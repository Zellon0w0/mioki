import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, unlink } from 'fs'
import { fileURLToPath } from 'url'

// 获取当前插件目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_NAME = '入典'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  browserPath: string
}

const CONFIG = {
  TEMP_DIR: join(getAbsPluginDir(), '入典', 'temp'),
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
        '--disable-software-rasterizer',
        '--font-render-hinting=none'
      ],
      defaultViewport: {
        width: 1000,
        height: 1000,
        deviceScaleFactor: 2 // 提高分辨率
      }
    })
  }
  return globalBrowser
}

async function closeBrowserInstance(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close()
    globalBrowser = null
    console.log('浏览器实例已关闭')
  }
}

const getAvatarUrl = async (userId: number | string): Promise<string> => {
  return `https://avatar.viki.moe?qq=${userId}`
}

async function generateRudianImage(
  message: string,
  nickname: string,
  avatarUrl: string,
  browserPath: string
): Promise<string> {
  const browser = await getBrowserInstance(browserPath)
  const page = await browser.newPage()

  // Font Fix: Use HanYi WenHei as requested
  const fontStyle = `"汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", sans-serif`

  const htmlContent = `
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 50px;
            background: #f0f2f5;
            font-family: ${fontStyle};
            display: flex;
            justify-content: center;
            align-items: flex-start;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 15px;
            width: fit-content;
            max-width: 800px;
            min-width: 400px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
            gap: 30px;
            border: 1px solid #eee;
          }
          .header {
            display: flex;
            align-items: center;
            gap: 20px;
          }
          .avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #f0f0f0;
          }
          .nickname {
            font-size: 32px;
            font-weight: 850;
            color: #333;
          }
          .content {
            font-size: 38px;
            line-height: 1.5;
            color: #000;
            word-wrap: break-word;
            white-space: pre-wrap;
            font-weight: 500;
            padding: 0 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img class="avatar" src="${avatarUrl}" alt="Avatar">
            <div class="nickname">${nickname}</div>
          </div>
          <div class="content">${message}</div>
        </div>
      </body>
    </html>
  `

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' })

  // 获取页面实际高度并重设 Viewport，防止长文本截断或缩放错位
  const height = await page.evaluate(() => {
    return document.documentElement.scrollHeight
  })
  await page.setViewport({
    width: 1000,
    height: Math.ceil(height),
    deviceScaleFactor: 2
  })

  const outputPath = join(CONFIG.TEMP_DIR, `rudian-${Date.now()}.png`)
  const container = await page.$('.container') 
  if (container) {
    await container.screenshot({ 
      path: outputPath,
      type: 'png',
      omitBackground: true
    })
  } else {
    await page.screenshot({ 
      path: outputPath,
      fullPage: true,
      type: 'png'
    })
  }

  await page.close()
  return outputPath
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  dependencies: ['puppeteer-core'],
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '入典')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        browserPath: '/usr/bin/chromium'
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

    if (!existsSync(CONFIG.TEMP_DIR)) {
      mkdirSync(CONFIG.TEMP_DIR, { recursive: true })
    }
    
    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return

      // 检查白名单
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return
      
      const text = ctx.text(e).trim()
      
      if (text === '入典') {
        ctx.logger.info(`[入典] 收到来自群 ${e.group_id} 的入典请求`)
        
        try {
            const replyMsg = await (e as any).getQuoteMsg()
            if (!replyMsg) {
                await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text('请引用需要入典的消息')])
                return
            }

            const content = replyMsg.raw_message || ''
            const senderName = replyMsg.sender.nickname || replyMsg.sender.card || '未知用户'
            const senderId = replyMsg.sender.user_id
            const avatarUrl = await getAvatarUrl(senderId)

            ctx.logger.info(`[入典] 正在为 ${senderName}(${senderId}) 生成入典图片...`)
            const imgPath = await generateRudianImage(content, senderName, avatarUrl, config.browserPath)
            
            await ctx.bot.sendGroupMsg(e.group_id, [
                ctx.segment.image(`file://${imgPath}`)
            ])

            // 发送后延迟清理
            setTimeout(() => {
                if (existsSync(imgPath)) {
                    unlink(imgPath, () => {})
                }
            }, 5000)

        } catch (err) {
            ctx.logger.error(`入典插件错误: ${err}`)
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text('生成入典图片失败')])
        }
      }
    })

    // 插件卸载时的清理逻辑
    return () => {
      closeBrowserInstance()
    }
  }
})
