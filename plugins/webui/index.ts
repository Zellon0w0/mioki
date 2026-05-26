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

// IP 提取助手，支持反向代理获取真实的客户端 IP
const getClientIp = (req: express.Request): string => {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    if (Array.isArray(forwarded)) {
      if (forwarded.length > 0) return forwarded[0].trim()
    } else if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim()
    }
  }
  return req.ip || req.socket.remoteAddress || 'unknown'
}

// 基于 SHA-256 Hash 的 Timing-Safe Comparison，防时序攻击，支持任意长度 Token 的安全比对
const timingSafeCompare = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  try {
    const aHash = crypto.createHash('sha256').update(a).digest()
    const bHash = crypto.createHash('sha256').update(b).digest()
    return crypto.timingSafeEqual(aHash, bHash)
  } catch {
    return false
  }
}

// 内存限流器
class RateLimiter {
  private ipWindow = new Map<string, { count: number; resetTime: number }>()

  constructor(
    private limit: number,
    private windowMs: number
  ) {}

  public check(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now()
    const record = this.ipWindow.get(ip)

    if (!record || now > record.resetTime) {
      const newRecord = { count: 1, resetTime: now + this.windowMs }
      this.ipWindow.set(ip, newRecord)
      return { allowed: true, remaining: this.limit - 1, resetTime: newRecord.resetTime }
    }

    record.count++
    const allowed = record.count <= this.limit
    const remaining = Math.max(0, this.limit - record.count)
    return { allowed, remaining, resetTime: record.resetTime }
  }

  public cleanup() {
    const now = Date.now()
    for (const [ip, record] of this.ipWindow.entries()) {
      if (now > record.resetTime) {
        this.ipWindow.delete(ip)
      }
    }
  }
}

export default definePlugin({
  name: 'webui',
  version: '1.0.0',
  priority: 10,
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

    // 弱 Token 安全检测与警告
    if (token && token.length < 8) {
      ctx.logger.warn('⚠️ [WebUI 安全警告] 您设置的访问 Token 长度少于 8 位，极易被暴力破解，强烈建议在 config.json 中修改为更长、更复杂的 Token 或使用默认生成的强 Token！')
    }

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

    // 注入基础 HTTP 安全响应头
    app.use((req, res, next) => {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('X-XSS-Protection', '1; mode=block')
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
      next()
    })

    // 初始化内存限流器
    const loginLimiter = new RateLimiter(5, 60 * 1000) // 登录限制: 1分钟5次尝试
    const apiLimiter = new RateLimiter(100, 60 * 1000)  // 基础 API 限流: 1分钟100次尝试

    // 定时清理已过期的限流记录，防止内存泄漏
    const cleanupInterval = setInterval(() => {
      loginLimiter.cleanup()
      apiLimiter.cleanup()
    }, 5 * 60 * 1000)
    cleanupInterval.unref()

    // 基础 API 限流中间件
    app.use('/api', (req, res, next) => {
      const ip = getClientIp(req)
      const { allowed, remaining, resetTime } = apiLimiter.check(ip)

      res.setHeader('X-RateLimit-Limit', 100)
      res.setHeader('X-RateLimit-Remaining', remaining)
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000))

      if (!allowed) {
        ctx.logger.warn(`[WebUI 安全拦截] 客户端 IP: ${ip} 触发 API 接口频率限制`)
        return res.status(429).json({
          error: 'Too Many Requests',
          message: '请求过于频繁，请稍后再试。',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        })
      }
      next()
    })

    // 登录专属限流中间件
    const loginRateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const ip = getClientIp(req)
      const { allowed, remaining, resetTime } = loginLimiter.check(ip)

      res.setHeader('X-RateLimit-Limit', 5)
      res.setHeader('X-RateLimit-Remaining', remaining)
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000))

      if (!allowed) {
        ctx.logger.warn(`[WebUI 安全拦截] 客户端 IP: ${ip} 连续尝试登录失败被拦截`)
        return res.status(429).json({
          error: 'Too Many Requests',
          message: '登录尝试次数过多，已被临时锁定，请 1 分钟后重试。',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        })
      }
      next()
    }

    // 静态资源目录
    const publicDir = path.join(pluginDir, 'public')
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true })
    }
    app.use(express.static(publicDir))

    // 动态挂载其他插件的静态资源文件夹
    app.use('/plugins/:name', (req, res, next) => {
      const pluginName = req.params.name
      // 避免路径穿越
      if (!pluginName || pluginName.includes('..') || pluginName.includes('/') || pluginName.includes('\\')) {
        return next()
      }
      const safePluginDir = getAbsPluginDir()
      const targetDir = path.resolve(safePluginDir, pluginName, 'public')
      
      // 强化防路径穿越：检验绝对路径必须位于插件目录下
      if (!targetDir.startsWith(safePluginDir)) {
        ctx.logger.warn(`[WebUI 安全拦截] 检测到非法的跨目录静态资源请求, 插件名: ${pluginName}`)
        return next()
      }
      
      if (fs.existsSync(targetDir)) {
        return express.static(targetDir)(req, res, next)
      }
      next()
    })

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

      if (reqToken && timingSafeCompare(reqToken, currentToken)) {
        return next()
      }
      res.status(401).json({ error: 'Unauthorized' })
    }

    // 动态注册接口服务
    interface WebUIPage {
      id: string
      title: string
      icon: string
      url: string
    }
    const registeredPages: WebUIPage[] = []

    ctx.addService('webui', {
      app,
      authMiddleware,
      registerPage: (page: WebUIPage) => {
        if (!registeredPages.some(p => p.id === page.id)) {
          registeredPages.push(page)
          ctx.logger.info(`WebUI 注册新页面: [${page.title}] -> ${page.url}`)
        }
      },
      getPages: () => registeredPages
    })

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
    app.post('/api/login', loginRateLimitMiddleware, (req, res) => {
      const { token: inputToken } = req.body
      let currentToken = token
      try {
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
          currentToken = cfg.token || token
        }
      } catch {}

      if (inputToken && timingSafeCompare(inputToken, currentToken)) {
        res.json({ success: true, token: currentToken })
      } else {
        res.status(401).json({ error: 'Invalid Token' })
      }
    })

    // API: 获取注册的自定义页面
    app.get('/api/webui/pages', authMiddleware, (req, res) => {
      res.json(registeredPages)
    })

    // API: 获取所有连接 Bot 的群列表
    app.get('/api/bots/groups', authMiddleware, async (req, res) => {
      try {
        const groupsMap = new Map<number, { group_id: number; group_name: string; bot_id: number }>()
        for (const bot of ctx.bots) {
          try {
            const list = await bot.getGroupList()
            for (const g of list) {
              if (!groupsMap.has(g.group_id)) {
                groupsMap.set(g.group_id, {
                  group_id: g.group_id,
                  group_name: g.group_name || `群 ${g.group_id}`,
                  bot_id: bot.bot_id
                })
              }
            }
          } catch (botErr: any) {
            ctx.logger.error(`获取 Bot ${bot.nickname} (${bot.bot_id}) 的群列表失败: ${botErr.message}`)
          }
        }
        res.json(Array.from(groupsMap.values()))
      } catch (err: any) {
        res.status(500).json({ error: err.message })
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
    // 使用 setImmediate 延迟注册，以便让其他插件优先注册 API 路由
    setImmediate(() => {
      app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) {
          return next()
        }
        if (req.method === 'GET' && fs.existsSync(path.join(publicDir, 'index.html'))) {
          res.sendFile(path.join(publicDir, 'index.html'))
        } else {
          res.status(404).send('WebUI 静态资源尚未就绪，请先创建 public/index.html')
        }
      })
    })

    let server: Server
    try {
      server = app.listen(port, () => {
        ctx.logger.info(`WebUI 服务器启动成功，访问地址: http://localhost:${port}`)
      })
    } catch (err: any) {
      ctx.logger.error(`WebUI 服务器启动失败: ${err.message}`)
    }

    // 卸载插件时清理服务器与限流定时器
    return () => {
      clearInterval(cleanupInterval)
      if (server) {
        server.close(() => {
          ctx.logger.info('WebUI 服务器已关闭')
        })
      }
    }
  }
})
