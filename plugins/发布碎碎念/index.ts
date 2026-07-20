import { definePlugin, getAbsPluginDir } from 'mioki'
import axios from 'axios'
import fs from 'node:fs'
import { join } from 'node:path'

const PLUGIN_NAME = '发布碎碎念'
const PLUGIN_VERSION = '1.0.2'

interface PluginConfig {
  enabled: boolean
  githubToken: string
  repo: string
  label: string
  r2PathPrefix: string
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '通过机器人命令自动发布碎碎念并把图片托管到 R2 后提交到 GitHub Issues',
  setup: (ctx) => {
    const pluginDir = join(getAbsPluginDir(), '发布碎碎念')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        githubToken: process.env.GITHUB_TOKEN || '',
        repo: 'Zellon0w0/fuwari_zellon0w0',
        label: 'thoughts',
        r2PathPrefix: 'QBot/reply/thoughts/',
      }

      if (!fs.existsSync(pluginDir)) {
        try {
          fs.mkdirSync(pluginDir, { recursive: true })
        } catch {}
      }

      if (!fs.existsSync(configPath)) {
        try {
          fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        } catch (err: any) {
          ctx.logger.error(`创建默认配置文件失败: ${err.message}`)
        }
        return defaultConfig
      }

      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent),
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    // 从“关键词回复”读取 R2 配置
    const loadR2Config = () => {
      const replyConfigPath = join(getAbsPluginDir(), '关键词回复', 'config.json')
      if (fs.existsSync(replyConfigPath)) {
        try {
          const content = fs.readFileSync(replyConfigPath, 'utf-8')
          const parsed = JSON.parse(content)
          if (parsed.r2 && parsed.r2.enabled) {
            return parsed.r2
          }
        } catch (err: any) {
          ctx.logger.error(`[发布碎碎念] 读取关键词回复 R2 配置失败: ${err.message}`)
        }
      }
      return null
    }

    // 上传图片至 Cloudflare R2
    const uploadUrlToR2 = async (url: string, r2: any, pathPrefix: string): Promise<string> => {
      if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucketName) {
        throw new Error('Cloudflare R2 参数配置不完整')
      }

      try {
        const response = await axios.get(url, { responseType: 'arraybuffer' })
        const buffer = Buffer.from(response.data)

        let ext = 'jpg'
        const contentType = response.headers['content-type'] || ''
        if (contentType.includes('png')) ext = 'png'
        else if (contentType.includes('gif')) ext = 'gif'
        else if (contentType.includes('webp')) ext = 'webp'

        // 动态加载 AWS SDK
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
        
        const client = new S3Client({
          endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2.accessKeyId,
            secretAccessKey: r2.secretAccessKey
          },
          region: 'auto'
        })

        const crypto = await import('node:crypto')
        const fileHash = crypto.createHash('md5').update(buffer).digest('hex')
        const prefix = pathPrefix ? pathPrefix.replace(/\/$/, '') + '/' : ''
        const key = `${prefix}${fileHash}.${ext}`

        await client.send(
          new PutObjectCommand({
            Bucket: r2.bucketName,
            Key: key,
            Body: buffer,
            ContentType: contentType || 'application/octet-stream'
          })
        )

        const domain = r2.customDomain ? r2.customDomain.replace(/\/$/, '') : `https://${r2.bucketName}.${r2.accountId}.r2.cloudflarestorage.com`
        const r2Url = `${domain}/${key}`
        ctx.logger.info(`[发布碎碎念] 图片成功上传到 R2: ${r2Url}`)
        return r2Url
      } catch (err: any) {
        ctx.logger.error(`[发布碎碎念] 上传文件至 R2 失败: ${err.message}`)
        throw new Error(`图片上传至 R2 失败: ${err.message}`)
      }
    }

    const handlePublish = async (e: any) => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return

      // 仅限机器人主人发布
      if (!ctx.isOwner(e)) {
        return
      }

      const rawText = ctx.text(e, { trim: false }).trim()
      if (!rawText.startsWith('#发布碎碎念')) return

      // 解析标题 and 正文
      const lines = rawText.split('\n')
      const firstLine = lines[0]
      const title = firstLine.replace('#发布碎碎念', '').trim()
      const body = lines.slice(1).join('\n').trim()

      // 提取并上传图片到 R2
      const images: string[] = []
      if (Array.isArray(e.message)) {
        const r2Config = loadR2Config()
        
        // 校验：如果消息中包含图片，但 R2 未配置或已禁用，直接拦截报错
        const hasImage = e.message.some((msg: any) => msg.type === 'image')
        if (hasImage && (!r2Config || !r2Config.enabled)) {
          const replyMsg = '发布失败：消息中包含图片，但 Cloudflare R2 未配置或已禁用。'
          if (e.message_type === 'group') {
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
          } else if (e.message_type === 'private') {
            await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
          }
          return
        }

        try {
          for (const msg of e.message) {
            if (msg.type === 'image') {
              const imgUrl = msg.url || msg.data?.url || msg.file || msg.data?.file || msg.path || msg.data?.path
              if (imgUrl && typeof imgUrl === 'string') {
                ctx.logger.info(`[发布碎碎念] 正在上传图片至 Cloudflare R2...`)
                const r2Url = await uploadUrlToR2(imgUrl, r2Config, currentConfig.r2PathPrefix)
                images.push(r2Url)
              }
            }
          }
        } catch (uploadErr: any) {
          ctx.logger.error(`[发布碎碎念] 图片上传终止发布流程: ${uploadErr.message}`)
          const replyMsg = `❌ 碎碎念发布失败：${uploadErr.message}`
          if (e.message_type === 'group') {
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
          } else if (e.message_type === 'private') {
            await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
          }
          return
        }
      }

      if (!body && images.length === 0) {
        const replyMsg = '发布失败：碎碎念内容不能为空。格式应为：\n#发布碎碎念 [标题]\n[正文]'
        if (e.message_type === 'group') {
          await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
        } else if (e.message_type === 'private') {
          await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
        }
        return
      }

      const token = currentConfig.githubToken
      if (!token) {
        const replyMsg = '发布失败：未配置 GitHub Token，请在插件配置文件中配置 githubToken'
        ctx.logger.error('[发布碎碎念] 未配置 githubToken，无法调用 GitHub API')
        if (e.message_type === 'group') {
          await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
        } else if (e.message_type === 'private') {
          await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
        }
        return
      }

      try {
        ctx.logger.info(`[发布碎碎念] 正在向 ${currentConfig.repo} 提交 Issue...`)
        
        // 拼接正文 and 图片 Markdown 语法
        let finalBody = body
        if (images.length > 0) {
          if (finalBody) finalBody += '\n\n'
          finalBody += images.map(url => `![image](${url})`).join('\n')
        }

        // 如果没有指定标题，使用正文前20个字作为标题
        const fallbackTitle = body ? (body.length > 20 ? body.substring(0, 20) + '...' : body) : '分享图片'
        const issueTitle = title || fallbackTitle
        
        const response = await axios.post(
          `https://api.github.com/repos/${currentConfig.repo}/issues`,
          {
            title: issueTitle,
            body: finalBody,
            labels: [currentConfig.label],
          },
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
              Authorization: `token ${token}`,
              'User-Agent': 'mioki-bot',
            },
            timeout: 10000,
          }
        )

        if (response.status === 201) {
          const issueUrl = response.data.html_url
          const issueNumber = response.data.number
          const replyMsg = `🎉 碎碎念发布成功！\nIssue: #${issueNumber}\n链接: ${issueUrl}`
          ctx.logger.info(`[发布碎碎念] 发布成功: #${issueNumber}`)
          
          if (e.message_type === 'group') {
            await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
          } else if (e.message_type === 'private') {
            await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
          }
        }
      } catch (err: any) {
        ctx.logger.error(`[发布碎碎念] 提交 Issue 失败: ${err.message}`, err.response?.data)
        const errorMsg = err.response?.data?.message || err.message
        const replyMsg = `❌ 碎碎念发布失败：${errorMsg}`
        
        if (e.message_type === 'group') {
          await ctx.bot.sendGroupMsg(e.group_id, [ctx.segment.text(replyMsg)])
        } else if (e.message_type === 'private') {
          await ctx.bot.sendPrivateMsg(e.user_id, [ctx.segment.text(replyMsg)])
        }
      }
    }

    ctx.handle('message.group', handlePublish)
    ctx.handle('message.private', handlePublish)
  },
})
