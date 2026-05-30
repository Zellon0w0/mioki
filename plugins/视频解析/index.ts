import { definePlugin, getAbsPluginDir } from 'mioki'
import fs from 'node:fs'
import { createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PLUGIN_NAME = '视频解析'

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  blacklist: number[]
  randomVideoApi: string
}

interface VideoResult {
  type: 'video'
  name: string
  title: string
  cover: string
  photo: string
}

interface ImagesResult {
  type: 'images'
  name: string
  title: string
  cover: string
  images: string[]
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
        blacklist: [],
        randomVideoApi: 'https://tucdn.wpon.cn/api-girl/index.php'
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
          randomVideoApi: parsed.randomVideoApi ?? defaultConfig.randomVideoApi
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

      if (['随机视频', 'sjsp'].includes(text)) {
        try {
          await e.addReaction('311')
          const response = await fetch(config.randomVideoApi)
          const html = await response.text()
          const match = html.match(/src="([^"]+)"/)
          if (match) {
            let videoUrl = match[1].trim()
            if (videoUrl.startsWith('//')) {
              videoUrl = 'https:' + videoUrl
            }
            const videoPath = await downloadVideo(videoUrl)
            await e.reply(ctx.segment.video(`file://${videoPath}`))
            cleanupFile(ctx, videoPath)
          } else {
            await e.reply('获取随机视频失败')
          }
        } catch (err: any) {
          ctx.logger.error(`[视频解析] 随机视频错误: ${err.message}`)
        }
      } else if (message.includes('https://v.douyin.com/')) {
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
      }

      if (video && !(video instanceof Error)) {
        try {
          if (video.type === 'images') {
            const forwardNodes = [
              createLocalForwardMsg(ctx, [`作者：${video.name}\n标题：${video.title}`], { nickname: video.name }),
              ...video.images.map((imgUrl: string) => createLocalForwardMsg(ctx, [ctx.segment.image(imgUrl)], { nickname: video.name }))
            ]
            await e.reply(forwardNodes)
          } else {
            await e.reply([
              ctx.segment.text(`作者：${video.name}\n标题：${video.title}\n`),
              ctx.segment.image(video.cover)
            ], true)
            
            try {
              const videoPath = await downloadVideo(video.photo)
              await e.reply(ctx.segment.video(`file://${videoPath}`))
              cleanupFile(ctx, videoPath)
            } catch (videoError: any) {
              ctx.logger.error(`[视频解析] 视频下载/发送失败: ${videoError.message}`)
              await e.reply(`视频发送失败: ${videoError.message}`, true)
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
  setTimeout(() => {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        ctx.logger.info(`[视频解析] 已清理临时文件: ${filePath}`)
      }
    } catch (e) {
      ctx.logger.error(`[视频解析] 文件清理失败: ${e}`)
    }
  }, 300000) // 5分钟后自动清理
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
    
    if (note.video) {
      const cover = note.imageList[0].urlDefault
      const photo = note.video.media.stream.h264[0].masterUrl
      return { type: 'video', name, title, cover, photo }
    } else if (note.imageList && note.imageList.length > 0) {
      const images = note.imageList.map((img: any) => img.urlDefault || img.url || img.urlPre)
      const cover = images[0]
      return { type: 'images', name, title, cover, images }
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
    }

    const apiRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
    const apiData = await apiRes.json()
    if (apiData.code !== 0) throw new Error(`Bilibili API 错误: ${apiData.message}`)

    const { title, pic: cover, owner, cid } = apiData.data
    const name = owner.name

    const playRes = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=16&type=mp4&platform=html5`)
    const playData = await playRes.json()
    if (playData.code !== 0) throw new Error(`Bilibili PlayAPI 错误: ${playData.message}`)

    const photo = playData.data.durl[0].url

    return { type: 'video', name, title, cover, photo }
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
