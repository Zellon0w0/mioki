import { definePlugin, getAbsPluginDir } from 'mioki'
import path from 'node:path'
import fs from 'node:fs'

const PLUGIN_NAME = '疯狂星期四'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  apiUrl: string
  whitelist: number[]
  keywords: string[]
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '肯德基疯狂星期四文案插件',
  setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), PLUGIN_NAME)
    const configPath = path.join(pluginDir, 'config.json')

    // 加载配置的函数
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        apiUrl: 'https://60s.zou2973496443.workers.dev/v2/kfc',
        whitelist: [],
        keywords: ['v50', 'kfc', '肯德基', '星期四']
      }

      if (!fs.existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent)
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    ctx.logger.info(`[${PLUGIN_NAME}] 插件已启动`)

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()

      if (!config.enabled) {
        return
      }

      // 白名单检查
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) {
        return
      }

      const text = ctx.text(e).trim().toLowerCase()
      
      // 触发关键词匹配
      const shouldTrigger = config.keywords.some(kw => text.includes(kw.toLowerCase()))

      if (shouldTrigger) {
        ctx.logger.info(`[${PLUGIN_NAME}] 触发文案查询: ${text}`)
        try {
          const response = await fetch(config.apiUrl)
          if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`)
          
          const json = await response.json() as any
          if (json.code === 200 && json.data?.kfc) {
            await e.reply(json.data.kfc)
          } else {
            throw new Error(json.message || '接口返回异常')
          }
        } catch (err) {
          ctx.logger.error(`[${PLUGIN_NAME}] 获取文案失败: ${err}`)
        }
      }
    })
  }
})
