import { definePlugin, getAbsPluginDir } from 'mioki'
import path from 'node:path'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据接口定义
interface ReplyRule {
  id: string
  trigger: string
  mode: 'exact' | 'fuzzy'
  content: string // 文本预览
  elements?: any[] // 存储原始消息段
  creator: number
  createTime: number
}

interface PluginData {
  rules: Record<string, ReplyRule[]> // 按群号隔离，key为groupId或'private'
}

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  blacklist: number[]
}

// 用户操作状态
interface UserState {
  step: 'idle' | 'waiting_trigger' | 'waiting_content'
  tempRule?: Partial<ReplyRule>
  groupId?: number // 记录发起操作时的群号
}

export default definePlugin({
  name: '关键词回复',
  version: '1.0.1',
  description: '关键词自动回复插件',
  
  async setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), '关键词回复')
    const configPath = path.join(pluginDir, 'config.json')

    // 加载配置
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        blacklist: []
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
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置失败，将使用默认配置: ${err.message}`)
        return defaultConfig
      }
    }

    // 保存配置
    const saveConfig = (config: PluginConfig) => {
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存 config.json 失败: ${err.message}`)
      }
    }

    // 1. 初始化存储
    const store = await ctx.createStore<PluginData>({
      rules: {}
    }, { __dirname })

    const userStates: Record<number, UserState> = {}

    const getUserState = (userId: number) => {
      if (!userStates[userId]) {
        userStates[userId] = { step: 'idle' }
      }
      return userStates[userId]
    }

    const resetUserState = (userId: number) => {
      delete userStates[userId]
    }

    const generateId = () => Math.random().toString(36).substring(2, 9)

    // 2. 消息处理主逻辑
    ctx.handle('message', async (e) => {
      const userId = e.user_id
      const groupId = e.group_id
      const text = ctx.text(e).trim()
      
      const isOwner = ctx.isOwner(e)
      const isAdmin = isOwner || (e.sender && ['owner', 'admin'].includes(e.sender.role))

      // ---------------- 状态机：处理添加流程 ----------------
      const state = getUserState(userId)
      if (state.step !== 'idle') {
        if (text === '取消') {
          resetUserState(userId)
          await e.reply('已取消操作')
          return
        }

        if (state.step === 'waiting_trigger') {
          if (!text) {
             await e.reply('关键词必须是文本，请重新发送，或发送"取消"')
             return
          }
          
          const currentScope = groupId ? String(groupId) : 'private'
          const targetScope = state.groupId ? String(state.groupId) : 'private'
          
          if (currentScope !== targetScope) {
              return 
          }

          const scopeRules = store.data.rules[targetScope] || []
          const exist = scopeRules.find(r => r.trigger === text)
          if (exist) {
              await e.reply(`本群/私聊已存在关键词 "${text}"，请重新发送其他关键词，或发送"取消"`)
              return
          }

          state.tempRule!.trigger = text
          state.step = 'waiting_content'
          await e.reply(`已记录关键词：${text}\n请发送回复内容（支持文本、图片、表情、语音），或发送"取消"`)
          return
        }

        if (state.step === 'waiting_content') {
          const currentScope = groupId ? String(groupId) : 'private'
          const targetScope = state.groupId ? String(state.groupId) : 'private'
          
          if (currentScope !== targetScope) return

          const rule: ReplyRule = {
            id: generateId(),
            trigger: state.tempRule!.trigger!,
            mode: state.tempRule!.mode as 'exact' | 'fuzzy',
            content: text || '[非文本消息]',
            elements: e.message,
            creator: userId,
            createTime: Date.now()
          }

          if (!store.data.rules[targetScope]) {
              store.data.rules[targetScope] = []
          }
          store.data.rules[targetScope].push(rule)
          await store.write()
          
          resetUserState(userId)
          await e.reply('✅ 添加回复规则成功！(仅当前群/私聊生效)')
          return
        }
      }

      // ---------------- 管理指令 ----------------
      if (text.startsWith('#回复 ')) {
        const cmd = text.replace('#回复 ', '').trim()
        const args = cmd.split(' ')

        if (cmd === '帮助' || cmd === '') {
            await e.reply(
                '🤖 自动回复插件指令：\n' +
                '------------------------------\n' +
                '#回复 添加 [精准|模糊]   - 添加本群规则\n' +
                '#回复 删除 [关键词]      - 删除本群规则\n' +
                '#回复 列表              - 查看本群规则\n' +
                '(以下需管理员权限)\n' +
                '#回复 黑名单 添加 [QQ]   - 添加黑名单\n' +
                '#回复 黑名单 删除 [QQ]   - 移除黑名单\n' +
                '#回复 黑名单 列表       - 查看黑名单\n' +
                '#回复 白名单 添加 [群号] - 添加白名单\n' +
                '#回复 白名单 删除 [群号] - 移除白名单\n' +
                '#回复 白名单 列表       - 查看白名单\n' +
                '------------------------------\n' +
                'Tip: 规则设置仅在当前群生效'
            )
            return
        }
        
        const scope = groupId ? String(groupId) : 'private'

        if (args[0] === '添加') {
            const mode = args[1] === '模糊' ? 'fuzzy' : 'exact'
            userStates[userId] = {
                step: 'waiting_trigger',
                tempRule: { mode },
                groupId: groupId
            }
            await e.reply(`进入${mode === 'fuzzy' ? '模糊' : '精准'}匹配添加模式。\n请发送触发关键词（仅支持文本），或发送"取消"`)
            return
        }

        if (args[0] === '删除') {
            const keyword = args.slice(1).join(' ')
            if (!keyword) {
                await e.reply('请输入要删除的关键词')
                return
            }
            const scopeRules = store.data.rules[scope] || []
            const index = scopeRules.findIndex(r => r.trigger === keyword)
            
            if (index !== -1) {
                scopeRules.splice(index, 1)
                store.data.rules[scope] = scopeRules
                await store.write()
                await e.reply(`已删除关键词 "${keyword}" 的回复规则`)
            } else {
                await e.reply(`未找到关键词 "${keyword}"`)
            }
            return
        }

        if (args[0] === '列表') {
            const scopeRules = store.data.rules[scope] || []
            if (scopeRules.length === 0) {
                await e.reply('当前群/私聊没有设置回复规则')
                return
            }
            const list = scopeRules.map(r => 
                `[${r.mode === 'exact' ? '精' : '模'}] ${r.trigger} -> ${r.content}`
            )
            const msg = `当前规则列表(${scopeRules.length}条)：\n${list.slice(0, 20).join('\n')}` + (list.length > 20 ? '\n...更多请查看配置文件' : '')
            await e.reply(msg)
            return
        }

        if (!isAdmin) return 

        // 黑名单管理
        if (args[0] === '黑名单') {
            const op = args[1]
            const config = loadConfig()
            if (op === '列表') {
                await e.reply(`黑名单用户：${config.blacklist.join(', ') || '无'}`)
                return
            }
            
            let targetId: number = 0
            if (args[2]) {
                targetId = parseInt(args[2])
            } else {
                const at = e.message.find((m: any) => m.type === 'at')
                if (at) targetId = parseInt(at.qq)
            }

            if (!targetId && op !== '列表') {
                await e.reply('请指定QQ号或@用户')
                return
            }

            if (op === '添加') {
                if (!config.blacklist.includes(targetId)) {
                    config.blacklist.push(targetId)
                    saveConfig(config)
                    await e.reply(`已将 ${targetId} 加入黑名单`)
                } else {
                    await e.reply('该用户已在黑名单中')
                }
            } else if (op === '删除') {
                const idx = config.blacklist.indexOf(targetId)
                if (idx !== -1) {
                    config.blacklist.splice(idx, 1)
                    saveConfig(config)
                    await e.reply(`已将 ${targetId} 移除黑名单`)
                } else {
                    await e.reply('该用户不在黑名单中')
                }
            }
            return
        }

        // 白名单管理
        if (args[0] === '白名单') {
            const op = args[1]
            const config = loadConfig()
            if (op === '列表') {
                await e.reply(`白名单群：${config.whitelist.join(', ') || '无 (所有群生效)'}`)
                return
            }

            let targetId = 0
            if (args[2]) {
                targetId = parseInt(args[2])
            } else if (groupId) {
                targetId = groupId
            }

            if (!targetId && op !== '列表') {
                await e.reply('请在群内使用或指定群号')
                return
            }

            if (op === '添加') {
                if (!config.whitelist.includes(targetId)) {
                    config.whitelist.push(targetId)
                    saveConfig(config)
                    await e.reply(`已将群 ${targetId} 加入白名单`)
                } else {
                    await e.reply('该群已在白名单中')
                }
            } else if (op === '删除') {
                const idx = config.whitelist.indexOf(targetId)
                if (idx !== -1) {
                    config.whitelist.splice(idx, 1)
                    saveConfig(config)
                    await e.reply(`已将群 ${targetId} 移除白名单`)
                } else {
                    await e.reply('该群不在白名单中')
                }
            }
            return
        }
      }

      // ---------------- 自动回复逻辑 ----------------
      const config = loadConfig()
      if (!config.enabled) return

      // 1. 黑名单检查
      if (config.blacklist.includes(userId)) return

      // 2. 白名单检查 (仅针对群聊)
      if (groupId && config.whitelist.length > 0) {
          if (!config.whitelist.includes(groupId)) {
               return
          }
      }

      // 3. 关键词匹配
      const scope = groupId ? String(groupId) : 'private'
      const scopeRules = store.data.rules[scope] || []

      for (const rule of scopeRules) {
          let matched = false
          if (rule.mode === 'exact') {
              matched = text === rule.trigger
          } else {
               matched = text.includes(rule.trigger)
          }

          if (matched) {
              if (rule.elements && rule.elements.length > 0) {
                  await e.reply(rule.elements)
              } else {
                  await e.reply(rule.content)
              }
              return 
          }
      }
    })
    
    ctx.logger.info('关键词回复 插件已启动')
  }
})
