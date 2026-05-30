import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer, { Browser } from 'puppeteer-core'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, unlink } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_NAME = '5E查询'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  browserPath: string
  userAgent: string
  cookie: string
  whitelist: number[]
}

const TEMP_DIR = join(__dirname, 'temp')

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '5E查询')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        browserPath: '/usr/bin/chromium',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        cookie: '',
        whitelist: []
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent)
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

    let globalBrowser: Browser | null = null

    async function getBrowserInstance(browserPath: string): Promise<Browser> {
      if (!globalBrowser) {
        globalBrowser = await puppeteer.launch({
          executablePath: browserPath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          defaultViewport: { width: 1000, height: 1200, deviceScaleFactor: 2 }
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

    async function fetchWithHeaders(url: string, config: PluginConfig) {
      const res = await fetch(url, {
        headers: {
          'User-Agent': config.userAgent,
          'Cookie': config.cookie,
          'Referer': 'https://arena.5eplay.com/'
        }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    }

    async function getPlayerUuid(keywords: string, config: PluginConfig): Promise<{ uuid: string, username: string, avatar: string }> {
      const searchUrl = `https://arena.5eplay.com/api/search?keywords=${encodeURIComponent(keywords)}`
      const data = await fetchWithHeaders(searchUrl, config)
      
      const user = data?.data?.user?.list?.[0]
      if (!user) throw new Error('未找到该玩家')

      // 使用 idTransfer 接口将 domain 转换为 uuid
      const transferUrl = 'https://gate.5eplay.com/userinterface/http/v1/userinterface/idTransfer'
      const transferRes = await fetch(transferUrl, {
        method: 'POST',
        headers: {
          'User-Agent': config.userAgent,
          'Cookie': config.cookie,
          'Content-Type': 'application/json',
          'Referer': 'https://arena.5eplay.com/'
        },
        body: JSON.stringify({
          trans: { domain: user.domain }
        })
      })

      if (!transferRes.ok) throw new Error(`UUID 转换失败: HTTP ${transferRes.status}`)
      const transferData = await transferRes.json()
      
      if (transferData.code !== 0 || !transferData.data?.uuid) {
        throw new Error('无法解析玩家 UUID')
      }

      return {
        uuid: transferData.data.uuid,
        username: user.username,
        avatar: user.avatar_url.startsWith('http') ? user.avatar_url : `https://oss-arena.5eplay.com/${user.avatar_url.replace(/^\//, '')}`
      }
    }

    async function generate5EImage(playerInfo: any, careerData: any, matches: any[], config: PluginConfig): Promise<string> {
      const browser = await getBrowserInstance(config.browserPath)
      const page = await browser.newPage()

      const fontStyle = `"汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", sans-serif`

      const formatDate = (timestamp: string | number) => {
        const date = new Date(Number(timestamp) * 1000)
        const Y = date.getFullYear()
        const M = String(date.getMonth() + 1).padStart(2, '0')
        const D = String(date.getDate()).padStart(2, '0')
        const h = String(date.getHours()).padStart(2, '0')
        const m = String(date.getMinutes()).padStart(2, '0')
        return `${Y}-${M}-${D} ${h}:${m}`
      }

      const formatDuration = (start: string | number, end: string | number) => {
        const durationMs = (Number(end) - Number(start))
        const minutes = Math.floor(durationMs / 60)
        return `${minutes}min`
      }

      const htmlContent = `
        <html>
          <head>
            <style>
              body { margin: 0; padding: 40px; background: #0b0e11; color: #fff; font-family: ${fontStyle}; }
              .container { background: #1a1d21; padding: 30px; border-radius: 12px; width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
              .header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; }
              .avatar { width: 80px; height: 80px; border-radius: 50%; border: 3px solid #ffcc00; }
              .user-info .name { font-size: 32px; font-weight: 850; margin-bottom: 4px; }
              .user-info .sub { font-size: 16px; color: #8a8d91; }
              
              .elo-box { background: linear-gradient(90deg, #2a2d32 0%, #1a1d21 100%); padding: 20px; border-radius: 8px; border-left: 4px solid #86ef47; display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
              .elo-label { color: #8a8d91; font-size: 18px; }
              .elo-value { color: #86ef47; font-size: 36px; font-weight: 850; }
              .win-rate { font-size: 32px; font-weight: 850; color: #86ef47; }
              .win-rate-label { color: #8a8d91; font-size: 18px; margin-right: 10px; }

              .stats-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 30px; }
              .stat-item .label { font-size: 14px; color: #8a8d91; text-transform: uppercase; margin-bottom: 8px; }
              .stat-item .value { font-size: 24px; font-weight: 850; color: #ffcc00; }

              .recent-title { font-size: 18px; color: #8a8d91; margin-bottom: 15px; text-transform: uppercase; border-bottom: 1px solid #2a2d32; padding-bottom: 8px; }
              .match-list { display: flex; flex-direction: column; gap: 10px; }
              .match-item { background: #23262a; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
              .match-main { display: flex; align-items: center; gap: 12px; }
              .match-result { width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
              .result-win { background: #4caf50; color: #fff; }
              .result-loss { background: #f44336; color: #fff; }
              .result-tie { background: #9e9e9e; color: #fff; }
              .match-info { flex: 1; display: flex; flex-direction: column; }
              .match-map-row { display: flex; align-items: center; gap: 8px; }
              .mvp-badge { background: #ffcc00; color: #000; font-size: 10px; font-weight: 850; padding: 0 4px; border-radius: 2px; height: 14px; display: flex; align-items: center; line-height: 1; }
              .match-map { font-size: 16px; font-weight: bold; }
              .match-score { font-size: 12px; color: #8a8d91; }
              .match-stats { display: flex; gap: 15px; text-align: right; }
              .m-stat .m-label { font-size: 10px; color: #8a8d91; display: block; }
              .m-stat .m-value { font-size: 14px; font-weight: bold; color: #ffcc00; }
              .m-stat .m-value.rating { color: #86ef47; }
              .match-time-container { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #5a5d61; border-top: 1px solid #2d3136; padding-top: 4px; }
              .match-duration { font-weight: bold; color: #8a8d91; }
              .match-time { }

              .footer { text-align: center; color: #4a4d51; font-size: 14px; margin-top: 20px; border-top: 1px solid #2a2d32; padding-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <img class="avatar" src="${playerInfo.avatar}">
                <div class="user-info">
                  <div class="name">${playerInfo.username}</div>
                  <div class="sub">5E对战平台</div>
                </div>
              </div>

              <div class="elo-box">
                <div>
                  <span class="elo-label">优先排位分数</span>
                  <div class="elo-value">${careerData.elo_9 || careerData.elo_8 || 'N/A'}</div>
                </div>
                <div>
                  <span class="win-rate-label">胜率</span>
                  <span class="win-rate">${(careerData.per_win_match * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div class="stats-grid">
                <div class="stat-item"><div class="label">生涯RATING</div><div class="value">${careerData.rating}</div></div>
                <div class="stat-item"><div class="label">生涯RWS</div><div class="value">${careerData.rws}</div></div>
                <div class="stat-item"><div class="label">MATCHES</div><div class="value">${careerData.match_total}</div></div>
                <div class="stat-item"><div class="label">生涯ADR</div><div class="value">${careerData.adr}</div></div>
                <div class="stat-item"><div class="label">生涯KPR</div><div class="value">${careerData.kpr || 'N/A'}</div></div>
                <div class="stat-item"><div class="label">WINS</div><div class="value">${careerData.win_total}</div></div>
              </div>

              <div class="recent-title">Recent 5 Matches</div>
              <div class="match-list">
                ${matches.slice(0, 5).map(m => `
                  <div class="match-item">
                    <div class="match-main">
                      <div class="match-result ${m.is_win ? 'result-win' : (m.is_tie ? 'result-tie' : 'result-loss')}">
                        ${m.is_win ? 'W' : (m.is_tie ? 'T' : 'L')}
                      </div>
                      <div class="match-info">
                        <div class="match-map-row">
                          <div class="match-map">${m.map_name}</div>
                          ${m.is_mvp ? '<div class="mvp-badge">MVP</div>' : ''}
                        </div>
                        <div class="match-score">${m.group2_all_score} : ${m.group1_all_score}</div>
                      </div>
                      <div class="match-stats">
                        <div class="m-stat"><span class="m-label">RATING</span><span class="m-value rating">${m.rating}</span></div>
                        <div class="m-stat"><span class="m-label">K/D</span><span class="m-value">${m.kill}/${m.death}</span></div>
                        <div class="m-stat"><span class="m-label">ADR</span><span class="m-value">${m.adr}</span></div>
                      </div>
                    </div>
                    <div class="match-time-container">
                      <div class="match-time">
                        ${formatDate(m.start_time)}
                      </div>
                      <div class="match-duration">
                        ${formatDuration(m.start_time, m.end_time)}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>

              <div class="footer">
                Data provided by 5EPlay • Generated by Zellon
              </div>
            </div>
          </body>
        </html>
      `

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' })
      const outputPath = join(TEMP_DIR, `5e-${Date.now()}.png`)
      const container = await page.$('.container')
      if (container) {
        await container.screenshot({ path: outputPath, type: 'png', omitBackground: true })
      } else {
        await page.screenshot({ path: outputPath, fullPage: true, type: 'png' })
      }
      await page.close()
      return outputPath
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      const text = ctx.text(e).trim()
      if (text.startsWith('#5e')) {
        const query = text.replace('#5e', '').trim()
        if (!query) return e.reply('请输入要查询的 5E 玩家名称')

        try {
          ctx.logger.info(`[5E查询] 正在搜索玩家: ${query}`)
          const playerInfo = await getPlayerUuid(query, config)
          
          ctx.logger.info(`[5E查询] 正在获取生涯数据和比赛记录: ${playerInfo.uuid}`)
          const careerUrl = `https://gate.5eplay.com/crane/http/api/data/player_career?uuid=${playerInfo.uuid}`
          const matchUrl = `https://gate.5eplay.com/crane/http/api/data/player_match?uuid=${playerInfo.uuid}`
          
          const [careerRes, matchRes] = await Promise.all([
            fetchWithHeaders(careerUrl, config),
            fetchWithHeaders(matchUrl, config)
          ])
          
          if (!careerRes.success) throw new Error(careerRes.message || '获取生涯数据失败')
          if (!matchRes.success) throw new Error(matchRes.message || '获取比赛记录失败')

          const imgPath = await generate5EImage(playerInfo, careerRes.data.career_data, matchRes.data.match_data || [], config)
          await e.reply(ctx.segment.image(`file://${imgPath}`))

          setTimeout(() => { if (existsSync(imgPath)) unlink(imgPath, () => {}) }, 300000)
        } catch (err) {
          ctx.logger.error(`[5E查询] 查询失败: ${err}`)
          await e.reply(`查询失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })

    return () => {
      closeBrowserInstance()
    }
  }
})
