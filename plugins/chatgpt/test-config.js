// 测试配置文件
const fs = require('fs')
const path = require('path')

const configPath = path.join(__dirname, 'config.json')

// 读取配置文件
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  console.log('当前配置:')
  console.log('当前模型:', config.currentModel)
  console.log('当前API:', config.currentApi)
  console.log('\n可用模型:')
  Object.entries(config.models).forEach(([id, name]) => {
    console.log(`  ${id}: ${name}`)
  })
  console.log('\n可用API:')
  Object.entries(config.apis).forEach(([name, api]) => {
    console.log(`  ${name}: ${api.url}`)
  })
} else {
  console.log('配置文件不存在')
}

// 测试命令解析
console.log('\n测试命令解析:')
const testCommands = [
  '#gpt model deepseek-chat',
  '#gpt api deepseek',
  '#gpt list model',
  '#gpt list api',
  '#gpt add api myapi https://api.example.com/v1 sk-xxx',
  '#gpt add model gpt-5.4 "GPT-5.4"',
  '#gpt help'
]

testCommands.forEach(cmd => {
  const trimmed = cmd.trim()
  if (trimmed.startsWith('#gpt model')) {
    const modelName = trimmed.replace('#gpt model', '').trim()
    console.log(`解析 "#gpt model": ${modelName}`)
  } else if (trimmed.startsWith('#gpt api')) {
    const apiName = trimmed.replace('#gpt api', '').trim()
    console.log(`解析 "#gpt api": ${apiName}`)
  } else if (trimmed.startsWith('#gpt list')) {
    const listType = trimmed.replace('#gpt list', '').trim()
    console.log(`解析 "#gpt list": ${listType}`)
  } else if (trimmed.startsWith('#gpt add api')) {
    const parts = trimmed.split(' ').filter(p => p.trim())
    if (parts.length >= 6) {
      const apiName = parts[3]
      const apiUrl = parts[4]
      console.log(`解析 "#gpt add api": ${apiName} -> ${apiUrl}`)
    }
  } else if (trimmed.startsWith('#gpt add model')) {
    const parts = trimmed.split(' ').filter(p => p.trim())
    if (parts.length >= 5) {
      const modelId = parts[3]
      const displayName = parts.slice(4).join(' ')
      console.log(`解析 "#gpt add model": ${modelId} -> ${displayName}`)
    }
  } else if (trimmed === '#gpt help' || trimmed === '#gpt') {
    console.log('解析 "#gpt help": 显示帮助')
  }
})