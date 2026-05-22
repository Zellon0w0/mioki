import sharp from 'sharp'
import { definePlugin, getAbsPluginDir } from 'mioki'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { setDefaultResultOrder } from 'node:dns'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

setDefaultResultOrder('ipv4first')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WHITELIST_FILE = join(__dirname, 'whitelist.json')
const FONT_FILE = join(__dirname, '../renderer/resources/HanYiBlack.woff2')
const FONT_FACE_CSS = loadFontFaceCss()

const WEATHER_API_PATH = '/v2/weather'
const FORECAST_API_PATH = '/v2/weather/forecast'
const HOLIDAY_API = 'http://timor.tech/api/holiday/info'
const SIXTY_API_BASES = [
  'https://60s.viki.moe',
  'https://60api.09cdn.xyz',
  'https://60s.zeabur.app',
  'https://60s.crystelf.top',
  'https://cqxx.site',
  'https://api.yanyua.icu',
  'https://60s.tmini.net',
  'https://60s.7se.cn',
  'https://60s.mizhoubaobei.top',
]
const SPECIAL_WEATHER_KEYWORDS = ['雨', '雪', '雷', '冰雹', '冻雨', '雾', '霾', '沙尘', '大风', '台风']
const COOLING_THRESHOLD = 8
const TIME_ZONE = 'Asia/Shanghai'
const FETCH_TIMEOUT = 6_000
const CARD_FONT_FAMILY = '"HanYiBlack", "汉仪文黑-85W", "HYWenHei-85W", "Microsoft YaHei", "PingFang SC", sans-serif'

interface Whitelist {
  groupWhitelist?: number[]
  nickname?: string[]
}

interface WeatherStore {
  holidayCache: Record<string, HolidayCacheEntry>
  alertState: {
    cooling: Record<string, number>
  }
}

interface GroupWeatherConfig {
  groupId: number
  locations: WeatherLocation[]
  primaryId: string
}

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  groups: GroupWeatherConfig[]
}

interface WeatherLocation {
  id: string
  query: string
  displayName: string
  province?: string
  city?: string
  county?: string
  createdAt: number
  createdBy: number
}

interface HolidayCacheEntry {
  isWorkday: boolean
  name?: string
  type?: number
  updatedAt: number
}

interface ApiResponse<T> {
  code?: number | string
  message?: string
  data?: T
}

interface WeatherLocationData {
  id?: string
  name?: string
  province?: string
  city?: string
  county?: string
  lat?: number
  lon?: number
}

interface WeatherCondition {
  text?: string
  condition?: string
  code?: string | number
  condition_code?: string | number
  icon?: string
  weather_icon?: string
  temperature?: number | string
  feels_like?: number | string
  humidity?: number | string
  wind_direction?: string
  wind_scale?: string
  wind_power?: string
  wind_speed?: number | string
  visibility?: number | string
  pressure?: number | string
  color?: string | string[]
  weather_colors?: string[]
  updated?: string
  updated_at?: number
}

interface RealtimeWeatherData {
  location?: WeatherLocationData
  weather?: WeatherCondition
  air_quality?: {
    aqi?: number | string
    category?: string
    quality?: string
    primary?: string
  }
  update_time?: string
  last_update?: string
  sunrise?: RealtimeSunrise | string
  sunset?: string
}

interface RealtimeSunrise {
  sunrise?: string
  sunrise_desc?: string
  sunset?: string
  sunset_desc?: string
}

interface HourlyForecast {
  time?: string
  datetime?: string
  text?: string
  condition?: string
  weather?: string
  code?: string | number
  condition_code?: string | number
  icon?: string
  weather_icon?: string
  temperature?: number | string
  temp?: number | string
  humidity?: number | string
  wind_direction?: string
  wind_scale?: string
  precipitation_probability?: number | string
  pop?: number | string
}

interface DailyForecast {
  date?: string
  day_condition?: string
  night_condition?: string
  text_day?: string
  text_night?: string
  weather_day?: string
  weather_night?: string
  high?: number | string
  low?: number | string
  temperature_high?: number | string
  temperature_low?: number | string
  temp_high?: number | string
  temp_low?: number | string
  max_temperature?: number | string
  min_temperature?: number | string
}

interface SunriseSunset {
  date?: string
  sunrise?: string
  sunrise_desc?: string
  sunset?: string
  sunset_desc?: string
}

interface ForecastWeatherData {
  location?: WeatherLocationData
  hourly_forecast?: HourlyForecast[]
  daily_forecast?: DailyForecast[]
  sunrise_sunset?: SunriseSunset[]
  update_time?: string
  last_update?: string
}

interface WeatherBundle {
  query: string
  location: WeatherLocationData
  realtime: RealtimeWeatherData
  forecast: ForecastWeatherData
}

interface CoolingReminder {
  key: string
  text: string
}

export default definePlugin({
  name: '天气',
  version: '1.0.0',
  description: '天气预报与雨雪降温提醒',

  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '天气')
    const configPath = join(pluginDir, 'config.json')

    // 自动从旧的 data.json / whitelist.json 迁移数据
    if (!existsSync(configPath)) {
      ctx.logger.info('未检测到 config.json，尝试从 data.json / whitelist.json 迁移配置...')
      const migratedConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        groups: [],
      }

      // 1. 迁移白名单
      const oldWhitelistFile = join(__dirname, 'whitelist.json')
      if (existsSync(oldWhitelistFile)) {
        try {
          const rawWl = JSON.parse(readFileSync(oldWhitelistFile, 'utf-8')) as Whitelist
          if (rawWl && Array.isArray(rawWl.groupWhitelist)) {
            migratedConfig.whitelist = rawWl.groupWhitelist.filter((id) => typeof id === 'number')
          }
        } catch (err: any) {
          ctx.logger.warn(`迁移 whitelist.json 失败: ${err.message}`)
        }
      }

      // 2. 迁移群配置
      const oldDbFile = join(__dirname, 'data.json')
      if (existsSync(oldDbFile)) {
        try {
          const rawDb = JSON.parse(readFileSync(oldDbFile, 'utf-8'))
          if (rawDb && rawDb.groups && typeof rawDb.groups === 'object') {
            for (const [groupIdStr, groupVal] of Object.entries(rawDb.groups)) {
              const groupId = Number(groupIdStr)
              if (!Number.isNaN(groupId) && groupVal && typeof groupVal === 'object') {
                const gVal = groupVal as any
                migratedConfig.groups.push({
                  groupId,
                  locations: Array.isArray(gVal.locations) ? gVal.locations : [],
                  primaryId: gVal.primaryId || '',
                })
              }
            }
          }
        } catch (err: any) {
          ctx.logger.warn(`迁移 data.json 失败: ${err.message}`)
        }
      }

      try {
        writeFileSync(configPath, JSON.stringify(migratedConfig, null, 2), 'utf-8')
        ctx.logger.info('已成功生成 config.json')
      } catch (err: any) {
        ctx.logger.error(`保存迁移后的 config.json 失败: ${err.message}`)
      }
    }

    const store = await ctx.createStore<WeatherStore>(
      {
        holidayCache: {},
        alertState: {
          cooling: {},
        },
      } as any,
      { __dirname },
    )

    // 清理旧 data.json 中的 groups 数据以减小体积
    if ((store.data as any).groups) {
      delete (store.data as any).groups
      await store.write()
    }

    // 加载配置的辅助函数
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        groups: [],
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const content = readFileSync(configPath, 'utf-8')
        const parsed = JSON.parse(content) as PluginConfig

        // 确保每个 location 都有唯一的 ID
        let modified = false
        if (parsed.groups && Array.isArray(parsed.groups)) {
          for (const g of parsed.groups) {
            if (g.locations && Array.isArray(g.locations)) {
              for (const loc of g.locations) {
                if (!loc.id) {
                  loc.id = randomUUID()
                  modified = true
                }
              }
            }
          }
        }

        const config = {
          ...defaultConfig,
          ...parsed,
        }

        if (modified) {
          try {
            writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
          } catch {}
        }

        return config
      } catch (err: any) {
        ctx.logger.error(`加载 config.json 失败: ${err.message}`)
        return defaultConfig
      }
    }

    // 保存配置的辅助函数
    const saveConfig = (config: PluginConfig) => {
      try {
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存 config.json 失败: ${err.message}`)
      }
    }

    let pluginConfig = loadConfig()

    const ensureGroupConfig = (groupId: number): GroupWeatherConfig => {
      let group = pluginConfig.groups.find((g) => g.groupId === groupId)
      if (!group) {
        group = {
          groupId,
          locations: [],
          primaryId: '',
        }
        pluginConfig.groups.push(group)
      }
      return group
    }

    const getGroupConfig = (groupId: number): GroupWeatherConfig | undefined => {
      return pluginConfig.groups.find((g) => g.groupId === groupId)
    }

    const canManageGroup = (event: any) => {
      return ctx.isOwner(event) || ['owner', 'admin'].includes(event.sender?.role)
    }

    const sendText = async (groupId: number, message: string) => {
      await ctx.bot.sendGroupMsg(groupId, [ctx.segment.text(message)])
    }

    const sendWeather = async (groupId: number, bundle: WeatherBundle) => {
      const image = await renderWeatherCard(bundle)
      await ctx.bot.sendGroupMsg(groupId, [ctx.segment.image(image)])

      const reminder = buildSpecialWeatherReminder(bundle)
      if (reminder) {
        await sendText(groupId, reminder)
      }
    }

    const queryAndSend = async (groupId: number, query: string) => {
      const bundle = await fetchWeatherBundle(query)
      await sendWeather(groupId, bundle)
    }

    ctx.handle('message.group', async (event) => {
      // 检查启用状态
      if (!pluginConfig.enabled) return

      // 检查白名单
      if (pluginConfig.whitelist.length > 0 && !pluginConfig.whitelist.includes(event.group_id)) return

      const text = ctx.text(event).trim()
      if (!text) return

      await ctx.runWithErrorHandler(
        async () => {
          if (text === '天气' || text === '天气 帮助' || text === '天气帮助') {
            if (text !== '天气') {
              await event.reply(getHelpText(), true)
              return
            }

            const group = getGroupConfig(event.group_id)
            const primary = group ? getPrimaryLocation(group) : null
            if (!primary) {
              await event.reply('本群还没有设置天气地址。管理员可发送：天气 添加 北京', true)
              return
            }

            await queryAndSend(event.group_id, primary.query)
            return
          }

          if (text.startsWith('天气 ')) {
            const [command, ...args] = text.slice(3).trim().split(/\s+/)
            const value = args.join(' ').trim()

            if (command === '帮助') {
              await event.reply(getHelpText(), true)
              return
            }

            if (command === '列表') {
              const group = getGroupConfig(event.group_id)
              await event.reply(formatLocationList(group), true)
              return
            }

            if (!['添加', '删除', '主地址', '清空'].includes(command)) return

            if (!canManageGroup(event)) {
              await event.reply('只有群主、管理员或机器人主人可以修改天气地址。', true)
              return
            }

            if (command === '添加') {
              if (!value) {
                await event.reply('格式：天气 添加 <地址>', true)
                return
              }

              const bundle = await fetchWeatherBundle(value)
              const location = bundle.location
              const displayName = formatLocationName(location, value)
              const group = ensureGroupConfig(event.group_id)
              const exists = group.locations.find((item) => {
                return item.query === value || item.displayName === displayName
              })

              if (exists) {
                await event.reply(`本群已添加过 ${exists.displayName}。`, true)
                return
              }

              const saved: WeatherLocation = {
                id: randomUUID(),
                query: value,
                displayName,
                province: location.province,
                city: location.city,
                county: location.county,
                createdAt: Date.now(),
                createdBy: event.user_id,
              }

              group.locations.push(saved)
              if (!group.primaryId) {
                group.primaryId = saved.id
              }

              saveConfig(pluginConfig)
              await event.reply(
                `已添加天气地址：${saved.displayName}${group.primaryId === saved.id ? '\n已自动设为主地址。' : ''}`,
                true,
              )
              return
            }

            if (command === '删除') {
              if (!value) {
                await event.reply('格式：天气 删除 <地址|序号>', true)
                return
              }

              const group = getGroupConfig(event.group_id)
              if (!group) {
                await event.reply('没有找到这个天气地址，可发送“天气 列表”查看。', true)
                return
              }

              const index = findLocationIndex(group, value)
              if (index < 0) {
                await event.reply('没有找到这个天气地址，可发送“天气 列表”查看。', true)
                return
              }

              const [removed] = group.locations.splice(index, 1)
              if (group.primaryId === removed.id) {
                group.primaryId = group.locations[0]?.id || ''
              }

              saveConfig(pluginConfig)
              await event.reply(`已删除天气地址：${removed.displayName}`, true)
              return
            }

            if (command === '主地址') {
              if (!value) {
                await event.reply('格式：天气 主地址 <地址|序号>', true)
                return
              }

              const group = getGroupConfig(event.group_id)
              if (!group) {
                await event.reply('没有找到这个天气地址，可发送“天气 列表”查看。', true)
                return
              }

              const index = findLocationIndex(group, value)
              if (index < 0) {
                await event.reply('没有找到这个天气地址，可发送“天气 列表”查看。', true)
                return
              }

              group.primaryId = group.locations[index].id
              saveConfig(pluginConfig)
              await event.reply(`已将 ${group.locations[index].displayName} 设为本群主地址。`, true)
              return
            }

            if (command === '清空') {
              pluginConfig.groups = pluginConfig.groups.filter((g) => g.groupId !== event.group_id)
              saveConfig(pluginConfig)
              await event.reply('已清空本群所有天气地址。', true)
              return
            }
          }

          const directMatch = text.match(/^(.+?)天气$/)
          if (directMatch?.[1]) {
            const query = directMatch[1].trim()
            if (!query) return
            await queryAndSend(event.group_id, query)
          }
        },
        event,
        (error) => {
          ctx.logger.warn(`天气查询失败：${error}`)
          return `天气获取失败：${error}`
        },
      )
    })

    ctx.cron('0 7,13 * * *', async () => {
      if (!pluginConfig.enabled) return

      const today = getChinaDate()
      const isWorkday = await checkWorkday(today)
      if (!isWorkday) return

      for (const group of pluginConfig.groups) {
        const groupId = group.groupId
        if (!Number.isFinite(groupId) || !group.locations || group.locations.length === 0) continue
        if (pluginConfig.whitelist.length > 0 && !pluginConfig.whitelist.includes(groupId)) continue

        const messages: string[] = []
        const coolingKeys: string[] = []

        for (const location of group.locations) {
          try {
            const bundle = await fetchWeatherBundle(location.query)
            const special = buildSpecialWeatherReminder(bundle, location.displayName)
            if (special) messages.push(special)

            const cooling = buildCoolingReminder(bundle, groupId, location)
            if (cooling && !store.data.alertState.cooling[cooling.key]) {
              messages.push(cooling.text)
              coolingKeys.push(cooling.key)
            }
          } catch (error) {
            ctx.logger.warn(`定时天气查询失败：群 ${groupId} / ${location.query} / ${ctx.stringifyError(error)}`)
          }
        }

        if (messages.length === 0) continue

        try {
          await sendText(groupId, `天气提醒\n${messages.join('\n\n')}`)
          for (const key of coolingKeys) {
            store.data.alertState.cooling[key] = Date.now()
          }
          await pruneCoolingState(store.data.alertState.cooling)
          await store.write()
          await ctx.wait(800)
        } catch (error) {
          ctx.logger.warn(`群 ${groupId} 发送天气提醒失败：${ctx.stringifyError(error)}`)
        }
      }
    })

    async function checkWorkday(date: string): Promise<boolean> {
      const cached = store.data.holidayCache[date]
      if (cached) return cached.isWorkday

      try {
        const data = await fetchJson<any>(`${HOLIDAY_API}/${date}`)
        const type = Number(data?.type?.type)
        if (!Number.isFinite(type)) throw new Error('节假日接口缺少 type.type')

        const entry: HolidayCacheEntry = {
          isWorkday: type === 0 || type === 3,
          name: data?.type?.name || data?.holiday?.name,
          type,
          updatedAt: Date.now(),
        }

        store.data.holidayCache[date] = entry
        await store.write()
        return entry.isWorkday
      } catch (error) {
        ctx.logger.warn(`节假日判断失败，跳过天气定时提醒：${ctx.stringifyError(error)}`)
        return false
      }
    }
  },
})

async function fetchWeatherBundle(query: string): Promise<WeatherBundle> {
  const errors: string[] = []
  let businessError: string | null = null

  for (const base of SIXTY_API_BASES) {
    try {
      const [realtime, forecast] = await Promise.all([
        fetchJson<RealtimeWeatherData>(buildApiUrl(base, WEATHER_API_PATH, { query })),
        fetchJson<ForecastWeatherData>(buildApiUrl(base, FORECAST_API_PATH, { query, days: '7' })),
      ])

      const location = realtime.location || forecast.location
      if (!location) {
        throw new Error('天气接口未返回地区信息')
      }

      return {
        query,
        location,
        realtime,
        forecast,
      }
    } catch (error) {
      const msg = formatError(error)
      errors.push(msg)
      if (!businessError && (msg.includes('未找到') || msg.includes('城市') || msg.includes('地区'))) {
        businessError = msg
      }
    }
  }

  throw new Error(businessError || `全部天气接口请求失败（共 ${errors.length} 个错误）`)
}

function buildApiUrl(base: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    let response: Response

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'mioki-weather-plugin/1.0',
          Accept: 'application/json',
        },
      })
    } catch (error) {
      throw new Error(`${getUrlOrigin(url)} 请求失败：${formatError(error)}`)
    }

    if (!response.ok) {
      throw new Error(`${getUrlOrigin(url)} HTTP ${response.status}`)
    }

    const json = (await response.json()) as ApiResponse<T> | null
    if (!json) {
      throw new Error('接口返回为空')
    }

    const code = Number(json.code)
    if (Number.isFinite(code) && code !== 200 && code !== 0) {
      const dataError = json.data && typeof json.data === 'object' ? (json.data as any).error || (json.data as any).message : null
      throw new Error(dataError || json.message || `接口返回 code=${json.code}`)
    }

    if (Object.prototype.hasOwnProperty.call(json, 'data')) {
      if (!json.data) {
        throw new Error(json.message || '接口返回为空')
      }

      return json.data
    }

    return json as unknown as T
  } finally {
    clearTimeout(timer)
  }
}

function getUrlOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

function getHelpText(): string {
  return [
    '天气插件指令',
    '天气：查询本群主地址',
    '<地址>天气：查询指定地址',
    '天气 添加 <地址>：添加群地址',
    '天气 删除 <地址|序号>：删除群地址',
    '天气 主地址 <地址|序号>：设置主地址',
    '天气 列表：查看本群地址',
    '天气 清空：清空本群地址',
  ].join('\n')
}

function getPrimaryLocation(group: GroupWeatherConfig): WeatherLocation | null {
  return group.locations.find((item) => item.id === group.primaryId) || group.locations[0] || null
}

function findLocationIndex(group: GroupWeatherConfig, ref: string): number {
  const index = Number(ref)
  if (Number.isInteger(index) && index >= 1 && index <= group.locations.length) {
    return index - 1
  }

  return group.locations.findIndex((item) => {
    return item.id === ref || item.query === ref || item.displayName === ref
  })
}

function formatLocationList(group?: GroupWeatherConfig): string {
  if (!group || group.locations.length === 0) {
    return '本群还没有设置天气地址。管理员可发送：天气 添加 北京'
  }

  const lines = group.locations.map((location, index) => {
    const primary = location.id === group.primaryId ? '（主地址）' : ''
    return `${index + 1}. ${location.displayName}${primary} - ${location.query}`
  })

  return `本群天气地址：\n${lines.join('\n')}`
}

function formatLocationName(location: WeatherLocationData, fallback: string): string {
  const parts = [location.province, location.city, location.county || location.name].filter(Boolean)
  return unique(parts).join(' ') || location.name || fallback
}

function buildSpecialWeatherReminder(bundle: WeatherBundle, fallbackName?: string): string | null {
  const hours = getHourlyForecast(bundle).slice(0, 3)
  const matched = hours.filter((hour) => hasSpecialWeather(getHourlyText(hour)))
  if (matched.length === 0) return null

  const locationName = fallbackName || formatLocationName(bundle.location, bundle.query)
  const detail = matched
    .map((hour) => `${formatHour(getHourlyTime(hour))} ${getHourlyText(hour)} ${formatTemperature(getHourlyTemp(hour))}`)
    .join('，')

  return `${locationName} 未来 3 小时可能出现特殊天气：${detail}。请留意出行安全。`
}

function buildCoolingReminder(bundle: WeatherBundle, groupId: number, location: WeatherLocation): CoolingReminder | null {
  const { today, tomorrow } = getTodayAndTomorrowForecast(bundle.forecast.daily_forecast || [])
  if (!today || !tomorrow) return null

  const todayHigh = getDailyHigh(today)
  const tomorrowHigh = getDailyHigh(tomorrow)
  const todayLow = getDailyLow(today)
  const tomorrowLow = getDailyLow(tomorrow)

  const highDrop = isNumber(todayHigh) && isNumber(tomorrowHigh) ? todayHigh - tomorrowHigh : 0
  const lowDrop = isNumber(todayLow) && isNumber(tomorrowLow) ? todayLow - tomorrowLow : 0
  const maxDrop = Math.max(highDrop, lowDrop)

  if (maxDrop < COOLING_THRESHOLD) return null

  const tomorrowDate = tomorrow.date || getTomorrowDate()
  const key = `${groupId}:${location.id}:${tomorrowDate}`
  const parts = []
  if (highDrop >= COOLING_THRESHOLD) parts.push(`最高温下降 ${Math.round(highDrop)}°C`)
  if (lowDrop >= COOLING_THRESHOLD) parts.push(`最低温下降 ${Math.round(lowDrop)}°C`)

  return {
    key,
    text: `${location.displayName} 明天明显降温：${parts.join('，')}，注意添衣。`,
  }
}

async function renderWeatherCard(bundle: WeatherBundle): Promise<Buffer> {
  const current = bundle.realtime.weather || {}
  const locationName = formatLocationName(bundle.location, bundle.query)
  const condition = getCurrentCondition(current)
  const temperature = formatTemperature(current.temperature)
  const humidity = formatPercent(current.humidity)
  const updateTime = formatDateTime(
    current.updated || bundle.realtime.update_time || bundle.realtime.last_update || bundle.forecast.update_time,
  )
  const sunriseSunset = getSunriseSunset(bundle)
  const hours = getHourlyForecast(bundle).slice(0, 6)
  const colors = normalizeColors(current.weather_colors || current.color)
  const currentIcon = current.weather_icon || current.icon
  const icon = currentIcon ? await getImageDataUri(currentIcon).catch(() => '') : ''
  const hourlyCards = hours.map((hour, index) => renderHourlyCard(hour, index)).join('')
  const now = formatChinaDateTime(new Date())

  // 获取今天的最高温/最低温
  const { today } = getTodayAndTomorrowForecast(bundle.forecast.daily_forecast || [])
  const highTemp = today ? getDailyHigh(today) : null
  const lowTemp = today ? getDailyLow(today) : null
  const lowTempText = lowTemp !== null ? `${Math.round(lowTemp)}°` : ''
  const highTempText = highTemp !== null ? `${Math.round(highTemp)}°` : ''
  const showHighLow = lowTempText && highTempText

  const svg = `
<svg width="860" height="640" viewBox="0 0 860 640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style type="text/css"><![CDATA[
      ${FONT_FACE_CSS}
      text {
        font-family: ${fontFamily()};
      }
    ]]></style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="54%" stop-color="${colors[1]}"/>
      <stop offset="100%" stop-color="${colors[2]}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#132238" flood-opacity="0.22"/>
    </filter>
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#11304f" flood-opacity="0.24"/>
    </filter>
  </defs>
  <rect width="860" height="640" rx="42" fill="url(#bg)"/>
  <circle cx="750" cy="80" r="170" fill="#ffffff" opacity="0.12"/>
  <circle cx="92" cy="560" r="210" fill="#ffffff" opacity="0.1"/>
  <rect x="38" y="38" width="784" height="564" rx="32" fill="#183653" opacity="0.36" filter="url(#shadow)"/>
  <rect x="38" y="38" width="784" height="564" rx="32" fill="#ffffff" opacity="0.12"/>
  <text x="72" y="96" fill="#ffffff" font-size="30" font-weight="800" filter="url(#textShadow)">${escapeXml(locationName)}</text>
  <text x="72" y="132" fill="#f1f8ff" font-size="18" font-weight="700">当前时间 ${escapeXml(now)}</text>
  <text x="72" y="244" fill="#ffffff" font-size="94" font-weight="900" filter="url(#textShadow)">${escapeXml(temperature)}</text>
  ${showHighLow ? `<text x="360" y="244" fill="#f1f8ff" font-size="20" font-weight="700" filter="url(#textShadow)">↓${escapeXml(lowTempText)}  ↑${escapeXml(highTempText)}</text>` : ''}
  <text x="74" y="294" fill="#ffffff" font-size="38" font-weight="900" filter="url(#textShadow)">${escapeXml(condition)}</text>
  ${icon ? `<image href="${icon}" x="640" y="86" width="116" height="116" opacity="0.92"/>` : renderFallbackIcon(condition)}
  <text x="74" y="334" fill="#f1f8ff" font-size="18" font-weight="700">更新时间 ${escapeXml(updateTime)}</text>
  <g transform="translate(72 382)">
    ${renderMetric('湿度', humidity, 0)}
    ${renderMetric('日出', sunriseSunset.sunrise || '--:--', 1)}
    ${renderMetric('日落', sunriseSunset.sunset || '--:--', 2)}
    ${renderMetric('空气', formatAqi(bundle.realtime.air_quality), 3)}
  </g>
  <text x="72" y="492" fill="#ffffff" font-size="26" font-weight="900" filter="url(#textShadow)">未来几小时</text>
  <g transform="translate(72 514)">
    ${hourlyCards}
  </g>
</svg>`

  return sharp(Buffer.from(svg)).png({ quality: 95, compressionLevel: 9 }).toBuffer()
}

function renderMetric(label: string, value: string, index: number): string {
  const x = index * 178
  return `
  <g transform="translate(${x} 0)">
    <rect width="154" height="74" rx="18" fill="#ffffff" opacity="0.26"/>
    <text x="18" y="30" fill="#f1f8ff" font-size="15" font-weight="700">${escapeXml(label)}</text>
    <text x="18" y="58" fill="#ffffff" font-size="23" font-weight="900">${escapeXml(value)}</text>
  </g>`
}

function renderHourlyCard(hour: HourlyForecast, index: number): string {
  const x = index * 114
  const time = formatHour(getHourlyTime(hour))
  const text = getHourlyText(hour)
  const temperature = formatTemperature(getHourlyTemp(hour))

  return `
  <g transform="translate(${x} 0)">
    <rect width="98" height="72" rx="17" fill="#ffffff" opacity="0.25"/>
    <text x="49" y="23" fill="#f1f8ff" font-size="14" font-weight="700" text-anchor="middle">${escapeXml(time)}</text>
    <text x="49" y="46" fill="#ffffff" font-size="17" font-weight="900" text-anchor="middle">${escapeXml(text.slice(0, 4))}</text>
    <text x="49" y="65" fill="#ffffff" font-size="16" font-weight="800" text-anchor="middle">${escapeXml(temperature)}</text>
  </g>`
}

function renderFallbackIcon(condition: string): string {
  return `
  <g transform="translate(642 86)">
    <circle cx="58" cy="58" r="58" fill="#ffffff" opacity="0.28"/>
    <text x="58" y="70" fill="#ffffff" font-size="30" font-weight="900" text-anchor="middle">${escapeXml(condition.slice(0, 2))}</text>
  </g>`
}

async function getImageDataUri(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || 'image/png'
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } finally {
    clearTimeout(timer)
  }
}

function getSunriseSunset(bundle: WeatherBundle): { sunrise?: string; sunset?: string } {
  const today = getChinaDate()
  const item = bundle.forecast.sunrise_sunset?.find((entry) => entry.date === today) || bundle.forecast.sunrise_sunset?.[0]
  const realtimeSunrise = getRealtimeSunrise(bundle.realtime.sunrise)

  return {
    sunrise: realtimeSunrise.sunrise || formatHour(item?.sunrise_desc || item?.sunrise),
    sunset: bundle.realtime.sunset || realtimeSunrise.sunset || formatHour(item?.sunset_desc || item?.sunset),
  }
}

function getHourlyForecast(bundle: WeatherBundle): HourlyForecast[] {
  return bundle.forecast.hourly_forecast || []
}

function getTodayAndTomorrowForecast(daily: DailyForecast[]): {
  today?: DailyForecast
  tomorrow?: DailyForecast
} {
  const todayDate = getChinaDate()
  const tomorrowDate = getTomorrowDate()
  const byDateToday = daily.find((item) => item.date === todayDate)
  const byDateTomorrow = daily.find((item) => item.date === tomorrowDate)

  if (byDateToday && byDateTomorrow) {
    return { today: byDateToday, tomorrow: byDateTomorrow }
  }

  const upcoming = daily
    .filter((item) => !item.date || item.date >= todayDate)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  return {
    today: byDateToday || upcoming[0],
    tomorrow: byDateTomorrow || upcoming[1],
  }
}

function getHourlyText(hour: HourlyForecast): string {
  return hour.condition || hour.text || hour.weather || '未知'
}

function getHourlyTemp(hour: HourlyForecast): number | string | undefined {
  return hour.temperature ?? hour.temp
}

function getHourlyTime(hour: HourlyForecast): string | undefined {
  return hour.time || hour.datetime
}

function getDailyHigh(day: DailyForecast): number | null {
  return toNumber(day.high ?? day.temperature_high ?? day.temp_high ?? day.max_temperature)
}

function getDailyLow(day: DailyForecast): number | null {
  return toNumber(day.low ?? day.temperature_low ?? day.temp_low ?? day.min_temperature)
}

function hasSpecialWeather(text: string): boolean {
  return SPECIAL_WEATHER_KEYWORDS.some((keyword) => text.includes(keyword))
}

function getCurrentCondition(current: WeatherCondition): string {
  return current.condition || current.text || '未知'
}

function getRealtimeSunrise(value: RealtimeWeatherData['sunrise']): { sunrise?: string; sunset?: string } {
  if (!value) return {}
  if (typeof value === 'string') return { sunrise: formatHour(value) }

  return {
    sunrise: value.sunrise_desc || formatHour(value.sunrise),
    sunset: value.sunset_desc || formatHour(value.sunset),
  }
}

function normalizeColors(color?: string | string[]): [string, string, string] {
  const colors = Array.isArray(color) ? color : typeof color === 'string' ? [color] : []
  const normalized = colors.filter((item) => /^#[0-9a-f]{6}$/i.test(item))

  if (normalized.length >= 3) return [normalized[0], normalized[1], normalized[2]]
  if (normalized.length === 2) return [normalized[0], normalized[1], '#f7d37b']
  if (normalized.length === 1) return [normalized[0], '#55b7a8', '#f2c66d']
  return ['#3b82c4', '#4fb7a8', '#f2c66d']
}

function formatTemperature(value: number | string | null | undefined): string {
  const num = toNumber(value)
  return num === null ? '--°C' : `${Math.round(num)}°C`
}

function formatPercent(value: number | string | null | undefined): string {
  const num = toNumber(value)
  return num === null ? '--%' : `${Math.round(num)}%`
}

function formatAqi(air?: RealtimeWeatherData['air_quality']): string {
  if (!air) return '--'
  const category = air.category || air.quality || ''
  return `${air.aqi || '--'} ${category}`.trim()
}

function formatHour(value?: string): string {
  if (!value) return '--:--'
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 5)
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).format(date)
}

function formatDateTime(value?: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 16)
  return formatChinaDateTime(date)
}

function formatChinaDateTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).format(date)
}

function getChinaDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIME_ZONE,
  }).format(date)
}

function getTomorrowDate(): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return getChinaDate(date)
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const match = value.match(/-?\d+(\.\d+)?/)
  if (!match) return null

  const num = Number(match[0])
  return Number.isFinite(num) ? num : null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}



function loadFontFaceCss(): string {
  try {
    if (!existsSync(FONT_FILE)) return ''

    const font = readFileSync(FONT_FILE).toString('base64')
    return `
      @font-face {
        font-family: "HanYiBlack";
        src: url("data:font/woff2;base64,${font}") format("woff2");
        font-weight: 400;
        font-style: normal;
      }
    `
  } catch {
    return ''
  }
}

function fontFamily(): string {
  return CARD_FONT_FAMILY
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const cause = (error as Error & { cause?: unknown }).cause
  if (!cause) return `${error.name}: ${error.message}`

  if (cause instanceof Error) {
    return `${error.name}: ${error.message} (${cause.name}: ${cause.message})`
  }

  if (typeof cause === 'object') {
    const detail = cause as Record<string, unknown>
    const code = detail.code ? ` ${String(detail.code)}` : ''
    const message = detail.message ? ` ${String(detail.message)}` : ''
    return `${error.name}: ${error.message} (${String(detail.name || 'Cause')}${code}${message})`
  }

  return `${error.name}: ${error.message} (${String(cause)})`
}

async function pruneCoolingState(cooling: Record<string, number>) {
  const expireBefore = Date.now() - 1000 * 60 * 60 * 24 * 30
  for (const [key, time] of Object.entries(cooling)) {
    if (time < expireBefore) delete cooling[key]
  }
}
