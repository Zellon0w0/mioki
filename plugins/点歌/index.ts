import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import axios from 'axios'
import type { Browser } from 'puppeteer-core'

const PLUGIN_NAME = '点歌'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  defaultPlatform: 'netease' | 'qq' | 'kugou'
  neteaseCookie: string
  qqCookie: string
  kugouCookie: string
  useImageRender: boolean
  sessionTimeoutMs: number
  whitelist: number[]
}

interface SongItem {
  id: string
  name: string
  artists: string
  album: string
  duration: number
  coverUrl: string
  platform: string
}

interface SearchSession {
  platform: string
  keyword: string
  results: SongItem[]
  expireTime: number
}

// Puppeteer browser management
let browser: Browser | null = null
let browserLaunchPromise: Promise<Browser> | null = null

function getChromeCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const programFilesX86 = process.env['PROGRAMFILES(X86)']

  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    programFiles ? join(programFiles, 'Google/Chrome/Application/chrome.exe') : '',
    programFilesX86 ? join(programFilesX86, 'Google/Chrome/Application/chrome.exe') : '',
    localAppData ? join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function findChromeExecutable(): string {
  const executablePath = getChromeCandidates().find((candidate) => existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH')
  }
  return executablePath
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser
  }
  browser = null

  if (!browserLaunchPromise) {
    browserLaunchPromise = puppeteer.launch({
      executablePath: findChromeExecutable(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--font-render-hinting=none',
      ],
      defaultViewport: {
        width: 850,
        height: 1000,
        deviceScaleFactor: 2,
      },
    }).then(b => {
      browser = b
      browserLaunchPromise = null
      b.on('disconnected', () => {
        if (browser === b) {
          browser = null
        }
      })
      return b
    }).catch(err => {
      browserLaunchPromise = null
      throw err
    })
  }
  return browserLaunchPromise
}

// HTML Escaper
function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Duration Formatter (mm:ss)
function formatDuration(duration: number): string {
  if (!duration) return '00:00'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// HTML Generator for EVA Unit-02 styling
function renderHtml(keyword: string, platformName: string, songs: SongItem[], icons: { netease: string, qq: string, kugou: string }): string {
  const platform = songs[0]?.platform || 'netease'
  const platformIcon = platform === 'netease' ? icons.netease : platform === 'qq' ? icons.qq : icons.kugou

  const songCardsHtml = songs.map((song, idx) => {
    const num = String(idx + 1).padStart(2, '0')
    const name = escapeHtml(song.name)
    const artists = escapeHtml(song.artists)
    const duration = formatDuration(song.duration)
    // Default placeholder cover if empty (offline-safe Base64 SVG), and enforce HTTPS to prevent mixed content blocks
    let coverUrl = song.coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSIjMmEyYjM3Ij48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjEwIi8+PHBhdGggZD0iTTUwIDMwdjMwYy0yLjIgMC00IDEuOC00IDRzMS44IDQgNCA0IDQtMS44IDQtNHYzOGgxNHYtOEg1MHoiIGZpbGw9IiNmZjNkMDAiLz48L3N2Zz4='
    if (coverUrl.startsWith('http://')) {
      coverUrl = coverUrl.replace('http://', 'https://')
    }
    
    return `
      <div class="song-card">
        <div class="song-num">#${num}</div>
        <div class="avatar-wrapper">
          <img class="avatar" src="${coverUrl}" alt="cover" />
        </div>
        <div class="song-info">
          <div class="song-title">${name}</div>
          <div class="song-singer">${artists}</div>
        </div>
        <div class="song-duration">${duration}</div>
      </div>
    `
  }).join('')

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="referrer" content="no-referrer" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          margin: 0;
          padding: 20px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
          background-color: #121318;
          background-image: 
            linear-gradient(rgba(255, 61, 0, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 61, 0, 0.03) 1px, transparent 1px);
          background-size: 20px 20px;
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-container {
          border: 2px solid #ff3d00;
          padding: 24px;
          background: radial-gradient(circle at top right, rgba(255, 61, 0, 0.05) 0%, transparent 70%);
          position: relative;
          overflow: hidden;
        }
        .menu-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 4px;
          background: repeating-linear-gradient(-45deg, #ffb300, #ffb300 10px, #121318 10px, #121318 20px);
        }
        
        /* Header styles */
        .header-card {
          background: rgba(26, 27, 35, 0.95);
          border: 1px solid #ff3d00;
          border-top: 4px solid #ff3d00;
          padding: 20px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          position: relative;
          clip-path: polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%);
        }
        .header-card::after {
          content: 'SYS STATUS: ACTIVE [EVA-02]';
          position: absolute;
          top: 8px;
          right: 12px;
          font-size: 10px;
          color: #ffb300;
          font-family: monospace;
          letter-spacing: 1px;
        }
        .header-info h1 {
          font-size: 24px;
          font-weight: 800;
          color: #ffffff;
          margin: 0 0 4px 0;
          letter-spacing: 2px;
          text-transform: uppercase;
          text-shadow: 0 0 10px rgba(229, 57, 53, 0.4);
        }
        .header-subtitle {
          font-size: 12px;
          color: #ffb300;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .header-meta {
          font-size: 11px;
          color: #8c8d99;
          font-family: monospace;
        }
        .header-meta span {
          color: #ff6d00;
          font-weight: bold;
        }
        .platform-logo {
          margin-left: 20px;
          flex-shrink: 0;
          filter: drop-shadow(0 0 6px rgba(255, 61, 0, 0.4));
        }
 
        /* Song card list */
        .songs-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .song-card {
          background: rgba(26, 27, 35, 0.85);
          border: 1px solid rgba(255, 61, 0, 0.2);
          border-left: 4px solid #ff3d00;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
        }
        .song-num {
          font-size: 20px;
          font-weight: 800;
          color: #ffb300;
          font-family: monospace;
          width: 40px;
          text-shadow: 0 0 5px rgba(255, 179, 0, 0.3);
        }
        .avatar-wrapper {
          width: 50px;
          height: 50px;
          border: 1px solid #ff3d00;
          padding: 2px;
          background: #121318;
          clip-path: polygon(15% 0%, 85% 0%, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0% 85%, 0% 15%);
          margin-right: 20px;
        }
        .avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
          clip-path: polygon(15% 0%, 85% 0%, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0% 85%, 0% 15%);
        }
        .song-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .song-title {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 450px;
        }
        .song-singer {
          font-size: 13px;
          color: #ff6d00;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 450px;
        }
        .song-duration {
          font-size: 14px;
          font-weight: bold;
          color: #8c8d99;
          font-family: monospace;
          margin-left: 20px;
        }
 
        /* Footer */
        .footer-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          background: rgba(26, 27, 35, 0.95);
          border: 1px solid #ff3d00;
          margin-top: 20px;
          font-size: 10px;
          font-family: monospace;
          color: #8c8d99;
          clip-path: polygon(0 10px, 10px 0, 100% 0, 100% 100%, 0 100%);
        }
        .footer-side strong {
          color: #ffb300;
        }
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="menu-wrapper">
        <div class="menu-container">
          <div class="header-card">
            <div class="header-info" style="flex: 1;">
              <div class="header-subtitle">MUSIC SELECTION</div>
              <h1>点歌搜索结果</h1>
              <div class="header-meta">
                SEARCH KEYWORD: <span>${escapeHtml(keyword)}</span> // PLATFORM: <span>${escapeHtml(platformName)}</span>
              </div>
            </div>
            <div class="platform-logo">
              <img src="${platformIcon}" width="40" height="40" style="display:block; object-fit:contain; border-radius:50%;" />
            </div>
          </div>
 
          <div class="songs-list">
            ${songCardsHtml}
          </div>
 
          <div class="footer-card">
            <div class="footer-side">
              SYSTEM: <strong>MIOKI</strong>
            </div>
            <div class="footer-side">
              <strong>EVANGELION</strong>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg))
    }, timeoutMs)
    promise.then(
      (res) => {
        clearTimeout(timer)
        resolve(res)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    })
  } finally {
    clearTimeout(id)
  }
}

async function renderSongsImage(keyword: string, platformName: string, songs: SongItem[]): Promise<Buffer | null> {
  const internalRender = async () => {
    let page;
    try {
      const pluginDir = join(getAbsPluginDir(), '点歌')
      const publicDir = join(pluginDir, 'public')
      const getIconBase64 = (filename: string): string => {
        const filePath = join(publicDir, filename)
        if (existsSync(filePath)) {
          return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
        }
        return ''
      }

      const icons = {
        netease: getIconBase64('Netease_Music_Icon.png'),
        qq: getIconBase64('QQ_Music_Icon.png'),
        kugou: getIconBase64('Kugou_Icon.png')
      }

      const instance = await getBrowser()
      page = await instance.newPage()
      await page.setViewport({ width: 850, height: 1000, deviceScaleFactor: 2 })
      const html = renderHtml(keyword, platformName, songs, icons)
      await page.setContent(html, { waitUntil: 'load', timeout: 8000 })
      const target = await page.$('.menu-container')
      const image = await (target || page).screenshot({
        type: 'png',
        encoding: 'binary',
      })
      return Buffer.from(image)
    } finally {
      if (page) {
        await page.close().catch(() => {})
      }
    }
  }

  try {
    return await promiseWithTimeout(internalRender(), 12000, 'Image rendering timed out')
  } catch (err) {
    console.error('[点歌] Image render error:', err)
    return null
  }
}

// Download stream with custom headers to a temp file
async function downloadAudioToTemp(url: string, headers: Record<string, string>): Promise<string> {
  const response = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 30000
  })
  
  const tempFile = join(tmpdir(), `mioki-music-${randomBytes(8).toString('hex')}.mp3`)
  writeFileSync(tempFile, Buffer.from(response.data))
  return tempFile
}

// Session store for song requesting
const sessions = new Map<string, SearchSession>()

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: 'Mioki 点歌插件，支持网易云、QQ音乐、酷狗音乐搜索和选择播放',
  dependencies: ['puppeteer-core'],
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '点歌')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        defaultPlatform: 'netease',
        neteaseCookie: '',
        qqCookie: '',
        kugouCookie: '',
        useImageRender: true,
        sessionTimeoutMs: 180000,
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

    ctx.logger.info(`[${PLUGIN_NAME}] 插件加载成功`)

    // Music resolving platforms definition
    const platformNames: Record<string, string> = {
      netease: '网易云音乐',
      qq: 'QQ音乐',
      kugou: '酷狗音乐'
    }

    // Direct search helper
    async function searchMusic(platform: string, keyword: string, config: PluginConfig): Promise<SongItem[]> {
      if (platform === 'netease') {
        // Step 1: Search to get brief song list & IDs
        const searchRes = await fetchWithTimeout(`http://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=10`)
        const searchData = await searchRes.json()
        const briefSongs = searchData?.result?.songs || []
        if (briefSongs.length === 0) return []

        // Step 2: Fetch detailed song info to resolve correct album covers
        const ids = briefSongs.map((s: any) => s.id)
        const detailRes = await fetchWithTimeout(`https://music.163.com/api/song/detail?ids=[${ids.join(',')}]`)
        const detailData = await detailRes.json()
        const songs = detailData?.songs || []

        return songs.map((song: any) => ({
          id: String(song.id),
          name: song.name,
          artists: song.artists?.map((a: any) => a.name).join(', ') || '未知歌手',
          album: song.album?.name || '',
          duration: song.duration ? Math.round(song.duration / 1000) : 0,
          coverUrl: song.album?.picUrl || '',
          platform: 'netease'
        }))
      } else if (platform === 'qq') {
        let uin = '0'
        if (config.qqCookie) {
          const match = config.qqCookie.match(/(?:^|;)\s*uin=(\d+)/)
          if (match) {
            uin = match[1]
          }
        }
        const queryData = {
          comm: {
            _log_uuid: 'mioki_search_' + Date.now(),
            g_tk: 5381,
            plat: 20,
            platver: 0,
            uid: uin,
            uin: uin,
            format: 'json',
            inCharset: 'utf-8',
            outCharset: 'utf-8',
            notice: 0,
            needNewCode: 0
          },
          req_0: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: {
              num_per_page: 10,
              page_num: 1,
              query: keyword,
              search_type: 0
            }
          }
        }
        const res = await fetchWithTimeout(`https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(queryData))}`, {
          headers: {
            'Referer': 'https://y.qq.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': config.qqCookie || ''
          }
        })
        const resData = await res.json()
        const songs = resData?.req_0?.data?.body?.song?.list || []
        return songs.map((song: any) => ({
          id: song.mid,
          name: song.name,
          artists: song.singer?.map((s: any) => s.name).join(', ') || '未知歌手',
          album: song.album?.name || '',
          duration: song.interval || 0,
          coverUrl: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : '',
          platform: 'qq'
        }))
      } else if (platform === 'kugou') {
        const res = await fetchWithTimeout(`http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10`)
        const resData = await res.json()
        const songs = resData?.data?.info || []
        return songs.map((song: any) => ({
          id: song.hash,
          name: song.songname,
          artists: song.singername || '未知歌手',
          album: song.album_name || '',
          duration: song.duration || 0,
          coverUrl: song.trans_param?.union_cover ? song.trans_param.union_cover.replace('{size}', '400') : '',
          platform: 'kugou'
        }))
      }
      return []
    }

    // Direct play url resolver helper
    async function resolvePlayUrl(platform: string, id: string, config: PluginConfig): Promise<{ url: string, headers: Record<string, string> } | null> {
      if (platform === 'netease') {
        const playUrlApi = `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=[${id}]&br=128000`
        const headers = {
          'Referer': 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': config.neteaseCookie || ''
        }
        const res = await axios.get(playUrlApi, { headers, timeout: 10000 })
        const playUrl = res.data?.data?.[0]?.url
        if (playUrl) {
          return { url: playUrl, headers }
        }
      } else if (platform === 'qq') {
        const guid = '8424509482'
        const queryData = {
          req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
              guid,
              songmid: [id],
              songtype: [0],
              uin: '0',
              loginflag: 1,
              platform: '20'
            }
          },
          comm: {
            uin: 0,
            format: 'json',
            ct: 24,
            cv: 0
          }
        }
        const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(queryData))}`
        const headers = {
          'Referer': 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': config.qqCookie || ''
        }
        const res = await axios.get(url, { headers, timeout: 10000 })
        const purl = res.data?.req_0?.data?.midurlinfo?.[0]?.purl
        const sip = res.data?.req_0?.data?.sip?.[0] || 'http://aqqmusic.tc.qq.com/'
        if (purl) {
          return { url: `${sip}${purl}`, headers }
        }
      } else if (platform === 'kugou') {
        const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${id}`
        const headers = {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
          'Cookie': config.kugouCookie || ''
        }
        const res = await axios.get(url, { headers, timeout: 10000 })
        const playUrl = res.data?.url
        if (playUrl) {
          return { url: playUrl, headers }
        }
      }
      return null
    }

    // Handles user trigger for song requests
    ctx.handle('message', async (event) => {
      const config = loadConfig()
      if (!config.enabled) return

      // Whitelist check
      if (event.message_type === 'group' && config.whitelist.length > 0) {
        if (!config.whitelist.includes(event.group_id)) {
          return
        }
      }

      const text = ctx.text(event).trim()
      let platform = ''
      let keyword = ''

      // Parse trigger commands
      let isCommand = false
      if (text.startsWith('网易云点歌')) {
        platform = 'netease'
        keyword = text.substring(5).trim()
        isCommand = true
      } else if (text.startsWith('QQ点歌')) {
        platform = 'qq'
        keyword = text.substring(4).trim()
        isCommand = true
      } else if (text.startsWith('酷狗点歌')) {
        platform = 'kugou'
        keyword = text.substring(4).trim()
        isCommand = true
      } else if (text.startsWith('点歌')) {
        platform = config.defaultPlatform
        keyword = text.substring(2).trim()
        isCommand = true
      }

      if (isCommand) {
        if (!keyword) {
          const defaultName = platformNames[config.defaultPlatform] || '网易云音乐'
          await event.reply(`🎶 MIOKI 点歌系统指令菜单：\n\n👉 【默认平台点歌】（当前默认：${defaultName}）\n   点歌 歌名\n   （示例：点歌 onelastkiss）\n\n👉 【指定平台点歌】\n   网易云点歌 歌名\n   QQ点歌 歌名\n   酷狗点歌 歌名\n\n💡 提示：搜索出歌曲列表后，请在 3 分钟内发送选择指令。`, true)
          return
        }

        ctx.logger.info(`收到点歌请求: 平台=${platform}, 关键词=${keyword}`)
        try {
          const songs = await searchMusic(platform, keyword, config)
          if (songs.length === 0) {
            await event.reply('未搜索到相关歌曲，请换个关键词试试。', true)
            return
          }

          // Limit to top 10 songs
          const topSongs = songs.slice(0, 10)

          // Save search results in session
          const sessionKey = event.message_type === 'group' 
            ? `${event.group_id}_${event.user_id}` 
            : `${event.user_id}`
          
          sessions.set(sessionKey, {
            platform,
            keyword,
            results: topSongs,
            expireTime: Date.now() + config.sessionTimeoutMs
          })

          if (config.useImageRender) {
            // Render via Puppeteer
            const promptMsg = await event.reply('正在搜索歌曲，请稍候...', false)
            const imgBuffer = await renderSongsImage(keyword, platformNames[platform] || platform, topSongs)
            
            // Recall prompt message once done
            if (promptMsg && promptMsg.message_id) {
              await ctx.bot.recallMsg(promptMsg.message_id).catch(() => {})
            }

            if (imgBuffer) {
              const base64Img = `base64://${imgBuffer.toString('base64')}`
              await event.reply([ctx.segment.image(base64Img), '\n💡 请在 3 分钟内发送“选择 序号”（例如：选择 1）进行点歌'])
            } else {
              // Fallback to text rendering
              const textList = topSongs.map((s, idx) => `${idx + 1}. ${s.name} - ${s.artists}`).join('\n')
              await event.reply(`【${platformNames[platform]}】点歌搜索结果：\n${textList}\n\n💡 请在 3 分钟内发送“选择 序号”进行点歌`, true)
            }
          } else {
            // Text list rendering
            const textList = topSongs.map((s, idx) => `${idx + 1}. ${s.name} - ${s.artists}`).join('\n')
            await event.reply(`【${platformNames[platform]}】点歌搜索结果：\n${textList}\n\n💡 请在 3 分钟内发送“选择 序号”进行点歌`, true)
          }
        } catch (err: any) {
          ctx.logger.error(`点歌搜索出错: ${err.message}`)
          await event.reply(`搜索失败，发生错误: ${err.message}`, true)
        }
      }
    })

    // Handles song selection triggering
    ctx.handle('message', async (event) => {
      const config = loadConfig()
      if (!config.enabled) return

      // Whitelist check
      if (event.message_type === 'group' && config.whitelist.length > 0) {
        if (!config.whitelist.includes(event.group_id)) {
          return
        }
      }

      const text = ctx.text(event).trim()
      // Matches both "选择 1" and "选择1"
      const match = text.match(/^\s*选择\s*(\d+)\s*$/)
      if (!match) return

      const sessionKey = event.message_type === 'group' 
        ? `${event.group_id}_${event.user_id}` 
        : `${event.user_id}`

      const session = sessions.get(sessionKey)
      if (!session) return // User has no active song selection session, ignore

      // Check session expiry
      if (Date.now() > session.expireTime) {
        sessions.delete(sessionKey)
        await event.reply('您的点歌会话已过期，请重新使用“点歌”指令搜索。', true)
        return
      }

      const index = parseInt(match[1], 10) - 1
      if (index < 0 || index >= session.results.length) {
        await event.reply(`序号超出范围，请输入 1 到 ${session.results.length} 之间的数字。`, true)
        return
      }

      const selectedSong = session.results[index]
      sessions.delete(sessionKey) // Consume the session immediately

      await event.reply(`已选择 [${selectedSong.name}]，正在解析语音，请稍候...`, false)

      let tempFilePath: string | null = null

      try {
        const resolved = await resolvePlayUrl(selectedSong.platform, selectedSong.id, config)
        if (!resolved || !resolved.url) {
          await event.reply('解析音频链接失败，这可能是VIP歌曲、数字专辑或版权受限歌曲。', true)
          return
        }

        ctx.logger.info(`正在解析音频流: ${resolved.url}`)
        tempFilePath = await downloadAudioToTemp(resolved.url, resolved.headers)
        
        ctx.logger.info(`音频文件已成功下载到临时路径: ${tempFilePath}`)
        const recordSeg = ctx.segment.record(`file:///${tempFilePath.replace(/\\/g, '/')}`)
        await event.reply(recordSeg)
      } catch (err: any) {
        ctx.logger.error(`获取/下载音乐失败: ${err.message}`)
        await event.reply(`音频加载失败: ${err.message}`, true)
      } finally {
        if (tempFilePath && existsSync(tempFilePath)) {
          // Delay deletion to give OneBot/NapCat a chance to load the file
          const filePathToDelete = tempFilePath
          setTimeout(() => {
            try {
              if (existsSync(filePathToDelete)) {
                unlinkSync(filePathToDelete)
                ctx.logger.debug(`成功清理临时音频文件: ${filePathToDelete}`)
              }
            } catch (cleanupErr: any) {
              ctx.logger.warn(`清理临时音频文件失败: ${cleanupErr.message}`)
            }
          }, 15000)
        }
      }
    })

    // Return a clean up function to dispose of puppeteer browser
    return () => {
      if (browser) {
        browser.close().catch(() => {})
        browser = null
      }
      sessions.clear()
    }
  }
})
