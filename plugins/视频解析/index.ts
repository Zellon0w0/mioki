import crypto from 'node:crypto'
import fs from 'node:fs'
import { createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { definePlugin, getAbsPluginDir } from 'mioki'

import { sharedBrowser } from '../_shared/resource'

const PLUGIN_NAME = '视频解析'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  blacklist: number[]
  kuaishouCookie: string
}

interface Comment {
  uname: string
  message: string
  like: number
  avatar?: string
  pinned?: boolean
  images?: string[]
}

interface VideoResult {
  type: 'video'
  name: string
  title: string
  cover: string
  photo: string
  desc?: string
  comments?: Comment[]
}

interface ImagesResult {
  type: 'images'
  name: string
  title: string
  cover: string
  images: string[]
  desc?: string
  comments?: Comment[]
}

type ParseResult = VideoResult | ImagesResult | Error

async function runWithReaction<T>(event: any, task: () => Promise<T>, id = '60'): Promise<T> {
  let reacted = false
  if (typeof event?.addReaction === 'function') {
    try {
      await event.addReaction(id)
      reacted = true
    } catch {}
  }

  try {
    return await task()
  } finally {
    if (reacted && typeof event?.delReaction === 'function') {
      await event.delReaction(id).catch(() => {})
    }
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 12_000

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new Error(`HTTP request timeout after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

function createLocalForwardMsg(
  ctx: any,
  message: any[] = [],
  options: { user_id?: number; nickname?: string } = {},
): any {
  const user_id = options.user_id || ctx.self_id
  const nickname = options.nickname || ''

  const content = message.map((item) => {
    if (typeof item === 'string') {
      return { type: 'text', data: { text: item } }
    }
    if (item.type === 'at') {
      return { type: 'at', data: { qq: String(item.qq) } }
    }
    if (item.type && item.data) {
      return item
    }
    const { type, ...data } = item
    return { type, data }
  })

  return {
    type: 'node',
    user_id: String(user_id),
    uin: String(user_id) as any,
    nickname,
    name: nickname as any,
    content,
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeImageUrl(url?: unknown): string {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  if (!trimmed) return ''
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('base64://')) return `data:image/png;base64,${trimmed.slice('base64://'.length)}`
  if (/^(https?:|file:|data:image\/)/i.test(trimmed)) return trimmed
  return ''
}

function formatLikeCount(like: number): string {
  const value = Number.isFinite(like) ? Math.max(0, Math.floor(like)) : 0
  if (value >= 10000) {
    const text = (value / 10000).toFixed(value >= 100000 ? 0 : 1)
    return `${text.replace(/\.0$/, '')}万`
  }
  return value.toLocaleString('zh-CN')
}

function renderCommentAvatar(comment: Comment): string {
  const avatarUrl = normalizeImageUrl(comment.avatar)
  const initial = escapeHtml(Array.from(comment.uname || '?')[0] || '?')

  return `
    <div class="avatar">
      <div class="avatar-fallback">${initial}</div>
      ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" onerror="this.style.display='none'" />` : ''}
    </div>
  `
}

function renderCommentImages(comment: Comment): string {
  const imageUrls = (comment.images || []).map(normalizeImageUrl).filter(Boolean)
  if (imageUrls.length === 0) return ''

  const visibleImages = imageUrls.slice(0, 3)
  const extraCount = imageUrls.length - visibleImages.length
  const images = visibleImages
    .map((url, index) => {
      const overlay =
        extraCount > 0 && index === visibleImages.length - 1 ? `<span class="image-extra">+${extraCount}</span>` : ''
      return `
        <div class="comment-image">
          <img src="${escapeHtml(url)}" onerror="this.style.display='none'" />
          ${overlay}
        </div>
      `
    })
    .join('')

  return `<div class="comment-images">${images}</div>`
}

function renderCommentsHtml(comments: Comment[]): string {
  const rows = comments
    .map((comment, index) => {
      const tag = comment.pinned ? '置顶' : `热评 ${index + 1}`
      const tagClass = comment.pinned ? 'tag pinned' : 'tag'

      return `
        <article class="comment-card">
          ${renderCommentAvatar(comment)}
          <div class="comment-main">
            <div class="comment-meta">
              <div class="name-line">
                <span class="user-name">${escapeHtml(comment.uname || '未知用户')}</span>
                <span class="${tagClass}">${tag}</span>
              </div>
              <div class="likes">点赞 ${escapeHtml(formatLikeCount(comment.like))}</div>
            </div>
            <div class="comment-text">${escapeHtml(comment.message || '')}</div>
            ${renderCommentImages(comment)}
          </div>
        </article>
      `
    })
    .join('')

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #edf2f7;
      color: #1f2937;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif;
    }
    .comments-board {
      width: 720px;
      padding: 20px;
      background: #ffffff;
      border: 1px solid #d7dee8;
      border-radius: 8px;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.12);
    }
    .board-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid #e5eaf0;
    }
    .board-title {
      font-size: 22px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
      color: #111827;
    }
    .board-subtitle {
      margin-top: 4px;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 600;
      color: #667085;
    }
    .count-badge {
      flex: 0 0 auto;
      padding: 7px 11px;
      border-radius: 8px;
      background: #e8f2ff;
      color: #155eef;
      font-size: 13px;
      line-height: 1;
      font-weight: 800;
    }
    .comment-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .comment-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 12px;
      padding: 14px;
      background: #f8fafc;
      border: 1px solid #e5eaf0;
      border-radius: 8px;
    }
    .avatar {
      position: relative;
      width: 48px;
      height: 48px;
      overflow: hidden;
      border-radius: 50%;
      background: linear-gradient(135deg, #155eef, #0e9384);
      color: #ffffff;
      flex: 0 0 auto;
    }
    .avatar img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      font-weight: 800;
    }
    .comment-main {
      min-width: 0;
    }
    .comment-meta {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .name-line {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .user-name {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 15px;
      line-height: 1.25;
      font-weight: 800;
      color: #101828;
    }
    .tag {
      flex: 0 0 auto;
      padding: 4px 7px;
      border-radius: 6px;
      background: #fff4df;
      color: #b54708;
      font-size: 11px;
      line-height: 1;
      font-weight: 800;
    }
    .tag.pinned {
      background: #ffe4e8;
      color: #c01048;
    }
    .likes {
      flex: 0 0 auto;
      color: #475467;
      background: #eef4ff;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
      line-height: 1;
      font-weight: 800;
    }
    .comment-text {
      color: #1f2937;
      font-size: 16px;
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .comment-images {
      display: grid;
      grid-template-columns: repeat(3, 88px);
      gap: 8px;
      margin-top: 10px;
    }
    .comment-image {
      position: relative;
      width: 88px;
      height: 88px;
      overflow: hidden;
      border-radius: 8px;
      background: #e5eaf0;
    }
    .comment-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .image-extra {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(17, 24, 39, 0.58);
      color: #ffffff;
      font-size: 19px;
      font-weight: 900;
    }
  </style>
</head>
<body>
  <main class="comments-board">
    <header class="board-header">
      <div>
        <div class="board-title">热门评论</div>
        <div class="board-subtitle">视频解析自动整理</div>
      </div>
      <div class="count-badge">${comments.length} 条</div>
    </header>
    <section class="comment-list">
      ${rows}
    </section>
  </main>
</body>
</html>
  `
}

async function renderCommentsImage(comments: Comment[]): Promise<Buffer> {
  const renderableComments = comments.filter((comment) => comment.message || comment.uname || comment.images?.length)
  if (renderableComments.length === 0) {
    throw new Error('没有可渲染的评论内容')
  }

  return sharedBrowser.withPage(
    async (page) => {
      await page.setContent(renderCommentsHtml(renderableComments), { waitUntil: 'domcontentloaded', timeout: 10_000 })
      await page.evaluate(async () => {
        const images = Array.from(document.images)
        await Promise.race([
          Promise.all(
            images.map((img) => {
              if (img.complete) return Promise.resolve()
              return new Promise<void>((resolve) => {
                img.onload = () => resolve()
                img.onerror = () => resolve()
              })
            }),
          ),
          new Promise((resolve) => setTimeout(resolve, 3500)),
        ])
      })

      const height = await page.evaluate(() => {
        const board = document.querySelector('.comments-board')
        return Math.ceil((board?.getBoundingClientRect().height || document.documentElement.scrollHeight) + 48)
      })

      await page.setViewport({
        width: 780,
        height: Math.min(Math.max(height, 420), 4000),
        deviceScaleFactor: 2,
      })

      const target = await page.$('.comments-board')
      const image = await (target || page).screenshot({
        type: 'png',
        encoding: 'binary',
      })

      return Buffer.from(image)
    },
    {
      label: `${PLUGIN_NAME} 评论渲染`,
      timeoutMs: 25_000,
      viewport: { width: 780, height: 1200, deviceScaleFactor: 2 },
    },
  )
}

function createCommentFallbackParts(ctx: any, comment: Comment): any[] {
  const prefix = comment.pinned ? '[置顶] ' : '[热评] '
  const messageParts: any[] = [`${prefix}${comment.uname}: ${comment.message}（点赞数：${comment.like}）`]

  if (comment.images && comment.images.length > 0) {
    for (const imgUrl of comment.images) {
      messageParts.push(ctx.segment.image(imgUrl))
    }
  }

  return messageParts
}

async function appendCommentsForwardNode(ctx: any, forwardNodes: any[], comments?: Comment[]): Promise<void> {
  if (!comments || comments.length === 0) return

  try {
    const imageBuffer = await renderCommentsImage(comments)
    forwardNodes.push(
      createLocalForwardMsg(ctx, [ctx.segment.image(`base64://${imageBuffer.toString('base64')}`)], {
        nickname: '热门评论',
      }),
    )
  } catch (err: any) {
    ctx.logger.error(`[视频解析] 评论图片渲染失败，回退到纯文本: ${err.message || err}`)
    for (const comment of comments) {
      forwardNodes.push(
        createLocalForwardMsg(ctx, createCommentFallbackParts(ctx, comment), { nickname: comment.uname }),
      )
    }
  }
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: '1.0.0',
  dependencies: ['puppeteer-core'],
  async setup(ctx) {
    const originalApi = ctx.bot.api
    ;(ctx.bot as any).api = function (action: string, params: any = {}) {
      if (['send_group_msg', 'send_private_msg', 'send_msg'].includes(action)) {
        return new Promise<any>((resolve, reject) => {
          const ws = ctx.bot.ws
          const echo = Math.random().toString(36).substring(2, 15)

          const handleMessage = (event: any) => {
            try {
              const data = JSON.parse(event.data)
              if (data && data.echo === echo) {
                cleanup()
                if (data.retcode === 0) {
                  resolve(data.data)
                } else {
                  reject(new Error(`API 错误: ${data.message}`))
                }
              }
            } catch {}
          }

          const cleanup = () => {
            clearTimeout(timeoutId)
            ws.removeEventListener('message', handleMessage)
          }

          ws.addEventListener('message', handleMessage)

          const timeoutId = setTimeout(() => {
            cleanup()
            reject(new Error(`API 请求超时: ${action}`))
          }, 300_000) // 5 minutes timeout

          try {
            ws.send(JSON.stringify({ echo, action, params }))
          } catch (err) {
            cleanup()
            reject(err)
          }
        })
      }
      return originalApi.call(ctx.bot, action, params)
    }

    const pluginDir = path.join(getAbsPluginDir(), '视频解析')
    const configPath = path.join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        blacklist: [],
        kuaishouCookie: '',
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
          kuaishouCookie: typeof parsed.kuaishouCookie === 'string' ? parsed.kuaishouCookie : defaultConfig.kuaishouCookie,
        }
      } catch (err: any) {
        ctx.logger.error(`[视频解析] 加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return

      // 黑名单验证
      if (config.blacklist.includes(e.user_id)) return

      // 白名单验证
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      let card: any = null
      let message = e.raw_message || ''

      // 查找 JSON 卡片
      const jsonSeg = e.message.find((m: any) => m.type === 'json')
      if (jsonSeg) {
        try {
          const data = JSON.parse((jsonSeg as any).data)
          card = data.meta
        } catch (err) {
          ctx.logger.error(`[视频解析] JSON 解析失败: ${err}`)
        }
      }

      const shouldParse =
        message.includes('https://v.douyin.com/') ||
        message.includes('https://v.kuaishou.com/') ||
        card?.news?.tag === '快手' ||
        message.includes('https://video.weishi.qq.com/') ||
        card?.video?.jumpURL?.includes('weishi.qq.com') ||
        message.includes('bilibili.com/video/') ||
        message.includes('b23.tv/') ||
        card?.detail_1?.title === '哔哩哔哩' ||
        message.includes('打开【小红书】App查看精彩内容！') ||
        message.includes('xhslink.com') ||
        card?.news?.tag === '小红书' ||
        message.includes('api.xiaoheihe.cn/v3/bbs/app/api/web/share') ||
        message.includes('xiaoheihe.cn/app/bbs/link/')

      if (!shouldParse) return

      await runWithReaction(e, async () => {
        let parsedVideo: ParseResult | null = null

        if (message.includes('https://v.douyin.com/')) {
          parsedVideo = await DouyinData(message)
        } else if (message.includes('https://v.kuaishou.com/') || (card && card.news && card.news.tag === '快手')) {
          if (card && card.news) message = card.news.jumpUrl
          parsedVideo = await KuaishouData(message, config.kuaishouCookie)
        } else if (
          message.includes('https://video.weishi.qq.com/') ||
          (card && card.video && card.video.jumpURL.includes('weishi.qq.com'))
        ) {
          if (card && card.video) message = card.video.jumpURL
          parsedVideo = await weishiData(message)
        } else if (
          message.includes('bilibili.com/video/') ||
          message.includes('b23.tv/') ||
          (card && card.detail_1 && card.detail_1.title === '哔哩哔哩')
        ) {
          if (card && card.detail_1) message = card.detail_1.qqdocurl
          parsedVideo = await bilibiliData(message)
        } else if (
          message.includes('打开【小红书】App查看精彩内容！') ||
          message.includes('xhslink.com') ||
          (card && card.news && card.news.tag === '小红书')
        ) {
          if (card && card.news) message = card.news.jumpUrl
          parsedVideo = await xiaohongshuData(message)
        } else if (
          message.includes('api.xiaoheihe.cn/v3/bbs/app/api/web/share') ||
          message.includes('xiaoheihe.cn/app/bbs/link/')
        ) {
          parsedVideo = await xiaoheiheData(message)
        }

        if (parsedVideo && !(parsedVideo instanceof Error)) {
          const video = parsedVideo
          try {
            // 1. Clean and deduplicate title and desc
            let title = (video.title || '').trim()
            let desc = (video.desc || '').trim()

            if (!title && desc) {
              if (desc.length > 60) {
                title = desc.slice(0, 60) + '...'
              } else {
                title = desc
                desc = ''
              }
            } else if (title && desc && title === desc) {
              desc = ''
            }

            video.title = title
            video.desc = desc

            const introText =
              `作者：${video.name}\n标题：${video.title}` + (video.desc ? `\n\n正文/简介：${video.desc}` : '')

            if (video.type === 'images') {
              const forwardNodes = [
                createLocalForwardMsg(ctx, [introText], { nickname: video.name }),
                ...video.images.map((imgUrl: string) =>
                  createLocalForwardMsg(ctx, [ctx.segment.image(imgUrl)], { nickname: video.name }),
                ),
              ]

              await appendCommentsForwardNode(ctx, forwardNodes, video.comments)
              await e.reply(forwardNodes)
            } else {
              // Video mode: download video first
              let videoPath = ''
              let downloadErrorMsg = ''
              try {
                videoPath = await downloadVideo(video.photo)
              } catch (videoError: any) {
                ctx.logger.error(`[视频解析] 视频下载失败: ${videoError.message}`)
                downloadErrorMsg = `视频下载失败: ${videoError.message}`
              }

              const forwardNodes = [
                createLocalForwardMsg(ctx, [introText, ctx.segment.image(video.cover)], { nickname: video.name }),
              ]

              if (videoPath) {
                forwardNodes.push(
                  createLocalForwardMsg(ctx, [ctx.segment.video(`file://${videoPath}`)], { nickname: video.name }),
                )
              } else {
                forwardNodes.push(
                  createLocalForwardMsg(ctx, [`[视频播放失败]\n${downloadErrorMsg}`], { nickname: video.name }),
                )
              }

              await appendCommentsForwardNode(ctx, forwardNodes, video.comments)

              try {
                await e.reply(forwardNodes)
              } finally {
                if (videoPath) {
                  cleanupFile(ctx, videoPath)
                }
              }
            }
          } catch (error) {
            ctx.logger.error(`[视频解析] 视频/图片发送失败: ${error}`)
          }
        }
      })
    })

    return () => {
      ;(ctx.bot as any).api = originalApi
    }
  },
})

/**
 * 通用视频下载函数，加了大小和超时限制防止服务器卡死或内存溢出
 */
async function downloadVideo(
  url: string,
  maxBytes: number = 30 * 1024 * 1024,
  timeoutMs: number = 60000,
): Promise<string> {
  const tempPath = path.join(tmpdir(), `video_${Date.now()}.mp4`)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (size > maxBytes) {
        throw new Error(
          `视频文件过大 (${(size / 1024 / 1024).toFixed(1)}MB)，已跳过下载 (最大限制为 ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`,
        )
      }
    }

    if (!response.body) {
      throw new Error('无法获取视频流')
    }

    let downloadedBytes = 0
    const limitTransform = async function* (source: any) {
      for await (const chunk of source) {
        downloadedBytes += chunk.length
        if (downloadedBytes > maxBytes) {
          throw new Error(`视频文件过大，已终止下载 (最大限制为 ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`)
        }
        yield chunk
      }
    }

    // @ts-ignore
    await pipeline(response.body, limitTransform, createWriteStream(tempPath))
    return tempPath
  } catch (err: any) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
      } catch {}
    }
    if (err.name === 'AbortError') {
      throw new Error(`下载视频超时 (${timeoutMs / 1000} 秒)`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 清理临时文件函数
 */
function cleanupFile(ctx: any, filePath: string) {
  const timer = setTimeout(() => {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        ctx.logger.info(`[视频解析] 已清理临时文件: ${filePath}`)
      }
    } catch (e) {
      ctx.logger.error(`[视频解析] 文件清理失败: ${e}`)
    }
  }, 300000) // 5分钟后自动清理
  ctx.clears.add(() => clearTimeout(timer))
}

// --- 平台解析函数 ---

async function xiaohongshuData(mes: string): Promise<ParseResult> {
  const headers = new Headers({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  })
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetchWithTimeout(urls[0], { method: 'GET', headers, credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP错误！状态： ${response.status}`)
    const html = await response.text()
    const jsonStr = html.split('"noteDetailMap":')[1].split(',"serverRequestInfo"')[0]
    const json = JSON.parse(jsonStr)
    const id = Object.keys(json)[0]
    const note = json[id].note
    const name = note.user.nickname
    const title = note.title || note.desc || ''
    const desc = note.title && note.title !== note.desc ? note.desc : ''

    if (note.video) {
      const cover = note.imageList[0].urlDefault
      const photo = note.video.media.stream.h264[0].masterUrl
      return { type: 'video', name, title, cover, photo, desc }
    } else if (note.imageList && note.imageList.length > 0) {
      const images = note.imageList.map((img: any) => img.urlDefault || img.url || img.urlPre)
      const cover = images[0]
      return { type: 'images', name, title, cover, images, desc }
    } else {
      throw new Error('未找到视频或图片内容')
    }
  } catch (error: any) {
    return error
  }
}

async function bilibiliData(mes: string): Promise<ParseResult> {
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    let url = urls[0]

    // 处理 b23.tv 短链接
    if (url.includes('b23.tv')) {
      const res = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow' })
      url = res.url
    }

    // 提取 bvid
    let bvid = ''
    const bvidMatch = url.match(/BV[a-zA-Z0-9]+/)
    if (bvidMatch) {
      bvid = bvidMatch[0]
    } else {
      // 尝试提取 av 号
      const avidMatch = url.match(/av(\d+)/)
      if (avidMatch) {
        const avid = avidMatch[1]
        const apiRes = await fetchWithTimeout(`https://api.bilibili.com/x/web-interface/view?aid=${avid}`)
        const apiData = await apiRes.json()
        if (apiData.code !== 0) throw new Error(`Bilibili API 错误: ${apiData.message}`)

        bvid = apiData.data.bvid
      } else {
        throw new Error('未找到有效的 BVID 或 AVID')
      }
    }
    const apiRes = await fetchWithTimeout(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    const apiData = await apiRes.json()
    if (apiData.code !== 0) throw new Error(`Bilibili API 错误: ${apiData.message}`)

    const { title, desc, pic: cover, owner, cid, aid } = apiData.data
    const name = owner.name

    const playRes = await fetchWithTimeout(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=16&type=mp4&platform=html5`,
    )
    const playData = await playRes.json()
    if (playData.code !== 0) throw new Error(`Bilibili PlayAPI 错误: ${playData.message}`)

    const photo = playData.data.durl[0].url

    const comments: Comment[] = []
    try {
      const replyRes = await fetchWithTimeout(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2`)
      const replyData = await replyRes.json()
      if (replyData.code === 0 && replyData.data) {
        const pinnedRpid: number | undefined = replyData.data.upper?.top?.rpid

        if (replyData.data.replies && replyData.data.replies.length > 0) {
          const hotReplies = replyData.data.replies
          let count = 0
          for (const r of hotReplies) {
            if (count >= 3) break
            if (pinnedRpid && r.rpid === pinnedRpid) continue
            comments.push({
              uname: r.member?.uname || '未知用户',
              message: r.content?.message || '',
              like: r.like || 0,
              avatar: r.member?.avatar || '',
              pinned: false,
              images: r.content?.pictures?.map((p: any) => p.img_src).filter(Boolean) || [],
            })
            count++
          }
        }
      }
    } catch (e) {
      // Ignore comment fetch errors gracefully
    }

    return { type: 'video', name, title, cover, photo, desc, comments }
  } catch (error: any) {
    return error
  }
}
async function KuaishouData(mes: string, kuaishouCookie = ''): Promise<ParseResult> {
  const headers = new Headers({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  })
  if (kuaishouCookie.trim()) {
    headers.set('Cookie', kuaishouCookie.trim())
  }
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetchWithTimeout(urls[0], { method: 'GET', headers, credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP错误！状态： ${response.status}`)
    const html = await response.text()
    const jsonStr = html.split('defaultClient":')[1].split(',"clients')[0]
    const json = JSON.parse(jsonStr)
    const authorKey = Object.keys(json).find((key) => key.startsWith('VisionVideoDetailAuthor:'))
    const photoKey = Object.keys(json).find((key) => key.startsWith('VisionVideoDetailPhoto:'))
    if (photoKey && authorKey) {
      const name = json[authorKey].name
      const title = json[photoKey].caption
      const cover = json[photoKey].coverUrl
      const photo = json[photoKey].photoUrl
      return { type: 'video', name, title, cover, photo }
    }
    throw new Error('解析快手数据失败')
  } catch (error: any) {
    return error
  }
}

async function DouyinData(mes: string): Promise<ParseResult> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }

  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')

    const redirectRes = await fetchWithTimeout(urls[0], {
      method: 'GET',
      headers,
      redirect: 'manual',
    })

    const location = redirectRes.headers.get('location')
    if (!location) {
      throw new Error('未找到跳转地址')
    }

    const videoRes = await fetchWithTimeout(location, {
      method: 'GET',
      headers,
    })
    const html = await videoRes.text()

    const matches = html.match(/_ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/)
    if (!matches) {
      throw new Error('未找到 _ROUTER_DATA')
    }

    let text = matches[1].trim()
    if (text.endsWith(';')) {
      text = text.slice(0, -1)
    }

    const routerData = JSON.parse(text)
    const loaderData = routerData.loaderData
    const pageKey = Object.keys(loaderData).find((k) => k.endsWith('/page'))
    if (!pageKey) {
      throw new Error('无法匹配到页面数据')
    }
    const pageData = loaderData[pageKey]
    const itemList = pageData.videoInfoRes.item_list
    if (!itemList || itemList.length === 0) {
      throw new Error('视频/图文数据解析为空')
    }

    const item = itemList[0]
    const name = item.author.nickname
    const title = item.desc

    const images = item.images
    if (images && images.length > 0) {
      const imgUrls = images.map((img: any) => img.url_list[0])
      const cover = imgUrls[0]
      return { type: 'images', name, title, cover, images: imgUrls }
    }

    const cover = item.video.cover.url_list[0]
    const playWmUrl = item.video.play_addr.url_list[0]
    const playUrl = playWmUrl.replace('/playwm/', '/play/')

    const videoFileRes = await fetchWithTimeout(playUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
      },
      redirect: 'follow',
    })

    return { type: 'video', name, title, cover, photo: videoFileRes.url }
  } catch (err: any) {
    return err
  }
}

async function weishiData(mes: string): Promise<ParseResult> {
  const headers = new Headers({
    'User-Agent':
      'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/7.2.1.0 Safari/536.2+ Edg/131.0.0.0',
  })
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetchWithTimeout(urls[0], { method: 'GET', headers, credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP错误！状态： ${response.status}`)
    const html = await response.text()
    const jsonStr = html.split('"feedsList":')[1].split(',"isCollection":')[0]
    const json = JSON.parse(jsonStr)
    const name = json[0].poster.nick
    const title = json[0].shareInfo.bodyMap['0'].title
    const cover = json[0].videoCover
    const photo = json[0].videoUrl
    return { type: 'video', name, title, cover, photo }
  } catch (error: any) {
    return error
  }
}

async function fetchFromRedirect(shareUrl: string, linkId: string): Promise<ParseResult> {
  const res = await fetchWithTimeout(shareUrl, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    redirect: 'manual',
  })

  const location = res.headers.get('location')
  if (!location) {
    throw new Error('未获取到跳转地址')
  }

  const u = new URL(location)
  const redirectDataStr = u.searchParams.get('redirect_data')
  if (!redirectDataStr) {
    throw new Error('未找到分享数据参数')
  }

  const redirectData = JSON.parse(redirectDataStr)
  const link = redirectData.link
  if (!link) {
    throw new Error('分享数据解析失败')
  }

  const name = '小黑盒用户'
  const title = link.title || ''
  const desc = link.description || ''
  const cover = link.thumb || ''
  const images = link.thumb ? [link.thumb] : []

  return {
    type: 'images',
    name,
    title,
    cover,
    images,
    desc,
  }
}

async function xiaoheiheData(mes: string): Promise<ParseResult> {
  const urls = mes.match(/https?:\/\/[^\s]+/g)
  if (!urls) return new Error('未找到链接')
  const shareUrl = urls[0]

  // Extract link_id
  let linkId = ''
  if (shareUrl.includes('link_id=')) {
    const match = shareUrl.match(/link_id=([a-zA-Z0-9]+)/)
    if (match) linkId = match[1]
  } else {
    const match = shareUrl.match(/\/link\/([a-zA-Z0-9]+)/)
    if (match) linkId = match[1]
  }
  if (!linkId) return new Error('未找到有效的 link_id')

  try {
    const path = '/bbs/app/link/tree'
    const timestamp = Math.floor(Date.now() / 1000)

    // Generate nonce
    const nonce = crypto
      .createHash('md5')
      .update(timestamp + Math.random().toString())
      .digest('hex')
      .toUpperCase()

    // Compute hkey
    const hkey = computeHkey(path, timestamp + 1, nonce)

    // Generate a random device_id
    const deviceId = crypto.randomUUID().replace(/-/g, '')

    // Build query parameters
    const params = new URLSearchParams({
      os_type: 'web',
      app: 'heybox',
      client_type: 'web',
      version: '999.0.4',
      web_version: '2.5',
      x_client_type: 'web',
      x_app: 'heybox_website',
      heybox_id: '',
      x_os_type: 'Windows',
      device_info: 'Chrome',
      device_id: deviceId,
      hkey: hkey,
      _time: String(timestamp),
      nonce: nonce,
      link_id: linkId,
      is_first: '1',
      page: '1',
      index: '1',
      limit: '20',
      owner_only: '0',
    })

    const url = `https://api.xiaoheihe.cn${path}?${params.toString()}`
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`,
      },
    })

    const data: any = await response.json()
    if (data.status !== 'ok') {
      throw new Error(`小黑盒 API 错误: ${data.msg || '未知错误'}`)
    }

    const link = data.result.link
    if (!link) {
      throw new Error('未获取到帖子内容')
    }

    const name = link.user?.username || '未知作者'
    const title = link.title || link.description || ''

    let videoUrl = ''
    let cover = link.thumb || link.cover || ''

    if (link.video_info) {
      videoUrl = link.video_info.video_src || link.video_info.url || link.video_info.play_url || ''
      if (link.video_info.cover) cover = link.video_info.cover
    }

    let desc = ''
    const images: string[] = []
    if (link.text) {
      try {
        const textSegments = JSON.parse(link.text)
        if (Array.isArray(textSegments)) {
          const textParts: string[] = []
          for (const item of textSegments) {
            if (item.type === 'text' && item.text) {
              textParts.push(item.text.trim())
            } else if (item.type === 'img' && item.url) {
              images.push(item.url)
            } else if ((item.type === 'video' || item.type === 'video_link') && !videoUrl) {
              videoUrl = item.url || item.video_src || item.play_url || ''
              if (item.cover || item.thumb) {
                cover = item.cover || item.thumb
              }
            }
          }
          desc = textParts.filter(Boolean).join('\n')
        }
      } catch (err) {}
    }

    if (!desc) {
      desc = link.description || ''
    }

    if (images.length === 0 && link.thumb) {
      images.push(link.thumb)
    }
    if (!cover && images.length > 0) {
      cover = images[0]
    }

    const comments: Comment[] = []
    if (data.result?.comments && Array.isArray(data.result.comments)) {
      const candidates: any[] = []
      for (const item of data.result.comments) {
        if (item.comment && Array.isArray(item.comment) && item.comment.length > 0) {
          const c = item.comment[0]
          if (c.is_top === 1) continue // Skip pinned comment to comply with "only hot 3 comments"
          candidates.push(c)
        }
      }

      candidates.sort((a, b) => (b.up || 0) - (a.up || 0))
      const topHots = candidates.slice(0, 3)
      for (const c of topHots) {
        comments.push({
          uname: c.user?.username || '小黑盒用户',
          message: c.text || '',
          like: c.up || 0,
          avatar: c.user?.avatar || c.user?.avatar_url || c.user?.headimg || c.user?.icon || '',
          pinned: false,
        })
      }
    }

    if (link.has_video === 1 || videoUrl) {
      return {
        type: 'video',
        name,
        title,
        cover,
        photo: videoUrl,
        desc,
        comments,
      }
    } else {
      return {
        type: 'images',
        name,
        title,
        cover,
        images,
        desc,
        comments,
      }
    }
  } catch (error: any) {
    try {
      return await fetchFromRedirect(shareUrl, linkId)
    } catch (fallbackError: any) {
      return fallbackError
    }
  }
}

function Vm(e: number): number {
  return 128 & e ? 255 & ((e << 1) ^ 27) : e << 1
}
function qm(e: number): number {
  return Vm(e) ^ e
}
function $m(e: number): number {
  return qm(Vm(e))
}
function Ym(e: number): number {
  return $m(qm(Vm(e)))
}
function Gm(e: number): number {
  return Ym(e) ^ $m(e) ^ qm(e)
}
function Km(e: number[]): number[] {
  const t = [0, 0, 0, 0]
  t[0] = Gm(e[0]) ^ Ym(e[1]) ^ $m(e[2]) ^ qm(e[3])
  t[1] = qm(e[0]) ^ Gm(e[1]) ^ Ym(e[2]) ^ $m(e[3])
  t[2] = $m(e[0]) ^ qm(e[1]) ^ Gm(e[2]) ^ Ym(e[3])
  t[3] = Ym(e[0]) ^ $m(e[1]) ^ qm(e[2]) ^ Gm(e[3])
  e[0] = t[0]
  e[1] = t[1]
  e[2] = t[2]
  e[3] = t[3]
  return e
}

function av(e: string, t: string, n: number): string {
  let r = ''
  const i = t.slice(0, n)
  for (let o = 0; o < e.length; o++) {
    r += i[e.charCodeAt(o) % i.length]
  }
  return r
}

function sv(e: string, t: string): string {
  let n = ''
  for (let r = 0; r < e.length; r++) {
    n += t[e.charCodeAt(r) % t.length]
  }
  return n
}

function computeHkey(e: string, t: number, n: string): string {
  e =
    '/' +
    e
      .split('/')
      .filter((x) => x)
      .join('/') +
    '/'
  const r = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89'

  const w1 = av(String(t), r, -2)
  const w2 = sv(e, r)
  const w3 = sv(n, r)

  const arrays = [w1, w2, w3]
  let woven = ''
  const maxLength = Math.max(...arrays.map((x) => x.length))
  for (let r = 0; r < maxLength; r++) {
    arrays.forEach((arr) => {
      if (r < arr.length) {
        woven += arr[r]
      }
    })
  }

  const i = woven.slice(0, 20)
  const o = crypto.createHash('md5').update(i).digest('hex')

  const charCodes = o
    .slice(-6)
    .split('')
    .map((x) => x.charCodeAt(0))
  const kmResult = Km(charCodes)
  let a = String(kmResult.reduce((x, y) => x + y, 0) % 100)
  if (a.length < 2) {
    a = '0' + a
  }

  const s = av(o.substring(0, 5), r, -4)
  return `${s}${a}`
}
