import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { definePlugin, getAbsPluginDir } from 'mioki'
import { sharedBrowser } from '../_shared/resource'

const PLUGIN_NAME = '状态'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  keywords: string[]
  theme: string
  whitelist: number[]
}

interface StatusData {
  bots: {
    uin: number
    nickname: string
    friends: number
    groups: number
    send: number
    receive: number
  }[]
  plugins: {
    enabled: number
    total: number
  }
  stats: {
    uptime: number
    send: number
    receive: number
  }
  versions: {
    node: string
    mioki: string
    napcat: string
    protocol: string
  }
  system: {
    name: string
    version: string
    arch: string
  }
  memory: {
    used: number
    total: number
    percent: number
    rss: {
      used: number
      percent: number
    }
  }
  disk: {
    total: number
    used: number
    free: number
    percent: number
  }
  cpu: {
    name: string
    count: number
    percent: number
  }
}

// Format bytes to readable size
function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

// Convert uptime milliseconds to a beautiful string
function formatUptime(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60)
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24)
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))

  const parts = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分`)
  if (parts.length === 0 || seconds > 0) parts.push(`${seconds}秒`)

  return parts.join('')
}

function renderHtml(status: StatusData, theme: string): string {
  const uptimeStr = formatUptime(status.stats.uptime)
  const miokiMemStr = formatBytes(status.memory.rss.used)
  const systemUsedStr = formatBytes(status.memory.used)
  const systemTotalStr = formatBytes(status.memory.total)

  const diskValid = status.disk.total > 0
  const diskUsedStr = formatBytes(status.disk.used)
  const diskTotalStr = formatBytes(status.disk.total)

  const pluginsDesc =
    status.plugins.enabled === status.plugins.total
      ? `共 ${status.plugins.total} 个插件已全部启用`
      : `共 ${status.plugins.total} 个插件，已启用 ${status.plugins.enabled} 个`

  // Webpage template to render in Puppeteer
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    :root {
      --font-body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", "PingFang SC", sans-serif;
      --font-mono: 'Consolas', 'Courier New', monospace;

      /* Light Theme styles */
      --primary: #0b57d0;
      --on-primary: #ffffff;
      --primary-container: #d3e3fd;
      --on-primary-container: #041e49;
      --text: #1f1f1f;
      --text-muted: #5f6368;
      --surface: #ffffff;
      --surface-variant: #f1f3f4;
      --outline: #74777f;
      --border: rgba(0, 0, 0, 0.08);
      --indicator-ok: #198754;

      /* Themes definition */
      ${
        theme === 'coral-sunset'
          ? `
          --bg-gradient: linear-gradient(135deg, #fff5f2 0%, #fbe3db 100%);
          --primary: #b63e2b;
          --on-primary: #ffffff;
          --primary-container: #ffdad5;
          --on-primary-container: #410002;
          `
          : theme === 'aurora-green'
          ? `
          --bg-gradient: linear-gradient(135deg, #f0f7f4 0%, #daebd8 100%);
          --primary: #296a4d;
          --on-primary: #ffffff;
          --primary-container: #aff2ce;
          --on-primary-container: #002114;
          `
          : theme === 'slate-classic'
          ? `
          --bg-gradient: linear-gradient(135deg, #f1f3f5 0%, #cfd4da 100%);
          --primary: #2b5f94;
          --on-primary: #ffffff;
          --primary-container: #d2e4ff;
          --on-primary-container: #001d37;
          `
          : `
          --bg-gradient: linear-gradient(135deg, #f4f6f9 0%, #e1e6eb 100%);
          --primary: #0b57d0;
          --on-primary: #ffffff;
          --primary-container: #d3e3fd;
          --on-primary-container: #041e49;
          `
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      margin: 0;
      padding: 30px;
      background: var(--bg-gradient);
      font-family: var(--font-body);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }

    .container {
      width: 720px;
      background: rgba(255, 255, 255, 0.75);
      backdrop-filter: blur(20px);
      border-radius: 28px;
      border: 1px solid var(--border);
      padding: 32px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.06);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
    }

    .header-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-icon {
      font-size: 28px;
    }

    .header-title {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--text);
    }

    .uptime-badge {
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
    }

    /* Grid Row */
    .grid-row {
      display: grid;
      grid-template-columns: 5fr 7fr;
      gap: 20px;
    }

    /* Card styling */
    .card {
      background: rgba(255, 255, 255, 0.6);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    /* Bots statistics */
    .bot-item {
      background: rgba(0, 0, 0, 0.02);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid rgba(0, 0, 0, 0.02);
    }

    .bot-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .bot-name {
      font-weight: 600;
      font-size: 15px;
      color: var(--text);
    }

    .bot-uin {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .bot-stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      text-align: center;
    }

    .bot-stat-box {
      background: rgba(0, 0, 0, 0.04);
      border-radius: 8px;
      padding: 6px;
    }

    .bot-stat-val {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .bot-stat-lbl {
      font-size: 9px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Gauges Dashboard representing RAM / CPU / Plugins */
    .dashboard-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }

    .gauge-card {
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .gauge-wrapper {
      position: relative;
      width: 100px;
      height: 100px;
      margin: 0 auto;
    }

    .gauge-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }

    .gauge-track {
      fill: none;
      stroke: rgba(0, 0, 0, 0.05);
      stroke-width: 8px;
    }

    .gauge-indicator {
      fill: none;
      stroke: var(--primary);
      stroke-width: 8px;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.8s ease-in-out;
    }

    .gauge-val {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: var(--font-mono);
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }

    .gauge-lbl {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 10px;
      font-weight: 600;
    }

    .gauge-detail {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      font-family: var(--font-mono);
    }

    /* Mioki Memory Showcase Badge */
    .rss-container {
      background: color-mix(in srgb, var(--primary) 8%, transparent);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .rss-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    .rss-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 3px;
    }

    .rss-badge {
      border: 1.5px solid var(--primary);
      background: transparent;
      color: var(--primary);
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 700;
      padding: 6px 16px;
      border-radius: 12px;
    }

    /* OS Info and Disk info details */
    .sys-details {
      display: grid;
      grid-template-columns: 85px 1fr;
      row-gap: 12px;
      column-gap: 16px;
      font-size: 13px;
      align-items: center;
    }

    .sys-detail-lbl {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .sys-detail-val {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--text);
    }

    /* Version strip */
    .footer-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--border);
      padding-top: 16px;
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-logo">
        <span class="header-icon">🟢</span>
        <span class="header-title">mioki 运行正常</span>
      </div>
      <div class="uptime-badge">已运行 ${uptimeStr}</div>
    </div>

    <!-- Bots and General System details -->
    <div class="grid-row">
      <!-- Bot Account card -->
      <div class="card">
        <div class="card-title">👤 机器人账号 (${status.bots.length})</div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${status.bots
            .map(
              (bot) => `
            <div class="bot-item">
              <div class="bot-header">
                <span class="bot-name">${bot.nickname}</span>
                <span class="bot-uin">${bot.uin}</span>
              </div>
              <div class="bot-stats-grid">
                <div class="bot-stat-box">
                  <div class="bot-stat-val">${bot.friends}</div>
                  <div class="bot-stat-lbl">好友</div>
                </div>
                <div class="bot-stat-box">
                  <div class="bot-stat-val">${bot.groups}</div>
                  <div class="bot-stat-lbl">群组</div>
                </div>
                <div class="bot-stat-box">
                  <div class="bot-stat-val">${bot.receive}</div>
                  <div class="bot-stat-lbl">接收</div>
                </div>
                <div class="bot-stat-box">
                  <div class="bot-stat-val">${bot.send}</div>
                  <div class="bot-stat-lbl">发送</div>
                </div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Environment and Disk info -->
      <div class="card">
        <div class="card-title">🖥️ 宿主系统</div>
        <div class="sys-details">
          <span class="sys-detail-lbl">操作系统</span>
          <span class="sys-detail-val">${status.system.name} (${status.system.arch})</span>
          <span class="sys-detail-lbl">系统版本</span>
          <span class="sys-detail-val">${status.system.version}</span>
          <span class="sys-detail-lbl">处理器</span>
          <span class="sys-detail-val">${status.cpu.name} (${status.cpu.count}核)</span>
          ${
            diskValid
              ? `
            <span class="sys-detail-lbl">磁盘利用率</span>
            <span class="sys-detail-val">${status.disk.percent}%</span>
            <span class="sys-detail-lbl">磁盘占用</span>
            <span class="sys-detail-val">${diskUsedStr} / ${diskTotalStr}</span>
          `
              : ''
          }
        </div>
      </div>
    </div>

    <!-- Gauges Row for RAM, CPU and Plugins -->
    <div class="dashboard-row">
      <!-- CPU Gauge -->
      <div class="card gauge-card">
        <div class="gauge-wrapper">
          <svg class="gauge-svg">
            <circle class="gauge-track" cx="50" cy="50" r="40" />
            <circle class="gauge-indicator" cx="50" cy="50" r="40"
              stroke-dasharray="251.2"
              stroke-dashoffset="${251.2 - (251.2 * status.cpu.percent) / 100}" />
          </svg>
          <div class="gauge-val">${status.cpu.percent}%</div>
        </div>
        <div class="gauge-lbl">CPU 占用率</div>
        <div class="gauge-detail">${status.cpu.name} ${status.cpu.count}核</div>
      </div>

      <!-- RAM Gauge -->
      <div class="card gauge-card">
        <div class="gauge-wrapper">
          <svg class="gauge-svg">
            <circle class="gauge-track" cx="50" cy="50" r="40" />
            <circle class="gauge-indicator" cx="50" cy="50" r="40"
              stroke-dasharray="251.2"
              stroke-dashoffset="${251.2 - (251.2 * status.memory.percent) / 100}" />
          </svg>
          <div class="gauge-val">${status.memory.percent}%</div>
        </div>
        <div class="gauge-lbl">系统内存占用</div>
        <div class="gauge-detail">${systemUsedStr} / ${systemTotalStr}</div>
      </div>

      <!-- Plugins load ratio Gauge -->
      <div class="card gauge-card">
        <div class="gauge-wrapper">
          <svg class="gauge-svg">
            <circle class="gauge-track" cx="50" cy="50" r="40" />
            <circle class="gauge-indicator" cx="50" cy="50" r="40"
              stroke-dasharray="251.2"
              stroke-dashoffset="${
                251.2 - (251.2 * status.plugins.enabled) / status.plugins.total
              }" />
          </svg>
          <div class="gauge-val">${status.plugins.enabled}</div>
        </div>
        <div class="gauge-lbl">插件启用数</div>
        <div class="gauge-detail">${pluginsDesc}</div>
      </div>
    </div>

    <!-- RSS Mioki RAM footprint Badge -->
    <div class="rss-container">
      <div>
        <div class="rss-title">🧠 mioki 自身常驻内存占用</div>
        <div class="rss-desc">Node.js 进程分配的物理内存大小 (Resident Set Size)</div>
      </div>
      <div class="rss-badge">${miokiMemStr}</div>
    </div>

    <!-- Footer strip representing Node.js / mioki / NapCat SDK versions -->
    <div class="footer-strip">
      <div>mioki/v${status.versions.mioki}</div>
      <div>NapCat/v${status.versions.napcat} (${status.versions.protocol})</div>
      <div>Node/v${status.versions.node}</div>
    </div>
  </div>
</body>
</html>
  `
}

async function renderImage(status: StatusData, theme: string): Promise<Buffer | null> {
  try {
    return await sharedBrowser.withPage(
      async (page) => {
        const html = renderHtml(status, theme)

        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {})

        const container = await page.$('.container')
        const image = await (container || page).screenshot({
          type: 'png',
          encoding: 'binary',
        })

        return Buffer.from(image)
      },
      {
        label: `${PLUGIN_NAME} 运行状态图渲染`,
        timeoutMs: 15_000,
        viewport: { width: 800, height: 1000, deviceScaleFactor: 2 },
      }
    )
  } catch (err) {
    console.error('[状态] 状态图片截图失败：', err)
    return null
  }
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '将框架运行数据结合系统硬件状态格式化为 Material Design 3 风格状态卡片并渲染为图片回复。',
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), PLUGIN_NAME)
    const configPath = join(pluginDir, 'config.json')

    // Load config configuration safely once at setup
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        keywords: ['状态'],
        theme: 'default-dark',
        whitelist: [],
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent),
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，回退到默认：${err.message}`)
        return defaultConfig
      }
    }

    // Set configuration variables to the execution context closure
    const pluginConfig = loadConfig()

    // 100% async message listener
    ctx.handle('message', async (e) => {
      if (!pluginConfig.enabled) return

      // White-list checking
      if (e.message_type === 'group' && pluginConfig.whitelist.length > 0) {
        if (!pluginConfig.whitelist.includes(e.group_id)) return
      }

      const rawText = ctx.text(e).trim()

      // Exact keyword matching (e.g. "状态")
      const isMatched = pluginConfig.keywords.includes(rawText)
      if (!isMatched) return

      // ❗IMPORTANT: Check prefix pattern.
      // If original string has a command prefix config rule matching prefix, skip this plugin.
      // And let original mioki-core builtin status logic reply with text version natively!
      const prefix = (ctx.botConfig.prefix ?? '#').replace(/[-_.^$?[\]{}]/g, '\\$&')
      const cmdPrefix = new RegExp(`^${prefix}`)
      if (cmdPrefix.test(rawText)) {
        // Contains # prefix - we skip this so builtin status cmd executes instead
        return
      }

      ctx.logger.info(`[状态] 收到用户 ${e.user_id} 的图片状态查询请求`)

      try {
        // Fetch raw data status using builtin frame service
        if (typeof ctx.services.getMiokiStatus !== 'function') {
          throw new Error('未在进程中发现核心服务的 getMiokiStatus 状态函数')
        }

        const rawStatus = (await ctx.services.getMiokiStatus()) as StatusData

        // Execute rendering tasks without creating temporary output files
        const imageBuffer = await renderImage(rawStatus, pluginConfig.theme)

        if (imageBuffer) {
          const imgBase64 = `base64://${imageBuffer.toString('base64')}`
          await e.reply(ctx.segment.image(imgBase64))
          ctx.logger.info('[状态] 状态图片回复发送成功')
        } else {
          throw new Error('生成的图片 Buffer 缓冲区为空')
        }
      } catch (err: any) {
        ctx.logger.error(`[状态] 获取/渲染状态图片错漏：${err.message}`)
        await e.reply(`❌ 无法获取或渲染状态大卡片：${err.message}`, true)
      }
    })

    ctx.logger.info(`[${PLUGIN_NAME}] 状态渲染插件启动成功`)
  },
})
