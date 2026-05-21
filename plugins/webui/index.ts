import { definePlugin, findLocalPlugins, getAbsPluginDir, enablePlugin, runtimePlugins } from 'mioki'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import express from 'express'
import type { Server } from 'node:http'

interface WebUIConfig {
  port: number
  token: string
}

export default definePlugin({
  name: 'webui',
  version: '1.0.0',
  description: 'WebUI 插件管理与配置面板',
  async setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), 'webui')
    const configPath = path.join(pluginDir, 'config.json')

    // 确保插件目录存在
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true })
    }

    let webuiConfig: WebUIConfig = { port: 3045, token: '' }
    let isFirstRun = false

    if (fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        webuiConfig = JSON.parse(fileContent)
      } catch (err: any) {
        ctx.logger.error(`读取 WebUI 配置文件失败: ${err.message}`)
      }
    }

    // 如果未设置 token，则生成随机 token
    if (!webuiConfig.token) {
      webuiConfig.token = crypto.randomBytes(16).toString('hex')
      isFirstRun = true
      try {
        fs.writeFileSync(configPath, JSON.stringify(webuiConfig, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存 WebUI 配置文件失败: ${err.message}`)
      }
    }

    const { port, token } = webuiConfig

    ctx.logger.info(`WebUI 服务将在端口 ${port} 启动`)

    // 首次启动，延时通过私聊发送 token 给主人
    if (isFirstRun) {
      ctx.logger.info(`首次启动 WebUI，生成的随机 token 为: ${token}`)
      setTimeout(async () => {
        try {
          await ctx.noticeMainOwner(`[Mioki WebUI] 首次启动成功！\n管理面板地址: http://localhost:${port}\n登录访问 Token 为: ${token}\n(可在 plugins/webui/config.json 中修改)`)
          ctx.logger.info('已成功向主人发送 Token 私聊通知')
        } catch (err: any) {
          ctx.logger.error(`发送 Token 私聊通知失败: ${err.message}`)
        }
      }, 3000)
    }

    const app = express()
    app.use(express.json())

    // 静态资源目录
    const publicDir = path.join(pluginDir, 'public')
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true })
    }
    app.use(express.static(publicDir))

    // 身份验证中间件
    const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const authHeader = req.headers.authorization
      const reqToken = authHeader && authHeader.split(' ')[1]
      
      // 读取最新的 token，以防在运行期间被修改
      let currentToken = token
      try {
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
          currentToken = cfg.token || token
        }
      } catch {}

      if (reqToken === currentToken) {
        return next()
      }
      res.status(401).json({ error: 'Unauthorized' })
    }

    // 辅助函数：根据 config 自动生成简单的 JSON Schema
    const generateSchemaFromConfig = (config: any): any => {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { type: 'object', properties: {} }
      }
      const properties: any = {}
      for (const [key, val] of Object.entries(config)) {
        let type: string = typeof val
        if (val === null) {
          type = 'string'
        } else if (Array.isArray(val)) {
          type = 'array'
        }
        
        properties[key] = {
          title: key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()),
          type: type,
          default: val
        }
        
        if (type === 'object' && val !== null) {
          properties[key] = generateSchemaFromConfig(val)
          properties[key].title = key
        }
      }
      return {
        type: 'object',
        properties
      }
    }

    // API: 登录验证
    app.post('/api/login', (req, res) => {
      const { token: inputToken } = req.body
      let currentToken = token
      try {
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
          currentToken = cfg.token || token
        }
      } catch {}

      if (inputToken === currentToken) {
        res.json({ success: true, token: currentToken })
      } else {
        res.status(401).json({ error: 'Invalid Token' })
      }
    })

    // API: 获取插件列表及其配置
    app.get('/api/plugins', authMiddleware, async (req, res) => {
      try {
        const localPlugins = await findLocalPlugins()
        const result = []

        for (const p of localPlugins) {
          const pConfigPath = path.join(p.absPath, 'config.json')
          const pSchemaPath = path.join(p.absPath, 'config.schema.json')

          let hasConfig = fs.existsSync(pConfigPath)
          let config = null
          let schema = null

          if (hasConfig) {
            try {
              config = JSON.parse(fs.readFileSync(pConfigPath, 'utf-8'))
            } catch (err: any) {
              ctx.logger.error(`解析插件 ${p.name} 的 config.json 失败: ${err.message}`)
            }
          }

          if (fs.existsSync(pSchemaPath)) {
            try {
              schema = JSON.parse(fs.readFileSync(pSchemaPath, 'utf-8'))
            } catch (err: any) {
              ctx.logger.error(`解析插件 ${p.name} 的 config.schema.json 失败: ${err.message}`)
            }
          } else if (config) {
            // 自动推断 schema
            schema = generateSchemaFromConfig(config)
          }

          // 检查该插件是否已启用
          const isEnabled = runtimePlugins.has(p.name)

          result.push({
            name: p.name,
            isEnabled,
            hasConfig,
            config,
            schema
          })
        }

        res.json(result)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

    // API: 保存插件配置并热重载该插件
    app.post('/api/plugins/:name/config', authMiddleware, async (req, res) => {
      const { name } = req.params
      const { config } = req.body

      try {
        const localPlugins = await findLocalPlugins()
        const targetPlugin = localPlugins.find(p => p.name === name)

        if (!targetPlugin) {
          return res.status(404).json({ error: `未找到插件: ${name}` })
        }

        const pConfigPath = path.join(targetPlugin.absPath, 'config.json')
        fs.writeFileSync(pConfigPath, JSON.stringify(config, null, 2), 'utf-8')
        ctx.logger.info(`已更新插件 ${name} 的配置文件`)

        // 热重载插件 (如果当前插件已启用)
        const pluginEntry = runtimePlugins.get(name)
        if (pluginEntry) {
          ctx.logger.info(`正在热重载插件: ${name}`)
          const type = pluginEntry.type
          const pluginDef = pluginEntry.plugin
          try {
            await pluginEntry.disable()
            await enablePlugin(ctx.bots, pluginDef, type)
            ctx.logger.info(`插件 ${name} 热重载成功`)
          } catch (reloadErr: any) {
            ctx.logger.error(`热重载插件 ${name} 失败: ${reloadErr.message}`)
            return res.status(500).json({ error: `配置已保存，但插件重载失败: ${reloadErr.message}` })
          }
        }

        res.json({ success: true })
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

    // 默认路由：兜底指向前端页面
    app.use((req, res) => {
      if (req.method === 'GET' && fs.existsSync(path.join(publicDir, 'index.html'))) {
        res.sendFile(path.join(publicDir, 'index.html'))
      } else {
        res.status(404).send('WebUI 静态资源尚未就绪，请先创建 public/index.html')
      }
    })

    let server: Server
    try {
      server = app.listen(port, () => {
        ctx.logger.info(`WebUI 服务器启动成功，访问地址: http://localhost:${port}`)
      })
    } catch (err: any) {
      ctx.logger.error(`WebUI 服务器启动失败: ${err.message}`)
    }

    // 卸载插件时清理服务器
    return () => {
      if (server) {
        server.close(() => {
          ctx.logger.info('WebUI 服务器已关闭')
        })
      }
    }
  }
})
