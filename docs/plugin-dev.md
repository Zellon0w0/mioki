# Mioki 插件配置开发规范文档

本文件定义了 Mioki 插件的外部配置开发规范。在开发和重构插件时，请务必遵守此规范，以保证插件配置能够在 WebUI 中正常可视化地读取、呈现与管理。

## 核心规范

> [!IMPORTANT]
> **配置隔离存储：** 所有插件的控制参数、黑白名单、第三方 API 密钥（如 ChatGPT apikey/model、60s 插件 API 地址）等，必须存储在插件同级目录的独立文件 `config.json` 中，禁止硬编码在代码或框架的核心配置文件内。

---

## 插件目录结构

每个支持可视化配置的插件应采用如下目录结构：

```
plugins/
└── your-plugin-name/
    ├── index.ts              # 插件入口主文件
    ├── config.json           # 运行配置文件（自动生成或手动配置）
    └── config.schema.json    # [可选] 配置描述文件，用于在 WebUI 自动生成精美表单
```

---

## 1. 声明配置属性 Schema (`config.schema.json`)

为了在 WebUI 页面上显示友好的表单输入框，我们使用标准的 **JSON Schema** 规范定义字段类型。如果未提供 `config.schema.json`，WebUI 会根据 `config.json` 的字段值自动推导简单表单，但推荐显式声明此文件。

### 示例文件

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ChatGPT 插件配置",
  "description": "管理 ChatGPT 问答机器人的 API 密钥、模型以及群白名单",
  "type": "object",
  "properties": {
    "enabled": {
      "title": "启用状态",
      "type": "boolean",
      "default": true,
      "description": "是否开启本插件的应答处理"
    },
    "apiKey": {
      "title": "API Key",
      "type": "string",
      "description": "OpenAI 接口调用的 Bearer Token"
    },
    "model": {
      "title": "使用的模型",
      "type": "string",
      "default": "gpt-4o-mini",
      "description": "默认使用的聊天模型"
    },
    "apiUrl": {
      "title": "API 请求地址",
      "type": "string",
      "default": "https://api.openai.com/v1",
      "description": "模型请求代理地址"
    },
    "whitelist": {
      "title": "白名单群组",
      "type": "array",
      "items": {
        "type": "integer"
      },
      "description": "允许响应此命令的 QQ 群号，每行一个"
    }
  },
  "required": ["apiKey"]
}
```

### 字段说明与控件映射

WebUI 解析配置 Schema 时的规则如下：
1. **布尔值 (Boolean)** (`"type": "boolean"`)：渲染为左右滑动的 **Toggle 开关**。
2. **数字 (Integer/Number)** (`"type": "integer"` 或 `"type": "number"`)：渲染为 **数字输入框**。
3. **字符串 (String)** (`"type": "string"`)：渲染为 **单行文本输入框**。
   - *敏感信息自动隐藏*：如果属性名中含有 `key`、`token`、`secret`、`password` 等单词，或者定义了 `"format": "password"`，则表单上输入框类型会被自动设为 `password` 以作遮罩。
4. **数组 (Array)** (`"type": "array"`)：渲染为 **多行文本域 (Textarea)**，输入时每行代表一个值（例如群号或QQ号）。
5. **对象 (Object)** (`"type": "object"`)：渲染为 **内嵌分组卡片**，用以组织多级属性分组。

---

## 2. 插件代码中加载与使用配置 (`index.ts`)

在插件逻辑中，应在 `setup` 期间读取 `config.json`，并在处理事件或定时任务时进行使用。

### 推荐实现模式

```ts
import path from 'node:path'
import fs from 'node:fs'
import { definePlugin, getAbsPluginDir } from 'mioki'

// 1. 定义配置属性接口
interface PluginConfig {
  enabled: boolean
  apiKey: string
  model: string
  apiUrl: string
  whitelist: number[]
}

export default definePlugin({
  name: 'chat-gpt', // 保持与目录名一致
  version: '1.0.0',
  setup(ctx) {
    const pluginDir = path.join(getAbsPluginDir(), 'chat-gpt')
    const configPath = path.join(pluginDir, 'config.json')

    // 2. 加载配置的函数
    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        apiKey: '',
        model: 'gpt-4o-mini',
        apiUrl: 'https://api.openai.com/v1',
        whitelist: []
      }

      if (!fs.existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent)
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，回退到默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    // 3. 处理事件（事件发生时读取最新配置）
    ctx.handle('message.group', async (event) => {
      const config = loadConfig()
      
      // 未启用则跳过
      if (!config.enabled) return
      
      // 白名单限制过滤
      if (config.whitelist.length > 0 && !config.whitelist.includes(event.group_id)) {
        return
      }

      if (event.raw_message === '提问') {
        if (!config.apiKey) {
          return event.reply('未配置 API 密钥，请在 WebUI 面板中配置后再试。')
        }
        
        event.reply(`已向模型 [${config.model}] 发起请求，API 地址: ${config.apiUrl}`)
      }
    })
  }
})
```

---

## 3. 热更新原理

WebUI 修改并点击保存后，会：
1. 更新目标插件目录下的 `config.json` 文件。
2. 触发该插件的 **热重载 (Hot Reload)**：WebUI 调用框架的 `disable` 注销插件注册的所有事件和任务，并通过 `jiti.import` 重新导入最新代码，接着重新运行 `enablePlugin`。
3. 插件的 `setup()` 函数重新执行，下次加载事件或任务时即可立即使用新的 `config.json` 参数，**无需重启机器人程序**。

---

## 4. 与系统管理插件的联动规范

为了提供更佳的用户体验，Mioki 内置了统一管理插件功能（如「黑白名单管理」与「菜单/帮助」）。在新开发或重构插件时，遵守以下接口契约可以让插件自动对接这些功能。

### 4.1 自动接入「黑白名单管理」插件

系统内置了 **「白名单管理」** 插件，会在 WebUI 中提供一个统一的页面来快捷配置各个插件的白名单群聊或黑名单用户。如果希望新插件的黑白名单被自动识别并展示在 WebUI 中，请确保 `config.schema.json` 中对应的属性声明符合以下条件：

1. **类型必须为整数/数字数组**：
   ```json
   "type": "array",
   "items": {
     "type": "integer"
   }
   ```
2. **命名字段/标题匹配规则**：属性的 `key`（键名）、`title`（标题）或 `description`（描述信息）中包含以下任意关键词：
   - 英文：`whitelist`、`blacklist`
   - 中文：`白名单`、`黑名单`
   - 或者属性的 `"format"` 指定为 `"group-list"`。

> [!TIP]
> 只要符合上述规范，WebUI 面板便会自动渲染出配置该插件黑白名单的群组/用户选择卡片。管理员保存修改后，该插件也会自动热重载以生效配置。

### 4.2 自动同步至「菜单与帮助」插件

系统内置了 **「菜单」** 插件，用于生成酷炫的图片格式指令帮助。
1. **自动发现**：菜单插件启动时，会自动扫描本地所有的插件目录，并为新插件在 `displayedPlugins` 菜单配置列表内自动注册一条默认条目：
   - 触发指令：`#[插件目录名]`
   - 指令描述：`使用 [插件目录名] 插件`
2. **自定义编辑**：自动同步后，管理员可在 WebUI 的“菜单与帮助插件配置”页面中，自定义修改各个插件在菜单上展示的命令列表、名称、指令说明以及展示顺序。

---

## 5. 插件资源与内存管理规范 (避坑指南)

在开发与重构 Mioki 插件时，为避免**内存泄漏、Chromium 句柄残留、磁盘文件堆积、以及同步阻塞事件循环**等高风险问题，必须遵循以下开发规范：

### 5.1 避免 Express 路由与 WebUI 页面泄漏
禁止直接使用 `webui.app.get` 或 `app.post` 注册路由。当插件被热重载或禁用时，这些路由会残留在 Express 路由栈中，导致旧的 `MiokiContext` 无法被垃圾回收，并且匹配时旧版本层优先执行导致新修改不生效。
- **规范做法**：使用 `webui.registerRouter(prefix, router)` 和 `webui.registerPage(page)` 注册。它们会返回注销函数。
- **清理逻辑**：在 `ctx.clears` 中注册注销函数：
  ```typescript
  const unregisterPage = webui.registerPage({ id: 'my-plugin', title: '标题', ... })
  const router = express.Router()
  router.get('/data', ...)
  const unregisterRouter = webui.registerRouter('/api/my-plugin', router)

  ctx.clears.add(() => unregisterPage?.())
  ctx.clears.add(() => unregisterRouter?.())
  ```

### 5.2 严格保护 Puppeteer 页面句柄
使用 Chromium 渲染截图时，打开 `page` 后随后的页面渲染与截图操作如果抛出异常（网络超时、Chromium 崩盘等），会导致后面的 `page.close()` 被跳过，产生 Chromium 页面句柄残留并最终引发 OOM 崩溃。
- **规范做法**：必须使用 `try...finally` 块确保 `page.close()` 绝对被执行。
  ```typescript
  const page = await browser.newPage()
  try {
    await page.setContent(htmlContent)
    return await page.screenshot(...)
  } finally {
    await page.close()
  }
  ```
- **关闭浏览器实例**：在插件清理钩子中，应使用 `async` 函数等待浏览器实例完全关闭，防止进程冲突：
  ```typescript
  return async () => {
    await closeBrowserInstance()
  }
  ```

### 5.3 临时文件清理与延迟安全
很多插件发送渲染的临时图片、音视频后会延迟删除它们。若发送操作 `e.reply` 报错，则后续的清理逻辑被中断导致磁盘泄漏。另外，高负载下过短的删除延迟（例如 1 秒）可能使 NapCat 还没来得及读取文件就被删除了。
- **规范做法**：将清理延迟设置为至少 **15 秒**，并使用 `finally` 块保证不论发送成败均会创建定时器，且将定时器注册到 `ctx.clears` 以在插件重载时自动注销：
  ```typescript
  let tempPath: string | null = null
  try {
    tempPath = await generateImage(...)
    await e.reply(ctx.segment.image(`file://${tempPath}`))
  } finally {
    if (tempPath) {
      const fileToDelete = tempPath
      const timer = setTimeout(() => {
        try {
          if (fs.existsSync(fileToDelete)) fs.unlinkSync(fileToDelete)
        } catch (err) {
          ctx.logger.error(`清理临时文件失败: ${err}`)
        }
      }, 15000)
      ctx.clears.add(() => clearTimeout(timer))
    }
  }
  ```

### 5.4 消除 Promise.race 导致的超时定时器泄漏
使用 `Promise.race` 实现 API 接口超时控制时，一旦 API 快速成功响应，用于超时的 `setTimeout` 依然会在后台激活，阻止 Promise 垃圾回收。
- **规范做法**：保存定时器 ID，并在 `finally` 中立即清理：
  ```typescript
  let timeoutId: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('请求超时')), baseConfig.OPENAI_TIMEOUT)
  })

  try {
    const response = await Promise.race([apiCallPromise, timeoutPromise])
    // 处理...
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
  ```

### 5.5 长生命周期状态与缓存的淘汰机制 (TTL)
如果在 Map 或 Object 中保存了用户的临时点歌、多步交互状态，一旦用户半途放弃且没有发送“取消”，该状态将永久驻留在内存中。
- **规范做法**：引入过期删除机制。例如保存用户状态时设置一个 5 分钟的超时定时器，并在状态结束或重载时将其清除。
  ```typescript
  // 点歌 session 淘汰示例
  const timer = setTimeout(() => {
    sessions.delete(sessionKey)
  }, config.sessionTimeoutMs)
  ctx.clears.add(() => clearTimeout(timer))
  ```

### 5.6 避免在消息处理器中进行同步磁盘 I/O
每次有群消息进来时都同步调用 `fs.readFileSync` 读取配置文件，在高并发环境下会严重阻塞 Node.js 的单线程事件循环，导致网络心跳超时断开。
- **规范做法**：在 `setup` 初始化时读取一次配置并放入闭包作用域变量（如 `let config = loadConfig()`）。由于 WebUI 修改配置时会自动触发插件的热重载，闭包内的变量会自动更新。如果通过指令写入了配置，应在写入时同时更新闭包中的 `config` 变量：
  ```typescript
  async setup(ctx) {
    let config = loadConfig() // 仅在 setup 时读盘一次

    ctx.handle('message', async (e) => {
      if (!config.enabled) return // 直接使用内存变量
      // ...
    })
  }
  ```

### 5.7 避免在模块顶层 (Module Scope) 声明可变状态与资源句柄
在编写插件代码时，禁止在 `export default definePlugin(...)` 的外部（即模块顶层）声明与运行状态相关的可变变量，例如 `let browser: Browser | null`、`let activeSessions = new Map()` 或 `let isProcessing = false`。
- **原因**：Node.js 对已导入的模块有强缓存机制。当通过 WebUI 修改配置触发插件热重载（先 `disable` 再重新 `enable`）时，该插件的 JS/TS 代码文件**不会被重新执行**，其模块顶层声明的变量也会被继续保留在内存中。这会导致：
  1. 新的插件实例与旧的清理逻辑竞争同一个全局变量，导致生命周期错乱。
  2. 旧的状态、缓存数据仍然遗留，导致内存泄漏或业务逻辑状态交错。
- **规范做法**：所有会随插件开启、关闭、重载而发生变化的变量、连接或实例，**必须声明在 `setup()` 函数体内**，使其作为局部闭包变量与特定的插件实例生命周期绑定。

### 5.8 异步清理定时器与文件操作中必须使用 try-catch 包裹
在 `setTimeout` 或 `setInterval` 等异步回调函数中执行 `fs.unlinkSync`、`page.close()` 等操作时，切忌直接调用而不做异常捕获。
- **原因**：异步回调的执行上下文已经脱离了插件主流程同步错误捕获（try-catch）作用域。如果在异步回调中发生任何异常（如文件已被提前删除、目录无权限、资源被占用等），且没有显式捕获，将会抛出 `uncaughtException`，在现代 Node.js 生产环境中这可能直接导致整个机器人服务进程崩溃挂掉。
- **规范做法**：异步定时器和清理逻辑内部，必须使用 `try-catch` 块包裹所有可能报错的操作，并将错误打印在日志中：
  ```typescript
  const timer = setTimeout(() => {
    try {
      if (fs.existsSync(fileToDelete)) {
        fs.unlinkSync(fileToDelete)
      }
    } catch (err) {
      ctx.logger.error(`删除临时文件失败: ${err}`)
    }
  }, 15000)
  ```

### 5.9 妥善等待并 Await 清理钩子中的异步操作
在插件卸载清理时，如果存在异步操作（如关闭 Puppeteer 浏览器实例、断开外部数据库连接），必须将其定义为 `async` 函数并妥善使用 `await` 或返回 Promise。
- **原因**：若不等待异步清理执行完毕，当新版插件快速启动时，旧版的浏览器进程或数据库连接可能仍处于关闭中的未决状态，极易造成端口冲突、文件锁占用以及操作系统句柄泄漏等竞态问题。
- **规范做法**：在卸载钩子中执行 `async` Teardown：
  ```typescript
  return async () => {
    // 确保异步关闭实例完全完成
    await closeBrowserInstance()
  }
  ```

### 5.10 避免同步阻塞事件循环的耗时操作 (如 SQLite 同步 VACUUM)
在消息处理器或主线程同步代码中，避免执行耗时的 CPU 密集型任务或阻塞式磁盘操作，例如对较大的 SQLite 数据库执行同步 `VACUUM`。
- **原因**：Node.js 是单线程的，任何耗时的同步操作（例如在主线程同步调用大文件读写，或者让 SQLite 执行数秒的同步数据重组）都会导致事件循环暂停，导致机器人期间无法处理其他群的任何消息，甚至导致 WebSocket 连接心跳超时断开。
- **规范做法**：耗时的数据整理、分析或 I/O，请使用异步方法执行，或者将其移至定时任务在深夜闲时分批处理。

### 5.11 路径处理避免使用 path.join(filePath, '..') 获取父级目录
当需要获取某个文件或目录的父级目录时，避免使用 `path.join(filePath, '..')`。
- **原因**：虽然该操作在 Node.js 中能通过路径规范化解析出父目录，但在语意上不清晰，容易在相对路径、空路径或跨平台（如 Windows 反斜杠）中引入边缘 bug 或解析歧义。
- **规范做法**：推荐使用 Node.js 官方提供的 `path.dirname(filePath)` 来获取父级目录，语义清晰且平台兼容性强。

