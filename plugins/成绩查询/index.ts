import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer, { Browser } from 'puppeteer-core'
import { join, dirname } from 'path'
import { readFileSync, existsSync, mkdirSync, unlink } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_NAME = '成绩查询'
const PLUGIN_VERSION = '1.0.0'

interface Course {
  name: string
  type: string
  credit: string
  score: string
  gpa: string
}

interface SemesterData {
  semester: string
  courses: Course[]
}

interface StudentInfo {
  name: string
  stuid: string
  major: string
  class: string
}

interface PluginConfig {
  enabled: boolean
  browserPath: string
  gpaUrl: string
  whitelist: number[]
}

const TEMP_DIR = join(__dirname, 'temp')

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  async setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), '成绩查询')
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        browserPath: '/usr/bin/chromium',
        gpaUrl: '',
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

    if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true })

    let globalBrowser: Browser | null = null

    async function getBrowserInstance(browserPath: string): Promise<Browser> {
      if (!globalBrowser) {
        globalBrowser = await puppeteer.launch({
          executablePath: browserPath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          defaultViewport: { width: 1200, height: 2000, deviceScaleFactor: 2 }
        })
      }
      return globalBrowser
    }

    async function closeBrowserInstance(): Promise<void> {
      if (globalBrowser) {
        await globalBrowser.close()
        globalBrowser = null
      }
    }

    async function fetchGPAData(config: PluginConfig): Promise<{ info: StudentInfo, semesters: SemesterData[] }> {
      const browser = await getBrowserInstance(config.browserPath)
      const page = await browser.newPage()
      
      try {
        await page.goto(config.gpaUrl, { waitUntil: 'networkidle0', timeout: 60000 })

        const result = await page.evaluate(() => {
          const info: any = { name: '', stuid: '', major: '', class: '' }
          const semesters: any[] = []
          
          // 1. 提取基本信息
          const tds = Array.from(document.querySelectorAll('td'))
          for (let i = 0; i < tds.length; i++) {
            const text = tds[i].innerText.trim()
            if (text === '姓名:') info.name = tds[i+1]?.innerText.trim()
            if (text === '学号:') info.stuid = tds[i+1]?.innerText.trim()
            if (text === '专业:') info.major = tds[i+1]?.innerText.trim()
            if (text === '班级:') info.class = tds[i+1]?.innerText.trim()
          }

          // 2. 提取成绩
          const reportTable = document.getElementById('report1')
          if (!reportTable) return { info, semesters }

          const rows = Array.from(reportTable.querySelectorAll('tr'))
          const tableWidth = reportTable.offsetWidth
          const midPoint = tableWidth / 2

          const leftItems: any[] = []
          const rightItems: any[] = []

          rows.forEach(tr => {
            const cells = Array.from(tr.children) as HTMLElement[]
            if (cells.length === 0) return

            const leftCells: string[] = []
            const rightCells: string[] = []

            cells.forEach(td => {
              if (td.style.display === 'none') return
              const text = td.innerText.trim()
              if (!text) return

              const center = td.offsetLeft + td.offsetWidth / 2
              if (center < midPoint) {
                leftCells.push(text)
              } else {
                rightCells.push(text)
              }
            })

            // 解析左侧
            if (leftCells.length > 0) {
              if (leftCells[0].includes('学年') && leftCells[0].includes('学期')) {
                leftItems.push({ type: 'semester', name: leftCells[0] })
              } else if (leftCells.length >= 5) {
                 const item = {
                   type: 'course',
                   name: leftCells[0],
                   gpa: leftCells[leftCells.length - 1],
                   score: leftCells[leftCells.length - 2],
                   credit: leftCells[leftCells.length - 3],
                   courseType: leftCells[leftCells.length - 4],
                   courseName: leftCells.slice(0, leftCells.length - 4).join(' ')
                 }
                 if (!isNaN(parseFloat(item.gpa))) {
                    leftItems.push(item)
                 }
              }
            }

            // 解析右侧
            if (rightCells.length > 0) {
              if (rightCells[0].includes('学年') && rightCells[0].includes('学期')) {
                rightItems.push({ type: 'semester', name: rightCells[0] })
              } else if (rightCells.length >= 5) {
                 const item = {
                   type: 'course',
                   gpa: rightCells[rightCells.length - 1],
                   score: rightCells[rightCells.length - 2],
                   credit: rightCells[rightCells.length - 3],
                   courseType: rightCells[rightCells.length - 4],
                   courseName: rightCells.slice(0, rightCells.length - 4).join(' ')
                 }
                 if (!isNaN(parseFloat(item.gpa))) {
                    rightItems.push(item)
                 }
              }
            }
          })

          const allItems = [...leftItems, ...rightItems]
          
          let currentSemester: any = null
          allItems.forEach(item => {
            if (item.type === 'semester') {
              currentSemester = { semester: item.name, courses: [] }
              semesters.push(currentSemester)
            } else if (item.type === 'course' && currentSemester) {
              currentSemester.courses.push({
                name: item.courseName,
                type: item.courseType,
                credit: item.credit,
                score: item.score,
                gpa: item.gpa
              })
            }
          })

          return { info, semesters }
        })

        return result

      } finally {
        await page.close()
      }
    }

    async function generateGPAImage(info: StudentInfo, semesters: SemesterData[], title: string, config: PluginConfig): Promise<string> {
      const browser = await getBrowserInstance(config.browserPath)
      const page = await browser.newPage()

      const fontStyle = `"汉仪文黑-85W", "HYWenHei-85W", "Microsoft YaHei", sans-serif`

      let totalCredit = 0
      let totalGP = 0
      semesters.forEach(s => {
        s.courses.forEach(c => {
          const credit = parseFloat(c.credit)
          const gpa = parseFloat(c.gpa)
          if (!isNaN(credit) && !isNaN(gpa)) {
            totalCredit += credit
            totalGP += credit * gpa
          }
        })
      })
      const avgGPA = totalCredit > 0 ? (totalGP / totalCredit).toFixed(2) : '0.00'

      const htmlContent = `
        <html>
          <head>
            <style>
              body { margin: 0; padding: 40px; background: #f0f2f5; font-family: ${fontStyle}; color: #333; }
              .container { width: 800px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden; }
              .header { background: #007bff; padding: 30px; color: #fff; }
              .title { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
              .info { font-size: 14px; opacity: 0.9; display: flex; gap: 20px; }
              .gpa-badge { position: absolute; top: 40px; right: 40px; background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 8px; text-align: center; }
              .gpa-val { font-size: 24px; font-weight: bold; }
              .gpa-label { font-size: 12px; }
              
              .semester { margin: 20px; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
              .semester-title { background: #f8f9fa; padding: 10px 20px; font-weight: bold; color: #555; border-bottom: 1px solid #eee; }
              
              table { width: 100%; border-collapse: collapse; font-size: 13px; }
              th, td { padding: 10px 15px; text-align: left; border-bottom: 1px solid #f0f0f0; }
              th { color: #888; font-weight: normal; font-size: 12px; }
              tr:last-child td { border-bottom: none; }
              
              .score-excellent { color: #28a745; font-weight: bold; }
              .score-fail { color: #dc3545; font-weight: bold; }
              
              .footer { padding: 20px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee; }
            </style>
          </head>
          <body>
            <div class="container" style="position: relative;">
              <div class="header">
                <div class="title">${title}</div>
                <div class="info">
                  <span>专业: ${info.major}</span>
                </div>
                <div class="gpa-badge">
                   <div class="gpa-val">${avgGPA}</div>
                   <div class="gpa-label">平均绩点</div>
                </div>
              </div>

              ${semesters.map(s => `
                <div class="semester">
                  <div class="semester-title">${s.semester}</div>
                  <table>
                    <thead>
                      <tr>
                        <th style="width: 40%">课程名称</th>
                        <th style="width: 15%">类别</th>
                        <th style="width: 10%">学分</th>
                        <th style="width: 15%">成绩</th>
                        <th style="width: 20%">绩点</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${s.courses.map(c => {
                        const scoreVal = parseFloat(c.score)
                        let scoreClass = ''
                        if (!isNaN(scoreVal)) {
                          if (scoreVal >= 90) scoreClass = 'score-excellent'
                          if (scoreVal < 60) scoreClass = 'score-fail'
                        }
                        return `
                          <tr>
                            <td>${c.name}</td>
                            <td>${c.type}</td>
                            <td>${c.credit}</td>
                            <td class="${scoreClass}">${c.score}</td>
                            <td>${c.gpa}</td>
                          </tr>
                        `
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `).join('')}
              
              <div class="footer">Generated by Mioki 成绩查询 Plugin</div>
            </div>
          </body>
        </html>
      `

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' })
      const outputPath = join(TEMP_DIR, `gpa-${Date.now()}.png`)
      const container = await page.$('.container')
      if (container) {
        await container.screenshot({ path: outputPath, type: 'png' })
      } else {
        await page.screenshot({ path: outputPath, fullPage: true, type: 'png' })
      }
      await page.close()
      return outputPath
    }

    ctx.handle('message.group', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return
      if (config.whitelist.length > 0 && !config.whitelist.includes(e.group_id)) return

      const text = ctx.text(e).trim()
      
      if (text === '#查成绩' || text === '#查绩点') {
        try {
          if (!config.gpaUrl) {
            return e.reply('未配置绩点查询链接，请在 WebUI 面板中配置后再试。')
          }

          await e.reply('正在查询成绩，请稍候...')
          
          const data = await fetchGPAData(config)
          
          if (!data.semesters || data.semesters.length === 0) {
            return e.reply('未查询到成绩数据，请检查教务系统是否正常或链接是否失效。')
          }

          let displaySemesters = data.semesters
          let title = '成绩单查询'

          if (text === '#查成绩') {
            let targetSemester = data.semesters[data.semesters.length - 1]
            if (targetSemester.courses.length === 0 && data.semesters.length > 1) {
              targetSemester = data.semesters[data.semesters.length - 2]
            }
            displaySemesters = [targetSemester]
            title = '当前学期成绩'
          } else {
            title = '所有学期成绩单'
          }

          const imgPath = await generateGPAImage(data.info, displaySemesters, title, config)
          await e.reply(ctx.segment.image(`file://${imgPath}`))
          
          setTimeout(() => { if (existsSync(imgPath)) unlink(imgPath, () => {}) }, 60000)

        } catch (err) {
          ctx.logger.error(`[成绩查询] 查询失败: ${err}`)
          await e.reply(`查询失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })

    return () => {
      closeBrowserInstance()
    }
  }
})
