import { definePlugin, getAbsPluginDir } from 'mioki'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const PLUGIN_NAME = '点赞'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '名片赞插件',
  setup: (ctx) => {
    const pluginDir = join(getAbsPluginDir(), '点赞')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
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

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      ctx.match(e, {
        赞我: async () => {
          let count = 0
          const success = await ctx.bot.sendLike(e.sender.user_id, 10)
          if (success) count = 10
          await e.addReaction(count > 0 ? '66' : '67')
        },
      })
    })
  },
})
