import { definePlugin, getAbsPluginDir } from 'mioki'
import fs from 'node:fs'
import { createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PLUGIN_NAME = '随机视频'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  blacklist: number[]
  randomVideoApi: string
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: '1.0.0',
  async setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), '随机视频')
    const configPath = path.join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        blacklist: [],
        randomVideoApi: 'https://tucdn.wpon.cn/api-girl/index.php'
      }

      if (!fs.existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(fileContent)
        return {
          enabled: parsed.enabled ?? defaultConfig.enabled,
          whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : defaultConfig.whitelist,
          blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : defaultConfig.blacklist,
          randomVideoApi: parsed.randomVideoApi ?? defaultConfig.randomVideoApi
        }
      } catch (err: any) {
        ctx.logger.error(`[随机视频] 加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return

      // 黑名单验证
      if (config.blacklist.includes(e.user_id)) return

      // 白名单验证
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      const text = ctx.text(e).trim()

      if (['随机视频', 'sjsp'].includes(text)) {
        let videoPath: string | null = null
        try {
          await e.addReaction('311')
          const response = await fetch(config.randomVideoApi)
          const html = await response.text()
          const match = html.match(/src="([^"]+)"/)
          if (match) {
            let videoUrl = match[1].trim()
            if (videoUrl.startsWith('//')) {
              videoUrl = 'https:' + videoUrl
            }
            videoPath = await downloadVideo(videoUrl)
            await e.reply(ctx.segment.video(`file://${videoPath}`))
          } else {
            await e.reply('获取随机视频失败')
          }
        } catch (err: any) {
          ctx.logger.error(`[随机视频] 随机视频错误: ${err.message}`)
        } finally {
          if (videoPath) {
            cleanupFile(ctx, videoPath)
          }
        }
      }
    })
  }
})

/**
 * 通用视频下载函数，加了大小和超时限制防止服务器卡死或内存溢出
 */
async function downloadVideo(
  url: string, 
  maxBytes: number = 30 * 1024 * 1024, 
  timeoutMs: number = 60000
): Promise<string> {
  const tempPath = path.join(tmpdir(), `video_${Date.now()}.mp4`)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (size > maxBytes) {
        throw new Error(`视频文件过大 (${(size / 1024 / 1024).toFixed(1)}MB)，已跳过下载 (最大限制为 ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`)
      }
    }

    if (!response.body) {
      throw new Error('无法获取视频流')
    }

    let downloadedBytes = 0
    const limitTransform = async function* (source: any) {
      for await (const chunk of source) {
        downloadedBytes += chunk.length
        if (downloadedBytes > maxBytes) {
          throw new Error(`视频文件过大，已终止下载 (最大限制为 ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`)
        }
        yield chunk
      }
    }

    // @ts-ignore
    await pipeline(response.body, limitTransform, createWriteStream(tempPath))
    return tempPath
  } catch (err: any) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
      } catch {}
    }
    if (err.name === 'AbortError') {
      throw new Error(`下载视频超时 (${timeoutMs / 1000} 秒)`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 清理临时文件函数
 */
function cleanupFile(ctx: any, filePath: string) {
  const timer = setTimeout(() => {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        ctx.logger.info(`[随机视频] 已清理临时文件: ${filePath}`)
      }
    } catch (e) {
      ctx.logger.error(`[随机视频] 文件清理失败: ${e}`)
    }
  }, 300000) // 5分钟后自动清理
  ctx.clears.add(() => clearTimeout(timer))
}
