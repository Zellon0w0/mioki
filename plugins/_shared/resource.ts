import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Browser = import('puppeteer-core').Browser
type Page = import('puppeteer-core').Page

export interface TaskQueueStats {
  name: string
  concurrency: number
  running: number
  queued: number
  completed: number
  failed: number
  timedOut: number
  rejected: number
}

export interface TaskQueueOptions {
  name: string
  concurrency?: number
  maxQueued?: number
  timeoutMs?: number
}

export interface QueueRunOptions {
  label?: string
  timeoutMs?: number
}

interface QueueItem<T> {
  label: string
  timeoutMs: number
  controller: AbortController
  run: (signal: AbortSignal) => T | Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  settled: boolean
}

export class TaskQueue {
  private readonly name: string
  private readonly concurrency: number
  private readonly maxQueued: number
  private readonly timeoutMs: number
  private readonly queue: QueueItem<unknown>[] = []
  private running = 0
  private completed = 0
  private failed = 0
  private timedOut = 0
  private rejected = 0

  constructor(options: TaskQueueOptions) {
    this.name = options.name
    this.concurrency = Math.max(1, options.concurrency ?? 1)
    this.maxQueued = Math.max(0, options.maxQueued ?? 20)
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 30_000)
  }

  add<T>(run: (signal: AbortSignal) => T | Promise<T>, options: QueueRunOptions = {}): Promise<T> {
    if (this.maxQueued > 0 && this.queue.length >= this.maxQueued) {
      this.rejected += 1
      return Promise.reject(new Error(`${this.name} 队列已满，请稍后再试`))
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        label: options.label || this.name,
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
        controller: new AbortController(),
        run,
        resolve,
        reject,
        settled: false,
      } as QueueItem<unknown>)

      this.drain()
    })
  }

  stats(): TaskQueueStats {
    return {
      name: this.name,
      concurrency: this.concurrency,
      running: this.running,
      queued: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      timedOut: this.timedOut,
      rejected: this.rejected,
    }
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) return
      void this.runItem(item)
    }
  }

  private async runItem<T>(item: QueueItem<T>): Promise<void> {
    this.running += 1

    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        this.timedOut += 1
        const error = new Error(`${item.label} 执行超时`)
        item.controller.abort(error)
        reject(error)
      }, item.timeoutMs)
    })

    try {
      const value = await Promise.race([Promise.resolve().then(() => item.run(item.controller.signal)), timeoutPromise])
      if (!item.settled) {
        item.settled = true
        this.completed += 1
        item.resolve(value)
      }
    } catch (err) {
      if (!item.settled) {
        item.settled = true
        if (!timedOut) {
          this.failed += 1
        }
        item.reject(err)
      }
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
      this.running -= 1
      this.drain()
    }
  }
}

export interface BrowserPageOptions {
  label?: string
  timeoutMs?: number
  executablePath?: string
  viewport?: {
    width: number
    height: number
    deviceScaleFactor?: number
  }
}

export interface BrowserServiceStats {
  connected: boolean
  launching: boolean
  activePages: number
  executablePath: string
  launchedAt: number
  lastUsedAt: number
  idleCloseMs: number
}

export interface SharedBrowserService {
  withPage<T>(handler: (page: Page, signal: AbortSignal) => T | Promise<T>, options?: BrowserPageOptions): Promise<T>
  close(): Promise<void>
  stats(): BrowserServiceStats
}

export interface SharedQueues {
  render: TaskQueue
  heavy: TaskQueue
}

function getChromeCandidates(configuredPath?: string): string[] {
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const programFilesX86 = process.env['PROGRAMFILES(X86)']

  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    configuredPath,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    programFiles ? join(programFiles, 'Google/Chrome/Application/chrome.exe') : '',
    programFilesX86 ? join(programFilesX86, 'Google/Chrome/Application/chrome.exe') : '',
    localAppData ? join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function findChromeExecutable(configuredPath?: string): string {
  const executablePath = getChromeCandidates(configuredPath).find((candidate) => existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH')
  }
  return executablePath
}

class DefaultBrowserService implements SharedBrowserService {
  private browser: Browser | null = null
  private launchPromise: Promise<Browser> | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private activePages = 0
  private executablePath = ''
  private launchedAt = 0
  private lastUsedAt = 0

  constructor(
    private readonly queue: TaskQueue,
    private readonly idleCloseMs = 60_000,
  ) {}

  async withPage<T>(handler: (page: Page, signal: AbortSignal) => T | Promise<T>, options: BrowserPageOptions = {}) {
    return this.queue.add(
      async (signal) => {
        this.cancelIdleClose()
        this.activePages += 1
        this.lastUsedAt = Date.now()

        let page: Page | null = null
        const abortPage = () => {
          void page?.close().catch(() => {})
        }

        try {
          const browser = await this.getBrowser(options.executablePath)
          if (signal.aborted) throw signal.reason || new Error(`${options.label || '浏览器任务'} 已取消`)

          page = await browser.newPage()
          page.setDefaultTimeout(options.timeoutMs ?? 30_000)
          page.setDefaultNavigationTimeout(options.timeoutMs ?? 30_000)
          signal.addEventListener('abort', abortPage, { once: true })

          if (options.viewport) {
            await page.setViewport(options.viewport)
          }

          return await handler(page, signal)
        } finally {
          signal.removeEventListener('abort', abortPage)
          if (page && !page.isClosed()) {
            await page.close().catch(() => {})
          }
          this.activePages -= 1
          this.lastUsedAt = Date.now()
          this.scheduleIdleClose()
        }
      },
      {
        label: options.label || '浏览器渲染',
        timeoutMs: options.timeoutMs ?? 30_000,
      },
    )
  }

  async close(): Promise<void> {
    this.cancelIdleClose()

    const launchPromise = this.launchPromise
    const browser = this.browser

    this.launchPromise = null
    this.browser = null

    if (launchPromise) {
      try {
        const b = await launchPromise
        await Promise.race([
          b.close(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => {})
      } catch {}
      return
    }

    if (browser) {
      try {
        await Promise.race([
          browser.close(),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => {})
      } catch {}
    }
  }

  stats(): BrowserServiceStats {
    return {
      connected: Boolean(this.browser?.connected),
      launching: Boolean(this.launchPromise),
      activePages: this.activePages,
      executablePath: this.executablePath,
      launchedAt: this.launchedAt,
      lastUsedAt: this.lastUsedAt,
      idleCloseMs: this.idleCloseMs,
    }
  }

  private async getBrowser(configuredPath?: string): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser
    }

    this.browser = null

    if (!this.launchPromise) {
      this.launchPromise = this.launchBrowser(configuredPath)
    }

    return this.launchPromise
  }

  private async launchBrowser(configuredPath?: string): Promise<Browser> {
    const puppeteer = (await import('puppeteer-core')).default
    const executablePath = findChromeExecutable(configuredPath)
    this.executablePath = executablePath

    const userDataDir = join(process.cwd(), '.puppeteer_data')

    try {
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        timeout: 15_000,
        protocolTimeout: 30_000,
        userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--no-zygote',
          '--font-render-hinting=none',
        ],
      })

      this.browser = browser
      this.launchPromise = null
      this.launchedAt = Date.now()
      browser.on('disconnected', () => {
        if (this.browser === browser) {
          this.browser = null
        }
      })

      return browser
    } catch (err) {
      this.launchPromise = null
      this.browser = null
      throw err
    }
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose()
    if (this.activePages > 0 || !this.browser?.connected) return

    this.closeTimer = setTimeout(() => {
      if (this.activePages > 0) return
      void this.close()
    }, this.idleCloseMs)
  }

  private cancelIdleClose(): void {
    if (!this.closeTimer) return
    clearTimeout(this.closeTimer)
    this.closeTimer = null
  }
}

interface SharedState {
  queues: SharedQueues
  browser: SharedBrowserService
}

const globalKey = '__mioki_plugin_shared_resources__'
const state = ((globalThis as any)[globalKey] ||= (() => {
  const queues: SharedQueues = {
    render: new TaskQueue({ name: 'render', concurrency: 1, maxQueued: 12, timeoutMs: 35_000 }),
    heavy: new TaskQueue({ name: 'heavy', concurrency: 1, maxQueued: 8, timeoutMs: 120_000 }),
  }

  return {
    queues,
    browser: new DefaultBrowserService(queues.render),
  } satisfies SharedState
})()) as SharedState

export const sharedQueues = state.queues
export const sharedBrowser = state.browser

export function getSharedResourceStats() {
  return {
    queues: Object.values(sharedQueues).map((queue) => queue.stats()),
    browser: sharedBrowser.stats(),
  }
}
