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
2. 触发该插件的 **热重载 (Hot Reload)**：WebUI 调用框架的 `disable` 注销插件注册的所有事件和任务，接着重新运行 `enablePlugin`。
3. 插件的 `setup()` 函数重新执行，下次加载事件或任务时即可立即使用新的 `config.json` 参数，**无需重启机器人程序**。
