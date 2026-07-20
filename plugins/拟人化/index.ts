import { definePlugin, getAbsPluginDir } from 'mioki'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import OpenAI from 'openai'
import {
  initDb,
  addChatMessage,
  getRecentChatHistory,
  closeDb,
  ChatMessage,
  getUserProfile,
  updateUserProfile,
  getSessionPersona,
  setSessionPersona,
  clearSessionPersona
} from './db'
import { runAgent } from './agent'

interface PluginConfig {
  enabled: boolean
  apiUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  probability: number
  groupWhitelist: number[]
  favorabilityEnabled: boolean
  debounceTime: number
  blacklistUsers: number[]
}

const defaultConfig: PluginConfig = {
  enabled: true,
  apiUrl: 'https://anti.zellon.me/v1',
  apiKey: process.env.MIOKI_API_KEY || '<REDACTED_API_KEY>',
  model: 'gemini-3-flash-agent',
  systemPrompt: "你是一个群聊成员，性格活泼，说话幽默。\n你可以根据当前语境决定是否回复，如果不回复请只输出 [NO_REPLY]。\n你有稳定的基础三观和判断底线：尊重生命、公共安全、法律责任与人的尊严；不要把违法、危险、伤害他人、逃避责任或损害公共秩序的行为说成值得同情、羡慕或鼓励的事。\n群聊玩笑可以接，但底线不能歪：如果话题涉及安全、违法、伤害或责任，先自然承认行为本身不对或风险很大，再用简短口语把话接住；不要长篇说教，也不要装成官方普法。\n对受害者、弱者、被伤害的人保持基本共情；不嘲笑苦难，不美化欺凌、歧视、暴力或剥削。",
  probability: 0.1,
  groupWhitelist: [],
  favorabilityEnabled: true,
  debounceTime: 5,
  blacklistUsers: []
}

function isAtMe(e: any): boolean {
  if (!e.message || !Array.isArray(e.message)) return false
  return e.message.some((el: any) => el.type === 'at' && Number(el.qq || el.data?.qq) === Number(e.self_id))
}

function getMessageText(message: any): string {
  if (!message) return ''
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .filter((el: any) => el.type === 'text')
      .map((el: any) => el.text)
      .join('')
      .trim()
  }
  return ''
}

function cleanupOldImages(imageDir: string, maxAgeDays = 7) {
  if (!existsSync(imageDir)) return
  try {
    const files = readdirSync(imageDir)
    const now = Date.now()
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
    for (const file of files) {
      const filePath = join(imageDir, file)
      const stat = statSync(filePath)
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(filePath)
      }
    }
  } catch {}
}

async function downloadAndSaveImage(url: string, destDir: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }
    
    const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    const destPath = join(destDir, filename)
    writeFileSync(destPath, buffer)
    return filename
  } catch (e) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function parseAndDownloadMessage(message: any, imageDir: string): Promise<string> {
  if (!message) return ''
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    const parts: string[] = []
    for (const el of message) {
      if (el.type === 'text') {
        parts.push(el.text || el.data?.text || '')
      } else if (el.type === 'image') {
        const url = el.url || el.data?.url
        if (url) {
          const filename = await downloadAndSaveImage(url, imageDir)
          if (filename) {
            parts.push(`[图片: ${filename}]`)
          } else {
            parts.push(`[图片加载失败]`)
          }
        }
      }
    }
    return parts.join('').trim()
  }
  return ''
}

async function generatePersonaPrompt(config: PluginConfig, characterName: string): Promise<string> {
  const openai = new OpenAI({
    baseURL: config.apiUrl,
    apiKey: config.apiKey,
    defaultHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  const prompt = `你是一个专业的角色扮演Prompt生成器。请分析动漫角色：${characterName}。
生成一段针对大语言模型的系统提示词（System Prompt），让模型扮演这个动漫角色。
提示词中应包含该角色的性格、语言风格、常用语、口头禅，以及群聊聊天的习惯（例如傲娇、毒舌、中二、温柔等特质）。
请注意：
1. 提示词必须使用中文，人设一定要饱满逼真。
2. 保持精简，总长度控制在 200 字以内。
3. 只输出最终的 System Prompt 文本内容，不要有任何前言、解释、Markdown 标记（如 \`\`\` 等）或包裹符号。`

  const response = await openai.chat.completions.create({
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  })

  return (response.choices[0]?.message?.content || '').trim()
}

interface DebounceSession {
  timer: NodeJS.Timeout
  hasAt: boolean
  lastEvent: any
}

export default definePlugin({
  name: '拟人化',
  version: '1.1.0',
  description: '升级版拟人化聊天 Agent 插件，支持自定义动漫角色、多连发防抖、多角色独立好感度',
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '拟人化')
    const configPath = join(pluginDir, 'config.json')
    const dbPath = join(pluginDir, 'data.db')

    // Load config
    function loadConfig(): PluginConfig {
      if (!existsSync(configPath)) {
        if (!existsSync(pluginDir)) {
          mkdirSync(pluginDir, { recursive: true })
        }
        writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        return defaultConfig
      }
      try {
        const content = readFileSync(configPath, 'utf-8')
        return { ...defaultConfig, ...JSON.parse(content) }
      } catch (err: any) {
        ctx.logger.error(`加载 拟人化 配置失败: ${err.message}`)
        return defaultConfig
      }
    }

    // Initialize database
    try {
      initDb(dbPath)
      ctx.logger.info(`[拟人化] SQLite 数据库已就绪: ${dbPath}`)
    } catch (err: any) {
      ctx.logger.error(`[拟人化] 初始化数据库失败: ${err.message}`)
    }

    const imageDir = join(pluginDir, 'images')
    try {
      cleanupOldImages(imageDir, 7)
    } catch {}

    // Active session locks, debounce timers & waiting queues
    const activeSessions = new Set<string>()
    const debounceSessions = new Map<string, DebounceSession>()
    const sessionQueues = new Map<string, { hasAt: boolean; lastEvent: any }>()

    // Asynchronous helper to execute LLM agent call and handle replies
    async function triggerAgentReply(e: any, isGroup: boolean, hasAt: boolean) {
      const sessionKey = isGroup ? `group_${e.group_id}` : `private_${String(e.user_id)}`
      const senderId = String(e.user_id)
      const senderName = e.sender?.card || e.sender?.nickname || senderId

      // Lock session
      activeSessions.add(sessionKey)

      try {
        const config = loadConfig()
        const sessionPersona = getSessionPersona(sessionKey)
        const activePrompt = sessionPersona ? sessionPersona.systemPrompt : config.systemPrompt
        const activePersonaName = sessionPersona ? sessionPersona.characterName : 'default'

        // Group decision: should we reply?
        if (isGroup) {
          const randomRoll = Math.random() < config.probability
          if (!hasAt && !randomRoll) {
            return
          }
        }

        // Fetch recent history
        let chatHistory: ChatMessage[] = []
        try {
          chatHistory = getRecentChatHistory(sessionKey, 15)
        } catch (dbErr: any) {
          ctx.logger.error(`[拟人化] 获取历史消息失败: ${dbErr.message}`)
        }

        // Trigger agent conversation loop
        const agentReply = await runAgent({
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          systemPrompt: activePrompt,
          personaName: activePersonaName,
          userId: senderId,
          defaultNickname: senderName,
          chatHistory,
          imageDir
        })

        const cleanedReply = agentReply.trim()
        if (cleanedReply === '[NO_REPLY]') {
          ctx.logger.info(`[拟人化] Agent 决策：不回复本连发消息`)
          return
        }

        if (!cleanedReply) {
          return
        }

        // Log assistant reply to history
        try {
          addChatMessage({
            sessionId: sessionKey,
            userId: String(e.self_id),
            nickname: 'Bot',
            role: 'assistant',
            content: cleanedReply,
            timestamp: Date.now()
          })
        } catch (dbErr: any) {
          ctx.logger.error(`[拟人化] 写入助手回复失败: ${dbErr.message}`)
        }

        // Simulate typing speed delay
        const typingDelayMs = Math.min(3000, (cleanedReply.length / 7) * 1000)
        await new Promise((resolve) => setTimeout(resolve, typingDelayMs))

        // Send reply
        await e.reply(cleanedReply)

      } catch (err: any) {
        ctx.logger.error(`[拟人化] 处理消息出错: ${err.message || err}`)
      } finally {
        // Unlock session
        activeSessions.delete(sessionKey)

        // Process next item in waiting queue if exists
        const nextQueue = sessionQueues.get(sessionKey)
        if (nextQueue) {
          sessionQueues.delete(sessionKey)
          ctx.logger.info(`[拟人化] 从等待队列中提取新消息，启动下一轮 Agent 回复. 会话: ${sessionKey}`)
          // Small pause before triggering the queued response to keep chat natural
          setTimeout(() => {
            triggerAgentReply(nextQueue.lastEvent, isGroup, nextQueue.hasAt).catch(() => {})
          }, 200)
        }
      }
    }

    // Core message processor
    async function processMessage(e: any, isGroup: boolean) {
      const config = loadConfig()
      if (!config.enabled) return

      // Whitelist filter
      if (isGroup && config.groupWhitelist.length > 0 && !config.groupWhitelist.includes(e.group_id)) {
        return
      }

      const senderId = String(e.user_id)
      const senderName = e.sender?.card || e.sender?.nickname || senderId
      const sessionKey = isGroup ? `group_${e.group_id}` : `private_${senderId}`

      // Blacklist user check
      if (config.blacklistUsers.includes(Number(senderId))) {
        return
      }

      // Nickname bot filter (ignore bots/robots/replicas to avoid loops)
      const senderNickname = e.sender?.nickname || ''
      if (/bot|robot|机器人/i.test(senderNickname)) {
        return
      }

      const plainText = getMessageText(e.message)
      const cleanText = plainText.trim()

      // Command filters: Ignore other plugin commands starting with common symbols
      // We block any prefix inputs except our own '#' commands
      const commandPrefixRegex = /^[~/%\$!！]/
      if (commandPrefixRegex.test(cleanText)) {
        return
      }
      if (cleanText.startsWith('#') && 
          !cleanText.startsWith('#好感') && 
          !cleanText.startsWith('#画像') && 
          !cleanText.startsWith('#设定人设') && 
          !cleanText.startsWith('#清除人设') && 
          !cleanText.startsWith('#重置人设')) {
        return
      }

      // Check current session persona (determines favorability namespace)
      const sessionPersona = getSessionPersona(sessionKey)
      const activePersonaName = sessionPersona ? sessionPersona.characterName : 'default'
      const activePrompt = sessionPersona ? sessionPersona.systemPrompt : config.systemPrompt

      // Handle active commands immediately (no debounce or queue needed)
      if (cleanText === '#好感度' || cleanText === '#好感' || cleanText === '#画像' || cleanText === '#我的画像') {
        try {
          const profile = getUserProfile(senderId, activePersonaName, senderName)
          const replyText = `【${senderName} 在「${activePersonaName}」人设下的画像】\n好感度：${profile.favorability} 分\n系统昵称：${profile.nickname}\n印象特征：${profile.impressions}`
          await e.reply(replyText)
        } catch (dbErr: any) {
          ctx.logger.error(`[拟人化] 查询画像失败: ${dbErr.message}`)
        }
        return
      }

      if (cleanText === '#好感度重置' || cleanText === '#画像重置') {
        try {
          const profile = getUserProfile(senderId, activePersonaName, senderName)
          updateUserProfile(senderId, activePersonaName, senderName, -profile.favorability, '初次见面。')
          await e.reply(`已成功重置【${senderName}】在「${activePersonaName}」人设下的画像与好感度。`)
        } catch (dbErr: any) {
          ctx.logger.error(`[拟人化] 重置画像失败: ${dbErr.message}`)
        }
        return
      }

      if (cleanText.startsWith('#设定人设 ')) {
        const characterName = cleanText.slice(5).trim()
        if (!characterName) return

        if (activeSessions.has(sessionKey)) {
          await e.reply('当前会话正忙，请稍候再试。')
          return
        }

        activeSessions.add(sessionKey)
        try {
          await e.reply(`正在分析生成动漫角色【${characterName}】的说话语调与人设中，请稍候...`)
          const generatedPrompt = await generatePersonaPrompt(config, characterName)
          
          if (!generatedPrompt) {
            throw new Error('生成的提示词为空')
          }

          setSessionPersona(sessionKey, characterName, generatedPrompt)
          ctx.logger.info(`[拟人化] 会话 ${sessionKey} 设定人设为: ${characterName}`)
          await e.reply(`已成功切换当前会话的人设为：【${characterName}】！专属好感度也已独立启用。`)
        } catch (err: any) {
          ctx.logger.error(`[拟人化] 设定人设失败: ${err.message || err}`)
          await e.reply(`设定人设失败，请检查网络或配置是否正确。`)
        } finally {
          activeSessions.delete(sessionKey)
        }
        return
      }

      if (cleanText === '#清除人设' || cleanText === '#重置人设') {
        try {
          clearSessionPersona(sessionKey)
          await e.reply('已重置回默认机器人人设。')
        } catch (dbErr: any) {
          ctx.logger.error(`[拟人化] 清除人设失败: ${dbErr.message}`)
        }
        return
      }

      // Download and parse image URL asynchronously
      const promptText = await parseAndDownloadMessage(e.message, imageDir)

      // Filter empty chats
      if (!promptText && !isAtMe(e)) {
        return
      }

      // Save user message in DB immediately to ensure order
      const userMsg: ChatMessage = {
        sessionId: sessionKey,
        userId: senderId,
        nickname: senderName,
        role: 'user',
        content: promptText || '[拍了拍或发送了空消息]',
        timestamp: Date.now()
      }

      try {
        addChatMessage(userMsg)
      } catch (dbErr: any) {
        ctx.logger.error(`[拟人化] 写入用户消息失败: ${dbErr.message}`)
      }

      // Check session locked (processing LLM response right now)
      if (activeSessions.has(sessionKey)) {
        const currentAtMe = isAtMe(e)
        // For private chats or direct @bot mentions, queue the task
        const isTriggered = !isGroup || currentAtMe
        
        if (isTriggered) {
          const existingQueue = sessionQueues.get(sessionKey)
          if (existingQueue) {
            existingQueue.hasAt = existingQueue.hasAt || currentAtMe
            existingQueue.lastEvent = e
          } else {
            sessionQueues.set(sessionKey, {
              hasAt: currentAtMe,
              lastEvent: e
            })
          }
          ctx.logger.info(`[拟人化] 会话 ${sessionKey} 正在响应中，已将中间的 At/私聊 消息加入等待队列`)
        }
        return
      }

      // Debounce mechanism: Wait for user to finish consecutive inputs
      const currentAtMe = isAtMe(e)
      const existingSession = debounceSessions.get(sessionKey)

      if (existingSession) {
        clearTimeout(existingSession.timer)
      }

      const hasAt = existingSession ? (existingSession.hasAt || currentAtMe) : currentAtMe

      const timer = setTimeout(async () => {
        // Clean session debounce timer
        debounceSessions.delete(sessionKey)
        await triggerAgentReply(e, isGroup, hasAt)
      }, (config.debounceTime ?? 5) * 1000)

      debounceSessions.set(sessionKey, {
        timer,
        hasAt,
        lastEvent: e
      })
    }

    // Register event handlers
    ctx.handle('message.group', async (e) => {
      await processMessage(e, true)
    })

    ctx.handle('message.private', async (e) => {
      await processMessage(e, false)
    })

    // Return cleanup hook
    return () => {
      ctx.logger.info('[拟人化] 正在关闭插件，清理防抖计时器与数据库连接...')
      for (const session of debounceSessions.values()) {
        clearTimeout(session.timer)
      }
      debounceSessions.clear()
      activeSessions.clear()
      sessionQueues.clear()
      closeDb()
    }
  }
})
