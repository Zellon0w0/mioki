import { definePlugin, getAbsPluginDir } from 'mioki'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import axios from 'axios'
import { sharedBrowser } from '../_shared/resource'

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
  timer?: NodeJS.Timeout
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

// HTML Generator for Material Design 3 styling
function renderHtml(
  keyword: string,
  platformName: string,
  songs: SongItem[],
  icons: { netease: string; qq: string; kugou: string },
): string {
  const platform = songs[0]?.platform || 'netease'
  const platformIcon = platform === 'netease' ? icons.netease : platform === 'qq' ? icons.qq : icons.kugou
  const safeKeyword = escapeHtml(keyword)
  const safePlatformName = escapeHtml(platformName)
  const platformLogoHtml = platformIcon
    ? `<img src="${platformIcon}" width="48" height="48" alt="${safePlatformName}" />`
    : `<span>${escapeHtml(platformName.charAt(0) || '音')}</span>`
  const fallbackCoverUrl =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMTIiIGhlaWdodD0iMTEyIiB2aWV3Qm94PSIwIDAgMTEyIDExMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjExMiIgaGVpZ2h0PSIxMTIiIHJ4PSIxNiIgZmlsbD0iI0VBRERGRiIvPjxjaXJjbGUgY3g9IjU2IiBjeT0iNTYiIHI9IjI4IiBmaWxsPSIjNjc1MEE0IiBmaWxsLW9wYWNpdHk9Ii4xOCIvPjxwYXRoIGQ9Ik03MCAzOHYyOC42YzAgNS4yLTQuOCA5LjQtMTAuOCA5LjRTNDguNCA3MS44IDQ4LjQgNjYuNnM0LjgtOS40IDEwLjgtOS40YzEuNSAwIDIuOS4yIDQuMi43VjM4aDYuNloiIGZpbGw9IiM2NzUwQTQiLz48L3N2Zz4='
  const safeFallbackCoverUrl = escapeHtml(fallbackCoverUrl)

  const songCardsHtml = songs
    .map((song, idx) => {
      const num = String(idx + 1)
      const name = escapeHtml(song.name)
      const artists = escapeHtml(song.artists)
      const album = escapeHtml(song.album)
      const duration = formatDuration(song.duration)
      const albumHtml = album ? `<span class="song-album">${album}</span>` : ''
      let coverUrl = song.coverUrl || fallbackCoverUrl
      if (coverUrl.startsWith('http://')) {
        coverUrl = coverUrl.replace('http://', 'https://')
      }
      const safeCoverUrl = escapeHtml(coverUrl)

      return `
      <article class="song-card">
        <div class="song-index">${num}</div>
        <div class="cover-frame">
          <img class="cover" src="${safeCoverUrl}" alt="" onerror="this.onerror=null;this.src='${safeFallbackCoverUrl}'" />
        </div>
        <div class="song-copy">
          <div class="song-title">${name}</div>
          <div class="song-meta">
            <span>${artists}</span>
            ${albumHtml}
          </div>
        </div>
        <div class="song-duration">${duration}</div>
      </article>
    `
    })
    .join('')

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="referrer" content="no-referrer" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          color-scheme: light;
          --md-primary: #6750a4;
          --md-on-primary: #ffffff;
          --md-primary-container: #eaddff;
          --md-on-primary-container: #21005d;
          --md-secondary-container: #e8def8;
          --md-on-secondary-container: #1d192b;
          --md-tertiary: #006d3b;
          --md-tertiary-container: #9df6b9;
          --md-background: #fffbfe;
          --md-surface: #fffbfe;
          --md-surface-container-lowest: #ffffff;
          --md-surface-container-low: #f7f2fa;
          --md-surface-container: #f3edf7;
          --md-surface-container-high: #ece6f0;
          --md-on-surface: #1d1b20;
          --md-on-surface-variant: #49454f;
          --md-outline-variant: #cac4d0;
          --elevation-1: 0 1px 2px rgba(29, 27, 32, 0.14), 0 1px 3px 1px rgba(29, 27, 32, 0.08);
          --elevation-2: 0 2px 6px rgba(29, 27, 32, 0.16), 0 6px 16px rgba(29, 27, 32, 0.10);
        }
        body {
          margin: 0;
          padding: 24px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
          background: var(--md-background);
          color: var(--md-on-surface);
          font-family: 'Roboto', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          letter-spacing: 0;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-container {
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          padding: 24px;
          background: var(--md-surface-container-lowest);
          box-shadow: var(--elevation-2);
        }
        .header {
          min-height: 116px;
          padding: 20px;
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          background: var(--md-surface-container-low);
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .platform-logo {
          width: 64px;
          height: 64px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          background: var(--md-primary-container);
          color: var(--md-on-primary-container);
          font-size: 22px;
          font-weight: 700;
        }
        .platform-logo img {
          display: block;
          width: 48px;
          height: 48px;
          object-fit: contain;
          border-radius: 8px;
        }
        .header-copy {
          min-width: 0;
          flex: 1;
        }
        .eyebrow {
          margin-bottom: 6px;
          color: var(--md-primary);
          font-size: 12px;
          font-weight: 600;
          line-height: 16px;
        }
        .header h1 {
          margin-bottom: 8px;
          color: var(--md-on-surface);
          font-size: 28px;
          font-weight: 500;
          line-height: 36px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .header-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--md-on-surface-variant);
          font-size: 14px;
          line-height: 20px;
          min-width: 0;
        }
        .header-meta strong {
          color: var(--md-on-surface);
          font-weight: 500;
          max-width: 330px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta-dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: var(--md-outline-variant);
          flex: 0 0 auto;
        }
        .count-chip {
          min-width: 88px;
          min-height: 64px;
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          background: var(--md-surface-container-lowest);
          color: var(--md-on-surface-variant);
          flex: 0 0 auto;
          box-shadow: var(--elevation-1);
        }
        .count-chip strong {
          color: var(--md-primary);
          font-size: 24px;
          font-weight: 600;
          line-height: 28px;
        }
        .count-chip span {
          font-size: 12px;
          line-height: 16px;
        }
 
        .songs-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .song-card {
          min-height: 78px;
          padding: 10px 14px;
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          display: grid;
          grid-template-columns: 36px 56px minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          background: var(--md-surface);
        }
        .song-card:first-child {
          background: var(--md-secondary-container);
          border-color: rgba(103, 80, 164, 0.28);
        }
        .song-index {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--md-surface-container);
          color: var(--md-primary);
          font-size: 14px;
          font-weight: 700;
          line-height: 20px;
        }
        .song-card:first-child .song-index {
          background: var(--md-primary);
          color: var(--md-on-primary);
        }
        .cover-frame {
          width: 56px;
          height: 56px;
          border-radius: 8px;
          overflow: hidden;
          background: var(--md-surface-container-high);
          flex: 0 0 auto;
        }
        .cover {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .song-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .song-title {
          font-size: 16px;
          font-weight: 600;
          line-height: 24px;
          color: var(--md-on-surface);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .song-meta {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          line-height: 18px;
          color: var(--md-on-surface-variant);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .song-meta span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .song-album {
          padding-left: 8px;
          border-left: 1px solid var(--md-outline-variant);
        }
        .song-duration {
          min-width: 58px;
          min-height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--md-surface-container-low);
          color: var(--md-on-surface-variant);
          font-family: 'Roboto Mono', Consolas, monospace;
          font-size: 14px;
          font-weight: 500;
          line-height: 20px;
        }
 
        .footer {
          min-height: 48px;
          margin-top: 18px;
          padding: 12px 4px 0;
          border-top: 1px solid var(--md-outline-variant);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          color: var(--md-on-surface-variant);
          font-size: 13px;
          line-height: 18px;
        }
        .footer strong {
          color: var(--md-tertiary);
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="menu-wrapper">
        <div class="menu-container">
          <header class="header">
            <div class="platform-logo">
              ${platformLogoHtml}
            </div>
            <div class="header-copy">
              <div class="eyebrow">Mioki Music</div>
              <h1>点歌搜索结果</h1>
              <div class="header-meta">
                <span>搜索</span>
                <strong>${safeKeyword}</strong>
                <span class="meta-dot"></span>
                <span>${safePlatformName}</span>
              </div>
            </div>
            <div class="count-chip">
              <strong>${songs.length}</strong>
              <span>首歌曲</span>
            </div>
          </header>
 
          <div class="songs-list">
            ${songCardsHtml}
          </div>
 
          <footer class="footer">
            <span>发送 <strong>选择 序号</strong> 完成点歌</span>
            <span>会话 3 分钟内有效</span>
          </footer>
        </div>
      </div>
    </body>
    </html>
  `
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(id)
  }
}

async function renderSongsImage(keyword: string, platformName: string, songs: SongItem[]): Promise<Buffer | null> {
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
      kugou: getIconBase64('Kugou_Icon.png'),
    }

    return await sharedBrowser.withPage(
      async (page) => {
        const html = renderHtml(keyword, platformName, songs, icons)
        await page.setContent(html, { waitUntil: 'load', timeout: 8000 })
        const target = await page.$('.menu-container')
        const image = await (target || page).screenshot({
          type: 'png',
          encoding: 'binary',
        })
        return Buffer.from(image)
      },
      {
        label: `${PLUGIN_NAME} 搜索结果渲染`,
        timeoutMs: 20_000,
        viewport: { width: 850, height: 1000, deviceScaleFactor: 2 },
      },
    )
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
    timeout: 30000,
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
        whitelist: [],
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent),
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
      kugou: '酷狗音乐',
    }

    // Direct search helper
    async function searchMusic(platform: string, keyword: string, config: PluginConfig): Promise<SongItem[]> {
      if (platform === 'netease') {
        // Step 1: Search to get brief song list & IDs
        const searchRes = await fetchWithTimeout(
          `http://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=10`,
        )
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
          platform: 'netease',
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
            needNewCode: 0,
          },
          req_0: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: {
              num_per_page: 10,
              page_num: 1,
              query: keyword,
              search_type: 0,
            },
          },
        }
        const res = await fetchWithTimeout(
          `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(queryData))}`,
          {
            headers: {
              Referer: 'https://y.qq.com/',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Cookie: config.qqCookie || '',
            },
          },
        )
        const resData = await res.json()
        const songs = resData?.req_0?.data?.body?.song?.list || []
        return songs.map((song: any) => ({
          id: song.mid,
          name: song.name,
          artists: song.singer?.map((s: any) => s.name).join(', ') || '未知歌手',
          album: song.album?.name || '',
          duration: song.interval || 0,
          coverUrl: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : '',
          platform: 'qq',
        }))
      } else if (platform === 'kugou') {
        const res = await fetchWithTimeout(
          `http://mobilecdn.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10`,
        )
        const resData = await res.json()
        const songs = resData?.data?.info || []
        return songs.map((song: any) => ({
          id: song.hash,
          name: song.songname,
          artists: song.singername || '未知歌手',
          album: song.album_name || '',
          duration: song.duration || 0,
          coverUrl: song.trans_param?.union_cover ? song.trans_param.union_cover.replace('{size}', '400') : '',
          platform: 'kugou',
        }))
      }
      return []
    }

    // Direct play url resolver helper
    async function resolvePlayUrl(
      platform: string,
      id: string,
      config: PluginConfig,
    ): Promise<{ url: string; headers: Record<string, string> } | null> {
      if (platform === 'netease') {
        const playUrlApi = `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=[${id}]&br=128000`
        const headers = {
          Referer: 'https://music.163.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: config.neteaseCookie || '',
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
              platform: '20',
            },
          },
          comm: {
            uin: 0,
            format: 'json',
            ct: 24,
            cv: 0,
          },
        }
        const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(queryData))}`
        const headers = {
          Referer: 'https://y.qq.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: config.qqCookie || '',
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
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
          Cookie: config.kugouCookie || '',
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
          await event.reply(
            `🎶 MIOKI 点歌系统指令菜单：\n\n👉 【默认平台点歌】（当前默认：${defaultName}）\n   点歌 歌名\n   （示例：点歌 onelastkiss）\n\n👉 【指定平台点歌】\n   网易云点歌 歌名\n   QQ点歌 歌名\n   酷狗点歌 歌名\n\n💡 提示：搜索出歌曲列表后，请在 3 分钟内发送选择指令。`,
            true,
          )
          return
        }

        ctx.logger.info(`收到点歌请求: 平台=${platform}, 关键词=${keyword}`)
        const searchAndReply = async () => {
          try {
            const songs = await searchMusic(platform, keyword, config)
            if (songs.length === 0) {
              await event.reply('未搜索到相关歌曲，请换个关键词试试。', true)
              return
            }

            // Limit to top 10 songs
            const topSongs = songs.slice(0, 10)

            // Save search results in session
            const sessionKey =
              event.message_type === 'group' ? `${event.group_id}_${event.user_id}` : `${event.user_id}`

            const oldSession = sessions.get(sessionKey)
            if (oldSession && oldSession.timer) {
              clearTimeout(oldSession.timer)
            }

            const timer = setTimeout(() => {
              sessions.delete(sessionKey)
            }, config.sessionTimeoutMs)
            ctx.clears.add(() => clearTimeout(timer))

            sessions.set(sessionKey, {
              platform,
              keyword,
              results: topSongs,
              expireTime: Date.now() + config.sessionTimeoutMs,
              timer,
            })

            if (config.useImageRender) {
              // Render via Puppeteer
              const imgBuffer = await renderSongsImage(keyword, platformNames[platform] || platform, topSongs)

              if (imgBuffer) {
                const base64Img = `base64://${imgBuffer.toString('base64')}`
                await event.reply([
                  ctx.segment.image(base64Img),
                  '\n💡 请在 3 分钟内发送“选择 序号”（例如：选择 1）进行点歌',
                ])
              } else {
                // Fallback to text rendering
                const textList = topSongs.map((s, idx) => `${idx + 1}. ${s.name} - ${s.artists}`).join('\n')
                await event.reply(
                  `【${platformNames[platform]}】点歌搜索结果：\n${textList}\n\n💡 请在 3 分钟内发送“选择 序号”进行点歌`,
                  true,
                )
              }
            } else {
              // Text list rendering
              const textList = topSongs.map((s, idx) => `${idx + 1}. ${s.name} - ${s.artists}`).join('\n')
              await event.reply(
                `【${platformNames[platform]}】点歌搜索结果：\n${textList}\n\n💡 请在 3 分钟内发送“选择 序号”进行点歌`,
                true,
              )
            }
          } catch (err: any) {
            ctx.logger.error(`点歌搜索出错: ${err.message}`)
            await event.reply(`搜索失败，发生错误: ${err.message}`, true)
          }
        }

        if (event.message_type === 'group') {
          await runWithReaction(event, searchAndReply)
        } else {
          await searchAndReply()
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

      const sessionKey = event.message_type === 'group' ? `${event.group_id}_${event.user_id}` : `${event.user_id}`

      const session = sessions.get(sessionKey)
      if (!session) return // User has no active song selection session, ignore

      // Check session expiry
      if (Date.now() > session.expireTime) {
        if (session.timer) clearTimeout(session.timer)
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
      if (session.timer) clearTimeout(session.timer)
      sessions.delete(sessionKey) // Consume the session immediately

      const resolveAndReply = async () => {
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
            const timer = setTimeout(() => {
              try {
                if (existsSync(filePathToDelete)) {
                  unlinkSync(filePathToDelete)
                  ctx.logger.debug(`成功清理临时音频文件: ${filePathToDelete}`)
                }
              } catch (cleanupErr: any) {
                ctx.logger.warn(`清理临时音频文件失败: ${cleanupErr.message}`)
              }
            }, 15000)
            ctx.clears.add(() => clearTimeout(timer))
          }
        }
      }

      if (event.message_type === 'group') {
        await runWithReaction(event, resolveAndReply)
      } else {
        await resolveAndReply()
      }
    })

    return async () => {
      sessions.clear()
    }
  },
})
