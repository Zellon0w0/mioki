import { definePlugin, getAbsPluginDir } from 'mioki'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pangu = {
  spacingText(text: string): string {
    if (!text) return ''
    return text
      .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
      .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
  }
}

interface RecommendNewsDTO {
  id: number
}

interface NewsItem {
  title: string
  publishTime: number
  recommendNewsDTO?: RecommendNewsDTO
}

interface TopicListRes {
  result: NewsItem[]
}

interface Post {
  id: number
  title: string
  content?: string
  postUrl: string
  gmtCreate: number
}

interface PostDetailRes {
  result: {
    post: Post
  }
}

async function fetchCS2UpdateNews() {
  const qs = new URLSearchParams({ pageNum: '1', pageSize: '10', topicId: '12' })
  const listApi = `https://appengine.wmpvp.com/steamcn/community/homepage/getNewsListInTopic?${qs.toString()}`

  const res = await fetch(listApi).catch(() => null)
  if (!res) return []
  const data: TopicListRes = await res.json().catch(() => null)
  if (!data || !data.result) return []

  return data.result
    .filter((e) => !!e.recommendNewsDTO)
    .map((item) => ({
      id: item.recommendNewsDTO!.id,
      title: pangu.spacingText(item.title),
      url: `https://news.wmpvp.com/community-detail.html?id=${item.recommendNewsDTO!.id}`,
      publishedAt: new Date(item.publishTime),
    }))
    .toSorted((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
}

async function fetchNewsDetail(id: number) {
  const url = `https://appengine.wmpvp.com/steamcn/community/post/getPostById?postId=${id}`
  const res = await fetch(url).catch(() => null)
  if (!res) return null
  const data: PostDetailRes = await res.json().catch(() => null)
  if (!data || !data.result || !data.result.post) return null

  const text = (data.result.post.content || '')
    .replaceAll('<br>', '\n')
    .replaceAll('</strong></p><p><strong>', '</strong></p>\n<p><strong>')
    .replaceAll('<li>', '<li>\n- ')
    .replaceAll('</p>', '</p>\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim()

  return {
    id: data.result.post.id,
    title: pangu.spacingText(data.result.post.title),
    content: text,
    url: data.result.post.postUrl,
    publishedAt: new Date(data.result.post.gmtCreate),
  }
}

function formatUpdateMsg(detail: { id: number; title: string; content: string; url: string; publishedAt: Date }) {
  const timeStr = detail.publishedAt.toLocaleString('zh-CN', { hour12: false })

  let content = detail.content
  const MAX_LENGTH = 700
  if (content.length > MAX_LENGTH) {
    content = content.substring(0, MAX_LENGTH) + `...\n\n⚠️ 内容过多已截断，查看完整内容请点击下方详情链接。`
  }

  return [
    `📢 CS2 更新快报`,
    `━━━━━━━━━━━━━━━`,
    `📌 标题: ${detail.title}`,
    `📅 时间: ${timeStr}`,
    `🔗 链接: ${detail.url}`,
    `━━━━━━━━━━━━━━━`,
    content
  ].join('\n')
}

interface PluginConfig {
  enabled: boolean
  cronTime: string
  whitelist: number[]
}

interface PluginState {
  lastNewsId: number
}

export default definePlugin({
  name: 'CS更新',
  version: '1.0.0',
  description: '获取 CS2 最新更新，并在发现新更新时推送到白名单群组',
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), 'CS更新')
    const configPath = join(pluginDir, 'config.json')
    const statePath = join(pluginDir, 'data.json')

    // Load config.json
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        cronTime: '0 * * * *',
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

    // Load data.json
    const loadState = (): PluginState => {
      const defaultState: PluginState = { lastNewsId: 0 }
      if (!existsSync(statePath)) {
        return defaultState
      }
      try {
        const fileContent = readFileSync(statePath, 'utf-8')
        return {
          ...defaultState,
          ...JSON.parse(fileContent)
        }
      } catch (err: any) {
        ctx.logger.error(`加载状态文件失败: ${err.message}`)
        return defaultState
      }
    }

    // Save data.json
    const saveState = (state: PluginState) => {
      try {
        writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存状态文件失败: ${err.message}`)
      }
    }

    // Initialize state if not present (prevents spam on first start)
    const initState = async () => {
      const state = loadState()
      if (state.lastNewsId === 0) {
        try {
          const newsList = await fetchCS2UpdateNews()
          if (newsList.length > 0) {
            const newestId = newsList[0].id
            saveState({ lastNewsId: newestId })
            ctx.logger.info(`初始化最新 CS2 新闻 ID 为: ${newestId}`)
          }
        } catch (err: any) {
          ctx.logger.error(`初始化状态失败: ${err.message}`)
        }
      }
    }

    await initState()

    // Handle Command Query
    ctx.handle('message.group', async (event) => {
      const config = loadConfig()
      if (!config.enabled) return

      // If whitelist is specified, restrict usage to whitelist groups
      if (config.whitelist.length > 0 && !config.whitelist.includes(event.group_id)) {
        return
      }

      if (ctx.text(event).trim() === 'CS更新') {
        try {
          const newsList = await fetchCS2UpdateNews()
          if (newsList.length === 0) {
            await event.reply('未能获取到 CS2 更新列表，请稍后再试。')
            return
          }

          const latestNews = newsList[0]
          const detail = await fetchNewsDetail(latestNews.id)
          if (!detail) {
            await event.reply(`未能获取到最新更新的详情，请尝试直接点击链接查看：\n${latestNews.url}`)
            return
          }

          const msg = formatUpdateMsg(detail)
          await event.reply(msg)
        } catch (err: any) {
          ctx.logger.error(`手动查询 CS 更新失败: ${err.message}`)
          await event.reply(`获取 CS 更新失败，错误信息: ${err.message || err}`)
        }
      }
    })

    // Scheduled Check (Cron Task)
    const config = loadConfig()
    ctx.cron(config.cronTime, async () => {
      const currentConfig = loadConfig()
      if (!currentConfig.enabled) return
      if (currentConfig.whitelist.length === 0) return

      try {
        const newsList = await fetchCS2UpdateNews()
        if (newsList.length === 0) return

        const state = loadState()
        const lastId = state.lastNewsId

        // If lastNewsId is not set, initialize it and exit to prevent spamming old updates
        if (lastId === 0) {
          saveState({ lastNewsId: newsList[0].id })
          return
        }

        // Filter news items newer than lastId
        const newerItems = newsList.filter((item) => item.id > lastId)

        if (newerItems.length > 0) {
          // Filter items within 48 hours to avoid spamming very old updates
          const maxAgeMs = 48 * 60 * 60 * 1000
          const now = Date.now()
          const newItemsToPush = newerItems
            .filter((item) => now - item.publishedAt.getTime() < maxAgeMs)
            .reverse()

          if (newItemsToPush.length > 0) {
            ctx.logger.info(`检测到 ${newItemsToPush.length} 条新 CS2 更新，开始推送到白名单群组`)
            for (const item of newItemsToPush) {
              const detail = await fetchNewsDetail(item.id)
              if (!detail) continue

              const msg = formatUpdateMsg(detail)
              for (const groupId of currentConfig.whitelist) {
                try {
                  await ctx.bot.sendGroupMsg(groupId, msg)
                  await new Promise((resolve) => setTimeout(resolve, 500))
                } catch (err: any) {
                  ctx.logger.error(`推送更新到群 ${groupId} 失败: ${err.message}`)
                }
              }
            }
          } else {
            ctx.logger.info(`检测到新更新，但由于发布时间已超过 48 小时，跳过推送`)
          }

          const newestId = Math.max(...newerItems.map((item) => item.id))
          saveState({ lastNewsId: newestId })
        }
      } catch (err: any) {
        ctx.logger.error(`定时检查 CS 更新失败: ${err.message}`)
      }
    })
  }
})
