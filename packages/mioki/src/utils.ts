import mri from 'mri'
import path from 'node:path'
import crypto from 'node:crypto'
import { Low } from 'lowdb'
import { segment } from 'napcat-sdk'
import { DataFile } from 'lowdb/node'
import { createJiti, type Jiti } from 'jiti'
import { string2argv } from 'string2argv'
import { fileURLToPath } from 'node:url'

export { default as prettyMs } from 'pretty-ms'

import type { BinaryLike, BinaryToTextEncoding } from 'node:crypto'
import type {
  MessageEvent,
  GroupMessageEvent,
  Sendable,
  PrivateMessageEvent,
  RecvElement,
  RecvImageElement,
} from 'napcat-sdk'

export { filesize } from 'filesize'
export { string2argv } from 'string2argv'
export { default as fs } from 'node:fs'
export { default as mri } from 'mri'
export { default as path } from 'node:path'
export { default as dayjs } from 'dayjs'
export { default as dedent } from 'dedent'
export { colors, stripAnsi, box, colorize } from 'consola/utils'
export { default as systemInfo } from 'systeminformation'

export const ChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'

export type Noop = () => void
export type AnyFunc = (...args: any[]) => any
export type PureObject<T = any> = Record<PropertyKey, T>
export type Arrayable<T> = T | T[]
export type Awaitable<T> = T | Promise<T>
export type Gettable<T> = T | (() => T)
export type HasMessage = { message: RecvElement[] } | RecvElement[]

/**
 * Jiti 实例
 */
export const jiti: Jiti = createJiti(__dirname, {
  extensions: ['.ts', '.js', '.cts', '.cjs', '.mts', '.mjs', '.tsx', '.jsx', '.json'],

  cache: false,
  fsCache: false,
  moduleCache: false,
  requireCache: false,

  sourceMaps: false,
  interopDefault: true,

  jsx: {
    importSource: 'react',
    runtime: 'automatic',
  },
})

export interface CreateCmdOptions {
  prefix?: string
  onPrefix?(): void
}

/**
 * 解析命令字符串，返回命令和参数
 */
export function createCmd(
  cmdStr: string,
  options: CreateCmdOptions = {},
): {
  cmd: string | undefined
  params: string[]
  options: Record<string, any>
} {
  const { prefix = '', onPrefix = () => {} } = options
  const { _, ...cmdOptions } = mri(string2argv(cmdStr))
  const [cmd, ...params] = _

  if (prefix) {
    if (cmd !== prefix) {
      return {
        cmd: undefined,
        params: [],
        options: cmdOptions,
      }
    }

    if (params.length === 0) {
      onPrefix()
    }

    const prefixedCmd = params.shift()

    return {
      cmd: prefixedCmd,
      params,
      options: cmdOptions,
    }
  }

  return {
    cmd,
    params,
    options: cmdOptions,
  }
}

/**
 * 带有表情反应的函数执行包装器
 */
export async function runWithReaction<T extends AnyFunc>(
  e: GroupMessageEvent,
  fn: T,
  id = '60',
): Promise<ReturnType<T>> {
  await e.addReaction(id)
  const result = (await fn()) as ReturnType<T>
  await e.delReaction(id)
  return result
}

/**
 * 创建一个 LowDB 数据库实例
 */
export async function createDB<T extends object = object>(
  filename: string,
  options: {
    defaultData?: T
    compress?: boolean
  } = {},
): Promise<Low<T>> {
  const { defaultData = {} as T, compress = false } = options

  const database = new Low<T>(
    new DataFile<T>(filename, {
      parse: JSON.parse,
      stringify: (data) => JSON.stringify(data, null, compress ? 0 : 2),
    }),
    defaultData,
  )

  await database.read()

  return database
}

/**
 * 确保返回一个可用的图片元素
 *
 * @param buffer 图片缓冲区
 * @param text 文本
 * @returns 图片元素
 */
export function ensureBuffer(buffer?: Buffer | null | undefined, text?: null): null
export function ensureBuffer(buffer?: Buffer | null | undefined, text?: string): Sendable
export function ensureBuffer(
  buffer?: Buffer | null | undefined,
  text: string | null = '图片渲染失败',
): Sendable | null {
  return buffer ? segment.image(`data:image/png;base64,${buffer.toString('base64')}`) : text
}

/**
 * 格式化时间间隔为可读字符串
 *
 * @param ms 时间间隔（毫秒）
 * @returns 可读字符串
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天${hours % 24}小时`
  if (hours > 0) return `${hours}小时${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`
  return `${seconds}秒`
}

type MatchPatternItem = null | undefined | void | false | Arrayable<Sendable>
type MatchValue<E extends MessageEvent> =
  | MatchPatternItem
  | ((matches: RegExpMatchArray, event: E) => MatchPatternItem)
  | ((matches: RegExpMatchArray, event: E) => Promise<MatchPatternItem>)
/**
 * 匹配输入文本与匹配模式，如果匹配成功，则回复匹配结果
 *
 * 支持：
 * - 精确匹配
 * - 正则表达式匹配（以 `/` 开头和结尾的字符串）
 * - 通配符匹配（使用 `*` 作为通配符）
 *
 * @param event 消息事件
 * @param pattern 匹配模式
 * @param quote 是否引用回复
 * @returns 匹配结果
 */
export async function match<E extends MessageEvent>(
  event: E,
  pattern: Record<string, MatchValue<E>>,
  quote: boolean = true,
): Promise<{ message_id: number } | null> {
  const inputText = text(event)

  async function handleMatch(key: string, value: MatchValue<E>) {
    let isMatched = false
    let matches: RegExpMatchArray | null = null

    const isRegExpLikeString = key.match(/^\/.+\/$/)
    const hasWildcard = key.includes('*')

    if (isRegExpLikeString) {
      try {
        const regex = new RegExp(key.slice(1, -1))
        const matchesValue = inputText.match(regex)

        if (matchesValue) {
          isMatched = true
          matches = matchesValue
        }
      } catch (err) {
        throw new Error(`无效的正则表达式: ${key}`, { cause: err })
      }
    } else if (hasWildcard) {
      const regexPattern = `^${key.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`
      const regex = new RegExp(regexPattern)
      const matchesValue = inputText.match(regex)

      if (matchesValue) {
        isMatched = true
        matches = matchesValue
      }
    } else if (key === inputText) {
      isMatched = true
    }

    if (isMatched) {
      return typeof value === 'function' ? await value(matches as RegExpMatchArray, event) : value
    }
  }

  for (const [key, value] of Object.entries(pattern)) {
    const result = await handleMatch(key, value)

    if (result) {
      return event.reply(result, quote)
    }
  }

  return null
}

/**
 * 创建一个持久化数据库，基于 createDB 封装
 */
export async function createStore<T extends object = object>(
  defaultData: T,
  options?: {
    __dirname?: string
    importMeta?: ImportMeta
    compress?: boolean
    filename?: string
  },
): Promise<Low<T>> {
  const { compress = false, __dirname, importMeta: meta, filename = 'data.json' } = options || {}
  const dirname = __dirname || meta?.dirname || (meta?.url ? path.dirname(fileURLToPath(meta.url)) : '')

  if (!dirname) {
    throw new Error('createStore: options.__dirname or options.meta must be provided')
  }

  const filePath = path.join(dirname, filename)

  const database = new Low<T>(
    new DataFile<T>(filePath, {
      parse: JSON.parse,
      stringify: (data) => JSON.stringify(data, null, compress ? 0 : 2),
    }),
    defaultData,
  )

  await database.read()
  await database.write()

  return database
}

/**
 * MD5 加密
 */
export function md5(text: BinaryLike, encoding: 'buffer'): Buffer
export function md5(text: BinaryLike, encoding?: BinaryToTextEncoding): string
export function md5(text: BinaryLike, encoding: BinaryToTextEncoding | 'buffer' = 'hex'): string | Buffer {
  const hash = crypto.createHash('md5').update(text)

  if (encoding === 'buffer') {
    return hash.digest()
  }

  return hash.digest(encoding)
}

/**
 * 数组去重
 */
export function unique<T>(array: T[]): T[] {
  return Array.from(new Set(array))
}

/**
 * 确保值为数组
 *
 */
export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

/**
 * 是否是群消息
 */
export const isGroupMsg = (event: MessageEvent): event is GroupMessageEvent => {
  return 'group' in event
}

/**
 * 是否是私聊消息
 */
export const isPrivateMsg = (event: MessageEvent): event is PrivateMessageEvent => {
  return !isGroupMsg(event)
}

/**
 * 异步延时函数
 *
 * @param {number} ms 等待毫秒数
 * @return {Promise<void>}
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FormatOptions {
  locale?: string
  timeZone?: string
}

/**
 * 获取今天的固定日期字符串，可用来作为「稳定随机」的参数，用于签到、每日任务等场景
 *
 * 格式： 2024/12/12，可选控制时区，默认为 'Asia/Shanghai' （亚洲/上海 时区）
 *
 * @param timeZone 指定的时区，默认为 'Asia/Shanghai'
 * @returns 返回当前日期的字符串格式
 */
export function localeDate(ts: number | string | Date = Date.now(), options: FormatOptions = {}): string {
  const { locale = 'zh-CN', timeZone = 'Asia/Shanghai' } = options
  const today = ts instanceof Date ? ts : new Date(ts)

  const formatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  })

  return formatter.format(today)
}

/**
 * 获取当前时间的固定时间字符串
 */
export function localeTime(
  ts: number | string | Date = Date.now(),
  options: FormatOptions & { seconds?: boolean } = {},
): string {
  const { locale = 'zh-CN', timeZone = 'Asia/Shanghai', seconds = true } = options
  const now = ts instanceof Date ? ts : new Date(ts)

  const formatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    timeZone,
  })

  return formatter.format(now)
}

/**
 * 生成指定范围（min ～ max）内的随机整数
 *
 * 额外支持「稳定随机」，继续传入额外参数即可，如果额外参数相同（忽略顺序），则生成的随机数相同
 */
export function randomInt(min: number, max: number, ...hashArgs: any[]): number {
  if (min > max) throw new Error('min must be less than or equal to max')

  if (hashArgs.length === 0) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  const sortedArgs = hashArgs.slice().sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return JSON.stringify(a).localeCompare(JSON.stringify(b))
  })

  const hash = md5(JSON.stringify(sortedArgs))
  const hashValue = Number.parseInt(hash.slice(0, 8), 16)

  const range = max - min + 1
  return (((hashValue % range) + range) % range) + min
}

/**
 * 取数组内随机一项
 *
 * 额外支持「稳定随机」，继续传入额外参数即可，如果额外参数相同（忽略顺序），则生成的随机项
 */
export function randomItem<T = any>(array: readonly T[], ...hashArgs: any[]): T {
  if (!Array.isArray(array) || !array.length) throw new Error('randomItem: 参数必须是数组，且不能为空')
  return array[randomInt(0, array.length - 1, ...hashArgs)]
}

/**
 * 从数组中随机选出指定数量的项（不重复）
 *
 * 额外支持「稳定随机」，继续传入额外参数即可，如果额外参数相同（忽略顺序），则生成的随机项相同
 *
 * @param array 源数组
 * @param count 要选择的项数量
 * @param hashArgs 稳定随机的额外参数
 * @returns 随机选出的项组成的数组
 */
export function randomItems<T = any>(array: readonly T[], count: number, ...hashArgs: any[]): T[] {
  if (!Array.isArray(array) || !array.length) throw new Error('randomItems: 参数必须是数组，且不能为空')
  if (count < 0) throw new Error('randomItems: count 必须为非负整数')
  if (count === 0) return []
  if (count > array.length) throw new Error(`randomItems: 要选择的数量 (${count}) 超过了数组长度 (${array.length})`)
  if (count === array.length) return [...array]

  const indices = Array.from({ length: array.length }, (_, i) => i)
  const selected: number[] = []

  for (let i = 0; i < count; i++) {
    const remainingCount = indices.length - i
    const randomIdx = randomInt(0, remainingCount - 1, ...hashArgs, `select_${i}`)
    selected.push(indices[randomIdx])
    const lastIdx = indices.length - 1 - i
    ;[indices[randomIdx], indices[lastIdx]] = [indices[lastIdx], indices[randomIdx]]
  }

  const hasString = array.some(isString)
  const items = selected.map((idx) => array[idx])

  return hasString ? items.sort((p, n) => (isString(p) && isString(n) ? p.localeCompare(n) : 0)) : items
}

/**
 * 包含大写字母与数字的 6 位随机 ID 生成器
 */
export function randomId(): string {
  return Math.random().toString(16).slice(2, 8).toUpperCase()
}

/**
 * 简单生成符合 UUID 规范的字符串，但不保证唯一性
 */
export function uuid() {
  return `${randStr(8)}-${randStr(4)}-${randStr(4)}-${randStr(4)}-${randStr(12)}`

  function randStr(length = 4) {
    return Math.random()
      .toString(16)
      .substring(2, length + 2)
  }
}

/**
 * clamp 操作，限制数值在指定范围内
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 排除 null 和 undefined
 */
export function noNullish<T>(val: T | null): val is T {
  return val !== null && val !== undefined
}

/**
 * 判断是否定义
 */
export function isDefined<T = unknown>(val?: T): val is T {
  return typeof val !== 'undefined'
}

/**
 * 通过消息事件生成唯一 id
 */
export function toMsgId(event: { seq: number; rand: number }) {
  return `${event.seq}_${event.rand}`
}

/**
 * 判断是否为函数
 */
export function isFunction<T extends AnyFunc>(val: unknown): val is T {
  return typeof val === 'function'
}

/**
 * 判断是否为数字
 */
export function isNumber(val: unknown): val is number {
  return typeof val === 'number'
}

/**
 * 判断是否为布尔值
 */
export function isBoolean(val: unknown): val is boolean {
  return typeof val === 'boolean'
}

/**
 * 判断是否为字符串
 */
export function isString(val: unknown): val is string {
  return typeof val === 'string'
}

/**
 * 判断是否为对象
 */
export function isObject(val: unknown): val is object {
  return Object.prototype.toString.call(val) === '[object Object]'
}

/**
 * 将数字转换为本地化数字字符串
 */
export function localNum(num: number, locale = 'zh-CN'): string {
  return num.toLocaleString(locale)
}

/**
 * 通过 QQ 号获取任意头像链接
 *
 * size 可选： 0 | 40 | 100 | 160 | 640，0 为原图
 */
export function getQQAvatarLink(qq: number, size = 640) {
  return `https://q.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=${size}`
}

/**
 * 通过群号获取任意群头像链接
 *
 * size 可选： 40 | 100 | 640，0 为原图
 */
export function getGroupAvatarLink(group: number, size = 640) {
  // return `https://p.qlogo.cn/gh/${group}/${group}/${size}`
  return `https://p.qlogo.cn/gh/111111/${group}/${size}`
}

const messageCacheMap = new Map<string, GroupMessageEvent | PrivateMessageEvent | 'loading' | null>()

/** 获取引用回复的消息 */
export async function getQuoteMsg(
  event: MessageEvent,
  timeout = 3_000,
): Promise<GroupMessageEvent | PrivateMessageEvent | null> {
  if (!event.quote_id) return null

  const quote_id = event.quote_id

  // 生成唯一 key
  const key = isGroupMsg(event) ? `${event.group_id}_${quote_id}` : `${event.sender.user_id}_${quote_id}`
  const cacheMsg = messageCacheMap.get(key)
  // 是否正在获取
  const isFetching = cacheMsg === 'loading'
  // 是否获取结束（已经获取过）
  const isFetchDone = cacheMsg !== undefined && !isFetching
  // 如果已经获取过，直接返回
  if (isFetchDone) return cacheMsg
  // 如果正在获取，等待获取完成
  if (isFetching) {
    const start = Date.now()
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const cacheMsg = messageCacheMap.get(key)
        const isFetching = cacheMsg === 'loading'
        const isFetchDone = cacheMsg !== undefined && !isFetching
        if (isFetchDone) {
          clearInterval(timer)
          resolve(cacheMsg)
        } else if (Date.now() - start > timeout) {
          clearInterval(timer)
          throw new Error(`获取引用消息超时 ${timeout}, Key: ${key}`)
        }
      }, 100)
    })
  }

  // 开始获取
  messageCacheMap.set(key, 'loading')

  const msg = await event.getQuoteMsg()

  // 如果缓存达到阈值则清空
  if (messageCacheMap.size > 100) messageCacheMap.clear()

  messageCacheMap.set(key, msg)

  return msg
}

/**
 * 获取原创表情包的图片链接
 */
export async function getBfaceUrl(file: string): Promise<string | null> {
  const id = file.slice(0, 2)
  const hash = file.slice(0, 32)
  const formats = ['raw300.gif', 'raw200.gif', 'raw100.gif', '300x300.png', '200x200.png', '100x100.png']

  for (const f of formats) {
    const url = `https://gxh.vip.qq.com/club/item/parcel/item/${id}/${hash}/${f}`
    const res = await fetch(url, { method: 'HEAD' })
    if (res.status === 200) return url
  }

  return null
}

/**
 * 获取消息中的图片链接
 */
export async function getImageUrl(event: HasMessage): Promise<string> {
  return find(event, 'image')?.url || ''
}

/**
 * 获取引用回复的消息中的图片链接
 */
export async function getQuoteImageUrl(event: MessageEvent): Promise<string> {
  const quoteMsg = await getQuoteMsg(event)
  if (!quoteMsg) return ''
  return await getImageUrl(quoteMsg)
}

/**
 * 获取消息提及的图片链接（消息或者引用消息）
 */
export async function getMentionedImageUrl(event: MessageEvent): Promise<string> {
  return (await getImageUrl(event)) || (await getQuoteImageUrl(event))
}

/**
 * 获取消息中的图片元素
 */
export function getImage(event: HasMessage): RecvImageElement | null {
  return find(Array.isArray(event) ? event : event.message, 'image') || null
}

/**
 * 获取引用回复的图片消息
 */
export async function getQuoteImage(event: MessageEvent): Promise<RecvImageElement | null> {
  const quoteMsg = await getQuoteMsg(event)
  if (quoteMsg) {
    return find(quoteMsg.message, 'image') || null
  }
  return null
}

/**
 * 获取消息提及的图片（消息或者引用消息）
 */
export async function getMentionedImage(event: MessageEvent): Promise<RecvImageElement | null> {
  return getImage(event) || (await getQuoteImage(event))
}

/**
 * 获取消息中的文本内容，默认采取 'whole' 模式，去除整体的首尾空格，可选 'each' 模式，去除每个文本的首尾空格
 *
 * 如: whole 模式下 => '  123    [表情] 456  ' => '123     456'
 * 如: each 模式下 => '  123    [表情] 456  ' => '123456'
 */
export function text(
  event: HasMessage,
  options: {
    trim?: boolean | 'whole' | 'each'
  } = {},
): string {
  const { trim = true } = options
  const messages = Array.isArray(event) ? event : event.message
  const textMessages = messages.filter((msg): msg is { type: 'text'; text: string } => msg.type === 'text')
  const texts = textMessages.map((msg) => msg.text)

  let result: string

  if (trim === 'whole') {
    result = texts.join('').trim()
  } else if (trim === 'each') {
    result = texts.map((t) => t.trim()).join('')
  } else if (trim === true) {
    // 默认为 true, 也就是整体去除首尾空格
    result = texts.map((t) => t.trim()).join('')
  } else {
    result = texts.join('')
  }

  return result || ''
}

/**
 * 获取回复的消息中的文本内容
 */
export async function getQuoteText(event: MessageEvent): Promise<string> {
  const msg = await getQuoteMsg(event)
  if (!msg) return ''
  return text(msg)
}

/**
 * 获取提到的用户 QQ 号，可以通过 if(!qq) 判断是否提到了用户，返回 0 代表没有提到用户
 */
export async function getMentionedUserId(event: MessageEvent): Promise<number | 0> {
  const quoteId = (await getQuoteMsg(event))?.sender.user_id || 0
  const msgAtId = +(find(event.message, 'at')?.qq || 0)
  return Number.isNaN(msgAtId) || !msgAtId ? quoteId : msgAtId
}

/**
 * 获取 **一个** 指定类型的消息元素，如获取图片、表情等，如果没有则返回 undefined
 */
export function find<
  Type extends Pick<RecvElement, 'type'>['type'],
  TargetType extends Extract<RecvElement, { type: Type }> = Extract<RecvElement, { type: Type }>,
>(event: HasMessage, type: Type): TargetType | undefined {
  const messages = Array.isArray(event) ? event : event.message
  return messages.find((msg): msg is TargetType => msg.type === type)
}

/**
 * 获取 **所有** 指定类型的消息元素，如获取图片、表情等，如果没有则返回 []
 */
export function filter<
  Type extends Pick<RecvElement, 'type'>['type'],
  TargetType extends Extract<RecvElement, { type: Type }> = Extract<RecvElement, { type: Type }>,
>(event: HasMessage, type: Type): TargetType[] {
  const messages = Array.isArray(event) ? event : event.message
  return messages.filter((msg): msg is TargetType => msg.type === type)
}

/**
 * 错误信息字符串格式化
 *
 * @param {any} error 待处理错误
 * @return {string} stringify 结果
 */
export function stringifyError(error: any): string {
  if (error && typeof error === 'object') {
    const errorType = error.constructor?.name ?? '未知错误'
    const errorMessage = error.message ?? '[无报错信息]'
    return `${errorType}: ${errorMessage}`
  }

  return String(error)
}

/**
 * Encodes string | number | buffer using base64.
 */
export function base64Encode(str: string | number | Buffer): string {
  return Buffer.from(str.toString()).toString('base64')
}

/**
 * Decodes the string from base64 to UTF-8.
 *
 * @param {string} str - The base64-encoded string.
 */
export function base64Decode(str: string, type: 'buffer' | BufferEncoding = 'utf8'): string | Buffer {
  if (type === 'buffer') return Buffer.from(str, 'base64')
  return Buffer.from(str, 'base64').toString(type)
}

/**
 * JS 对象转换成 `urlencoded` 格式字符串 { name: 'Bob', age: 18 } => name=Bob&age=18
 *
 * @param {Record<number | string, any>} obj JS 对象
 * @return {string} 转换后的字符串
 */
export function qs(obj: Record<number | string, any>): string {
  return new URLSearchParams(obj).toString()
}

/**
 * 格式化展示 QQ 等级
 */
export function formatQQLevel(level: number): string {
  return (
    '👑'.repeat(Math.floor(level / 64)) +
    '☀️'.repeat(Math.floor((level % 64) / 16)) +
    '🌙'.repeat(Math.floor((level % 16) / 4)) +
    '⭐️'.repeat(level % 4)
  )
}

/**
 * 申请通过开发者工具登录，以获取 Cookie
 */
export async function requestLoginViaDevTools(): Promise<{ code: string; url: string }> {
  const code = await getDevToolsLoginCode()

  return {
    code: code,
    url: `https://h5.qzone.qq.com/qqq/code/${code}?_proxy=1&from=ide`,
  }

  /**
   * 获取开发者工具登录码
   */
  async function getDevToolsLoginCode(): Promise<string> {
    const response = await fetch('https://q.qq.com/ide/devtoolAuth/GetLoginCode', {
      method: 'GET',
      headers: {
        qua: 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D',
        host: 'q.qq.com',
        accept: 'application/json',
        'content-type': 'application/json',
      },
    })

    if (!response.ok) return ''
    const { code, data } = await response.json()
    if (+code !== 0) return ''
    return data.code ?? ''
  }
}

/**
 * 获取开发者工具登录结果
 */
export async function queryDevToolsLoginStatus(code: string): Promise<{
  status: 'OK' | 'Wait' | 'Expired' | 'Used' | 'Error'
  ticket?: string
}> {
  const response = await fetch(`https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket?code=${code}`, {
    method: 'GET',
    headers: {
      qua: 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D',
      host: 'q.qq.com',
      accept: 'application/json',
      'content-type': 'application/json',
    },
  })

  if (!response.ok) return { status: 'Error' }

  // OK: { "code": 0, "data": { "code": "xxx", "ticket": "xxx", "ok": 1, "uin": "xxx" }, "message": "" }
  // Wait: { "code": 0, "data": { "code": "xxx" }, "message": "" }
  // Expired: { "code": 0, "data": { "code": "xxx" }, "message": "" }
  // Used: { "code": "-10003", "message": "process fail" }

  const { code: resCode, data } = await response.json()

  if (+resCode === 0) {
    if (+data.ok !== 1) return { status: 'Wait' }

    return {
      status: 'OK',
      ticket: data.ticket,
    }
  }

  if (+resCode === -10003) return { status: 'Used' }

  return { status: 'Error' }
}

/**
 * 通过开发者工具登录获取 AuthCode
 */
export async function getAuthCodeViaTicket(ticket: string, appid: number): Promise<string> {
  const response = await fetch('https://q.qq.com/ide/login', {
    method: 'POST',
    headers: {
      qua: 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D',
      host: 'q.qq.com',
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ appid, ticket }),
  })

  if (!response.ok) return ''

  const { code } = await response.json()

  return code || ''
}

/**
 * 通过 Auth Code 获取 minico Token
 */
export async function getMinicoTokenViaAuthCode(authCode: string, appid: number): Promise<any> {
  const response = await fetch('https://minico.qq.com/minico/oauth20?uin=QQ%E5%AE%89%E5%85%A8%E4%B8%AD%E5%BF%83', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      appid,
      code: authCode,
      platform: 'qq',
    }),
  })

  if (!response.ok) return {}

  const { retcode, data } = await response.json()

  if (+retcode !== 0 || !data) return {}

  return data || {}
}

/**
 * 获取终端输入，返回 Promise，支持提示信息
 */
export async function getTerminalInput(inputTip = '请输入'): Promise<string> {
  return new Promise((resolve) => {
    if (inputTip) console.log(inputTip)

    function getInput() {
      process.stdin.once('data', async (e) => {
        const input = e.toString().trim()
        if (input) {
          resolve(input)
          return
        }
        getInput()
      })
    }
    getInput()
  })
}

/**
 * 当前 Node.js 进程的启动时间，常量，Date 类型
 */
export const START_TIME: Date = new Date()

/**
 * 计算 GTK 值
 */
export function getGTk(pskey: string): number {
  let gkt = 5381
  for (let i = 0, len = pskey.length; i < len; ++i) {
    gkt += (gkt << 5) + pskey.charCodeAt(i)
  }
  return gkt & 0x7fffffff
}
