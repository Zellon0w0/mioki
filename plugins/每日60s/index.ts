import { definePlugin, getAbsPluginDir } from 'mioki'
import axios from 'axios'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sharedBrowser } from '../_shared/resource'

function renderHtml(date: string, news: string[], tip: string, newsApi: string): string {
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  const escapedNews = news.map(escapeHtml)
  const escapedTip = tip ? escapeHtml(tip) : ''

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      --primary: #2b5f94;
      --text: #2c3e50;
      --text-muted: #7f8c8d;
      --card-bg: rgba(255, 255, 255, 0.85);
      --border: rgba(255, 255, 255, 0.3);
      --font-body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
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
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      border: 1px solid var(--border);
      padding: 35px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      gap: 25px;
    }
    .header {
      border-bottom: 2px solid rgba(43, 95, 148, 0.1);
      padding-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-title {
      font-size: 26px;
      font-weight: 800;
      color: var(--primary);
      letter-spacing: 1px;
    }
    .header-date {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(43, 95, 148, 0.1);
      padding: 6px 14px;
      border-radius: 12px;
    }
    .news-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .news-item {
      display: flex;
      gap: 15px;
      align-items: flex-start;
      line-height: 1.6;
      font-size: 16px;
    }
    .news-index {
      font-size: 15px;
      font-weight: 700;
      color: var(--primary);
      background: rgba(43, 95, 148, 0.1);
      min-width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .news-content {
      color: #34495e;
    }
    .quote-box {
      background: rgba(43, 95, 148, 0.05);
      border-left: 4px solid var(--primary);
      padding: 16px 20px;
      border-radius: 0 16px 16px 0;
      font-style: italic;
      font-size: 15px;
      color: #555;
      line-height: 1.6;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid rgba(0,0,0,0.05);
      padding-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">📅 60秒读懂世界</div>
      <div class="header-date">${date}</div>
    </div>
    <div class="news-list">
      ${escapedNews.map((item, index) => `
        <div class="news-item">
          <div class="news-index">${index + 1}</div>
          <div class="news-content">${item}</div>
        </div>
      `).join('')}
    </div>
    ${escapedTip ? `
      <div class="quote-box">
        💡 ${escapedTip}
      </div>
    ` : ''}
    <div class="footer">
      <div>由 mioki 机器人渲染</div>
      <div>数据源: ${newsApi}</div>
    </div>
  </div>
</body>
</html>
  `
}

async function renderNewsCardImage(date: string, news: string[], tip: string, newsApi: string): Promise<Buffer | null> {
  try {
    return await sharedBrowser.withPage(
      async (page) => {
        const html = renderHtml(date, news, tip, newsApi)
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {})

        const container = await page.$('.container')
        const image = await (container || page).screenshot({
          type: 'png',
          encoding: 'binary',
        })

        return Buffer.from(image)
      },
      {
        label: '每日60s新闻渲染',
        timeoutMs: 15_000,
        viewport: { width: 780, height: 1200, deviceScaleFactor: 2 },
      }
    )
  } catch (err) {
    console.error('[每日60s] 本地渲染新闻大卡片失败：', err)
    return null
  }
}

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

const PLUGIN_NAME = '每日60s'
const PLUGIN_VERSION = '1.0.2'

interface PluginConfig {
  enabled: boolean
  newsApi: string
  time: string
  whitelist: number[]
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '每日60s新闻推送插件',
  setup: (ctx) => {
    const pluginDir = join(getAbsPluginDir(), '每日60s')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        newsApi: 'https://60s.viki.moe/v2',
        time: '0 8 * * *',
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
        ctx.logger.error(`加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    // Try to get JSON first and render locally. If that fails, fallback to fetching the image from the API.
    async function getNewsImage(api: string) {
      try {
        ctx.logger.info(`[每日60s] 开始尝试获取 JSON 并本地渲染新闻大卡片...`)
        const response = await axios.get(`${api}/60s`, {
          timeout: 8000,
        })
        if (response.data && response.data.code === 200 && response.data.data) {
          const { date, news, tip } = response.data.data
          if (Array.isArray(news) && news.length > 0) {
            const buffer = await renderNewsCardImage(date, news, tip, api)
            if (buffer) {
              ctx.logger.info(`[每日60s] 本地渲染大卡片成功！`)
              return `base64://${buffer.toString('base64')}`
            }
          }
        }
        ctx.logger.warn(`[每日60s] JSON 格式不符合预期，准备回退到 API 图片获取`)
      } catch (err: any) {
        ctx.logger.warn(`[每日60s] 获取新闻 JSON 失败或渲染超时，将回退到 API 图片获取: ${err.message || err}`)
      }

      // Fallback: request image directly from API
      ctx.logger.info(`[每日60s] 正在从 API 获取预渲染图片: ${api}/60s?encoding=image`)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await axios.get(`${api}/60s?encoding=image`, {
            responseType: 'arraybuffer',
            timeout: 12000,
          })
          const base64Image = Buffer.from(response.data).toString('base64')
          return `base64://${base64Image}`
        } catch (err: any) {
          ctx.logger.warn(`[每日60s] 获取新闻图片失败 (第 ${attempt}/3 次尝试): ${err.message || err}`)
          if (attempt === 3) {
            throw err
          }
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }
      throw new Error('获取新闻图片未知错误')
    }

    const config = loadConfig()

    ctx.handle('message.group', async (e) => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return
      if (currentConfig.whitelist.length > 0 && !currentConfig.whitelist.includes(e.group_id)) return

      if (ctx.text(e).trim() === '60s') {
        await runWithReaction(e, async () => {
          try {
            const imageData = await getNewsImage(currentConfig.newsApi)
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.image(imageData)])
          } catch (error) {
            ctx.logger.error(`发送新闻图片失败: ${error}`)
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text('获取新闻失败，请稍后重试')])
          }
        })
      }
    })

    ctx.cron(config.time, async () => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return
      if (currentConfig.whitelist.length === 0) return

      let newsImage
      try {
        newsImage = await getNewsImage(currentConfig.newsApi)
      } catch (error) {
        ctx.logger.error(`定时任务获取新闻图片失败: ${error}`)
        return
      }

      for (const groupId of currentConfig.whitelist) {
        try {
          await ctx.bot.sendGroupMsg(groupId, [ctx.segment.image(newsImage)])
          await new Promise((resolve) => setTimeout(resolve, 100))
        } catch (err) {
          ctx.logger.warn(`群${groupId}发送错误：${err}`)
        }
      }
    })
  },
})
