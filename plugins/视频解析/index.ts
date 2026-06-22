import { definePlugin, getAbsPluginDir } from 'mioki'
import fs from 'node:fs'
import { createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const PLUGIN_NAME = '视频解析'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  blacklist: number[]
}

interface Comment {
  uname: string
  message: string
  like: number
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

export default definePlugin({
  name: PLUGIN_NAME,
  version: '1.0.0',
  async setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), '视频解析')
    const configPath = path.join(pluginDir, 'config.json')

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
          blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : defaultConfig.blacklist
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

      const text = ctx.text(e).trim()
      let card: any = null
      let video: ParseResult | null = null
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

      if (message.includes('https://v.douyin.com/')) {
        video = await DouyinData(message)
      } else if (message.includes('https://v.kuaishou.com/') || (card && card.news && card.news.tag === '快手')) {
        if (card && card.news) message = card.news.jumpUrl
        video = await KuaishouData(message)
      } else if (message.includes('https://video.weishi.qq.com/') || (card && card.video && card.video.jumpURL.includes('weishi.qq.com'))) {
        if (card && card.video) message = card.video.jumpURL
        video = await weishiData(message)
      } else if (message.includes('bilibili.com/video/') || message.includes('b23.tv/') || (card && card.detail_1 && card.detail_1.title === '哔哩哔哩')) {
        if (card && card.detail_1) message = card.detail_1.qqdocurl
        video = await bilibiliData(message)
      } else if (message.includes('打开【小红书】App查看精彩内容！') || message.includes('xhslink.com') || (card && card.news && card.news.tag === '小红书')) {
        if (card && card.news) message = card.news.jumpUrl
        video = await xiaohongshuData(message)
      } else if (message.includes('api.xiaoheihe.cn/v3/bbs/app/api/web/share') || message.includes('xiaoheihe.cn/app/bbs/link/')) {
        video = await xiaoheiheData(message)
      }

      if (video && !(video instanceof Error)) {
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

          const introText = `作者：${video.name}\n标题：${video.title}` + (video.desc ? `\n\n正文/简介：${video.desc}` : '')

          if (video.type === 'images') {
            const forwardNodes = [
              createLocalForwardMsg(ctx, [introText], { nickname: video.name }),
              ...video.images.map((imgUrl: string) => createLocalForwardMsg(ctx, [ctx.segment.image(imgUrl)], { nickname: video.name }))
            ]
            
            // Add comments if they exist
            if (video.comments && video.comments.length > 0) {
              for (const comment of video.comments) {
                const prefix = comment.pinned ? '[置顶] ' : '[热评] '
                const textContent = `${prefix}${comment.uname}: ${comment.message}（点赞数：${comment.like}）`
                const messageParts: any[] = [textContent]
                if (comment.images && comment.images.length > 0) {
                  for (const imgUrl of comment.images) {
                    messageParts.push(ctx.segment.image(imgUrl))
                  }
                }
                forwardNodes.push(
                  createLocalForwardMsg(ctx, messageParts, { nickname: comment.uname })
                )
              }
            }
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
              createLocalForwardMsg(ctx, [introText, ctx.segment.image(video.cover)], { nickname: video.name })
            ]

            if (videoPath) {
              forwardNodes.push(
                createLocalForwardMsg(ctx, [ctx.segment.video(`file://${videoPath}`)], { nickname: video.name })
              )
            } else {
              forwardNodes.push(
                createLocalForwardMsg(ctx, [`[视频播放失败]\n${downloadErrorMsg}`], { nickname: video.name })
              )
            }

            // Add comments if they exist
            if (video.comments && video.comments.length > 0) {
              for (const comment of video.comments) {
                const prefix = comment.pinned ? '[置顶] ' : '[热评] '
                const textContent = `${prefix}${comment.uname}: ${comment.message}（点赞数：${comment.like}）`
                const messageParts: any[] = [textContent]
                if (comment.images && comment.images.length > 0) {
                  for (const imgUrl of comment.images) {
                    messageParts.push(ctx.segment.image(imgUrl))
                  }
                }
                forwardNodes.push(
                  createLocalForwardMsg(ctx, messageParts, { nickname: comment.uname })
                )
              }
            }

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
  }
})

/**
 * 通用视频下载函数，加了大小和超时限制防止服务器卡死或内存溢出
 */
async function downloadVideo(
  url: string, 
  maxBytes: number = 30 * 1024 * 1024, 
  timeoutMs: number = 60000
): Promise<string> {
  const tempPath = path.join(tmpdir(), `video_${Date.now()}.mp4`)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (size > maxBytes) {
        throw new Error(`视频文件过大 (${(size / 1024 / 1024).toFixed(1)}MB)，已跳过下载 (最大限制为 ${(maxBytes / 1024 / 1024).toFixed(1)}MB)`)
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
  })
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetch(urls[0], { method: 'GET', headers, credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP错误！状态： ${response.status}`)
    const html = await response.text()
    const jsonStr = html.split('"noteDetailMap":')[1].split(',"serverRequestInfo"')[0]
    const json = JSON.parse(jsonStr)
    const id = Object.keys(json)[0]
    const note = json[id].note
    const name = note.user.nickname
    const title = note.title || note.desc || ''
    const desc = (note.title && note.title !== note.desc) ? note.desc : ''
    
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
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
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
        const apiRes = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${avid}`)
        const apiData = await apiRes.json()
        if (apiData.code !== 0) throw new Error(`Bilibili API 错误: ${apiData.message}`)
        
        bvid = apiData.data.bvid
      } else {
        throw new Error('未找到有效的 BVID 或 AVID')
      }
    }    const apiRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    const apiData = await apiRes.json()
    if (apiData.code !== 0) throw new Error(`Bilibili API 错误: ${apiData.message}`)

    const { title, desc, pic: cover, owner, cid, aid } = apiData.data
    const name = owner.name

    const playRes = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=16&type=mp4&platform=html5`)
    const playData = await playRes.json()
    if (playData.code !== 0) throw new Error(`Bilibili PlayAPI 错误: ${playData.message}`)

    const photo = playData.data.durl[0].url

    const comments: Comment[] = []
    try {
      const replyRes = await fetch(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2`)
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
              pinned: false,
              images: r.content?.pictures?.map((p: any) => p.img_src).filter(Boolean) || []
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
async function KuaishouData(mes: string): Promise<ParseResult> {
  const submitCookie = 'kpf=PC_WEB; clientid=3; did=web_dab1d78d4f05ff725a2cae3b527725bf; didv=1710412982000; userId=1454056173; kuaishou.server.web_st=ChZrdWFpc2hvdS5zZXJ2ZXIud2ViLnN0EqAB5ThOJxiYpdIAKS8nKpUGsVswYutuaHmpFktKjQZwWXVDUaYWmj791TVOLDq6mIWx2lE9pHmeT9lQz4pvrfPiz3hvlzsn75dXR_poLlgQX6iP22LJ137DQG9tb2akXxjKpMORbnlhSwwJuUPjygx1JIXreQMXX-El85hsK2nbdrVSsXGXsedchxKLXcErfX13Xf3xVx65xakNJjY1U8XOqRoSsguEA2pmac6i3oLJsA9rNwKEIiAQs97AFU0qHrir3RcbauOEy-So4_m4-JJr4QhNami_SygFMAE; kuaishou.server.web_ph=2b7483c4ddefd22090c22b0fb486de80a6df; kpn=KUAISHOU_VISION'
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
    'Cookie': submitCookie
  })
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetch(urls[0], { method: 'GET', headers, credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP错误！状态： ${response.status}`)
    const html = await response.text()
    const jsonStr = html.split('defaultClient":')[1].split(',"clients')[0]
    const json = JSON.parse(jsonStr)
    const authorKey = Object.keys(json).find(key => key.startsWith('VisionVideoDetailAuthor:'))
    const photoKey = Object.keys(json).find(key => key.startsWith('VisionVideoDetailPhoto:'))
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
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }

  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    
    const redirectRes = await fetch(urls[0], {
      method: 'GET',
      headers,
      redirect: 'manual'
    })

    const location = redirectRes.headers.get('location')
    if (!location) {
      throw new Error('未找到跳转地址')
    }

    const videoRes = await fetch(location, {
      method: 'GET',
      headers
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
    const pageKey = Object.keys(loaderData).find(k => k.endsWith('/page'))
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

    const videoFileRes = await fetch(playUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36'
      },
      redirect: 'follow'
    })

    return { type: 'video', name, title, cover, photo: videoFileRes.url }
  } catch (err: any) {
    return err
  }
}

async function weishiData(mes: string): Promise<ParseResult> {
  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/7.2.1.0 Safari/536.2+ Edg/131.0.0.0'
  })
  try {
    const urls = mes.match(/https?:\/\/[^\s]+/g)
    if (!urls) throw new Error('未找到链接')
    const response = await fetch(urls[0], { method: 'GET', headers, credentials: 'include' })
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
  const res = await fetch(shareUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    },
    redirect: 'manual'
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
    desc
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
    const nonce = crypto.createHash('md5').update(timestamp + Math.random().toString()).digest('hex').toUpperCase()
    
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
      owner_only: '0'
    })
    
    const url = `https://api.xiaoheihe.cn${path}?${params.toString()}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': `https://www.xiaoheihe.cn/app/bbs/link/${linkId}`
      }
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
          pinned: false
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
        comments
      }
    } else {
      return {
        type: 'images',
        name,
        title,
        cover,
        images,
        desc,
        comments
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
  return 128 & e ? 255 & (e << 1 ^ 27) : e << 1;
}
function qm(e: number): number {
  return Vm(e) ^ e;
}
function $m(e: number): number {
  return qm(Vm(e));
}
function Ym(e: number): number {
  return $m(qm(Vm(e)));
}
function Gm(e: number): number {
  return Ym(e) ^ $m(e) ^ qm(e);
}
function Km(e: number[]): number[] {
  const t = [0, 0, 0, 0];
  t[0] = Gm(e[0]) ^ Ym(e[1]) ^ $m(e[2]) ^ qm(e[3]);
  t[1] = qm(e[0]) ^ Gm(e[1]) ^ Ym(e[2]) ^ $m(e[3]);
  t[2] = $m(e[0]) ^ qm(e[1]) ^ Gm(e[2]) ^ Ym(e[3]);
  t[3] = Ym(e[0]) ^ $m(e[1]) ^ qm(e[2]) ^ Gm(e[3]);
  e[0] = t[0];
  e[1] = t[1];
  e[2] = t[2];
  e[3] = t[3];
  return e;
}

function av(e: string, t: string, n: number): string {
  let r = "";
  const i = t.slice(0, n);
  for (let o = 0; o < e.length; o++) {
    r += i[e.charCodeAt(o) % i.length];
  }
  return r;
}

function sv(e: string, t: string): string {
  let n = "";
  for (let r = 0; r < e.length; r++) {
    n += t[e.charCodeAt(r) % t.length];
  }
  return n;
}

function computeHkey(e: string, t: number, n: string): string {
  e = "/" + e.split("/").filter(x => x).join("/") + "/";
  const r = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
  
  const w1 = av(String(t), r, -2);
  const w2 = sv(e, r);
  const w3 = sv(n, r);
  
  const arrays = [w1, w2, w3];
  let woven = "";
  const maxLength = Math.max(...arrays.map(x => x.length));
  for (let r = 0; r < maxLength; r++) {
    arrays.forEach(arr => {
      if (r < arr.length) {
        woven += arr[r];
      }
    });
  }
  
  const i = woven.slice(0, 20);
  const o = crypto.createHash('md5').update(i).digest('hex');
  
  const charCodes = o.slice(-6).split("").map(x => x.charCodeAt(0));
  const kmResult = Km(charCodes);
  let a = String(kmResult.reduce((x, y) => x + y, 0) % 100);
  if (a.length < 2) {
    a = "0" + a;
  }
  
  const s = av(o.substring(0, 5), r, -4);
  return `${s}${a}`;
}

