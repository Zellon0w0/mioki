import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from 'puppeteer-core'
import type { GroupMessageEvent, PrivateMessageEvent } from 'napcat-sdk'

const PLUGIN_NAME = '菜单'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  command: string
  title: string
  subtitle: string
  theme: 'eva-02' | 'hatsune' | 'cyberpunk'
  whitelist: number[]
  categories: Array<{
    name: string
    badge?: string
    desc?: string
    commands: string[]
  }>
}

let browser: Browser | null = null

function getChromeCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const programFilesX86 = process.env['PROGRAMFILES(X86)']

  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
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

function findChromeExecutable(): string {
  const executablePath = getChromeCandidates().find((candidate) => existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH')
  }
  return executablePath
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      executablePath: findChromeExecutable(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--font-render-hinting=none',
      ],
      defaultViewport: {
        width: 850,
        height: 1200,
        deviceScaleFactor: 2,
      },
    })
  }
  return browser
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

function renderHtml(config: PluginConfig, avatarUrl: string, nickname: string): string {
  const categoriesHtml = config.categories
    .map((cat) => {
      const name = escapeHtml(cat.name)
      const badge = cat.badge ? `<span class="category-badge">${escapeHtml(cat.badge)}</span>` : ''
      const desc = cat.desc ? `<div class="category-desc">${escapeHtml(cat.desc)}</div>` : ''
      const commandsList = (cat.commands || [])
        .map((cmd) => `<span class="cmd-chip">${escapeHtml(cmd)}</span>`)
        .join('')

      return `
        <div class="category-card">
          <div class="category-header">
            <h2 class="category-title">${name}</h2>
            ${badge}
          </div>
          ${desc}
          <div class="commands-container">
            ${commandsList}
          </div>
        </div>
      `
    })
    .join('')

  const totalCommands = config.categories.reduce((acc, cat) => acc + (cat.commands?.length || 0), 0)

  // Style templates based on theme
  let themeCss = ''
  let layoutHtml = ''

  if (config.theme === 'eva-02') {
    // Neon Genesis Evangelion Unit-02 (二号机) Theme
    themeCss = `
      :root {
        --bg-color: #121318;
        --card-bg: rgba(26, 27, 35, 0.85);
        --text-color: #ffffff;
        --text-muted: #8c8d99;
        --accent-red: #e53935;
        --accent-orange: #ff6d00;
        --accent-yellow: #ffb300;
        --accent-yellow-glow: rgba(255, 179, 0, 0.4);
        --border-color: #ff3d00;
        --chip-bg: rgba(255, 61, 0, 0.05);
        --chip-border: rgba(255, 61, 0, 0.3);
        --chip-text: #ff6d00;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          linear-gradient(rgba(255, 61, 0, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 61, 0, 0.03) 1px, transparent 1px);
        background-size: 20px 20px;
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        border: 2px solid var(--border-color);
        padding: 24px;
        background: radial-gradient(circle at top right, rgba(255, 61, 0, 0.05) 0%, transparent 70%);
        position: relative;
        overflow: hidden;
      }
      .menu-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 4px;
        background: repeating-linear-gradient(-45deg, var(--accent-yellow), var(--accent-yellow) 10px, #121318 10px, #121318 20px);
      }
      
      /* Header styles */
      .header-card {
        background: rgba(26, 27, 35, 0.95);
        border: 1px solid var(--border-color);
        border-top: 4px solid var(--border-color);
        padding: 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        position: relative;
        clip-path: polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%);
      }
      .header-card::after {
        content: 'SYS STATUS: ACTIVE [EVA-02]';
        position: absolute;
        top: 8px;
        right: 12px;
        font-size: 10px;
        color: var(--accent-yellow);
        font-family: monospace;
        letter-spacing: 1px;
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border: 2px solid var(--border-color);
        padding: 3px;
        background: #121318;
        clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);
        margin-right: 24px;
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);
      }
      .header-info h1 {
        font-size: 26px;
        font-weight: 800;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 0 10px rgba(229, 57, 53, 0.4);
      }
      .header-subtitle {
        font-size: 13px;
        color: var(--accent-yellow);
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .header-meta {
        font-size: 12px;
        color: var(--text-muted);
        font-family: monospace;
      }
      .header-meta span {
        color: var(--accent-orange);
        font-weight: bold;
      }

      /* Card styles */
      .category-card {
        background: var(--card-bg);
        border: 1px solid rgba(255, 61, 0, 0.2);
        border-left: 4px solid var(--border-color);
        margin-bottom: 20px;
        padding: 20px;
        clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(255, 61, 0, 0.15);
        padding-bottom: 8px;
      }
      .category-title {
        font-size: 17px;
        font-weight: 700;
        color: var(--text-color);
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .category-badge {
        font-size: 11px;
        font-weight: bold;
        background: var(--border-color);
        color: #fff;
        padding: 2px 8px;
        border-radius: 2px;
        font-family: monospace;
      }
      .category-desc {
        font-size: 13px;
        color: var(--text-muted);
        margin-bottom: 15px;
        line-height: 1.4;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 13px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 5px 12px;
        margin: 4px 6px 4px 0;
        font-weight: 600;
        font-family: monospace;
      }

      /* Footer */
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: rgba(26, 27, 35, 0.95);
        border: 1px solid var(--border-color);
        margin-top: 24px;
        font-size: 11px;
        font-family: monospace;
        color: var(--text-muted);
        clip-path: polygon(0 10px, 10px 0, 100% 0, 100% 100%, 0 100%);
      }
      .footer-side strong {
        color: var(--accent-yellow);
      }
    `
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.subtitle || 'TACTICAL ASSISTANT')}</div>
            <h1>${escapeHtml(config.title || nickname)}</h1>
            <div class="header-meta">
              COMMANDS LOADED: <span>${totalCommands}</span> UNITS // SECTORS: <span>${config.categories.length}</span> ACTIVE
            </div>
          </div>
        </div>

        <div class="menu-grid">
          ${categoriesHtml}
        </div>

        <div class="footer-card">
          <div class="footer-side">
            FRAMEWORK: <strong>MIOKI // VER ${escapeHtml(PLUGIN_VERSION)}</strong>
          </div>
          <div class="footer-side">
            PILOT: <strong>${escapeHtml(nickname)} // STATUS_NORMAL</strong>
          </div>
        </div>
      </div>
    `
  } else if (config.theme === 'hatsune') {
    // Miku Cyan glassmorphism theme
    themeCss = `
      :root {
        --bg-color: #f0f7f6;
        --card-bg: rgba(255, 255, 255, 0.65);
        --text-color: #1e3a38;
        --text-muted: #5e7c7a;
        --accent-teal: #00c4b4;
        --accent-light: #e0f7f5;
        --border-color: rgba(255, 255, 255, 0.5);
        --chip-bg: rgba(0, 196, 180, 0.08);
        --chip-border: rgba(0, 196, 180, 0.25);
        --chip-text: #00897b;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          radial-gradient(at 0% 0%, rgba(224, 247, 245, 0.8) 0, transparent 50%),
          radial-gradient(at 100% 100%, rgba(227, 242, 253, 0.8) 0, transparent 50%);
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        padding: 30px;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 32px;
        box-shadow: 0 20px 50px rgba(0, 196, 180, 0.05);
      }
      
      /* Header styles */
      .header-card {
        background: var(--card-bg);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border-color);
        padding: 28px;
        margin-bottom: 28px;
        border-radius: 24px;
        display: flex;
        align-items: center;
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.04);
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        padding: 3px;
        background: linear-gradient(135deg, #00c4b4, #00b0ff);
        margin-right: 24px;
        box-shadow: 0 8px 24px rgba(0, 196, 180, 0.2);
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid #fff;
      }
      .header-info h1 {
        font-size: 28px;
        font-weight: 800;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 0.5px;
      }
      .header-subtitle {
        font-size: 14px;
        color: var(--accent-teal);
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .header-meta {
        font-size: 13px;
        color: var(--text-muted);
      }

      /* Card styles */
      .category-card {
        background: var(--card-bg);
        backdrop-filter: blur(10px);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        margin-bottom: 20px;
        padding: 22px;
        box-shadow: 0 8px 32px 0 rgba(0, 196, 180, 0.02);
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .category-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-color);
      }
      .category-badge {
        font-size: 11px;
        font-weight: 600;
        background: var(--accent-light);
        color: var(--chip-text);
        padding: 3px 10px;
        border-radius: 20px;
      }
      .category-desc {
        font-size: 13.5px;
        color: var(--text-muted);
        margin-bottom: 16px;
        line-height: 1.45;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 13px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 6px 14px;
        margin: 5px 6px 5px 0;
        border-radius: 100px;
        font-weight: 500;
      }

      /* Footer */
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        background: var(--card-bg);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border-color);
        margin-top: 28px;
        font-size: 12px;
        color: var(--text-muted);
        border-radius: 20px;
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.04);
      }
      .footer-side strong {
        color: var(--accent-teal);
        font-weight: 700;
      }
    `
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.title || 'MIOKU ASSISTANT')}</div>
            <h1>${escapeHtml(config.subtitle || nickname)}</h1>
            <div class="header-meta">
              共 ${config.categories.length} 个功能分类，包含 ${totalCommands} 个指令
            </div>
          </div>
        </div>

        <div class="menu-grid">
          ${categoriesHtml}
        </div>

        <div class="footer-card">
          <div class="footer-side">
            Framework: <strong>Mioki</strong>
          </div>
          <div class="footer-side">
            Platform: <strong>OneBot v11</strong>
          </div>
        </div>
      </div>
    `
  } else {
    // Cyberpunk theme
    themeCss = `
      :root {
        --bg-color: #05060b;
        --card-bg: rgba(10, 11, 20, 0.9);
        --text-color: #ffffff;
        --text-muted: #727b93;
        --accent-cyan: #00f3ff;
        --accent-magenta: #ff007f;
        --accent-yellow: #fefe00;
        --border-color: #1e293b;
        --chip-bg: rgba(0, 243, 255, 0.03);
        --chip-border: rgba(0, 243, 255, 0.3);
        --chip-text: #00f3ff;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          linear-gradient(rgba(0, 243, 255, 0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 243, 255, 0.02) 1px, transparent 1px);
        background-size: 30px 30px;
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        padding: 24px;
        position: relative;
      }
      .menu-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--accent-magenta), var(--accent-cyan));
      }
      
      /* Header styles */
      .header-card {
        background: var(--card-bg);
        border: 2px solid var(--accent-cyan);
        box-shadow: 0 0 15px rgba(0, 243, 255, 0.2);
        padding: 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        position: relative;
      }
      .header-card::before {
        content: 'NEON HUD V1.0';
        position: absolute;
        top: -10px;
        left: 20px;
        font-size: 9px;
        font-weight: bold;
        background: var(--accent-cyan);
        color: #000;
        padding: 1px 6px;
        font-family: monospace;
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border: 2px solid var(--accent-magenta);
        box-shadow: 0 0 10px rgba(255, 0, 127, 0.3);
        margin-right: 24px;
        transform: skewX(-5deg);
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .header-info h1 {
        font-size: 30px;
        font-weight: 900;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 0 8px rgba(0, 243, 255, 0.5);
      }
      .header-subtitle {
        font-size: 13px;
        color: var(--accent-yellow);
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .header-meta {
        font-size: 12px;
        color: var(--text-muted);
        font-family: monospace;
      }

      /* Card styles */
      .category-card {
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-left: 4px solid var(--accent-cyan);
        margin-bottom: 20px;
        padding: 20px;
        position: relative;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }
      .category-card::after {
        content: '///';
        position: absolute;
        bottom: 5px;
        right: 10px;
        font-size: 9px;
        color: rgba(0, 243, 255, 0.2);
        font-family: monospace;
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .category-title {
        font-size: 17px;
        font-weight: 800;
        color: var(--text-color);
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .category-badge {
        font-size: 10px;
        font-weight: bold;
        border: 1px solid var(--accent-magenta);
        color: var(--accent-magenta);
        padding: 2px 6px;
        font-family: monospace;
        text-transform: uppercase;
      }
      .category-desc {
        font-size: 13px;
        color: var(--text-muted);
        margin-bottom: 14px;
        line-height: 1.4;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 12.5px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 5px 12px;
        margin: 4px 6px 4px 0;
        font-family: monospace;
        text-shadow: 0 0 5px rgba(0, 243, 255, 0.3);
      }

      /* Footer */
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        margin-top: 24px;
        font-size: 11px;
        font-family: monospace;
        color: var(--text-muted);
      }
      .footer-side strong {
        color: var(--accent-magenta);
      }
    `
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.subtitle || 'CYBER ASSISTANT')}</div>
            <h1>${escapeHtml(config.title || nickname)}</h1>
            <div class="header-meta">
              DB_COMMANDS: ${totalCommands} CELLS // CATEGORIES: ${config.categories.length} NODES
            </div>
          </div>
        </div>

        <div class="menu-grid">
          ${categoriesHtml}
        </div>

        <div class="footer-card">
          <div class="footer-side">
            CORE: <strong>MIOKI ENGINE</strong>
          </div>
          <div class="footer-side">
            SYS: <strong>ONLINE</strong>
          </div>
        </div>
      </div>
    `
  }

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          margin: 0;
          padding: 20px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        /* Make long cards take full width */
        .category-card:first-child,
        .category-card:nth-child(3n) {
          grid-column: span 2;
        }
        @media (max-width: 780px) {
          .menu-wrapper { width: 100%; }
          .menu-grid { grid-template-columns: 1fr; }
          .category-card:first-child,
          .category-card:nth-child(3n) { grid-column: span 1; }
        }
        ${themeCss}
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="menu-wrapper">
        ${layoutHtml}
      </div>
    </body>
    </html>
  `
}

async function renderMenuImage(config: PluginConfig, avatarUrl: string, nickname: string): Promise<Buffer> {
  const instance = await getBrowser()
  const page = await instance.newPage()

  try {
    await page.setViewport({ width: 850, height: 1800, deviceScaleFactor: 2 })
    await page.setContent(renderHtml(config, avatarUrl, nickname), { waitUntil: 'networkidle0', timeout: 30_000 })

    const target = await page.$('.menu-container')
    const image = await (target || page).screenshot({
      type: 'png',
      encoding: 'binary',
    })

    return Buffer.from(image)
  } finally {
    await page.close()
  }
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  dependencies: ['puppeteer-core'],
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '菜单')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        command: '菜单',
        title: 'MIOKI ASSISTANT',
        subtitle: 'EVA UNIT-02 EDITION',
        theme: 'eva-02',
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

    ctx.clears.add(async () => {
      if (browser) {
        ctx.logger.info('[菜单] 正在关闭 Puppeteer 浏览器实例...')
        await browser.close()
        browser = null
      }
    })

    ctx.logger.info(`[菜单] 插件 v${PLUGIN_VERSION} 已加载`)

    const handleMessage = async (e: GroupMessageEvent | PrivateMessageEvent) => {
      const config = loadConfig()
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
      const matchRegex = new RegExp(`^(?:${prefix})?${config.command.trim()}$`)

      if (matchRegex.test(text)) {
        ctx.logger.info(`[菜单] 收到触发指令, 正在渲染菜单图片...`)
        try {
          const loginInfo = await ctx.bot.getLoginInfo().catch(() => ({
            user_id: ctx.self_id,
            nickname: 'Mioki',
          }))

          const avatarUrl = `http://q.qlogo.cn/headimg_dl?dst_uin=${loginInfo.user_id}&spec=640&img_type=jpg`
          const nickname = loginInfo.nickname || 'Mioki'

          const image = await renderMenuImage(config, avatarUrl, nickname)
          await e.reply(ctx.segment.image(image))
          ctx.logger.info(`[菜单] 菜单图片发送成功`)
        } catch (err: any) {
          ctx.logger.error(`[菜单] 渲染/发送菜单失败: ${err.message}`)
          await e.reply(`菜单生成失败: ${err.message}`)
        }
      }
    }

    ctx.handle('message.group', handleMessage)
    ctx.handle('message.private', handleMessage)
  },
})
