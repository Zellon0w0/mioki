import { definePlugin, findLocalPlugins, getAbsPluginDir, enablePlugin, runtimePlugins } from 'mioki'
import path from 'node:path'
import fs from 'node:fs'

interface WebUIPage {
  id: string
  title: string
  icon: string
  url: string
}

export default definePlugin({
  name: '白名单管理',
  version: '1.0.0',
  priority: 120, // Load after webui (priority 10)
  description: '统一群黑白名单管理插件',
  async setup(ctx) {
    // 1. 获取 webui 服务
    const webui = ctx.services.webui as any
    if (!webui) {
      ctx.logger.warn('WebUI 服务未启用，白名单管理将不会在网页面板显示。')
      return
    }

    // 2. 注册网页面板页面
    webui.registerPage({
      id: '白名单管理',
      title: '黑白名单管理',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
      url: '/plugins/白名单管理/index.html'
    })

    // 3. 注册 API 路由
    const app = webui.app
    const authMiddleware = webui.authMiddleware

    // 智能识别辅助函数
    const isWhitelistOrBlacklistField = (key: string, prop: any): boolean => {
      if (prop.type !== 'array') return false
      const itemType = prop.items?.type
      if (itemType !== 'integer' && itemType !== 'number') return false

      const keyLower = key.toLowerCase()
      const titleLower = (prop.title || '').toLowerCase()
      const descLower = (prop.description || '').toLowerCase()

      const matchesKeyword = 
        keyLower.includes('whitelist') || 
        keyLower.includes('blacklist') ||
        titleLower.includes('白名单') || 
        titleLower.includes('黑名单') ||
        titleLower.includes('whitelist') || 
        titleLower.includes('blacklist') ||
        descLower.includes('白名单') || 
        descLower.includes('黑名单') ||
        prop.format === 'group-list'

      return !!matchesKeyword
    }

    // API: 获取所有插件的黑白名单配置
    app.get('/api/whitelist/configs', authMiddleware, async (req: any, res: any) => {
      try {
        const localPlugins = await findLocalPlugins()
        const result = []

        for (const p of localPlugins) {
          // 不扫描 webui 和 白名单管理 自身（除非必要）
          if (p.name === 'webui' || p.name === '白名单管理') {
            continue
          }

          const pConfigPath = path.join(p.absPath, 'config.json')
          const pSchemaPath = path.join(p.absPath, 'config.schema.json')

          let config: any = {}
          if (fs.existsSync(pConfigPath)) {
            try {
              config = JSON.parse(fs.readFileSync(pConfigPath, 'utf-8'))
            } catch (err: any) {
              ctx.logger.error(`解析插件 ${p.name} config.json 失败: ${err.message}`)
            }
          }

          let schema: any = null
          if (fs.existsSync(pSchemaPath)) {
            try {
              schema = JSON.parse(fs.readFileSync(pSchemaPath, 'utf-8'))
            } catch (err: any) {
              ctx.logger.error(`解析插件 ${p.name} config.schema.json 失败: ${err.message}`)
            }
          }

          const fields = []

          // 1. 如果有 schema，根据 schema properties 提取
          if (schema && schema.properties) {
            for (const [key, prop] of Object.entries<any>(schema.properties)) {
              if (isWhitelistOrBlacklistField(key, prop)) {
                const keyLower = key.toLowerCase()
                const titleLower = (prop.title || '').toLowerCase()
                const isBlack = keyLower.includes('blacklist') || titleLower.includes('黑名单')
                const value = config[key] || prop.default || []

                fields.push({
                  key,
                  title: prop.title || key,
                  description: prop.description || '',
                  type: isBlack ? 'blacklist' : 'whitelist',
                  value: Array.isArray(value) ? value : []
                })
              }
            }
          } else if (config) {
            // 2. 如果没有 schema，但有 config.json，根据 key 和 value 简单推断
            for (const [key, val] of Object.entries(config)) {
              if (Array.isArray(val)) {
                const keyLower = key.toLowerCase()
                const isBlack = keyLower.includes('blacklist') || keyLower.includes('黑名单')
                const isWhite = keyLower.includes('whitelist') || keyLower.includes('白名单')
                
                // 检查是否全都是数字（或者为空数组）
                const isAllNumbers = val.every(item => typeof item === 'number')

                if ((isBlack || isWhite) && isAllNumbers) {
                  fields.push({
                    key,
                    title: key,
                    description: '',
                    type: isBlack ? 'blacklist' : 'whitelist',
                    value: val
                  })
                }
              }
            }
          }

          if (fields.length > 0) {
            result.push({
              name: p.name,
              fields
            })
          }
        }

        res.json(result)
      } catch (err: any) {
        ctx.logger.error(`获取黑白名单配置列表失败: ${err.message}`)
        res.status(500).json({ error: err.message })
      }
    })

    // API: 保存指定插件的黑白名单配置
    app.post('/api/whitelist/save', authMiddleware, async (req: any, res: any) => {
      const { pluginName, key, value } = req.body

      if (!pluginName || !key || !Array.isArray(value)) {
        return res.status(400).json({ error: '参数不完整或类型错误' })
      }

      try {
        const localPlugins = await findLocalPlugins()
        const target = localPlugins.find(p => p.name === pluginName)
        if (!target) {
          return res.status(404).json({ error: `未找到插件 ${pluginName}` })
        }

        const pConfigPath = path.join(target.absPath, 'config.json')
        let config: any = {}

        if (fs.existsSync(pConfigPath)) {
          try {
            config = JSON.parse(fs.readFileSync(pConfigPath, 'utf-8'))
          } catch (err: any) {
            ctx.logger.error(`解析插件 ${pluginName} config.json 失败: ${err.message}`)
          }
        }

        // 更新黑白名单数组，确保是数字数组
        config[key] = value.map(val => Number(val)).filter(val => !isNaN(val))

        fs.writeFileSync(pConfigPath, JSON.stringify(config, null, 2), 'utf-8')
        ctx.logger.info(`已更新插件 ${pluginName} 的黑白名单配置 [${key}]`)

        // 触发热重载
        const pluginEntry = runtimePlugins.get(pluginName)
        if (pluginEntry) {
          ctx.logger.info(`正在热重载插件: ${pluginName}`)
          const type = pluginEntry.type
          const pluginDef = pluginEntry.plugin
          try {
            await pluginEntry.disable()
            await enablePlugin(ctx.bots, pluginDef, type)
            ctx.logger.info(`插件 ${pluginName} 热重载成功`)
          } catch (reloadErr: any) {
            ctx.logger.error(`热重载插件 ${pluginName} 失败: ${reloadErr.message}`)
            return res.status(500).json({ error: `配置已保存，但插件重载失败: ${reloadErr.message}` })
          }
        }

        res.json({ success: true })
      } catch (err: any) {
        ctx.logger.error(`保存黑白名单配置失败: ${err.message}`)
        res.status(500).json({ error: err.message })
      }
    })
  }
})
