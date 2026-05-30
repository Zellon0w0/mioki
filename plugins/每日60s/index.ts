import { definePlugin, getAbsPluginDir } from 'mioki'
import axios from 'axios'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

    // Get news image
    async function getNewsImageWithProxy(api: string) {
      try {
        const response = await axios.get(`${api}/60s?encoding=image`, {
          responseType: 'arraybuffer',
          timeout: 10000,
        })
        const base64Image = Buffer.from(response.data).toString('base64')
        return `base64://${base64Image}`
      } catch (err) {
        ctx.logger.error(`获取新闻图片失败: ${err}`)
        throw err
      }
    }

    const config = loadConfig()

    ctx.handle('message.group', async (e) => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return
      if (currentConfig.whitelist.length > 0 && !currentConfig.whitelist.includes(e.group_id)) return

      if (ctx.text(e).trim() === '60s') {
        try {
          const imageData = await getNewsImageWithProxy(currentConfig.newsApi)
          await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.image(imageData)])
        } catch (error) {
          ctx.logger.error(`发送新闻图片失败: ${error}`)
          await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text('获取新闻失败，请稍后重试')])
        }
      }
    })

    ctx.cron(config.time, async () => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return
      if (currentConfig.whitelist.length === 0) return

      let newsImage
      try {
        newsImage = await getNewsImageWithProxy(currentConfig.newsApi)
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
