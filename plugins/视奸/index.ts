import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer, { Browser } from 'puppeteer-core'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlink } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_NAME = '视奸'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  browserPath: string
  apiKey: string
}

interface PluginData {
  bindings: Record<string, string>
}

let globalBrowser: Browser | null = null

async function getBrowserInstance(browserPath: string): Promise<Browser> {
  if (!globalBrowser) {
    globalBrowser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none'
      ],
      defaultViewport: {
        width: 1000,
        height: 1000,
        deviceScaleFactor: 2
      }
    })
  }
  return globalBrowser
}

async function closeBrowserInstance(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close()
    globalBrowser = null
  }
}

async function generateStalkImage(profile: any, games: any[], browserPath: string): Promise<string> {
  const browser = await getBrowserInstance(browserPath)
  const page = await browser.newPage()

  const fontStyle = `"汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", sans-serif`

  // 过滤出两周内玩过的游戏
  const recentGames = games.filter(g => (g.playtime.recent || g.playtime.recent_minutes) > 0)

  const htmlContent = `
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 40px;
            background: #1b2838;
            color: #c7d5e0;
            font-family: ${fontStyle};
          }
          .container {
            background: #171a21;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            max-width: 800px;
            margin: auto;
          }
          .header {
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 30px;
            border-bottom: 1px solid #2a475e;
            padding-bottom: 20px;
          }
          .avatar {
            width: 120px;
            height: 120px;
            border-radius: 4px;
            border: 2px solid #66c0f4;
          }
          .info {
            flex-grow: 1;
          }
          .name {
            font-size: 36px;
            font-weight: 850;
            color: #fff;
            margin-bottom: 5px;
          }
          .status {
            font-size: 20px;
            color: ${profile.is_online ? '#66c0f4' : '#898989'};
          }
          .section-title {
            font-size: 24px;
            color: #66c0f4;
            margin: 20px 0 15px;
            border-left: 4px solid #66c0f4;
            padding-left: 12px;
          }
          .game-list {
            display: flex;
            flex-direction: column;
            gap: 15px;
          }
          .game-item {
            display: flex;
            align-items: center;
            gap: 15px;
            background: #2a475e;
            padding: 10px;
            border-radius: 4px;
          }
          .game-header {
            width: 180px;
            height: 84px;
            object-fit: cover;
            border-radius: 2px;
          }
          .game-info {
            flex-grow: 1;
          }
          .game-name {
            font-size: 22px;
            font-weight: bold;
            color: #fff;
            margin-bottom: 5px;
          }
          .playtime {
            font-size: 16px;
            color: #acb2b8;
          }
          .recent {
            color: #66c0f4;
            font-weight: bold;
          }
          .empty {
            text-align: center;
            padding: 20px;
            color: #898989;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img class="avatar" src="${profile.avatar.full}">
            <div class="info">
              <div class="name">${profile.persona_name}</div>
              <div class="status">${profile.online_status_desc}</div>
            </div>
          </div>
          
          <div class="section-title">最近两周游戏记录</div>
          <div class="game-list">
            ${recentGames.length > 0 ? recentGames.map(game => `
              <div class="game-item">
                <img class="game-header" src="${game.image.header}">
                <div class="game-info">
                  <div class="game-name">${game.name}</div>
                  <div class="playtime">
                    两周内：<span class="recent">${game.playtime.recent_desc}</span> / 
                    总计：${game.playtime.total_desc}
                  </div>
                </div>
              </div>
            `).join('') : '<div class="empty">两周内没有游戏记录</div>'}
          </div>
        </div>
      </body>
    </html>
  `

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' })
  const tempDir = join(getAbsPluginDir(), '视奸', 'temp')
  const outputPath = join(tempDir, `stalk-${Date.now()}.png`)
  const container = await page.$('.container')
  if (container) {
    await container.screenshot({ path: outputPath, type: 'png', omitBackground: true })
  } else {
    await page.screenshot({ path: outputPath, fullPage: true, type: 'png' })
  }
  await page.close()
  return outputPath
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '视奸')
    const configPath = join(pluginDir, 'config.json')
    const dataPath = join(pluginDir, 'data.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        browserPath: '/usr/bin/chromium',
        apiKey: '88ab2ca23dc4d78eb39cfb9b09c529e7'
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return { ...defaultConfig, ...JSON.parse(fileContent) }
      } catch (err: any) {
        ctx.logger.error(`加载配置失败，将使用默认配置: ${err.message}`)
        return defaultConfig
      }
    }

    const loadData = (): PluginData => {
      const defaultData: PluginData = {
        bindings: {}
      }

      if (!existsSync(dataPath)) {
        return defaultData
      }

      try {
        const fileContent = readFileSync(dataPath, 'utf-8')
        return { ...defaultData, ...JSON.parse(fileContent) }
      } catch (err: any) {
        ctx.logger.error(`加载数据失败，将使用默认数据: ${err.message}`)
        return defaultData
      }
    }

    const saveData = (data: PluginData) => {
      try {
        writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存数据失败: ${err.message}`)
      }
    }

    const tempDir = join(pluginDir, 'temp')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      const text = ctx.text(e).trim()
      const data = loadData()
      const bindings = data.bindings

      // 1. 处理绑定：#视奸绑定 小b xxxxx
      if (text.startsWith('#视奸绑定')) {
        const parts = text.split(/\s+/)
        if (parts.length !== 3) {
          return e.reply('格式错误：#视奸绑定 昵称 SteamID')
        }
        const nickname = parts[1]
        const steamId = parts[2]
        bindings[nickname] = steamId
        saveData({ bindings })
        return e.reply(`绑定成功：${nickname} -> ${steamId}`)
      }

      // 2. 处理解绑：#视奸解绑 小b 或 #视奸解绑 xxxxx
      if (text.startsWith('#视奸解绑')) {
        const target = text.replace('#视奸解绑', '').trim()
        if (!target) return e.reply('格式错误：#视奸解绑 昵称或SteamID')

        let removed = false
        // 按昵称删除
        if (bindings[target]) {
          delete bindings[target]
          removed = true
        } else {
          // 按 SteamID 删除
          for (const [nick, id] of Object.entries(bindings)) {
            if (id === target) {
              delete bindings[nick]
              removed = true
            }
          }
        }

        if (removed) {
          saveData({ bindings })
          return e.reply(`解绑成功：${target}`)
        } else {
          return e.reply(`未找到相关绑定：${target}`)
        }
      }

      // 3. 处理查询：#视奸小a 或 #视奸 76561199076421920 或 #视奸 shirosakishizuku
      if (text.startsWith('#视奸')) {
        let query = text.replace('#视奸', '').trim()
        if (!query) return // 忽略只有指令的情况

        let steamId = query
        // 如果查询的是昵称，则转换为 SteamID
        if (bindings[query]) {
          steamId = bindings[query]
        }

        // 检查是否需要通过 API 转换 ID (非 17 位数字且非绑定昵称)
        if (!/^\d{17}$/.test(steamId)) {
          ctx.logger.info(`[视奸] 尝试转换 Steam ID: ${steamId}`)
          try {
            const convRes = await fetch(`https://api.viki.moe/steam/id2id/${steamId}?key=${config.apiKey}`)
            if (convRes.ok) {
              const convData = await convRes.json()
              if (convData.steam_id_64) {
                steamId = convData.steam_id_64
                ctx.logger.info(`[视奸] 转换成功: ${query} -> ${steamId}`)
              }
            }
          } catch (err) {
            ctx.logger.warn(`[视奸] ID 转换请求失败: ${err}`)
          }
        }

        // 最后的 SteamID 格式验证
        if (!/^\d{17}$/.test(steamId)) {
          // 如果依然不是 17 位数字，说明可能是普通文本或转换失败
          return e.reply(`未找到有效的 SteamID 或绑定：${query}`)
        }

        ctx.logger.info(`[视奸] 正在查询 SteamID: ${steamId}`)
        try {
          // 并行获取用户信息和游戏记录
          const [profileRes, gamesRes] = await Promise.all([
            fetch(`https://api.viki.moe/steam/${steamId}?key=${config.apiKey}`),
            fetch(`https://api.viki.moe/steam/${steamId}/recently-played?key=${config.apiKey}`)
          ])

          if (!profileRes.ok) throw new Error('无法获取用户信息')
          if (!gamesRes.ok) throw new Error('无法获取游戏记录')

          const profile = await profileRes.json()
          const games = await gamesRes.json()

          if (profile.error) throw new Error(profile.error)

          const imgPath = await generateStalkImage(profile, games, config.browserPath)
          await e.reply(ctx.segment.image(`file://${imgPath}`))

          // 延迟清理
          setTimeout(() => {
            if (existsSync(imgPath)) unlink(imgPath, () => {})
          }, 10000)

        } catch (err) {
          ctx.logger.error(`[视奸] 查询失败: ${err}`)
          await e.reply(`查询失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })

    return () => {
      closeBrowserInstance()
    }
  }
})
