import { definePlugin, getAbsPluginDir } from 'mioki'
import path from 'node:path'
import fs from 'node:fs'

const PLUGIN_NAME = '撤回消息'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  async setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), '撤回消息')
    const configPath = path.join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true
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

    ctx.logger.info(`[撤回消息] 插件已启动`)
    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return

      // 提取纯文本内容，排除掉回复等非文本段
      const text = e.message
        .filter((seg: any) => seg.type === 'text')
        .map((seg: any) => seg.text)
        .join('')
        .trim()
      
      ctx.logger.debug(`[撤回消息] 收到文本内容: "${text}"`)

      if (text === '撤回') {
        try {
          // 获取引用的消息
          ctx.logger.debug(`[撤回消息] 尝试获取引用消息...`)
          const replyMsg = await (e as any).getQuoteMsg()
          
          if (!replyMsg) {
            ctx.logger.warn(`[撤回消息] 未找到引用消息`)
            return
          }

          // 获取 Bot 自己的 ID，尝试多个可能的属性
          const selfId = e.self_id || (ctx.bot as any).uin || (ctx.bot as any).self_id
          ctx.logger.debug(`[撤回消息] 引用消息发送者: ${replyMsg.user_id}, Bot ID: ${selfId}`)

          // 检查引用的消息是否为 bot 发出的
          if (String(replyMsg.user_id) === String(selfId)) {
            ctx.logger.debug(`[撤回消息] 校验通过，正在撤回消息 ID: ${replyMsg.message_id}`)
            
            // 执行撤回
            try {
              await ctx.bot.recallMsg(replyMsg.message_id)
            } catch (err: any) {
              // 忽略 NapCat 的 "decode failed" 错误，因为消息实际上已经撤回成功了
              if (err?.message?.includes('decode failed')) {
                ctx.logger.debug(`[撤回消息] 消息 ID ${replyMsg.message_id} 撤回指令已发送 (忽略 decode failed 响应)`)
              } else {
                throw err
              }
            }

            // 撤回用户的指令消息
            try {
              await ctx.bot.recallMsg(e.message_id)
            } catch (err: any) {
              if (!err?.message?.includes('decode failed')) {
                ctx.logger.warn(`[撤回消息] 撤回指令消息失败: ${err.message}`)
              }
            }
          } else {
            ctx.logger.warn(`[撤回消息] 引用消息非 Bot 发出，跳过撤回`)
          }
        } catch (err) {
          ctx.logger.error(`[撤回消息] 撤回失败: ${err}`)
        }
      }
    })
  }
})
