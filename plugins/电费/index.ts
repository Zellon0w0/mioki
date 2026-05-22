import { definePlugin, getAbsPluginDir } from 'mioki'
import axios from 'axios'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, unlink } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer, { Browser } from 'puppeteer-core'
import MarkdownIt from 'markdown-it'
import mk from 'markdown-it-katex'

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
  browserPath: string
  apiBaseUrl: string
}

interface WarningStateRecord {
  mutedUntilRecover: boolean;
  lastWarningAt?: string;
  lastKnownBalance?: number;
}

interface PluginData {
  bindings: Record<string, string>
  warningState: Record<string, WarningStateRecord>
}

// 全局浏览器实例
let globalBrowser: Browser | null = null;

// 初始化 Markdown 解析器
const md = new MarkdownIt();
md.use(mk);

const STUDENT_ID_REGEX = /^202\d{6,12}$/;
const UNSUBSCRIBE_COMMANDS = new Set(['T', 't', '退订', '取消提醒', '不再提醒']);

function isUnsubscribeCommand(text: string) {
  return UNSUBSCRIBE_COMMANDS.has(text.trim());
}

function getEventUserId(e: any): string {
  return String(e.sender?.user_id ?? e.user_id ?? '');
}

function getPersonInfoApi(personNo: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/personInfo?personNo=${personNo}`;
}

function getElecListApi(personNo: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/elecList?personNo=${personNo}`;
}

function getQueryRecordApi(personNo: string, queryMonth: string, config: PluginConfig) {
  return `${config.apiBaseUrl}/queryRecord?personNo=${personNo}&queryFlag=0&queryMonth=${queryMonth}`;
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
`;

/**
 * 获取浏览器实例
 */
async function getBrowserInstance(config: PluginConfig): Promise<Browser> {
  if (!globalBrowser) {
    console.log('启动浏览器实例...');
    globalBrowser = await puppeteer.launch({
      executablePath: config.browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
      timeout: 60000
    });
  }
  return globalBrowser;
}

/**
 * 关闭浏览器实例
 */
async function closeBrowserInstance() {
  if (globalBrowser) {
    console.log('关闭浏览器实例...');
    try {
      const pages = await globalBrowser.pages();
      await Promise.all(pages.map(page => page.close()));
      await globalBrowser.close();
    } catch (err) {
      console.error('关闭浏览器时出错:', err);
    } finally {
      globalBrowser = null;
    }
  }
}

/**
 * 渲染 HTML 为图片
 */
async function renderHTMLToImage(html: string, config: PluginConfig): Promise<string> {
  console.log('渲染 HTML...');

  try {
    const browser = await getBrowserInstance(config);
    const page = await browser.newPage();

    const totalWidth = config.contentWidth + config.padding * 2;

    await page.setViewport({
      width: totalWidth,
      height: 100,
      deviceScaleFactor: 2,
    });

    console.log('加载 HTML 内容...');
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    console.log('等待渲染...');
    await new Promise(resolve => setTimeout(resolve, config.renderWaitTime));

    const height = await page.evaluate(() => {
      return document.documentElement.scrollHeight;
    });

    console.log('内容高度:', height);
    await page.setViewport({
      width: totalWidth,
      height: Math.ceil(height),
      deviceScaleFactor: 2,
    });

    const tempDir = join(getAbsPluginDir(), '电费', 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const imagePath = join(tempDir, `electric_${Date.now()}.png`);
    console.log('截图保存到:', imagePath);
    await page.screenshot({
      path: imagePath,
      type: 'png',
      fullPage: true
    });

    await page.close();
    return imagePath;
  } catch (error) {
    console.error('渲染 HTML 出错:', error);
    throw error;
  }
}

/**
 * 获取电费数据
 */
async function getElectricityData(personNo: string, config: PluginConfig) {
  try {
    console.log('获取电费数据...');
  
    const personInfoResponse = await axios.get(getPersonInfoApi(personNo, config));
    const personInfo = personInfoResponse.data;
  
    if (personInfo.code !== 200) {
      throw new Error(`API1 请求失败: ${personInfo.msg}`);
    }

    const elecListResponse = await axios.get(getElecListApi(personNo, config));
    const elecList = elecListResponse.data;
  
    if (elecList.code !== 200) {
      throw new Error(`API2 请求失败: ${elecList.msg}`);
    }

    return {
      personInfo: personInfo.data,
      elecList: elecList.data
    };
  } catch (error) {
    console.error('获取电费数据失败:', error);
    throw error;
  }
}

/**
 * 获取电费历史数据
 */
async function getElectricityHistory(personNo: string, config: PluginConfig) {
  try {
    console.log('获取电费历史数据...');
  
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
  
    const historyData = [];
  
    for (let i = 0; i < 3; i++) {
      let year = currentYear;
      let month = currentMonth - i;
    
      if (month <= 0) {
        month += 12;
        year -= 1;
      }
    
      const queryMonth = `${year}${month.toString().padStart(2, '0')}`;
      const apiUrl = getQueryRecordApi(personNo, queryMonth, config);
    
      console.log(`获取 ${queryMonth} 数据...`);
      const response = await axios.get(apiUrl);
      const data = response.data;
    
      if (data.code === 200 && data.data) {
        const consumptionRecords = data.data
          .filter((record: any) => record.dealName === '消费')
          .sort((a: any, b: any) => new Date(b.dealTime).getTime() - new Date(a.dealTime).getTime());
      
        historyData.push(...consumptionRecords);
      }
    
      if (historyData.length >= config.maxHistoryDays) {
        break;
      }
    }
  
    return historyData.slice(0, config.maxHistoryDays);
  } catch (error) {
    console.error('获取电费历史数据失败:', error);
    throw error;
  }
}

/**
 * 获取当月电费历史数据
 */
async function getCurrentMonthHistory(personNo: string, config: PluginConfig) {
  try {
    console.log('获取当月电费历史数据...');
  
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const queryMonth = `${currentYear}${currentMonth.toString().padStart(2, '0')}`;
    const apiUrl = getQueryRecordApi(personNo, queryMonth, config);
  
    console.log(`获取 ${queryMonth} 数据...`);
    const response = await axios.get(apiUrl);
    const data = response.data;
  
    if (data.code === 200 && data.data) {
      const consumptionRecords = data.data
        .filter((record: any) => record.dealName === '消费')
        .sort((a: any, b: any) => new Date(b.dealTime).getTime() - new Date(a.dealTime).getTime());
    
      return consumptionRecords;
    }
  
    return [];
  } catch (error) {
    console.error('获取当月电费历史数据失败:', error);
    throw error;
  }
}

/**
 * 计算预计可用天数
 */
function calculateEstimatedDays(balance: number, dailyAverage: number): number {
  if (dailyAverage <= 0) return 0;
  return Math.floor(balance / dailyAverage);
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): { date: string, dayOfWeek: string } {
  const date = new Date(dateString);
  const days = ['日', '一', '二', '三', '四', '五', '六'];

  return {
    date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`,
    dayOfWeek: `周${days[date.getDay()]}`
  };
}

/**
 * 生成电费状态 HTML
 */
async function generateElectricityStatusHTML(personNo: string, config: PluginConfig): Promise<string> {
  const data = await getElectricityData(personNo, config);
  const currentMonthHistory = await getCurrentMonthHistory(personNo, config);
  const history = await getElectricityHistory(personNo, config);

  const { personInfo, elecList } = data;
  const currentBalance = Math.abs(parseFloat(personInfo.roomBalance));
  const currentReading = elecList[0]?.lastAmount || 0;

  let yesterdayUsage = 0;
  let monthlyTotal = 0;

  // 昨日用电
  if (history.length > 0) {
    yesterdayUsage = parseFloat(history[0].dealMoney) || 0;
  }

  // 本月累计（从当月历史记录求和）
  if (currentMonthHistory.length > 0) {
    monthlyTotal = currentMonthHistory.reduce((total: number, record: any) => {
      return total + parseFloat(record.dealMoney || 0);
    }, 0);
  }

  const dailyAverage = monthlyTotal / (currentMonthHistory.length || 1);
  const estimatedDays = calculateEstimatedDays(currentBalance, dailyAverage);
  const isLowBalance = currentBalance < config.warningBalance;

  // 计算剩余电量（按 0.57 元/度估算）
  const remainingElectricity = (currentBalance / 0.57).toFixed(2);
  
  // 计算本月剩余天数
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const remainingDaysInMonth = daysInMonth - now.getDate();
  
  // 预计月耗（按当前使用速度推算）
  const estimatedMonthlyUsage = (monthlyTotal / 0.57) * (daysInMonth / now.getDate());
  
  // 判断余额状态
  const balanceStatus = currentBalance >= 50 ? '余额充足' : '余额不足';

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>电费概览</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%);
            color: #fff;
            font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            min-height: 100vh;
        }

        /* 顶部标题栏 */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 28px;
            font-weight: bold;
        }

        .dot {
            width: 12px;
            height: 12px;
            background: #00d4ff;
            border-radius: 50%;
        }

        .date-badge {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 10px 20px;
            border-radius: 25px;  
            font-size: 14px;
            backdrop-filter: blur(10px);
        }

        /* 关键指标卡片 */
        .key-metrics {
            background: linear-gradient(135deg, rgba(100, 50, 150, 0.4) 0%, rgba(80, 30, 120, 0.3) 100%);
            border: 2px solid;
            border-image: linear-gradient(135deg, #7c3aed, #06b6d4) 1;
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 20px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 30px;
        }

        .metric-item {
            text-align: center;
        }

        .metric-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: #b0b8c1;
            margin-bottom: 10px;
        }

        .metric-dot {
            width: 10px;
            height: 10px;
            background: #a78bfa;
            border-radius: 50%;
        }

        .metric-value {
            font-size: 48px;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .value-yellow { color: #fbbf24; }
        .value-cyan { color: #06b6d4; }
        .value-purple { color: #d8b4fe; }

        .metric-desc {
            font-size: 12px;
            color: #888;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }

        .warning-icon {
            color: #f59e0b;
            font-size: 14px;
        }

        .status-icon {
            color: #10b981;
        }

        /* 双卡片行 */
        .cards-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 20px;
        }

        .card {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 25px;
        }

        .card-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 25px;
        }

        .card-dot-cyan { background: #06b6d4; }
        .card-dot-pink { background: #d946ef; }

        .card-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }

        .card-badge {
            margin-left: auto;
            border: 1px solid #10b981;
            color: #10b981;
            padding: 5px 12px;
            border-radius: 12px;
            font-size: 12px;
        }

        .card-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .card-stat {
            display: flex;
            flex-direction: column;
        }

        .stat-label {
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 32px;
            font-weight: bold;
        }

        .value-cyan { color: #06b6d4; }
        .value-pink { color: #ec4899; }

        /* 账户余额卡片 */
        .balance-card {
            background: linear-gradient(135deg, rgba(120, 40, 60, 0.3) 0%, rgba(80, 30, 50, 0.2) 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 20px;
        }

        .balance-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .balance-title {
            font-size: 20px;
            font-weight: bold;
        }

        .balance-warning {
            border: 1px solid #f97316;
            color: #f97316;
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 12px;
        }

        .balance-normal {
            border: 1px solid #10b981;
            color: #10b981;
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 12px;
        }

        .balance-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
        }

        .balance-stat {
            display: flex;
            flex-direction: column;
        }

        .balance-label {
            font-size: 14px;
            color: #999;
            margin-bottom: 12px;
        }

        .balance-value {
            font-size: 40px;
            font-weight: bold;
            color: #ff6b6b;
            margin-bottom: 15px;
        }

        .progress-bar {
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #ff6b6b, #ff8c8c);
            width: ${(currentBalance / 100) * 100}%;
        }

        /* 预测分析 */
        .forecast {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 25px;
        }

        .forecast-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 25px;
        }

        .forecast-content {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 30px;
        }

        .forecast-item {
            display: flex;
            flex-direction: column;
        }

        .forecast-label {
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
        }

        .forecast-value {
            font-size: 28px;
            font-weight: bold;
        }

        .forecast-warn {
            color: #fbbf24;
        }

        .forecast-normal {
            color: #fbbf24;
        }

        .forecast-alert {
            color: #f97316;
        }

        @media (max-width: 768px) {
            .key-metrics, .cards-row, .balance-content, .forecast-content {
                grid-template-columns: 1fr;
            }

            .metric-value {
                font-size: 36px;
            }
        }
    </style>
</head>
<body>
    <!-- 顶部标题 -->
    <div class="header">
        <div class="header-title">
            <div class="dot"></div>
            电费概览
        </div>
        <div class="date-badge">${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日</div>
    </div>

    <!-- 关键指标 -->
    <div class="key-metrics">
        <div class="metric-item">
            <div class="metric-label">
                <div class="metric-dot"></div>
                预计可用天数
            </div>
            <div class="metric-value value-yellow">${estimatedDays}<span style="font-size: 28px;">天</span></div>
            <div class="metric-desc">
                <span class="warning-icon">⚠</span>
                ${estimatedDays < 7 ? '需要充值' : '正常使用'}
            </div>
        </div>

        <div class="metric-item">
            <div class="metric-label">
                <div class="metric-dot"></div>
                本月剩余天数
            </div>
            <div class="metric-value value-cyan">${remainingDaysInMonth}<span style="font-size: 28px;">天</span></div>
            <div class="metric-desc">第 ${now.getDate()} 天 / 共 ${daysInMonth} 天</div>
        </div>

        <div class="metric-item">
            <div class="metric-label">
                <div class="metric-dot"></div>
                近两周日均
            </div>
            <div class="metric-value value-purple">${dailyAverage.toFixed(1)}<span style="font-size: 28px;">度</span></div>
            <div class="metric-desc">
                <span class="status-icon">✓</span>
                正常使用
            </div>
        </div>
    </div>

    <!-- 昨日用电 和 本月累计 -->
    <div class="cards-row">
        <div class="card">
            <div class="card-title">
                <div class="card-dot card-dot-cyan"></div>
                昨日用电
            </div>
            <div class="card-content">
                <div class="card-stat">
                    <div class="stat-label">用电量</div>
                    <div class="stat-value value-cyan">${(yesterdayUsage / 0.57).toFixed(2)}<span style="font-size: 18px;"> 度</span></div>
                </div>
                <div class="card-stat">
                    <div class="stat-label">电费</div>
                    <div class="stat-value value-cyan">¥ ${yesterdayUsage.toFixed(2)}</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-title">
                <div class="card-dot card-dot-pink"></div>
                本月累计
            </div>
            <div class="card-content">
                <div class="card-stat">
                    <div class="stat-label">用电量</div>
                    <div class="stat-value value-pink">${(monthlyTotal / 0.57).toFixed(2)}<span style="font-size: 18px;"> 度</span></div>
                </div>
                <div class="card-stat">
                    <div class="stat-label">电费</div>
                    <div class="stat-value value-pink">¥ ${monthlyTotal.toFixed(2)}</div>
                </div>
            </div>
        </div>
    </div>

    <!-- 账户余额 -->
    <div class="balance-card">
        <div class="balance-header">
            <div class="balance-title">账户余额</div>
            <div class="${currentBalance >= 50 ? 'balance-normal' : 'balance-warning'}">${balanceStatus}</div>
        </div>
        <div class="balance-content">
            <div class="balance-stat">
                <div class="balance-label">剩余电量</div>
                <div class="balance-value">${remainingElectricity}<span style="font-size: 20px;"> 度</span></div>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
            <div class="balance-stat">
                <div class="balance-label">剩余金额</div>
                <div class="balance-value">¥ ${currentBalance.toFixed(2)}</div>
            </div>
        </div>
    </div>

    <!-- 预测分析 -->
    <div class="forecast">
        <div class="forecast-title">预测分析</div>
        <div class="forecast-content">
            <div class="forecast-item">
                <div class="forecast-label">预计月耗</div>
                <div class="forecast-value forecast-normal">${estimatedMonthlyUsage.toFixed(1)}<span style="font-size: 16px;"> 度</span></div>
            </div>
            <div class="forecast-item">
                <div class="forecast-label">本月预测</div>
                <div class="forecast-value forecast-alert">${estimatedMonthlyUsage > 100 ? '可能超出' : '正常范围'}</div>
            </div>
        </div>
    </div>
</body>
</html>
  `;

  return html;
}

/**
 * 生成电费历史 HTML
 */
async function generateElectricityHistoryHTML(personNo: string, config: PluginConfig): Promise<string> {
  const history = await getElectricityHistory(personNo, config);
  const data = await getElectricityData(personNo, config);

  const totalConsumption = history.reduce((total: number, record: any) => {
    return total + parseFloat(record.dealMoney || 0);
  }, 0);

  const totalElectricity = history.reduce((total: number, record: any) => {
    return total + (parseFloat(record.dealMoney || 0) / 0.57);
  }, 0);

  const dailyAverage = totalConsumption / (history.length || 1);
  const currentBalance = parseFloat(data.personInfo.roomBalance);

  let tableRows = '';
  history.forEach((record: any) => {
    const { date, dayOfWeek } = formatDate(record.dealTime);
    const cost = parseFloat(record.dealMoney || 0).toFixed(2);
    const electricity = (parseFloat(record.dealMoney || 0) / 0.57).toFixed(2);

    tableRows += `
      <tr>
        <td class="date-cell">${date} ${dayOfWeek}</td>
        <td class="cost-cell">消耗 ${electricity} 度</td>
        <td class="cost-cell">¥${cost}</td>
      </tr>
    `;
  });

  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>电费历史</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%);
            color: #fff;
            font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            min-height: 100vh;
        }

        /* 顶部标题栏 */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 28px;
            font-weight: bold;
        }

        .dot {
            width: 12px;
            height: 12px;
            background: #00d4ff;
            border-radius: 50%;
        }

        .date-badge {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 10px 20px;
            border-radius: 25px;
            font-size: 14px;
            backdrop-filter: blur(10px);
        }

        /* 统计卡片 */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 20px;
        }

        .stat-card {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
        }

        .stat-label {
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #fbbf24;
        }

        /* 历史表格 */
        .history-section {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
        }

        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .section-dot {
            width: 10px;
            height: 10px;
            background: #06b6d4;
            border-radius: 50%;
        }

        .history-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }

        .history-table th {
            text-align: left;
            padding: 12px 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            color: #888;
            font-weight: 500;
        }

        .history-table td {
            padding: 12px 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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

        .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 13px;
            color: #666;
        }

        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
    </style>
</head>
<body>
    <!-- 顶部标题 -->
    <div class="header">
        <div class="header-title">
            <div class="dot"></div>
            电费历史
        </div>
        <div class="date-badge">${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日</div>
    </div>

    <!-- 统计信息 -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-label">记录天数</div>
            <div class="stat-value">${history.length}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">总用电量</div>
            <div class="stat-value">${totalElectricity.toFixed(2)}度</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">总费用</div>
            <div class="stat-value">¥${totalConsumption.toFixed(2)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">日均费用</div>
            <div class="stat-value">¥${dailyAverage.toFixed(2)}</div>
        </div>
    </div>

    <!-- 历史记录 -->
    <div class="history-section">
        <div class="section-title">
            <div class="section-dot"></div>
            近期用电记录
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
    </div>

    <div class="footer">
        最近 ${history.length} 天用电记录
    </div>
</body>
</html>
  `;

  return html;
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
        browserPath: '/usr/bin/chromium',
        apiBaseUrl: 'https://mobiles.znmdhq.com/api/room/mobile'
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
        warningState: {}
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
    const tempDir = join(pluginDir, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    function clearWarningCycleState(warningState: Record<string, WarningStateRecord>, userId: string) {
      if (!(userId in warningState)) return false;
      delete warningState[userId];
      return true;
    }

    // 检查余额并主动私聊预警
    async function checkBalanceAndWarn() {
      const config = loadConfig()
      if (!config.enabled) return

      try {
        const data = loadData();
        const entries = Object.entries(data.bindings);
        let changed = false;

        for (const [userId, personNo] of entries) {
          try {
            const elecData = await getElectricityData(personNo, config);
            const currentBalance = Math.abs(parseFloat(elecData.personInfo.roomBalance));
            const currentState = data.warningState[userId];

            if (currentBalance >= config.warningBalance) {
              changed = clearWarningCycleState(data.warningState, userId) || changed;
              continue;
            }

            if (!currentState) {
              data.warningState[userId] = {
                mutedUntilRecover: false,
                lastKnownBalance: currentBalance,
              };
              changed = true;
            } else if (currentState.lastKnownBalance !== currentBalance) {
              currentState.lastKnownBalance = currentBalance;
              changed = true;
            }

            if (data.warningState[userId]?.mutedUntilRecover) continue;

            const warningMessage =
              `⚠️ 电费余额不足提醒\n` +
              `当前余额：${currentBalance.toFixed(2)} 元\n` +
              `预警阈值：${config.warningBalance} 元\n` +
              `学号：${personNo}\n` +
              `请及时充值，避免影响正常用电。\n` +
              `回复T退订（本次欠费不再提醒）`;

            await ctx.bot.sendPrivateMsg(Number(userId), [ctx.segment.text(warningMessage)]);
            data.warningState[userId] = {
              mutedUntilRecover: false,
              lastKnownBalance: currentBalance,
              lastWarningAt: new Date().toISOString(),
            };
            changed = true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (err) {
            ctx.logger.warn(`[电费] 私聊预警发送失败 user=${userId}, personNo=${personNo}: ${err}`);
          }
        }

        if (changed) {
          saveData(data);
        }
      } catch (error) {
        ctx.logger.warn(`[电费] 余额检查失败: ${error}`);
      }
    }

    async function handleWarningUnsubscribe(e: any, config: PluginConfig) {
      const text = ctx.text(e).trim();
      if (!isUnsubscribeCommand(text)) return false;

      const userId = getEventUserId(e);
      if (!userId) {
        await e.reply('无法识别你的 QQ 号，请稍后再试。');
        return true;
      }

      const data = loadData();
      const personNo = data.bindings[userId];
      if (!personNo) {
        await e.reply('你还没有绑定学号，请先发送：#电费 绑定 202xxxxxxxxx');
        return true;
      }

      if (!data.warningState[userId]) {
        await e.reply('当前没有可退订的欠费提醒。');
        return true;
      }

      try {
        const elecData = await getElectricityData(personNo, config);
        const currentBalance = Math.abs(parseFloat(elecData.personInfo.roomBalance));

        if (currentBalance >= config.warningBalance) {
          clearWarningCycleState(data.warningState, userId);
          saveData(data);
          await e.reply('当前余额已恢复，无需退订。');
          return true;
        }

        data.warningState[userId] = {
          ...data.warningState[userId],
          mutedUntilRecover: true,
          lastKnownBalance: currentBalance,
        };
        saveData(data);
        await e.reply('已为你退订本次欠费提醒，待余额恢复后下次欠费会重新提醒。');
      } catch (error) {
        await e.reply(`处理退订失败：${error instanceof Error ? error.message : '未知错误'}`);
      }

      return true;
    }

    async function handleElectricityMessage(e: any, config: PluginConfig) {
      const text = ctx.text(e).trim();
      if (!text.startsWith('#电费')) return;

      const userId = getEventUserId(e);
      if (!userId) {
        await e.reply('无法识别你的 QQ 号，请稍后再试。');
        return;
      }

      const data = loadData();
      const parts = text.split(/\s+/).filter(Boolean);
      const subCommand = parts[1];

      if (subCommand === '绑定') {
        const personNo = parts[2] ?? '';
        if (!STUDENT_ID_REGEX.test(personNo)) {
          await e.reply('格式错误，请使用：#电费 绑定 202xxxxxxxxx');
          return;
        }

        data.bindings[userId] = personNo;
        saveData(data);
        await e.reply(`绑定成功，QQ ${userId} -> 学号 ${personNo}`);
        return;
      }

      const personNo = data.bindings[userId];
      if (!personNo) {
        await e.reply('你还没有绑定学号，请先发送：#电费 绑定 202xxxxxxxxx');
        return;
      }

      if (!subCommand) {
        const thinking = await e.reply('正在查询电费信息，请稍候...');
        try {
          const html = await generateElectricityStatusHTML(personNo, config);
          const imagePath = await renderHTMLToImage(html, config);
          await e.reply(ctx.segment.image(imagePath));
          setTimeout(() => unlink(imagePath, () => {}), 1000);
        } catch (error) {
          await e.reply(`查询失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
          if (thinking?.message_id) {
            try {
              await ctx.bot.recallMsg(thinking.message_id);
            } catch {}
          }
        }
        return;
      }

      if (subCommand === '历史') {
        const thinking = await e.reply('正在查询电费历史，请稍候...');
        try {
          const html = await generateElectricityHistoryHTML(personNo, config);
          const imagePath = await renderHTMLToImage(html, config);
          await e.reply(ctx.segment.image(imagePath));
          setTimeout(() => unlink(imagePath, () => {}), 1000);
        } catch (error) {
          await e.reply(`查询失败：${error instanceof Error ? error.message : '未知错误'}`);
        } finally {
          if (thinking?.message_id) {
            try {
              await ctx.bot.recallMsg(thinking.message_id);
            } catch {}
          }
        }
        return;
      }

      await e.reply('支持的命令：#电费 / #电费 历史 / #电费 绑定 202xxxxxxxxx');
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if ('group_id' in e && config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return;
      await handleElectricityMessage(e, config);
    });

    ctx.handle('message.private', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (await handleWarningUnsubscribe(e, config)) return;
      await handleElectricityMessage(e, config);
    });

    // 每天检查余额（早上 9 点执行）
    ctx.cron('0 9 * * *', async () => {
      await checkBalanceAndWarn();
    });

    // 进程退出清理
    const cleanup = async () => {
      const tempDir = join(pluginDir, 'temp');
      if (existsSync(tempDir)) {
        console.log('清理临时文件夹...');
        readdirSync(tempDir).forEach(file => {
          try {
            unlinkSync(join(tempDir, file));
          } catch (err) {
            console.error(`删除临时文件失败 ${file}:`, err);
          }
        });
      }
    
      await closeBrowserInstance();
    };

    return () => {
        cleanup();
    }
  }
});
