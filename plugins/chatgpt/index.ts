import { definePlugin, getAbsPluginDir } from 'mioki'
import OpenAI from 'openai'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, unlink } from 'node:fs'
import MarkdownIt from 'markdown-it'
// @ts-ignore missing types
import mk from 'markdown-it-katex'
import type { RecvImageElement } from 'napcat-sdk'

// 获取当前插件目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 白名单接口定义
interface Whitelist {
  groupWhitelist: number[]
  nickname: string[]
}

// 配置接口定义
interface PluginConfig {
  enabled: boolean
  currentModel: string
  currentApi: string
  models: string[]
  apis: { name: string; url: string; apiKey: string }[]
  groupWhitelist: number[]
}

type PromptImage = {
  label: string
  url: string
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

/**
 * 基础配置
 */
const baseConfig = {
  DIRECT_TRIGGER: ['%', '％', '$', '￥'],
  MAX_RESPONSE_LENGTH: 5000,
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  OPENAI_TIMEOUT: 180000, // 3分钟超时
  RENDER_WAIT_TIME: 1000,
  STREAM_RESPONSE: false,
  CHUNK_TIMEOUT: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY: 2000
};

function getImageUrlFromSegment(image: RecvImageElement): string {
  return [image.url, image.path, image.file].find((value): value is string => {
    if (typeof value !== 'string' || !value.trim()) return false
    return /^(https?:\/\/|data:|base64:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\/)/.test(value)
  }) || ''
}

function normalizeMimeType(contentType: string | null, imageUrl: string): string {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mediaType?.startsWith('image/')) return mediaType

  const pathname = imageUrl.split('?')[0]?.toLowerCase() || ''
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.bmp')) return 'image/bmp'

  return 'image/png'
}

function getLocalImagePath(imageUrl: string): string | null {
  if (imageUrl.startsWith('file://')) {
    try {
      return fileURLToPath(imageUrl)
    } catch {
      return imageUrl.replace(/^file:\/\/\/?/, '')
    }
  }

  if (/^[a-zA-Z]:[\\/]/.test(imageUrl) || imageUrl.startsWith('/')) {
    return imageUrl
  }

  return null
}

async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('data:')) return imageUrl
  if (imageUrl.startsWith('base64://')) return `data:image/png;base64,${imageUrl.slice('base64://'.length)}`

  const localPath = getLocalImagePath(imageUrl)
  if (localPath && existsSync(localPath)) {
    const buffer = readFileSync(localPath)
    if (buffer.byteLength > baseConfig.MAX_IMAGE_BYTES) {
      throw new Error(`图片过大: ${buffer.byteLength} bytes`)
    }

    return `data:${normalizeMimeType(null, localPath)};base64,${buffer.toString('base64')}`
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error(`不支持的图片地址: ${imageUrl}`)
  }

  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status} ${response.statusText}`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > baseConfig.MAX_IMAGE_BYTES) {
    throw new Error(`图片过大: ${contentLength} bytes`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > baseConfig.MAX_IMAGE_BYTES) {
    throw new Error(`图片过大: ${arrayBuffer.byteLength} bytes`)
  }

  const mimeType = normalizeMimeType(response.headers.get('content-type'), imageUrl)
  return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString('base64')}`
}

async function prepareImageUrl(image: PromptImage): Promise<string> {
  try {
    return await imageUrlToDataUrl(image.url)
  } catch (error) {
    console.warn(`图片转为 data URL 失败，回退原始链接 (${image.label}):`, error)
    return image.url
  }
}

function buildPromptText(content: string, quotedText: string, images: PromptImage[]): string {
  const parts: string[] = []

  if (quotedText) {
    parts.push(`引用消息文字：\n${quotedText}`)
  }

  if (content) {
    parts.push(`提问：\n${content}`)
  }

  if (images.length > 0) {
    parts.push(`图片上下文：\n${images.map(image => `- ${image.label}`).join('\n')}`)
  }

  if (parts.length === 0 && images.length > 0) {
    return '请根据图片内容进行分析并回答。'
  }

  return parts.join('\n\n')
}

async function buildOpenAIMessageContent(text: string, images: PromptImage[]): Promise<string | ChatContentPart[]> {
  if (images.length === 0) return text

  const content: ChatContentPart[] = [
    {
      type: 'text',
      text: text || '请根据图片内容进行分析并回答。',
    },
  ]

  for (const image of images) {
    content.push({ type: 'text', text: `${image.label}：` })
    content.push({
      type: 'image_url',
      image_url: {
        url: await prepareImageUrl(image),
        detail: 'auto',
      },
    })
  }

  return content
}

function isVisionUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : JSON.stringify(error)
  return /image_url|image input|vision|multimodal|multi-modal|unsupported.*image|image.*unsupported|content.*array|expected.*string|invalid.*content/i.test(message || '')
}
// 默认配置
const defaultConfig: PluginConfig = {
  enabled: true,
  currentModel: 'deepseek-chat',
  currentApi: 'deepseek',
  models: [
    'deepseek-chat',
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'gemini-2.5-flash'
  ],
  apis: [
    {
      name: 'deepseek',
      url: 'https://api.deepseek.com/v1',
      apiKey: 'sk-your-deepseek-key'
    },
    {
      name: 'openai',
      url: 'https://api.openai.com/v1',
      apiKey: 'sk-your-openai-key'
    },
    {
      name: 'maoleio',
      url: 'https://api.maoleio.com/v1',
      apiKey: 'sk-your-maoleio-key'
    }
  ],
  groupWhitelist: []
};

// 全局浏览器实例
let globalBrowser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

// 初始化 Markdown 解析器
const md = new MarkdownIt();
md.use(mk);

/**
 * 获取浏览器实例
 */
async function getBrowserInstance(): Promise<Browser> {
  if (globalBrowser) {
    return globalBrowser;
  }
  if (!browserLaunchPromise) {
    console.log('启动浏览器实例...');
    browserLaunchPromise = puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
      timeout: 60000
    }).then(b => {
      globalBrowser = b;
      browserLaunchPromise = null;
      return b;
    }).catch(err => {
      browserLaunchPromise = null;
      throw err;
    });
  }
  return browserLaunchPromise;
}

/**
 * 关闭浏览器实例
 */
async function closeBrowserInstance() {
  if (browserLaunchPromise) {
    console.log('等待正在启动的浏览器实例并关闭...');
    try {
      const b = await browserLaunchPromise;
      const pages = await b.pages();
      await Promise.all(pages.map((page: Page) => page.close()));
      await b.close();
    } catch (err) {
      console.error('关闭正在启动的浏览器时出错:', err);
    } finally {
      browserLaunchPromise = null;
      globalBrowser = null;
    }
    return;
  }
  if (globalBrowser) {
    console.log('关闭浏览器实例...');
    try {
      const pages = await globalBrowser.pages();
      await Promise.all(pages.map((page: Page) => page.close()));
      await globalBrowser.close();
    } catch (err) {
      console.error('关闭浏览器时出错:', err);
    } finally {
      globalBrowser = null;
    }
  }
}
function cleanupTempFolder() {
  const tempDir = join(__dirname, 'temp');
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
}

/**
 * 渲染Markdown为图片
 */
async function renderMarkdownToImage(markdown: string): Promise<string> {
  console.log('渲染Markdown，长度:', markdown.length);
  let page: Page | null = null;
  
  try {
    const renderedMarkdown = md.render(markdown);
    const contentWidth = 600;
    const padding = 35;
    const totalWidth = contentWidth + padding * 2;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
        <style>
          body {
            width: ${contentWidth}px;
            margin: 0;
            padding: 30px ${padding}px;
            font-family: "汉仪文黑-85W", "HYWenHei-85W", "汉仪文黑", "HYWenHei", "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
            line-height: 1.6;
            color: #333;
          }
           h1, h2, h3, h4, h5, h6 {
             margin-top: 1.5em;
             margin-bottom: 0.5em;
           }
           p {
             margin: 0.5em 0;
           }
           code {
             background-color: #f5f5f5;
             padding: 0.2em 0.4em;
             border-radius: 3px;
             font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
           }
           pre {
             background-color: #f5f5f5;
             padding: 1em;
             border-radius: 5px;
             overflow-x: auto;
           }
           blockquote {
             border-left: 4px solid #ddd;
             margin: 1em 0;
             padding-left: 1em;
             color: #666;
           }
           hr {
             border: none;
             border-top: 1px solid #eee;
             margin: 2em 0;
           }
           .model-info {
             margin-top: 2em;
             padding-top: 1em;
             border-top: 1px dashed #ddd;
             font-size: 0.85em;
             color: #888;
             font-style: italic;
           }
        </style>
      </head>
      <body>
        ${renderedMarkdown}
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
      </body>
      </html>
    `;

    const browser = await getBrowserInstance();
    page = await browser.newPage();

    await page.setViewport({
      width: totalWidth,
      height: 100,
      deviceScaleFactor: 2,
    });

    console.log('加载HTML内容...');
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: baseConfig.OPENAI_TIMEOUT

    });

    console.log('等待渲染...');
    await new Promise(resolve => setTimeout(resolve, baseConfig.RENDER_WAIT_TIME));

    const height = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
    });

    console.log('内容高度:', height);
    await page.setViewport({
      width: totalWidth,
      height: Math.ceil(height),
      deviceScaleFactor: 2,
    });

    const tempDir = join(__dirname, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    const imagePath = join(tempDir, `${Date.now()}.png`);
    await page.screenshot({ path: imagePath, type: 'png', fullPage: true, captureBeyondViewport: true });
    return imagePath;
  } catch (error) {
    console.error('渲染Markdown出错:', error);
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (err) {
        console.error('关闭页面出错:', err);
      }
    }
  }
}

export default definePlugin({
  name: 'chatgpt',
  version: '1.5.0',
  description: '支持模型切换、API切换的ChatGPT插件',
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), 'chatgpt')
    const configPath = join(pluginDir, 'config.json')

    // 加载配置
    function loadConfig(): PluginConfig {
      if (!existsSync(configPath)) {
        ctx.logger.info(`[+] 配置文件不存在，写入默认配置`)
        if (!existsSync(pluginDir)) {
          mkdirSync(pluginDir, { recursive: true })
        }
        writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        return defaultConfig
      }

      try {
        const content = readFileSync(configPath, 'utf-8')
        const config = JSON.parse(content)
        // 合并默认，以防字段缺失
        return { ...defaultConfig, ...config }
      } catch (err) {
        ctx.logger.warn(`[-] 加载配置失败: ${err}`)
        return defaultConfig
      }
    }

    // 保存配置
    function saveConfig(config: PluginConfig): void {
      try {
        if (!existsSync(pluginDir)) {
          mkdirSync(pluginDir, { recursive: true })
        }
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      } catch (err) {
        ctx.logger.warn(`[-] 保存配置失败: ${err}`)
      }
    }

    // 初始化时加载配置
    let pluginConfig = loadConfig()

    // 获取当前API配置
    function getCurrentApiConfig() {
      const apiConfig = pluginConfig.apis.find(a => a.name === pluginConfig.currentApi)
      if (!apiConfig) {
        ctx.logger.warn(`[-] API配置不存在: ${pluginConfig.currentApi}`)
        return pluginConfig.apis[0] || defaultConfig.apis[0]
      }
      return apiConfig
    }

    // 自定义fetch适配器（兼容maoleio API）
    const customFetch = async (url: RequestInfo, init?: RequestInit) => {
      let response: Response
      try {
        if (init?.method === 'POST' && init.body) {
          const body = JSON.parse(init.body.toString());
          body.stream = false; // 强制禁用流式
          
          // 兼容maoleio API：如果使用maoleio API，可能需要调整请求格式
          if (pluginConfig.currentApi === 'maoleio') {
            // maoleio兼容OpenAI Completions API，但可能需要调整模型名称
            if (body.model && body.model.startsWith('gpt-')) {
              // maoleio可能使用不同的模型命名约定
            }
            
            // 添加调试日志
            console.log('使用maoleio API，请求体:', JSON.stringify(body, null, 2))
          }
          
          init.body = JSON.stringify(body);
        }
        
        // 使用全局 fetch
        response = await fetch(url, init);
        
        // 记录响应状态和头部信息
        console.log(`API响应状态: ${response.status} ${response.statusText}`)
        
        if (pluginConfig.currentApi === 'maoleio') {
          const responseText = await response.text()
          console.log('maoleio API原始响应:', responseText)
          
          // 尝试解析响应
          try {
            const parsedResponse = JSON.parse(responseText)
            console.log('maoleio API解析后响应:', JSON.stringify(parsedResponse, null, 2))
            
            // 检查响应结构
            if (!parsedResponse.choices || !Array.isArray(parsedResponse.choices)) {
              console.warn('maoleio API响应缺少choices字段或格式不正确')
            }
            
            // 返回一个新的Response对象，包含解析后的文本
            return new Response(responseText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            })
          } catch (parseError) {
            console.error('解析maoleio API响应失败:', parseError)
            console.error('原始响应文本:', responseText)
            throw new Error(`maoleio API响应格式错误: ${parseError instanceof Error ? parseError.message : '未知错误'}`)
          }
        }
        
        return response
      } catch (error) {
        console.error('fetch请求失败:', error)
        throw error
      }
    };

    // 创建OpenAI客户端
    function createOpenAIClient() {
      const apiConfig = getCurrentApiConfig()
      return new OpenAI({
        baseURL: apiConfig.url,
        apiKey: apiConfig.apiKey,
        defaultHeaders: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        fetch: customFetch as any
      })
    }

    let openai = createOpenAIClient()

    // 初始化临时文件夹
    const tempDir = join(__dirname, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    } else {
      cleanupTempFolder();
    }

    // 处理管理命令
    async function handleAdminCommand(e: any, text: string): Promise<boolean> {
      const trimmedText = text.trim()
      const parts = trimmedText.split(/\s+/)
      
      if (parts[0] !== '#gpt') {
        return false
      }

      const cmd = parts[1]

      // #gpt help / #gpt
      if (!cmd || cmd === 'help') {
        const helpText = `ChatGPT插件命令:
#gpt model <模型名称> - 切换模型
#gpt api <API名称> - 切换API
#gpt list model - 列出可用模型
#gpt list api - 列出可用API
#gpt add api <名称> <URL> <API密钥> - 添加新API配置
#gpt add model <模型名称> - 添加新模型
#gpt help - 显示此帮助

触发方式:
%问题 或 $问题
支持直接发送图文、引用文字后提问、引用图片后提问、引用图文消息后提问

当前配置:
- 启用状态: ${pluginConfig.enabled ? '已启用' : '已禁用'}
- 当前模型: ${pluginConfig.currentModel}
- 当前API: ${pluginConfig.currentApi}`
        await e.reply(helpText)
        return true
      }

      // #gpt model <model_name>
      if (cmd === 'model') {
        const modelName = parts.slice(2).join(' ').trim()
        if (!modelName) {
          await e.reply('请指定模型名称，例如: #gpt model gpt-4o')
          return true
        }
        
        if (!pluginConfig.models.includes(modelName)) {
          await e.reply(`模型 "${modelName}" 不存在。可用模型:\n${pluginConfig.models.map(m => `- ${m}`).join('\n')}`)
          return true
        }
        
        pluginConfig.currentModel = modelName
        saveConfig(pluginConfig)
        await e.reply(`已切换到模型: ${modelName}`)
        return true
      }
      
      // #gpt api <api_name>
      if (cmd === 'api') {
        const apiName = parts.slice(2).join(' ').trim()
        if (!apiName) {
          await e.reply('请指定API名称，例如: #gpt api deepseek')
          return true
        }
        
        const api = pluginConfig.apis.find(a => a.name === apiName)
        if (!api) {
          await e.reply(`API "${apiName}" 不存在。可用API:\n${pluginConfig.apis.map(a => `- ${a.name}`).join('\n')}`)
          return true
        }
        
        pluginConfig.currentApi = apiName
        openai = createOpenAIClient()
        saveConfig(pluginConfig)
        await e.reply(`已切换到API: ${apiName}`)
        return true
      }
      
      // #gpt list <api/model>
      if (cmd === 'list') {
        const listType = parts[2]
        
        if (listType === 'model' || listType === 'models') {
          const modelsList = pluginConfig.models
            .map(m => `${m === pluginConfig.currentModel ? '→ ' : '  '}${m}`)
            .join('\n')
          await e.reply(`可用模型 (当前: ${pluginConfig.currentModel}):\n${modelsList}`)
          return true
        }
        
        if (listType === 'api' || listType === 'apis') {
          const apisList = pluginConfig.apis
            .map(a => `${a.name === pluginConfig.currentApi ? '→ ' : '  '}${a.name}: ${a.url}`)
            .join('\n')
          await e.reply(`可用API (当前: ${pluginConfig.currentApi}):\n${apisList}`)
          return true
        }
        
        await e.reply('用法: #gpt list api 或 #gpt list model')
        return true
      }
      
      // #gpt add api <名称> <URL> <API密钥>
      if (cmd === 'add' && parts[2] === 'api') {
        const args = parts.slice(3)
        if (args.length < 3) {
          await e.reply('用法: #gpt add api <名称> <URL> <API密钥>')
          return true
        }
        const [name, url, apiKey] = args
        const existingIndex = pluginConfig.apis.findIndex(a => a.name === name)
        if (existingIndex !== -1) {
          pluginConfig.apis[existingIndex] = { name, url, apiKey }
          await e.reply(`已更新 API 配置 "${name}"`)
        } else {
          pluginConfig.apis.push({ name, url, apiKey })
          await e.reply(`已添加 API 配置 "${name}"`)
        }
        saveConfig(pluginConfig)
        if (pluginConfig.currentApi === name) {
          openai = createOpenAIClient()
        }
        return true
      }

      // #gpt add model <模型名称>
      if (cmd === 'add' && parts[2] === 'model') {
        const modelName = parts.slice(3).join(' ').trim()
        if (!modelName) {
          await e.reply('用法: #gpt add model <模型名称>')
          return true
        }
        if (pluginConfig.models.includes(modelName)) {
          await e.reply(`模型 "${modelName}" 已存在`)
          return true
        }
        pluginConfig.models.push(modelName)
        saveConfig(pluginConfig)
        await e.reply(`已添加模型: ${modelName}`)
        return true
      }
      
      return false
    }

    function collectPromptImages(currentImages: RecvImageElement[], quoteImages: RecvImageElement[]): PromptImage[] {
      const images: PromptImage[] = []

      quoteImages.forEach((image, index) => {
        const url = getImageUrlFromSegment(image)
        if (url) images.push({ label: `引用图片 ${index + 1}`, url })
      })

      currentImages.forEach((image, index) => {
        const url = getImageUrlFromSegment(image)
        if (url) images.push({ label: `当前消息图片 ${index + 1}`, url })
      })

      return images
    }

    ctx.handle('message.group', async (e) => {
      // 检查启用状态与群白名单
      if (!pluginConfig.enabled) return
      if (pluginConfig.groupWhitelist.length > 0 && !pluginConfig.groupWhitelist.includes(e.group_id)) return

      const text = ctx.text(e)

      // 处理管理命令
      if (text.startsWith('#gpt')) {
        const handled = await handleAdminCommand(e, text)
        if (handled) return
      }
      
      if (!baseConfig.DIRECT_TRIGGER.some(trigger => text.startsWith(trigger))) {
        return;
      }

      const content = text.slice(1).trim();
      const quoteMsg = await ctx.getQuoteMsg(e);
      const quotedText = quoteMsg ? ctx.text(quoteMsg) : '';
      const currentImages = ctx.filter(e, 'image');
      const quoteImages = quoteMsg ? ctx.filter(quoteMsg, 'image') : [];
      const promptImages = collectPromptImages(currentImages, quoteImages);
      const prompt = buildPromptText(content, quotedText, promptImages);

      if (!prompt && promptImages.length === 0) {
        await e.reply('请引用要分析的消息或直接输入内容');
        return;
      }

      console.log('处理请求，长度:', prompt.length, '图片数量:', promptImages.length);
      let thinkingMsg;
      try {
          thinkingMsg = await e.reply('thinking...');
      } catch (err) {
          console.error('发送思考消息失败:', err);
      }

      try {
        let lastError: Error | null = null;
        const userMessageContent = await buildOpenAIMessageContent(prompt, promptImages)
        
        for (let retry = 0; retry <= baseConfig.MAX_RETRIES; retry++) {
          try {
            console.log(`尝试第 ${retry + 1} 次请求...`);
            console.log(`使用API: ${pluginConfig.currentApi}, 模型: ${pluginConfig.currentModel}`);
            
            // 处理maoleio API的特殊模型名称
            let modelName = pluginConfig.currentModel
            if (pluginConfig.currentApi === 'maoleio') {
              // maoleio可能不支持某些模型名称，尝试调整
              if (modelName.startsWith('gpt-')) {
                // 可以尝试移除gpt-前缀或使用兼容名称
                // modelName = modelName.replace('gpt-', '')
              }
            }
            
            const response = await Promise.race([
              openai.chat.completions.create({
                model: modelName,
                max_tokens: 1024,
                temperature: 0.24,
                messages: [
                  {
                    role: 'system',
                    content: '你是一个专业、高效的信息检索引擎。你的文风精简，但直击要害。请使用中文回复，并尽可能使用 Markdown 语法（包括数学公式）。',
                  },
                  { role: 'user', content: userMessageContent },
                ],
              }),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('请求超时')), baseConfig.OPENAI_TIMEOUT)
              )
            ]) as any; // 类型转换

            const replyContent = (response.choices?.[0]?.message?.content ?? '').trim();
            if (!replyContent) {
              throw new Error('AI返回了空响应');
            }

            console.log('收到响应，长度:', replyContent.length);
            
            // 获取token使用信息
            const usage = response.usage || {}
            const promptTokens = usage.prompt_tokens || 0
            const completionTokens = usage.completion_tokens || 0
            const totalTokens = usage.total_tokens || 0
            
            // 添加模型和token信息到回复内容
            const modelInfo = `\n\n使用模型: ${pluginConfig.currentModel} | 消耗Token: ${totalTokens} (输入:${promptTokens} 输出:${completionTokens})`
            const finalContent = replyContent + modelInfo
            
            if (finalContent.length > baseConfig.MAX_RESPONSE_LENGTH) {
              await e.reply('响应内容过长，已截断显示:\n' + finalContent.substring(0, baseConfig.MAX_RESPONSE_LENGTH));
              return;
            }

            try {
              const imagePath = await renderMarkdownToImage(finalContent);
              await e.reply([ctx.segment.image(imagePath)], true);
              // 延迟删除图片，确保发送成功
              setTimeout(() => {
                unlink(imagePath, () => {});
              }, 1000);
              return;
            } catch (renderError) {
              console.error('渲染失败，回退到文本:', renderError);
              await e.reply(finalContent);
              return;
            }
           } catch (error) {
            lastError = error as Error;
            console.error(`请求失败 (${retry + 1}/${baseConfig.MAX_RETRIES + 1}):`, error);
            
            // 如果是maoleio API，记录更详细的错误信息
            if (pluginConfig.currentApi === 'maoleio') {
              if (error instanceof Error) {
                console.error('maoleio API错误详情:', {
                  message: error.message,
                  stack: error.stack,
                  api: pluginConfig.currentApi,
                  model: pluginConfig.currentModel
                })
              }
            }

            if (promptImages.length > 0 && isVisionUnsupportedError(error)) {
              await e.reply(`当前模型或API不支持图片输入，请切换到支持视觉的模型/API后重试。\n当前模型: ${pluginConfig.currentModel}\n当前API: ${pluginConfig.currentApi}`);
              return;
            }
            
            if (retry < baseConfig.MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, baseConfig.RETRY_DELAY));
            }
          }
        }

        throw lastError || new Error('请求失败');
      } catch (error) {
        console.error('最终处理失败:', error);
        await e.reply(`处理请求时出错: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        if (thinkingMsg?.message_id) {
          try {
            await ctx.bot.recallMsg(thinkingMsg.message_id);
          } catch (err) {
            console.error('撤回消息失败:', err);
          }
        }
      }
    });

    // 进程管理
    const cleanup = async () => {
      cleanupTempFolder();
      await closeBrowserInstance();
    };

    return () => {
        cleanup();
    }
  }
});
