import { definePlugin, getAbsPluginDir } from 'mioki'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import crypto from 'node:crypto'
import { sharedBrowser } from '../_shared/resource'
import type { GroupMessageEvent, PrivateMessageEvent } from 'napcat-sdk'
import express from 'express'

async function runWithReaction<T>(event: any, task: () => Promise<T>, id = '60'): Promise<T> {
  let reacted = false
  if (typeof event?.addReaction === 'function') {
    try {
      await event.addReaction(id)
      reacted = true
    } catch {}
  }

  try {
    return await task()
  } finally {
    if (reacted && typeof event?.delReaction === 'function') {
      await event.delReaction(id).catch(() => {})
    }
  }
}

const PLUGIN_NAME = '菜单'
const PLUGIN_VERSION = '1.1.0'

type MaterialTheme = 'material-light' | 'material-warm' | 'material-dark'
type LegacyTheme = 'eva-02' | 'hatsune' | 'cyberpunk'
type MenuTheme = MaterialTheme | LegacyTheme

interface PluginConfig {
  enabled: boolean
  command: string
  title: string
  subtitle: string
  theme: MenuTheme
  whitelist: number[]
  categories: Array<{
    name: string
    badge?: string
    desc?: string
    commands: string[]
    order?: number
    width?: number
  }>
}

function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeTheme(theme?: string): MaterialTheme {
  switch (theme) {
    case 'material-warm':
    case 'hatsune':
      return 'material-warm'
    case 'material-dark':
    case 'cyberpunk':
      return 'material-dark'
    case 'material-light':
    case 'eva-02':
    default:
      return 'material-light'
  }
}

function getThemeVariables(theme?: string): string {
  const palettes: Record<MaterialTheme, Record<string, string>> = {
    'material-light': {
      'md-bg': '#f7f8ff',
      'md-surface': '#fefbff',
      'md-surface-dim': '#f0f1fa',
      'md-surface-container-low': '#f8f6ff',
      'md-surface-container': '#f1eff7',
      'md-surface-container-high': '#e9e7ef',
      'md-on-surface': '#1b1b21',
      'md-on-surface-variant': '#46464f',
      'md-outline': '#777680',
      'md-outline-variant': '#c7c5d0',
      'md-primary': '#005ac1',
      'md-on-primary': '#ffffff',
      'md-primary-container': '#d8e2ff',
      'md-on-primary-container': '#001a41',
      'md-secondary': '#6750a4',
      'md-secondary-container': '#e9ddff',
      'md-tertiary': '#006a60',
      'md-tertiary-container': '#77f8e4',
      'md-shadow': 'rgba(24, 31, 54, 0.16)',
    },
    'material-warm': {
      'md-bg': '#fff8f1',
      'md-surface': '#fffdf8',
      'md-surface-dim': '#f4ece0',
      'md-surface-container-low': '#fff3e2',
      'md-surface-container': '#f8eddd',
      'md-surface-container-high': '#efe4d5',
      'md-on-surface': '#211b13',
      'md-on-surface-variant': '#51443a',
      'md-outline': '#837468',
      'md-outline-variant': '#d6c2b3',
      'md-primary': '#8a5100',
      'md-on-primary': '#ffffff',
      'md-primary-container': '#ffddb5',
      'md-on-primary-container': '#2c1600',
      'md-secondary': '#53643e',
      'md-secondary-container': '#d6ebbb',
      'md-tertiary': '#006a6a',
      'md-tertiary-container': '#80f4f0',
      'md-shadow': 'rgba(73, 47, 20, 0.16)',
    },
    'material-dark': {
      'md-bg': '#121318',
      'md-surface': '#1b1b21',
      'md-surface-dim': '#121318',
      'md-surface-container-low': '#202127',
      'md-surface-container': '#25262d',
      'md-surface-container-high': '#303139',
      'md-on-surface': '#e4e2ea',
      'md-on-surface-variant': '#c8c5d0',
      'md-outline': '#918f99',
      'md-outline-variant': '#47464f',
      'md-primary': '#abc7ff',
      'md-on-primary': '#002f68',
      'md-primary-container': '#00458f',
      'md-on-primary-container': '#d8e2ff',
      'md-secondary': '#d0bcff',
      'md-secondary-container': '#4f378b',
      'md-tertiary': '#7bded4',
      'md-tertiary-container': '#00504d',
      'md-shadow': 'rgba(0, 0, 0, 0.36)',
    },
  }

  return Object.entries(palettes[normalizeTheme(theme)])
    .map(([key, value]) => `        --${key}: ${value};`)
    .join('\n')
}

export function renderHtml(config: PluginConfig, avatarUrl: string, nickname: string): string {
  const sortedCategories = [...(config.categories || [])].sort((a, b) => (a.order ?? 10) - (b.order ?? 10))

  const categoriesHtml = sortedCategories
    .map((cat) => {
      const name = escapeHtml(cat.name)
      const badge = escapeHtml(cat.badge || '功能')
      const desc = cat.desc ? `<div class="category-desc">${escapeHtml(cat.desc)}</div>` : ''
      const commands = cat.commands || []
      const commandsList =
        commands.length > 0
          ? commands.map((cmd) => `<span class="cmd-chip">${escapeHtml(cmd)}</span>`).join('')
          : '<span class="cmd-chip cmd-chip-empty">暂无指令</span>'
      const width = cat.width === 2 ? 2 : 1

      return `
        <section class="category-card" style="grid-column: span ${width};">
          <div class="category-header">
            <div>
              <div class="category-badge">${badge}</div>
              <h2 class="category-title">${name}</h2>
            </div>
            <span class="category-count">${commands.length}</span>
          </div>
          ${desc}
          <div class="commands-container">
            ${commandsList}
          </div>
        </section>
      `
    })
    .join('')

  const totalCommands = sortedCategories.reduce((acc, cat) => acc + (cat.commands?.length || 0), 0)
  const title = escapeHtml(config.title || nickname || 'Mioki')
  const subtitle = escapeHtml(config.subtitle || '清晰有序的指令菜单')
  const botName = escapeHtml(nickname || 'Mioki')

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
${getThemeVariables(config.theme)}
        }
        body {
          margin: 0;
          padding: 24px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
          background:
            linear-gradient(135deg, var(--md-bg), var(--md-surface-dim));
          color: var(--md-on-surface);
          font-family: 'Noto Sans SC', 'Outfit', 'Microsoft YaHei', sans-serif;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-container {
          position: relative;
          overflow: hidden;
          width: 100%;
          padding: 30px;
          background: var(--md-surface);
          border: 1px solid var(--md-outline-variant);
          border-radius: 28px;
          box-shadow: 0 18px 44px var(--md-shadow);
        }
        .menu-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 12px;
          background: linear-gradient(90deg, var(--md-primary), var(--md-tertiary), var(--md-secondary));
        }
        .header-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 20px;
          align-items: center;
          padding: 24px;
          margin-bottom: 20px;
          background: var(--md-surface-container-low);
          border: 1px solid var(--md-outline-variant);
          border-radius: 24px;
        }
        .avatar-wrapper {
          position: relative;
          width: 76px;
          height: 76px;
          padding: 4px;
          border-radius: 24px;
          background: var(--md-primary-container);
        }
        .avatar-wrapper::after {
          content: '';
          position: absolute;
          right: 2px;
          bottom: 2px;
          width: 16px;
          height: 16px;
          background: var(--md-tertiary);
          border: 3px solid var(--md-surface-container-low);
          border-radius: 50%;
        }
        .avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 20px;
        }
        .header-info {
          min-width: 0;
        }
        .header-subtitle {
          margin-bottom: 4px;
          color: var(--md-on-surface-variant);
          font-size: 14px;
          font-weight: 600;
          line-height: 1.35;
        }
        .header-info h1 {
          color: var(--md-on-surface);
          font-size: 34px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: 0;
          overflow-wrap: anywhere;
        }
        .header-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }
        .meta-chip {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 6px 12px;
          border-radius: 16px;
          background: var(--md-secondary-container);
          color: var(--md-on-surface);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
        }
        .meta-chip strong {
          margin-right: 4px;
          color: var(--md-primary);
          font-size: 16px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .category-card {
          min-width: 0;
          padding: 18px;
          background: var(--md-surface-container);
          border: 1px solid var(--md-outline-variant);
          border-radius: 16px;
        }
        .category-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .category-badge {
          width: fit-content;
          max-width: 100%;
          margin-bottom: 6px;
          padding: 4px 9px;
          overflow: hidden;
          color: var(--md-on-primary-container);
          background: var(--md-primary-container);
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .category-title {
          color: var(--md-on-surface);
          font-size: 18px;
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0;
          overflow-wrap: anywhere;
        }
        .category-count {
          flex: 0 0 auto;
          min-width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--md-on-primary);
          background: var(--md-primary);
          border-radius: 17px;
          font-size: 14px;
          font-weight: 800;
        }
        .category-desc {
          margin-bottom: 13px;
          color: var(--md-on-surface-variant);
          font-size: 13px;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }
        .commands-container {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .cmd-chip {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          max-width: 100%;
          padding: 6px 11px;
          color: var(--md-primary);
          background: var(--md-surface);
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .cmd-chip-empty {
          color: var(--md-on-surface-variant);
          font-weight: 500;
        }
        .footer-card {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-top: 18px;
          padding: 14px 18px;
          color: var(--md-on-surface-variant);
          background: var(--md-surface-container-high);
          border-radius: 14px;
          font-size: 12px;
          font-weight: 600;
        }
        .footer-card strong {
          color: var(--md-primary);
        }
        @media (max-width: 780px) {
          .menu-wrapper { width: 100%; }
          .menu-container { padding: 22px; border-radius: 22px; }
          .header-card { grid-template-columns: 1fr; }
          .header-info h1 { font-size: 28px; }
          .menu-grid { grid-template-columns: 1fr; }
          .category-card { grid-column: span 1 !important; }
          .footer-card { flex-direction: column; }
        }
      </style>
    </head>
    <body>
      <div class="menu-wrapper">
        <main class="menu-container">
          <header class="header-card">
            <div class="avatar-wrapper">
              <img class="avatar" src="${avatarUrl}" alt="avatar" />
            </div>
            <div class="header-info">
              <div class="header-subtitle">${subtitle}</div>
              <h1>${title}</h1>
              <div class="header-meta">
                <span class="meta-chip"><strong>${sortedCategories.length}</strong> 功能</span>
                <span class="meta-chip"><strong>${totalCommands}</strong> 指令</span>
                <span class="meta-chip">Mioki</span>
              </div>
            </div>
          </header>

          <div class="menu-grid">
            ${categoriesHtml}
          </div>

          <footer class="footer-card">
            <span>Bot: <strong>${botName}</strong></span>
            <span>OneBot v11 · Material 3</span>
          </footer>
        </main>
      </div>
    </body>
    </html>
  `
}

export async function renderMenuImage(config: PluginConfig, avatarUrl: string, nickname: string): Promise<Buffer> {
  return sharedBrowser.withPage(
    async (page) => {
      await page.setContent(renderHtml(config, avatarUrl, nickname), { waitUntil: 'networkidle2', timeout: 20_000 })

      const target = await page.$('.menu-container')
      const image = await (target || page).screenshot({
        type: 'jpeg',
        quality: 90,
        encoding: 'binary',
      })

      return Buffer.from(image)
    },
    {
      label: `${PLUGIN_NAME} 菜单渲染`,
      timeoutMs: 35_000,
      viewport: { width: 850, height: 1800, deviceScaleFactor: 1.5 },
    },
  )
}

function getMenuImageCache(
  pluginDir: string,
  config: PluginConfig,
  avatarUrl: string,
  nickname: string,
  forceRefresh = false,
): { cachePath: string; hash: string; image: Buffer | null } {
  const cacheDir = join(pluginDir, 'cache')
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const hashObj = {
    config,
    avatarUrl,
    nickname,
    version: PLUGIN_VERSION,
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(hashObj)).digest('hex')
  const cachePath = join(cacheDir, `${hash}.jpg`)

  if (!forceRefresh && existsSync(cachePath)) {
    try {
      const image = readFileSync(cachePath)
      return { cachePath, hash, image }
    } catch {
      // Fallback
    }
  }

  return { cachePath, hash, image: null }
}

function saveMenuImageCache(cachePath: string, image: Buffer) {
  try {
    writeFileSync(cachePath, image)
    const cacheDir = dirname(cachePath)
    const files = readdirSync(cacheDir)
    const currentFile = cachePath.split(/[\\/]/).pop()
    for (const file of files) {
      if ((file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) && file !== currentFile) {
        try {
          unlinkSync(join(cacheDir, file))
        } catch {}
      }
    }
  } catch {}
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  dependencies: ['puppeteer-core'],
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '菜单')
    const configPath = join(pluginDir, 'config.json')

    // WebUI 预览页面与 API 注册
    const webui = ctx.services.webui as any
    if (webui) {
      const unregisterPage = webui.registerPage({
        id: 'menu-preview',
        title: '菜单预览',
        icon: '📊',
        url: '/plugins/菜单/index.html',
      })
      ctx.clears.add(() => unregisterPage?.())

      const router = express.Router()
      router.get('/preview/image', webui.authMiddleware, async (req: any, res: any) => {
        try {
          const forceRefresh = req.query.bypassCache === 'true'
          const config = loadConfig()
          const loginInfo = await ctx.bot.getLoginInfo().catch(() => ({
            user_id: ctx.self_id,
            nickname: 'Mioki',
          }))

          const avatarUrl = `http://q.qlogo.cn/headimg_dl?dst_uin=${loginInfo.user_id}&spec=640&img_type=jpg`
          const nickname = loginInfo.nickname || 'Mioki'

          const cached = getMenuImageCache(pluginDir, config, avatarUrl, nickname, forceRefresh)
          let image: Buffer
          if (cached.image) {
            image = cached.image
          } else {
            image = await renderMenuImage(config, avatarUrl, nickname)
            saveMenuImageCache(cached.cachePath, image)
          }

          res.set('Content-Type', 'image/jpeg')
          res.send(image)
        } catch (err: any) {
          ctx.logger.error(`[菜单] WebUI 预览生成失败: ${err.message}`)
          res.status(500).json({ error: err.message })
        }
      })

      const unregisterRouter = webui.registerRouter('/api/menu', router)
      ctx.clears.add(() => unregisterRouter?.())
    }

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        command: '菜单',
        title: 'MIOKI ASSISTANT',
        subtitle: '清晰有序的指令菜单',
        theme: 'material-light',
        whitelist: [],
        categories: [],
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
        ctx.logger.error(`[菜单] 加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    ctx.logger.info(`[菜单] 插件 v${PLUGIN_VERSION} 已加载`)

    const config = loadConfig()

    const handleMessage = async (e: GroupMessageEvent | PrivateMessageEvent) => {
      if (!config.enabled) return

      // Handle whitelist if in group
      if (
        e.message_type === 'group' &&
        config.whitelist &&
        config.whitelist.length > 0 &&
        !config.whitelist.includes(e.group_id)
      ) {
        return
      }

      // Check command matches
      const text = e.raw_message?.trim()
      if (!text) return

      const prefix = (ctx.botConfig.prefix ?? '#').replace(/[-_.\s+^$?[\]{}]/g, '\\$&')
      const cleanCommand = config.command.trim()
      const matchRegex = new RegExp(`^(?:${prefix})?${cleanCommand}$`)
      const refreshRegex = new RegExp(`^(?:${prefix})?${cleanCommand}(?:\\s+)?刷新$`)

      const isNormalMatch = matchRegex.test(text)
      const isRefreshMatch = refreshRegex.test(text)

      if (isNormalMatch || isRefreshMatch) {
        const forceRefresh = isRefreshMatch
        ctx.logger.info(`[菜单] 收到触发指令 (forceRefresh: ${forceRefresh}), 正在获取菜单图片...`)
        const renderAndReply = async () => {
          try {
            const loginInfo = await ctx.bot.getLoginInfo().catch(() => ({
              user_id: ctx.self_id,
              nickname: 'Mioki',
            }))

            const avatarUrl = `http://q.qlogo.cn/headimg_dl?dst_uin=${loginInfo.user_id}&spec=640&img_type=jpg`
            const nickname = loginInfo.nickname || 'Mioki'

            // Get from cache
            const cached = getMenuImageCache(pluginDir, config, avatarUrl, nickname, forceRefresh)
            let image: Buffer
            if (cached.image) {
              ctx.logger.info(`[菜单] 直接调用本地已缓存图片`)
              image = cached.image
            } else {
              ctx.logger.info(`[菜单] 缓存未命中/强制刷新，开始使用 Puppeteer 渲染...`)
              image = await renderMenuImage(config, avatarUrl, nickname)
              saveMenuImageCache(cached.cachePath, image)
            }

            await e.reply(ctx.segment.image(image))
            ctx.logger.info(`[菜单] 菜单图片发送成功`)
          } catch (err: any) {
            ctx.logger.error(`[菜单] 渲染/发送菜单失败: ${err.message}`)
            await e.reply(`菜单生成失败: ${err.message}`)
          }
        }

        if (e.message_type === 'group') {
          await runWithReaction(e, renderAndReply)
        } else {
          await renderAndReply()
        }
      }
    }

    ctx.handle('message.group', handleMessage)
    ctx.handle('message.private', handleMessage)
  },
})
