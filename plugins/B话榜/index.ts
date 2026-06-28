import { definePlugin, getAbsPluginDir } from 'mioki'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { sharedBrowser, sharedQueues } from '../_shared/resource'
import { uploadBuffer } from '../_shared/upload'

import type { GroupMessageEvent } from 'napcat-sdk'

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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_NAME = 'B话榜'
const PLUGIN_VERSION = '1.1.0'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const pluginDir = join(getAbsPluginDir(), 'B话榜')
const configPath = join(pluginDir, 'config.json')
const dbPath = join(pluginDir, 'data.db')

type QueryKind = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'
type ReportMode = 'ranking' | 'king'

interface PluginConfig {
  enabled: boolean
  groupWhitelist: number[]
  nickname?: string[]
  backupEnabled?: boolean
  backupIntervalHours?: number
  r2?: {
    enabled?: boolean
    accountId?: string
    accessKeyId?: string
    secretAccessKey?: string
    bucketName?: string
    customDomain?: string
    pathPrefix?: string
  }
}

interface UserSnapshot {
  nickname: string
  card: string
  lastSeenAt: number
}

interface DateRange {
  title: string
  startKey: string
  endKey: string
  label: string
}

interface RankingItem {
  userId: number
  displayName: string
  count: number
  percent: string
  rank: number
  lastSeenAt: number
  avatarUrl: string
}

interface ReportData {
  mode: ReportMode
  title: string
  groupName: string
  periodLabel: string
  total: number
  activeUsers: number
  items: RankingItem[]
  winners: RankingItem[]
  emptyText: string
}

interface KingCardData {
  groupName: string
  periodLabel: string
  title: string
  winner: RankingItem | null
  total: number
  activeUsers: number
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getLocalDate(date = new Date()) {
  const local = new Date(date.getTime() + SHANGHAI_OFFSET_MS)

  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    weekday: local.getUTCDay(),
  }
}

function dateKeyFromDate(date = new Date()): string {
  const local = getLocalDate(date)
  return `${local.year}-${pad2(local.month)}-${pad2(local.day)}`
}

function dateKeyFromLocalParts(year: number, month: number, day: number): string {
  return dateKeyFromDate(new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS))
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return { year, month, day }
}

function localStartMs(key: string): number {
  const { year, month, day } = parseDateKey(key)
  return Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS
}

function addDays(key: string, days: number): string {
  return dateKeyFromDate(new Date(localStartMs(key) + days * DAY_MS))
}

function formatDateKey(key: string): string {
  const { year, month, day } = parseDateKey(key)
  return `${year}.${pad2(month)}.${pad2(day)}`
}

function formatRangeLabel(startKey: string, endKey: string): string {
  if (startKey === endKey) return `${formatDateKey(startKey)} 00:00 - 23:59`
  return `${formatDateKey(startKey)} 00:00 - ${formatDateKey(endKey)} 23:59`
}

function formatTime(date = new Date()): string {
  const local = getLocalDate(date)
  return `${pad2(local.hour)}:${pad2(local.minute)}`
}

function formatLiveRangeLabel(startKey: string, endDate = new Date()): string {
  const endKey = dateKeyFromDate(endDate)
  if (startKey === endKey) return `${formatDateKey(startKey)} 00:00 - ${formatTime(endDate)}`
  return `${formatDateKey(startKey)} 00:00 - ${formatDateKey(endKey)} ${formatTime(endDate)}`
}

function getDateRange(kind: QueryKind, baseDate = new Date()): DateRange {
  const today = dateKeyFromDate(baseDate)
  const local = getLocalDate(baseDate)
  const mondayOffset = (local.weekday + 6) % 7

  if (kind === 'today') {
    return {
      title: '今日 B话榜',
      startKey: today,
      endKey: today,
      label: formatLiveRangeLabel(today, baseDate),
    }
  }

  if (kind === 'yesterday') {
    const yesterday = addDays(today, -1)
    return {
      title: '昨日 B话榜',
      startKey: yesterday,
      endKey: yesterday,
      label: formatRangeLabel(yesterday, yesterday),
    }
  }

  if (kind === 'thisWeek' || kind === 'lastWeek') {
    const weekStart = addDays(today, -mondayOffset + (kind === 'lastWeek' ? -7 : 0))
    const weekEnd = addDays(weekStart, 6)
    return {
      title: kind === 'thisWeek' ? '本周 B话榜' : '上周 B话榜',
      startKey: weekStart,
      endKey: weekEnd,
      label: kind === 'thisWeek' ? formatLiveRangeLabel(weekStart, baseDate) : formatRangeLabel(weekStart, weekEnd),
    }
  }

  const monthOffset = kind === 'lastMonth' ? -1 : 0
  const monthStart = dateKeyFromLocalParts(local.year, local.month + monthOffset, 1)
  const nextMonthStart = dateKeyFromLocalParts(local.year, local.month + monthOffset + 1, 1)
  const monthEnd = addDays(nextMonthStart, -1)

  return {
    title: kind === 'thisMonth' ? '本月 B话榜' : '上月 B话榜',
    startKey: monthStart,
    endKey: monthEnd,
    label: kind === 'thisMonth' ? formatLiveRangeLabel(monthStart, baseDate) : formatRangeLabel(monthStart, monthEnd),
  }
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, '').toLowerCase()
}

function parseQueryCommand(text: string): QueryKind | null {
  const normalized = normalizeText(text)
  const commandMap: Record<string, QueryKind> = {
    b话榜: 'thisWeek',
    比话榜: 'thisWeek',
    今日b话榜: 'today',
    昨日b话榜: 'yesterday',
    本周b话榜: 'thisWeek',
    上周b话榜: 'lastWeek',
    本月b话榜: 'thisMonth',
    上月b话榜: 'lastMonth',
  }

  return commandMap[normalized] || null
}

function parseKingCommand(text: string): QueryKind | null {
  const normalized = normalizeText(text)
  const commandMap: Record<string, QueryKind> = {
    b话王: 'thisWeek',
    今日b话王: 'today',
    昨日b话王: 'yesterday',
    本周b话王: 'thisWeek',
    上周b话王: 'lastWeek',
    本月b话王: 'thisMonth',
    上月b话王: 'lastMonth',
  }

  return commandMap[normalized] || null
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeDisplayText(value: string): string {
  return value.normalize('NFKC')
}

// 规范化配置加载
function loadConfig(ctx: any): PluginConfig {
  const defaultConfig: PluginConfig = {
    enabled: true,
    groupWhitelist: [],
    nickname: [],
    backupEnabled: true,
    backupIntervalHours: 6,
    r2: {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucketName: '',
      customDomain: '',
      pathPrefix: 'QBot/backup/'
    }
  }

  if (!existsSync(configPath)) return defaultConfig

  try {
    const data = JSON.parse(readFileSync(configPath, 'utf-8')) as PluginConfig
    return {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      groupWhitelist: Array.isArray(data.groupWhitelist) ? data.groupWhitelist.filter((id) => Number.isFinite(id)) : [],
      nickname: Array.isArray(data.nickname) ? data.nickname : [],
      backupEnabled: typeof data.backupEnabled === 'boolean' ? data.backupEnabled : defaultConfig.backupEnabled,
      backupIntervalHours: typeof data.backupIntervalHours === 'number' && data.backupIntervalHours > 0 ? data.backupIntervalHours : defaultConfig.backupIntervalHours,
      r2: data.r2 ? {
        enabled: typeof data.r2.enabled === 'boolean' ? data.r2.enabled : defaultConfig.r2!.enabled,
        accountId: typeof data.r2.accountId === 'string' ? data.r2.accountId : defaultConfig.r2!.accountId,
        accessKeyId: typeof data.r2.accessKeyId === 'string' ? data.r2.accessKeyId : defaultConfig.r2!.accessKeyId,
        secretAccessKey: typeof data.r2.secretAccessKey === 'string' ? data.r2.secretAccessKey : defaultConfig.r2!.secretAccessKey,
        bucketName: typeof data.r2.bucketName === 'string' ? data.r2.bucketName : defaultConfig.r2!.bucketName,
        customDomain: typeof data.r2.customDomain === 'string' ? data.r2.customDomain : defaultConfig.r2!.customDomain,
        pathPrefix: typeof data.r2.pathPrefix === 'string' ? data.r2.pathPrefix : defaultConfig.r2!.pathPrefix
      } : defaultConfig.r2
    }
  } catch {
    return defaultConfig
  }
}

function saveConfig(data: PluginConfig): void {
  writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function getWhitelistGroupName(config: PluginConfig, groupId: number): string {
  const index = config.groupWhitelist.indexOf(groupId)
  return index >= 0 ? config.nickname?.[index] || '' : ''
}

function isGroupEnabled(config: PluginConfig, groupId: number): boolean {
  return config.enabled && config.groupWhitelist.includes(groupId)
}

function getAvatarUrl(userId: number): string {
  return `http://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640&img_type=jpg`
}

function getDisplayName(userId: number, snapshot?: Partial<UserSnapshot>): string {
  return normalizeDisplayText(snapshot?.card || snapshot?.nickname || String(userId))
}

// 初始化 SQLite 数据库与建表建索引，包含从 data.json 的数据自动迁移
function initDb(ctx: any): DatabaseSync {
  const db = new DatabaseSync(dbPath)

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_names (
      group_id INTEGER PRIMARY KEY,
      group_name TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS group_users (
      group_id INTEGER,
      user_id INTEGER,
      nickname TEXT,
      card TEXT,
      last_seen_at INTEGER,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_msg_stats (
      group_id INTEGER,
      user_id INTEGER,
      date TEXT,
      count INTEGER DEFAULT 0,
      nickname TEXT,
      card TEXT,
      last_seen_at INTEGER,
      PRIMARY KEY (group_id, user_id, date)
    );
  `)

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_group_msg_stats_date ON group_msg_stats (group_id, date);
  `)

  return db
}

function createMessageRecorder(db: DatabaseSync) {
  const updateGroup = db.prepare(`
    INSERT OR REPLACE INTO group_names (group_id, group_name, updated_at)
    VALUES (?, ?, ?)
  `)

  const updateUser = db.prepare(`
    INSERT INTO group_users (group_id, user_id, nickname, card, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE nickname END,
      card = CASE WHEN excluded.card <> '' THEN excluded.card ELSE card END,
      last_seen_at = excluded.last_seen_at
  `)

  const updateMsg = db.prepare(`
    INSERT INTO group_msg_stats (group_id, user_id, date, count, nickname, card, last_seen_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(group_id, user_id, date) DO UPDATE SET
      count = count + 1,
      nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE nickname END,
      card = CASE WHEN excluded.card <> '' THEN excluded.card ELSE card END,
      last_seen_at = excluded.last_seen_at
  `)

  return {
    record(event: GroupMessageEvent): void {
      const groupId = event.group_id
      const userId = event.user_id
      const eventTime = (event.time || Math.floor(Date.now() / 1000)) * 1000
      const dayKey = dateKeyFromDate(new Date(eventTime))
      const nickname = event.sender?.nickname || ''
      const card = event.sender?.card || ''
      const groupName = event.group_name || ''

      let inTransaction = false
      try {
        db.exec('BEGIN IMMEDIATE')
        inTransaction = true
        updateGroup.run(groupId, groupName, Date.now())
        updateUser.run(groupId, userId, nickname, card, eventTime)
        updateMsg.run(groupId, userId, dayKey, nickname, card, eventTime)
        db.exec('COMMIT')
      } catch (err) {
        if (inTransaction) {
          try {
            db.exec('ROLLBACK')
          } catch {}
        }
        throw err
      }
    },
  }
}

function buildReport(
  db: DatabaseSync,
  config: PluginConfig,
  groupId: number,
  fallbackGroupName: string,
  range: DateRange,
  mode: ReportMode,
  title = range.title,
): ReportData {
  // 获取群名称
  const getGroupNameStmt = db.prepare('SELECT group_name FROM group_names WHERE group_id = ?')
  const nameRow = getGroupNameStmt.get(groupId) as { group_name: string } | undefined
  const groupName =
    fallbackGroupName || nameRow?.group_name || getWhitelistGroupName(config, groupId) || String(groupId)

  // 获取发言总条数
  const totalStmt = db.prepare(`
    SELECT SUM(count) as total
    FROM group_msg_stats
    WHERE group_id = ? AND date >= ? AND date <= ?
  `)
  const totalRow = totalStmt.get(groupId, range.startKey, range.endKey) as { total: number | null } | undefined
  const total = totalRow?.total || 0

  // 聚合查询成员发言统计并排序
  const queryStmt = db.prepare(`
    SELECT 
      s.user_id,
      SUM(s.count) as count,
      MAX(s.last_seen_at) as last_seen_at,
      u.nickname,
      u.card
    FROM group_msg_stats s
    LEFT JOIN group_users u ON s.group_id = u.group_id AND s.user_id = u.user_id
    WHERE s.group_id = ? AND s.date >= ? AND s.date <= ?
    GROUP BY s.user_id
    ORDER BY count DESC, last_seen_at ASC, s.user_id ASC
  `)
  const rows = queryStmt.all(groupId, range.startKey, range.endKey) as {
    user_id: number
    count: number
    last_seen_at: number
    nickname: string | null
    card: string | null
  }[]

  const sorted = rows.map((item) => {
    const userId = item.user_id
    const displayName = getDisplayName(userId, {
      nickname: item.nickname || '',
      card: item.card || '',
    })

    return {
      userId,
      displayName,
      count: item.count,
      percent: total > 0 ? `${((item.count / total) * 100).toFixed(1)}%` : '0%',
      rank: 0,
      lastSeenAt: item.last_seen_at,
      avatarUrl: getAvatarUrl(userId),
    }
  })

  let lastCount = -1
  let lastRank = 0
  sorted.forEach((item, index) => {
    if (item.count !== lastCount) {
      lastRank = index + 1
      lastCount = item.count
    }
    item.rank = lastRank
  })

  const topCount = sorted[0]?.count || 0
  const winners = topCount > 0 ? sorted.filter((item) => item.count === topCount) : []

  return {
    mode,
    title,
    groupName,
    periodLabel: range.label,
    total,
    activeUsers: sorted.length,
    items: sorted,
    winners,
    emptyText: mode === 'king' ? '昨日暂无发言记录' : '当前时间段暂无发言记录',
  }
}

function buildKingCardData(
  db: DatabaseSync,
  config: PluginConfig,
  groupId: number,
  fallbackGroupName: string,
  range: DateRange,
  title = 'B话王',
): KingCardData {
  const report = buildReport(db, config, groupId, fallbackGroupName, range, 'king', title)
  const winner = report.winners.length > 0 ? report.winners[0] : null
  return {
    groupName: report.groupName,
    periodLabel: report.periodLabel,
    title,
    winner,
    total: report.total,
    activeUsers: report.activeUsers,
  }
}

function renderAvatar(item: RankingItem, sizeClass = 'avatar'): string {
  const initial = escapeHtml(Array.from(item.displayName)[0] || '?')

  return `
    <div class="${sizeClass}">
      <div class="avatar-fallback">${initial}</div>
      <img src="${escapeHtml(item.avatarUrl)}" onerror="this.style.display='none'" />
    </div>
  `
}

function renderReportHtml(report: ReportData): string {
  const displayTitle = report.title
  const summaryText = report.items.length
    ? `${report.title} / 共 ${report.activeUsers.toLocaleString('zh-CN')} 位群友，累计 ${report.total.toLocaleString('zh-CN')} 条 B话`
    : report.emptyText

  const rows = report.items
    .map(
      (item) => `
        <div class="rank-row ${item.rank <= 3 ? `top-card-${item.rank}` : ''}">
          ${renderAvatar(item)}
          <div class="user-main">
            <div class="user-name">第 ${item.rank} 名 - ${escapeHtml(item.displayName)}</div>
            <div class="user-count">B话: ${item.count.toLocaleString('zh-CN')} 条</div>
          </div>
        </div>
      `,
    )
    .join('')

  const body = report.items.length
    ? `<section class="list">${rows}</section>`
    : `<section class="list"><div class="empty">${escapeHtml(report.emptyText)}</div></section>`

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #f8efcf;
      color: #68545b;
      font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", "Noto Sans Math", "Cambria Math", "Segoe UI Symbol", sans-serif;
    }
    .card {
      width: 430px;
      overflow: hidden;
      background: #f8efcf;
      padding: 34px 26px 30px;
    }
    .header {
      padding: 0 0 18px;
      text-align: center;
    }
    .title {
      font-size: 34px;
      line-height: 1;
      font-weight: 900;
      color: #b87314;
      letter-spacing: 0;
      text-shadow: 0 3px 0 rgba(171, 105, 15, .08);
    }
    .group-name {
      margin-top: 10px;
      font-size: 12px;
      line-height: 1.5;
      color: #c7a37a;
      font-weight: 800;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .period {
      margin-top: 8px;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 800;
      color: #ddc59b;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rank-row {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-height: 56px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #f2f2ef;
      border: 1px solid rgba(210, 198, 173, .42);
      box-shadow: 0 2px 5px rgba(119, 94, 49, .09);
    }
    .rank-row.top-card-1 { background: #fff1a7; }
    .rank-row.top-card-2 { background: #eadcf7; }
    .rank-row.top-card-3 { background: #d9e8f5; }
    .avatar {
      position: relative;
      width: 36px;
      height: 36px;
      overflow: hidden;
      border-radius: 50%;
      background: #caa56f;
      color: #fff;
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
      font-size: 15px;
      font-weight: 800;
    }
    .user-name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 15px;
      line-height: 1.15;
      font-weight: 900;
      color: #75636d;
      font-style: italic;
    }
    .top-card-1 .user-name { color: #ad7a09; }
    .top-card-2 .user-name { color: #7d58b0; }
    .top-card-3 .user-name { color: #3f7796; }
    .user-count {
      margin-top: 4px;
      font-size: 11px;
      line-height: 1;
      font-weight: 900;
      color: #82706c;
    }
    .empty {
      padding: 34px 20px;
      border-radius: 8px;
      background: #f2f2ef;
      text-align: center;
      font-size: 15px;
      font-weight: 900;
      color: #9b846d;
    }
  </style>
</head>
<body>
  <main class="card">
    <header class="header">
      <div class="title">${escapeHtml(displayTitle)}</div>
      <div class="period">${escapeHtml(report.periodLabel)}</div>
      <div class="group-name">${escapeHtml(report.groupName)}</div>
      <div class="period">${escapeHtml(summaryText)}</div>
    </header>
    ${body}
  </main>
</body>
</html>
  `
}

async function renderReportImage(report: ReportData): Promise<Buffer> {
  return sharedBrowser.withPage(
    async (page) => {
      await page.setContent(renderReportHtml(report), { waitUntil: 'networkidle2', timeout: 20_000 })

      const target = await page.$('.card')
      const image = await (target || page).screenshot({
        type: 'png',
        encoding: 'binary',
      })

      return Buffer.from(image)
    },
    {
      label: `${PLUGIN_NAME} 榜单渲染`,
      timeoutMs: 45_000,
      viewport: { width: 430, height: 1800, deviceScaleFactor: 2 },
    },
  )
}

function renderKingCardHtml(card: KingCardData): string {
  const winner = card.winner
  const avatarUrl = winner ? escapeHtml(winner.avatarUrl) : ''
  const displayName = winner ? escapeHtml(winner.displayName) : '暂无'
  const count = winner ? winner.count.toLocaleString('zh-CN') : '0'
  const initial = winner ? escapeHtml(Array.from(winner.displayName)[0] || '?') : '?'

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      margin: 0;
      padding: 0;
      font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", sans-serif;
    }
    .card {
      width: 400px;
      padding: 40px 30px 36px;
      background: linear-gradient(135deg, #d42c2c 0%, #b71c1c 30%, #c62828 50%, #e65100 80%, #f57c00 100%);
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: -60px;
      right: -60px;
      width: 200px;
      height: 200px;
      background: radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%);
      border-radius: 50%;
    }
    .card::after {
      content: '';
      position: absolute;
      bottom: -40px;
      left: -40px;
      width: 160px;
      height: 160px;
      background: radial-gradient(circle, rgba(255,215,0,0.2) 0%, transparent 70%);
      border-radius: 50%;
    }
    .crown {
      font-size: 52px;
      line-height: 1;
      margin-bottom: 6px;
      filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3));
    }
    .title {
      font-size: 46px;
      font-weight: 900;
      color: #ffd700;
      text-shadow: 0 3px 0 #b8860b, 0 5px 12px rgba(0,0,0,0.4);
      letter-spacing: 8px;
      margin-bottom: 20px;
    }
    .avatar-ring {
      width: 130px;
      height: 130px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ffd700, #ffab00, #ffd700);
      padding: 5px;
      margin: 0 auto 16px;
      box-shadow: 0 0 0 4px rgba(255,215,0,0.3), 0 6px 20px rgba(0,0,0,0.4);
    }
    .avatar-inner {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      overflow: hidden;
      background: #c62828;
      position: relative;
    }
    .avatar-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 50px;
      font-weight: 900;
      color: #ffd700;
    }
    .avatar-inner img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .winner-name {
      font-size: 28px;
      font-weight: 900;
      color: #fff;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
      margin-bottom: 8px;
      max-width: 100%;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .winner-count {
      font-size: 36px;
      font-weight: 900;
      color: #ffd700;
      text-shadow: 0 2px 0 #b8860b, 0 4px 8px rgba(0,0,0,0.3);
      margin-bottom: 4px;
    }
    .winner-count-label {
      font-size: 14px;
      font-weight: 800;
      color: rgba(255,255,255,0.8);
      margin-bottom: 18px;
    }
    .footer {
      padding-top: 16px;
      border-top: 1px solid rgba(255,215,0,0.3);
    }
    .group-name {
      font-size: 13px;
      font-weight: 800;
      color: rgba(255,255,255,0.7);
      margin-bottom: 4px;
      max-width: 100%;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .period {
      font-size: 11px;
      font-weight: 800;
      color: rgba(255,255,255,0.5);
    }
    .no-winner {
      padding: 40px 0;
      font-size: 18px;
      font-weight: 900;
      color: rgba(255,255,255,0.6);
    }
    .sparkle {
      position: absolute;
      color: #ffd700;
      font-size: 18px;
      opacity: 0.6;
    }
    .sparkle-1 { top: 20px; left: 30px; }
    .sparkle-2 { top: 50px; right: 40px; }
    .sparkle-3 { bottom: 40px; left: 50px; }
    .sparkle-4 { bottom: 20px; right: 30px; }
  </style>
</head>
<body>
  <main class="card">
    <span class="sparkle sparkle-1">✦</span>
    <span class="sparkle sparkle-2">✦</span>
    <span class="sparkle sparkle-3">✦</span>
    <span class="sparkle sparkle-4">✦</span>
    <div class="crown">👑</div>
    <div class="title">B话王</div>
    ${
      winner
        ? `
      <div class="avatar-ring">
        <div class="avatar-inner">
          <div class="avatar-fallback">${initial}</div>
          <img src="${avatarUrl}" onerror="this.style.display='none'" />
        </div>
      </div>
      <div class="winner-name">${displayName}</div>
      <div class="winner-count">${count}</div>
      <div class="winner-count-label">条 B话</div>
    `
        : `
      <div class="no-winner">暂无发言记录</div>
    `
    }
    <div class="footer">
      <div class="group-name">${escapeHtml(card.groupName)}</div>
      <div class="period">${escapeHtml(card.periodLabel)}</div>
    </div>
  </main>
</body>
</html>
  `
}

async function renderKingCardImage(card: KingCardData): Promise<Buffer> {
  return sharedBrowser.withPage(
    async (page) => {
      await page.setContent(renderKingCardHtml(card), { waitUntil: 'networkidle2', timeout: 20_000 })

      const target = await page.$('.card')
      const image = await (target || page).screenshot({
        type: 'png',
        encoding: 'binary',
      })

      return Buffer.from(image)
    },
    {
      label: `${PLUGIN_NAME} B话王渲染`,
      timeoutMs: 45_000,
      viewport: { width: 400, height: 600, deviceScaleFactor: 2 },
    },
  )
}

function isAdminCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith('#b话榜')
}

function getAdminArgs(text: string): string[] {
  return text.trim().slice('#B话榜'.length).trim().split(/\s+/).filter(Boolean)
}

function formatWhitelistList(config: PluginConfig): string {
  if (!config.groupWhitelist.length) return '当前白名单为空'

  return config.groupWhitelist
    .map((groupId, index) => {
      const name = config.nickname?.[index]
      return name ? `${groupId} - ${name}` : String(groupId)
    })
    .join('\n')
}

function getTargetGroupId(args: string[], currentGroupId: number): number {
  const raw = args[2]
  const target = raw ? Number(raw) : currentGroupId
  return Number.isSafeInteger(target) && target > 0 ? target : 0
}

function isPluginAdmin(ctx: any, event: GroupMessageEvent): boolean {
  return ctx.isOwner(event) || ctx.isAdmin(event) || ['owner', 'admin'].includes(event.sender?.role)
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  dependencies: ['puppeteer-core'],
  async setup(ctx) {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const runHeavy = <T>(label: string, task: () => Promise<T>) =>
      sharedQueues.heavy.add(() => task(), { label, timeoutMs: 30 * 60_000 })

    // 1. 初始化 SQLite 数据库
    const db = initDb(ctx)
    const recorder = createMessageRecorder(db)

    // 2. 加载配置文件（旧 whitelist.json 自动向后兼容迁移）
    let config = loadConfig(ctx)

    // 自动备份数据库函数
    const backupDb = async () => {
      config = loadConfig(ctx)
      if (!config.backupEnabled) {
        ctx.logger.debug(`[${PLUGIN_NAME}] 自动备份已禁用。`)
        return
      }

      try {
        if (!existsSync(dbPath)) {
          ctx.logger.warn(`[${PLUGIN_NAME}] 数据库文件 ${dbPath} 不存在，取消备份。`)
          return
        }

        ctx.logger.info(`[${PLUGIN_NAME}] 开始自动备份数据库到 Cloudflare R2...`)
        const buffer = readFileSync(dbPath)

        const local = getLocalDate()
        const timeStr = `${local.year}${pad2(local.month)}${pad2(local.day)}_${pad2(local.hour)}${pad2(local.minute)}${pad2(local.second)}`
        const key = `backups/${PLUGIN_NAME}_data_${timeStr}.db`

        const backupUrl = await uploadBuffer(buffer, key, 'application/x-sqlite3', config.r2)
        ctx.logger.info(`[${PLUGIN_NAME}] 自动备份成功，已上传至: ${backupUrl}`)
      } catch (err: any) {
        if (err.message?.includes('未启用')) {
          ctx.logger.debug(`[${PLUGIN_NAME}] 自动备份跳过，原因: ${err.message}`)
        } else {
          ctx.logger.error(`[${PLUGIN_NAME}] 自动备份数据库失败: ${err.message}`)
        }
      }
    }

    // 3. 注册自动备份定时任务
    const backupInterval = config.backupIntervalHours || 6
    const backupCronExpr = backupInterval >= 24 ? '0 0 * * *' : `0 */${backupInterval} * * *`
    ctx.cron(backupCronExpr, async () => {
      await backupDb()
    })

    const replyImage = async (event: GroupMessageEvent, report: ReportData) => {
      const image = await renderReportImage(report)
      await event.reply(ctx.segment.image(image))
    }

    const handleAdminCommand = async (event: GroupMessageEvent, text: string): Promise<boolean> => {
      if (!isAdminCommand(text)) return false

      if (!isPluginAdmin(ctx, event)) {
        await event.reply('权限不足，仅机器人管理员或群管理员可用')
        return true
      }

      const args = getAdminArgs(text)
      const [main, op] = args

      if (!main || main === '帮助') {
        await event.reply(
          [
            '#B话榜 帮助',
            '#B话榜 备份',
            '#B话榜 白名单 列表',
            '#B话榜 白名单 添加 [群号]',
            '#B话榜 白名单 删除 [群号]'
          ].join('\n'),
        )
        return true
      }

      if (main === '备份') {
        await runWithReaction(event, async () => {
          try {
            await backupDb()
            await event.reply('✅ B话榜备份任务已触发，请查看控制台日志了解备份结果。')
          } catch (err: any) {
            await event.reply(`❌ 备份失败: ${err.message}`)
          }
        })
        return true
      }

      if (main !== '白名单') return true

      if (op === '列表') {
        await event.reply(formatWhitelistList(config))
        return true
      }

      const targetGroupId = getTargetGroupId(args, event.group_id)
      if (!targetGroupId) {
        await event.reply('请在群内使用或指定有效群号')
        return true
      }

      if (op === '添加') {
        if (config.groupWhitelist.includes(targetGroupId)) {
          await event.reply(`群 ${targetGroupId} 已在白名单中`)
          return true
        }

        let groupName = targetGroupId === event.group_id ? event.group_name : ''
        if (!groupName) {
          try {
            const info = await ctx.bot.getGroupInfo(targetGroupId)
            groupName = info?.group_name || ''
          } catch {}
        }

        config.groupWhitelist.push(targetGroupId)
        config.nickname = [...(config.nickname || []), groupName]
        saveConfig(config)
        await event.reply(`已将群 ${targetGroupId}${groupName ? `（${groupName}）` : ''} 加入白名单`)
        return true
      }

      if (op === '删除') {
        const index = config.groupWhitelist.indexOf(targetGroupId)
        if (index < 0) {
          await event.reply(`群 ${targetGroupId} 不在白名单中`)
          return true
        }

        config.groupWhitelist.splice(index, 1)
        config.nickname?.splice(index, 1)
        saveConfig(config)
        await event.reply(`已将群 ${targetGroupId} 移出白名单`)
        return true
      }

      await event.reply('未知白名单命令，请发送 #B话榜 帮助 查看用法')
      return true
    }

    ctx.handle('message.group', async (event) => {
      // 重新读取配置以防 WebUI 编辑后未更新缓存
      config = loadConfig(ctx)

      const text = ctx.text(event).trim()
      const enabledBeforeCommand = isGroupEnabled(config, event.group_id)
      const isSelfMessage = event.user_id === event.self_id || event.user_id === ctx.bot.user_id

      if (enabledBeforeCommand && !isSelfMessage) {
        try {
          recorder.record(event)
        } catch (err) {
          ctx.logger.warn(`[${PLUGIN_NAME}] 记录群消息失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      if (await handleAdminCommand(event, text)) return

      if (!enabledBeforeCommand) return

      const kingKind = parseKingCommand(text)
      if (kingKind) {
        await runWithReaction(event, async () => {
          try {
            const range = getDateRange(kingKind)
            const kingTitle = normalizeText(text) === 'b话王' ? '本周 B话王' : range.title.replace('B话榜', 'B话王')
            const kingCard = buildKingCardData(db, config, event.group_id, event.group_name, range, kingTitle)
            const kingImage = await renderKingCardImage(kingCard)
            await event.reply(ctx.segment.image(kingImage))
          } catch (err) {
            ctx.logger.error(`[${PLUGIN_NAME}] 渲染B话王失败: ${err instanceof Error ? err.message : String(err)}`)
            await event.reply('B话王生成失败，请稍后再试')
          }
        })
        return
      }

      const queryKind = parseQueryCommand(text)
      if (!queryKind) return

      await runWithReaction(event, async () => {
        try {
          const range = getDateRange(queryKind)
          const report = buildReport(db, config, event.group_id, event.group_name, range, 'ranking')
          await replyImage(event, report)
        } catch (err) {
          ctx.logger.error(`[${PLUGIN_NAME}] 渲染榜单失败: ${err instanceof Error ? err.message : String(err)}`)
          await event.reply('B话榜生成失败，请稍后再试')
        }
      })
    })

    let weeklySending = false

    // 定时发送上周 B话榜/B话王
    ctx.cron('1 0 * * 1', async () => {
      if (weeklySending) {
        ctx.logger.warn(`[${PLUGIN_NAME}] 上一次自动群发仍在执行，本次跳过`)
        return
      }

      weeklySending = true

      try {
        await runHeavy(`${PLUGIN_NAME} 自动群发`, async () => {
          config = loadConfig(ctx)
          if (!config.enabled) return

          const range = getDateRange('lastWeek')

          for (const groupId of [...config.groupWhitelist]) {
            try {
              const report = buildReport(db, config, groupId, '', range, 'ranking', '上周 B话榜')
              const image = await renderReportImage(report)
              await ctx.bot.sendGroupMsg(groupId, [ctx.segment.image(image)])
              await delay(1_200)

              const kingCard = buildKingCardData(db, config, groupId, '', range, '上周 B话王')
              if (kingCard.winner) {
                const kingImage = await renderKingCardImage(kingCard)
                await ctx.bot.sendGroupMsg(groupId, [ctx.segment.image(kingImage)])
                await delay(1_200)
              }
            } catch (err) {
              ctx.logger.warn(
                `[${PLUGIN_NAME}] 群 ${groupId} 定时发送失败: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
        })
      } finally {
        weeklySending = false
      }
    })

    // 每天凌晨 3 点自动清理 60 天前的历史陈旧记录以限制文件体积，并整理数据库空间
    ctx.cron('0 3 * * *', () => {
      try {
        const thresholdDate = dateKeyFromDate(new Date(Date.now() - 60 * DAY_MS))
        db.exec('BEGIN TRANSACTION')
        const deleteStmt = db.prepare('DELETE FROM group_msg_stats WHERE date < ?')
        const result = deleteStmt.run(thresholdDate)
        db.exec('COMMIT')

        ctx.logger.info(`[${PLUGIN_NAME}] 自动清理 60 天前发言数据完成，删除了 ${result.changes} 条历史记录。`)

        if (getLocalDate().weekday === 1 && result.changes > 0) {
          db.exec('VACUUM')
          ctx.logger.info(`[${PLUGIN_NAME}] 已完成每周数据库整理`)
        }
      } catch (err: any) {
        try {
          db.exec('ROLLBACK')
        } catch {}
        ctx.logger.error(`[${PLUGIN_NAME}] 自动清理历史数据失败: ${err.message}`)
      }
    })

    ctx.logger.info(`${PLUGIN_NAME} 插件已加载（SQLite版），白名单群数：${config.groupWhitelist.length} 个`)

    return async () => {
      db.close()
      ctx.logger.info(`${PLUGIN_NAME} 数据库连接已关闭`)
    }
  },
})
