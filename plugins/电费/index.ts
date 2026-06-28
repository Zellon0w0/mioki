import { definePlugin, getAbsPluginDir } from 'mioki'
import axios from 'axios'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, unlink } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
// @ts-ignore missing types
import mk from 'markdown-it-katex'
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

// 获取当前插件目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface PluginConfig {
  enabled: boolean
  whitelist: number[]
  warningBalance: number
  renderWaitTime: number
  maxHistoryDays: number
  contentWidth: number
  padding: number
  apiBaseUrl: string
}

interface WarningStateRecord {
  mutedUntilRecover: boolean
  lastWarningAt?: string
  lastKnownBalance?: number
}

interface PluginData {
  bindings: Record<string, string>
  warningState: Record<string, WarningStateRecord>
}

// 初始化 Markdown 解析器
const md = new MarkdownIt()
md.use(mk, {
  throwOnError: false,
  strict: 'ignore',
})

const STUDENT_ID_REGEX = /^202\d{6,12}$/
const UNSUBSCRIBE_COMMANDS = new Set(['T', 't', '退订', '取消提醒', '不再提醒'])
const ELECTRICITY_UNIT_PRICE = 0.57

function isUnsubscribeCommand(text: string) {
  return UNSUBSCRIBE_COMMANDS.has(text.trim())
}

function getEventUserId(e: any): string {
  return String(e.sender?.user_id ?? e.user_id ?? '')
}

function getPersonInfoApi(personNo: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/personInfo?personNo=${personNo}`
}

function getElecListApi(personNo: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/elecList?personNo=${personNo}`
}

function getQueryRecordApi(personNo: string, queryMonth: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/queryRecord?personNo=${personNo}&queryFlag=0&queryMonth=${queryMonth}`
}

/**
 * HTML/CSS 样式常量
 */
const GLOBAL_STYLES = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
    background: #f5f7fa;
    padding: 20px;
    line-height: 1.5;
    color: #333;
  }

  .main-container {
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    max-width: 800px;
    margin: 0 auto;
  }

  .header {
    background: #4a6bdf;
    color: white;
    padding: 20px;
    text-align: center;
  }

  .header h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 5px;
  }

  .header p {
    font-size: 14px;
    opacity: 0.9;
  }

  .content {
    padding: 20px;
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 15px;
  }

  .stat-item {
    flex: 1;
    background: #f8f9fa;
    border-radius: 8px;
    padding: 15px;
    text-align: center;
    border-left: 3px solid #4a6bdf;
  }

  .stat-label {
    font-size: 13px;
    color: #666;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 18px;
    font-weight: 600;
    color: #333;
  }

  .section {
    margin-bottom: 25px;
  }

  .section-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 1px solid #eee;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 15px;
    margin-bottom: 20px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
  }

  .info-label {
    font-size: 12px;
    color: #666;
    margin-bottom: 5px;
  }

  .info-value {
    font-size: 14px;
    font-weight: 500;
    color: #333;
  }

  .history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .history-table th {
    background: #f1f5f9;
    padding: 10px 12px;
    text-align: left;
    font-weight: 500;
    color: #555;
    border-bottom: 1px solid #e1e5e9;
  }

  .history-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f0f0f0;
  }

  .history-table tr:last-child td {
    border-bottom: none;
  }

  .date-cell {
    font-weight: 500;
    width: 35%;
  }

  .cost-cell {
    text-align: right;
    font-weight: 500;
    width: 32.5%;
  }

  .status-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
  }

  .status-below {
    background-color: #4CAF50;
  }

  .status-above {
    background-color: #FF5722;
  }

  .status-normal {
    background-color: #FFC107;
  }

  .summary-box {
    background: #f0f7ff;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
    border-left: 3px solid #4a6bdf;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .summary-label {
    font-size: 13px;
    color: #555;
  }

  .summary-value {
    font-size: 14px;
    font-weight: 500;
    color: #333;
  }

  .warning-box {
    background: #fff3e0;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
    border-left: 3px solid #FF9800;
  }

  .warning-text {
    color: #E65100;
    font-size: 14px;
    font-weight: 500;
  }

  .footer {
    text-align: center;
    padding: 15px;
    border-top: 1px solid #eee;
    color: #888;
    font-size: 12px;
  }

  @media (max-width: 600px) {
    body {
      padding: 10px;
    }
    
    .content {
      padding: 15px;
    }
    
    .stats-row {
      flex-direction: column;
    }
    
    .info-grid {
      grid-template-columns: 1fr;
    }
  }
`

/**
 * 获取浏览器实例
 */
/**
 * 关闭浏览器实例
 */
/**
 * 渲染 HTML 为图片
 */
async function renderHTMLToImage(html: string, config: PluginConfig): Promise<string> {
  console.log('渲染 HTML...')

  return sharedBrowser
    .withPage(
      async (page) => {
        const totalWidth = config.contentWidth + config.padding * 2

        await page.setViewport({
          width: totalWidth,
          height: 100,
          deviceScaleFactor: 2,
        })

        console.log('加载 HTML 内容...')
        await page.setContent(html, {
          waitUntil: 'networkidle0',
          timeout: 30000,
        })

        console.log('等待渲染...')
        await new Promise((resolve) => setTimeout(resolve, config.renderWaitTime))

        const height = await page.evaluate(() => {
          return document.documentElement.scrollHeight
        })

        console.log('内容高度:', height)
        await page.setViewport({
          width: totalWidth,
          height: Math.ceil(height),
          deviceScaleFactor: 2,
        })

        const tempDir = join(getAbsPluginDir(), '电费', 'temp')
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true })
        }

        const imagePath = join(tempDir, `electric_${Date.now()}.png`)
        console.log('截图保存到:', imagePath)
        await page.screenshot({
          path: imagePath,
          type: 'png',
          fullPage: true,
        })

        return imagePath
      },
      {
        label: 'electricity image render',
        timeoutMs: Math.max(35_000, config.renderWaitTime + 30_000),
        viewport: { width: config.contentWidth + config.padding * 2, height: 100, deviceScaleFactor: 2 },
      },
    )
    .catch((error) => {
      console.error('渲染 HTML 出错:', error)
      throw error
    })
}

/**
 * 获取电费数据
 */
async function getElectricityData(personNo: string, config: PluginConfig) {
  try {
    console.log('获取电费数据...')

    const personInfoResponse = await axios.get(getPersonInfoApi(personNo, config))
    const personInfo = personInfoResponse.data

    if (personInfo.code !== 200) {
      throw new Error(`API1 请求失败: ${personInfo.msg}`)
    }

    const elecListResponse = await axios.get(getElecListApi(personNo, config))
    const elecList = elecListResponse.data

    if (elecList.code !== 200) {
      throw new Error(`API2 请求失败: ${elecList.msg}`)
    }

    return {
      personInfo: personInfo.data,
      elecList: elecList.data,
    }
  } catch (error) {
    console.error('获取电费数据失败:', error)
    throw error
  }
}

/**
 * 获取电费历史数据
 */
async function getElectricityHistory(personNo: string, config: PluginConfig) {
  try {
    console.log('获取电费历史数据...')

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    const historyData = []

    for (let i = 0; i < 3; i++) {
      let year = currentYear
      let month = currentMonth - i

      if (month <= 0) {
        month += 12
        year -= 1
      }

      const queryMonth = `${year}${month.toString().padStart(2, '0')}`
      const apiUrl = getQueryRecordApi(personNo, queryMonth, config)

      console.log(`获取 ${queryMonth} 数据...`)
      const response = await axios.get(apiUrl)
      const data = response.data

      if (data.code === 200 && data.data) {
        const consumptionRecords = data.data
          .filter((record: any) => record.dealName === '消费')
          .sort((a: any, b: any) => new Date(b.dealTime).getTime() - new Date(a.dealTime).getTime())

        historyData.push(...consumptionRecords)
      }

      if (historyData.length >= config.maxHistoryDays) {
        break
      }
    }

    return historyData.slice(0, config.maxHistoryDays)
  } catch (error) {
    console.error('获取电费历史数据失败:', error)
    throw error
  }
}

/**
 * 获取当月电费历史数据
 */
async function getCurrentMonthHistory(personNo: string, config: PluginConfig) {
  try {
    console.log('获取当月电费历史数据...')

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const queryMonth = `${currentYear}${currentMonth.toString().padStart(2, '0')}`
    const apiUrl = getQueryRecordApi(personNo, queryMonth, config)

    console.log(`获取 ${queryMonth} 数据...`)
    const response = await axios.get(apiUrl)
    const data = response.data

    if (data.code === 200 && data.data) {
      const consumptionRecords = data.data
        .filter((record: any) => record.dealName === '消费')
        .sort((a: any, b: any) => new Date(b.dealTime).getTime() - new Date(a.dealTime).getTime())

      return consumptionRecords
    }

    return []
  } catch (error) {
    console.error('获取当月电费历史数据失败:', error)
    throw error
  }
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): { date: string; dayOfWeek: string } {
  const date = new Date(dateString)
  const days = ['日', '一', '二', '三', '四', '五', '六']

  return {
    date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`,
    dayOfWeek: `周${days[date.getDay()]}`,
  }
}

function formatCurrentDate(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function getElectricityPageStyles(config: PluginConfig): string {
  return `
    :root {
      color-scheme: light;
      --md-primary: #006a60;
      --md-on-primary: #ffffff;
      --md-primary-container: #9cf2e5;
      --md-on-primary-container: #00201c;
      --md-secondary-container: #cce8e1;
      --md-on-secondary-container: #0f1f1c;
      --md-tertiary: #6d5e00;
      --md-tertiary-container: #f9e287;
      --md-on-tertiary-container: #211b00;
      --md-error: #ba1a1a;
      --md-error-container: #ffdad6;
      --md-on-error-container: #410002;
      --md-background: #fbfdf9;
      --md-surface: #fbfdf9;
      --md-surface-container-lowest: #ffffff;
      --md-surface-container-low: #f5f7f3;
      --md-surface-container: #eef2ed;
      --md-surface-container-high: #e8ece7;
      --md-on-surface: #191c1b;
      --md-on-surface-variant: #414945;
      --md-outline-variant: #bec9c4;
      --md-shadow: rgba(25, 28, 27, 0.16);
      --elevation-1: 0 1px 2px rgba(25, 28, 27, 0.14), 0 1px 3px 1px rgba(25, 28, 27, 0.08);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      background: var(--md-background);
      color: var(--md-on-surface);
      font-family: "Roboto", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: ${config.padding}px;
      line-height: 1.5;
      letter-spacing: 0;
    }

    .page {
      width: 100%;
      max-width: ${config.contentWidth}px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding: 4px 0 8px;
    }

    .eyebrow {
      color: var(--md-on-surface-variant);
      font-size: 13px;
      font-weight: 500;
    }

    h1 {
      margin-top: 4px;
      color: var(--md-on-surface);
      font-size: 30px;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .date-chip,
    .status-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
    }

    .date-chip {
      min-height: 40px;
      padding: 0 16px;
      border-radius: 20px;
      background: var(--md-secondary-container);
      color: var(--md-on-secondary-container);
    }

    .status-chip {
      min-height: 32px;
      padding: 0 12px;
      border-radius: 16px;
      font-size: 13px;
    }

    .status-chip.normal {
      background: var(--md-primary-container);
      color: var(--md-on-primary-container);
    }

    .status-chip.warning {
      background: var(--md-error-container);
      color: var(--md-on-error-container);
    }

    .balance-panel,
    .metric-card,
    .history-section {
      background: var(--md-surface-container-lowest);
      border: 1px solid var(--md-outline-variant);
      border-radius: 8px;
      box-shadow: var(--elevation-1);
    }

    .balance-panel {
      display: grid;
      gap: 18px;
      padding: 28px;
      border-left: 6px solid var(--md-primary);
    }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--md-on-surface);
      font-size: 16px;
      font-weight: 600;
    }

    .balance-amount {
      color: var(--md-primary);
      font-size: 48px;
      font-weight: 700;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    .balance-meta,
    .metric-support,
    .section-subtitle {
      color: var(--md-on-surface-variant);
      font-size: 14px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .metric-grid.history-summary {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .metric-card {
      min-height: 138px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      border-top: 4px solid var(--md-primary);
    }

    .metric-card.tertiary {
      border-top-color: var(--md-tertiary);
    }

    .metric-card.neutral {
      border-top-color: var(--md-on-surface-variant);
    }

    .metric-label {
      color: var(--md-on-surface-variant);
      font-size: 14px;
      font-weight: 500;
    }

    .metric-value {
      color: var(--md-on-surface);
      font-size: 34px;
      font-weight: 700;
      line-height: 1.08;
      font-variant-numeric: tabular-nums;
    }

    .metric-value.compact {
      font-size: 28px;
    }

    .unit {
      margin-left: 4px;
      color: var(--md-on-surface-variant);
      font-size: 0.52em;
      font-weight: 500;
    }

    .metric-support {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .support-value {
      color: var(--md-on-surface);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .history-section {
      padding: 24px;
      display: grid;
      gap: 18px;
    }

    .table-container {
      overflow: hidden;
      border: 1px solid var(--md-outline-variant);
      border-radius: 8px;
      background: var(--md-surface-container-lowest);
    }

    .history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    .history-table th {
      background: var(--md-surface-container-low);
      color: var(--md-on-surface-variant);
      font-weight: 500;
      text-align: left;
      padding: 14px 16px;
    }

    .history-table td {
      padding: 14px 16px;
      border-top: 1px solid var(--md-outline-variant);
    }

    .history-table th:nth-child(n + 2),
    .history-table td:nth-child(n + 2) {
      text-align: right;
    }

    .date-cell {
      color: var(--md-on-surface);
      font-weight: 600;
    }

    .cost-cell {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    .empty-cell {
      padding: 28px 16px !important;
      color: var(--md-on-surface-variant);
      text-align: center !important;
    }

    @media (max-width: 720px) {
      body {
        padding: 20px;
      }

      .top-bar {
        flex-direction: column;
        gap: 12px;
      }

      h1 {
        font-size: 26px;
      }

      .metric-grid,
      .metric-grid.history-summary {
        grid-template-columns: 1fr;
      }

      .balance-amount {
        font-size: 40px;
      }
    }
  `
}

/**
 * 生成电费状态 HTML
 */
async function generateElectricityStatusHTML(personNo: string, config: PluginConfig): Promise<string> {
  const data = await getElectricityData(personNo, config)
  const currentMonthHistory = await getCurrentMonthHistory(personNo, config)
  const history = await getElectricityHistory(personNo, config)

  const { personInfo } = data
  const currentBalance = Math.abs(parseFloat(personInfo.roomBalance) || 0)

  let yesterdayCost = 0
  let monthlyCost = 0

  // 昨日用电
  if (history.length > 0) {
    yesterdayCost = parseFloat(history[0].dealMoney) || 0
  }

  // 本月累计（从当月历史记录求和）
  if (currentMonthHistory.length > 0) {
    monthlyCost = currentMonthHistory.reduce((total: number, record: any) => {
      return total + (parseFloat(record.dealMoney || 0) || 0)
    }, 0)
  }

  const balanceIsLow = currentBalance < config.warningBalance
  const balanceStatus = balanceIsLow ? '低于预警' : '余额正常'
  const currentDate = formatCurrentDate()
  const yesterdayElectricity = yesterdayCost / ELECTRICITY_UNIT_PRICE
  const monthlyElectricity = monthlyCost / ELECTRICITY_UNIT_PRICE

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>电费概览</title>
    <style>
        ${getElectricityPageStyles(config)}
    </style>
</head>
<body>
    <main class="page">
        <header class="top-bar">
            <div>
                <div class="eyebrow">当前日期</div>
                <h1>电费概览</h1>
            </div>
            <div class="date-chip">${currentDate}</div>
        </header>

        <section class="balance-panel">
            <div class="section-heading">
                <span>账户余额</span>
                <span class="status-chip ${balanceIsLow ? 'warning' : 'normal'}">${balanceStatus}</span>
            </div>
            <div class="balance-amount">¥ ${currentBalance.toFixed(2)}</div>
            <div class="balance-meta">预警阈值 ¥ ${config.warningBalance.toFixed(2)}</div>
        </section>

        <section class="metric-grid">
            <article class="metric-card">
                <div class="metric-label">昨日用电</div>
                <div class="metric-value">${yesterdayElectricity.toFixed(2)}<span class="unit">度</span></div>
                <div class="metric-support">
                    <span>电费</span>
                    <span class="support-value">¥ ${yesterdayCost.toFixed(2)}</span>
                </div>
            </article>

            <article class="metric-card tertiary">
                <div class="metric-label">本月累计</div>
                <div class="metric-value">${monthlyElectricity.toFixed(2)}<span class="unit">度</span></div>
                <div class="metric-support">
                    <span>电费</span>
                    <span class="support-value">¥ ${monthlyCost.toFixed(2)}</span>
                </div>
            </article>
        </section>
    </main>
</body>
</html>
  `

  return html
}

/**
 * 生成电费历史 HTML
 */
async function generateElectricityHistoryHTML(personNo: string, config: PluginConfig): Promise<string> {
  const history = await getElectricityHistory(personNo, config)
  const data = await getElectricityData(personNo, config)

  const totalConsumption = history.reduce((total: number, record: any) => {
    return total + (parseFloat(record.dealMoney || 0) || 0)
  }, 0)

  const totalElectricity = history.reduce((total: number, record: any) => {
    return total + (parseFloat(record.dealMoney || 0) || 0) / ELECTRICITY_UNIT_PRICE
  }, 0)

  const currentBalance = Math.abs(parseFloat(data.personInfo.roomBalance) || 0)
  const currentDate = formatCurrentDate()
  const historyCountText = history.length > 0 ? `最近 ${history.length} 天` : '暂无记录'

  const tableRows =
    history.length > 0
      ? history
          .map((record: any) => {
            const { date, dayOfWeek } = formatDate(record.dealTime)
            const cost = parseFloat(record.dealMoney || 0) || 0
            const electricity = cost / ELECTRICITY_UNIT_PRICE

            return `
      <tr>
        <td class="date-cell">${date} ${dayOfWeek}</td>
        <td class="cost-cell">${electricity.toFixed(2)} 度</td>
        <td class="cost-cell">¥ ${cost.toFixed(2)}</td>
      </tr>
    `
          })
          .join('')
      : `
      <tr>
        <td class="empty-cell" colspan="3">暂无历史记录</td>
      </tr>
    `

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>电费历史</title>
    <style>
        ${getElectricityPageStyles(config)}
    </style>
</head>
<body>
    <main class="page">
        <header class="top-bar">
            <div>
                <div class="eyebrow">当前日期</div>
                <h1>电费历史</h1>
            </div>
            <div class="date-chip">${currentDate}</div>
        </header>

        <section class="metric-grid history-summary">
            <article class="metric-card">
                <div class="metric-label">账户余额</div>
                <div class="metric-value compact">¥ ${currentBalance.toFixed(2)}</div>
            </article>

            <article class="metric-card neutral">
                <div class="metric-label">记录天数</div>
                <div class="metric-value compact">${history.length}<span class="unit">天</span></div>
            </article>

            <article class="metric-card">
                <div class="metric-label">总用电量</div>
                <div class="metric-value compact">${totalElectricity.toFixed(2)}<span class="unit">度</span></div>
            </article>

            <article class="metric-card tertiary">
                <div class="metric-label">总费用</div>
                <div class="metric-value compact">¥ ${totalConsumption.toFixed(2)}</div>
            </article>
        </section>

        <section class="history-section">
            <div class="section-heading">
                <span>近期用电记录</span>
                <span class="section-subtitle">${historyCountText}</span>
            </div>
        <div class="table-container">
            <table class="history-table">
                <thead>
                    <tr>
                        <th>日期</th>
                        <th>用电量</th>
                        <th>费用</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
        </section>
    </main>
</body>
</html>
  `

  return html
}

export default definePlugin({
  name: '电费',
  version: '2.0.0',
  description: '电费查询和监控插件 - 美化版',
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '电费')
    const configPath = join(pluginDir, 'config.json')
    const dataPath = join(pluginDir, 'data.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        whitelist: [],
        warningBalance: 10,
        renderWaitTime: 1000,
        maxHistoryDays: 30,
        contentWidth: 800,
        padding: 40,
        apiBaseUrl: 'https://mobiles.znmdhq.com/api/room/mobile',
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return { ...defaultConfig, ...JSON.parse(fileContent) }
      } catch (err: any) {
        ctx.logger.error(`加载配置失败，将使用默认配置: ${err.message}`)
        return defaultConfig
      }
    }

    const loadData = (): PluginData => {
      const defaultData: PluginData = {
        bindings: {},
        warningState: {},
      }

      if (!existsSync(dataPath)) {
        return defaultData
      }

      try {
        const fileContent = readFileSync(dataPath, 'utf-8')
        return { ...defaultData, ...JSON.parse(fileContent) }
      } catch (err: any) {
        ctx.logger.error(`加载数据失败，将使用默认数据: ${err.message}`)
        return defaultData
      }
    }

    const saveData = (data: PluginData) => {
      try {
        writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8')
      } catch (err: any) {
        ctx.logger.error(`保存数据失败: ${err.message}`)
      }
    }

    // 初始化临时目录
    const tempDir = join(pluginDir, 'temp')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    function clearWarningCycleState(warningState: Record<string, WarningStateRecord>, userId: string) {
      if (!(userId in warningState)) return false
      delete warningState[userId]
      return true
    }

    // 检查余额并主动私聊预警
    async function checkBalanceAndWarn() {
      const config = loadConfig()
      if (!config.enabled) return

      try {
        const data = loadData()
        const entries = Object.entries(data.bindings)
        let changed = false

        for (const [userId, personNo] of entries) {
          try {
            const elecData = await getElectricityData(personNo, config)
            const currentBalance = Math.abs(parseFloat(elecData.personInfo.roomBalance))
            const currentState = data.warningState[userId]

            if (currentBalance >= config.warningBalance) {
              changed = clearWarningCycleState(data.warningState, userId) || changed
              continue
            }

            if (!currentState) {
              data.warningState[userId] = {
                mutedUntilRecover: false,
                lastKnownBalance: currentBalance,
              }
              changed = true
            } else if (currentState.lastKnownBalance !== currentBalance) {
              currentState.lastKnownBalance = currentBalance
              changed = true
            }

            if (data.warningState[userId]?.mutedUntilRecover) continue

            const warningMessage =
              `⚠️ 电费余额不足提醒\n` +
              `当前余额：${currentBalance.toFixed(2)} 元\n` +
              `预警阈值：${config.warningBalance} 元\n` +
              `学号：${personNo}\n` +
              `请及时充值，避免影响正常用电。\n` +
              `回复T退订（本次欠费不再提醒）`

            await ctx.bot.sendPrivateMsg(Number(userId), [ctx.segment.text(warningMessage)])
            data.warningState[userId] = {
              mutedUntilRecover: false,
              lastKnownBalance: currentBalance,
              lastWarningAt: new Date().toISOString(),
            }
            changed = true
            await new Promise((resolve) => setTimeout(resolve, 100))
          } catch (err) {
            ctx.logger.warn(`[电费] 私聊预警发送失败 user=${userId}, personNo=${personNo}: ${err}`)
          }
        }

        if (changed) {
          saveData(data)
        }
      } catch (error) {
        ctx.logger.warn(`[电费] 余额检查失败: ${error}`)
      }
    }

    async function handleWarningUnsubscribe(e: any, config: PluginConfig) {
      const text = ctx.text(e).trim()
      if (!isUnsubscribeCommand(text)) return false

      const userId = getEventUserId(e)
      if (!userId) {
        await e.reply('无法识别你的 QQ 号，请稍后再试。')
        return true
      }

      const data = loadData()
      const personNo = data.bindings[userId]
      if (!personNo) {
        await e.reply('你还没有绑定学号，请先发送：#电费 绑定 202xxxxxxxxx')
        return true
      }

      if (!data.warningState[userId]) {
        await e.reply('当前没有可退订的欠费提醒。')
        return true
      }

      try {
        const elecData = await getElectricityData(personNo, config)
        const currentBalance = Math.abs(parseFloat(elecData.personInfo.roomBalance))

        if (currentBalance >= config.warningBalance) {
          clearWarningCycleState(data.warningState, userId)
          saveData(data)
          await e.reply('当前余额已恢复，无需退订。')
          return true
        }

        data.warningState[userId] = {
          ...data.warningState[userId],
          mutedUntilRecover: true,
          lastKnownBalance: currentBalance,
        }
        saveData(data)
        await e.reply('已为你退订本次欠费提醒，待余额恢复后下次欠费会重新提醒。')
      } catch (error) {
        await e.reply(`处理退订失败：${error instanceof Error ? error.message : '未知错误'}`)
      }

      return true
    }

    async function handleElectricityMessage(e: any, config: PluginConfig) {
      const text = ctx.text(e).trim()
      if (!text.startsWith('#电费')) return

      const userId = getEventUserId(e)
      if (!userId) {
        await e.reply('无法识别你的 QQ 号，请稍后再试。')
        return
      }

      const data = loadData()
      const parts = text.split(/\s+/).filter(Boolean)
      const subCommand = parts[1]

      if (subCommand === '绑定') {
        const personNo = parts[2] ?? ''
        if (!STUDENT_ID_REGEX.test(personNo)) {
          await e.reply('格式错误，请使用：#电费 绑定 202xxxxxxxxx')
          return
        }

        data.bindings[userId] = personNo
        saveData(data)
        await e.reply(`绑定成功，QQ ${userId} -> 学号 ${personNo}`)
        return
      }

      const personNo = data.bindings[userId]
      if (!personNo) {
        await e.reply('你还没有绑定学号，请先发送：#电费 绑定 202xxxxxxxxx')
        return
      }

      if (!subCommand) {
        await runWithReaction(e, async () => {
          let imagePath: string | null = null
          try {
            const html = await generateElectricityStatusHTML(personNo, config)
            imagePath = await renderHTMLToImage(html, config)
            await e.reply(ctx.segment.image(imagePath))
          } catch (error) {
            await e.reply(`查询失败：${error instanceof Error ? error.message : '未知错误'}`)
          } finally {
            if (imagePath) {
              const fileToDelete = imagePath
              const timer = setTimeout(() => {
                try {
                  if (existsSync(fileToDelete)) unlink(fileToDelete, () => {})
                } catch {}
              }, 15000)
              ctx.clears.add(() => clearTimeout(timer))
            }
          }
        })
        return
      }

      if (subCommand === '历史') {
        await runWithReaction(e, async () => {
          let imagePath: string | null = null
          try {
            const html = await generateElectricityHistoryHTML(personNo, config)
            imagePath = await renderHTMLToImage(html, config)
            await e.reply(ctx.segment.image(imagePath))
          } catch (error) {
            await e.reply(`查询失败：${error instanceof Error ? error.message : '未知错误'}`)
          } finally {
            if (imagePath) {
              const fileToDelete = imagePath
              const timer = setTimeout(() => {
                try {
                  if (existsSync(fileToDelete)) unlink(fileToDelete, () => {})
                } catch {}
              }, 15000)
              ctx.clears.add(() => clearTimeout(timer))
            }
          }
        })
        return
      }

      await e.reply('支持的命令：#电费 / #电费 历史 / #电费 绑定 202xxxxxxxxx')
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if ('group_id' in e && config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return
      await handleElectricityMessage(e, config)
    })

    ctx.handle('message.private', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (await handleWarningUnsubscribe(e, config)) return
      await handleElectricityMessage(e, config)
    })

    // 每天检查余额（早上 9 点执行）
    ctx.cron('0 9 * * *', async () => {
      await checkBalanceAndWarn()
    })

    // 进程退出清理
    const cleanup = async () => {
      const tempDir = join(pluginDir, 'temp')
      if (existsSync(tempDir)) {
        console.log('清理临时文件夹...')
        readdirSync(tempDir).forEach((file) => {
          try {
            unlinkSync(join(tempDir, file))
          } catch (err) {
            console.error(`删除临时文件失败 ${file}:`, err)
          }
        })
      }
    }

    return async () => {
      await cleanup()
    }
  },
})
