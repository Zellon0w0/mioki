import OpenAI from 'openai'
import { tools } from './tools'
import { ChatMessage } from './db'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export interface AgentOptions {
  apiUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  personaName: string
  userId: string
  defaultNickname: string
  chatHistory: ChatMessage[]
  imageDir: string
}

export async function runAgent(options: AgentOptions): Promise<string> {
  const openai = new OpenAI({
    baseURL: options.apiUrl,
    apiKey: options.apiKey,
    defaultHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  // Format messages:
  // 1. System Prompt with strict chat length/emoji rules
  const constraintPrompt = '\n\n【回复要求】请像正常人类在聊天群中水群一样进行口语化的简短对话。说话不要分段，字数严格限制在 5-30 字之内！禁止解释，严禁大篇幅问候。严禁在回复中输出任何类似于 [微笑]、[哭泣]、[大笑]、[捂脸] 等文字形式的表情占位符。'
  
  const messages: any[] = [
    {
      role: 'system',
      content: options.systemPrompt + constraintPrompt
    }
  ]

  // 2. Chat history
  // Slice to keep context size clean (recent 15 messages)
  const historySlice = options.chatHistory.slice(-15)
  for (const msg of historySlice) {
    if (msg.role === 'user') {
      const imageRegex = /\[图片: (img_[^\]]+)\]/g
      let match
      const imageFilenames: string[] = []
      let textWithoutImages = msg.content

      while ((match = imageRegex.exec(msg.content)) !== null) {
        imageFilenames.push(match[1])
      }
      textWithoutImages = textWithoutImages.replace(imageRegex, '[图片]')

      const contentParts: any[] = [
        { type: 'text', text: `${msg.nickname}: ${textWithoutImages}` }
      ]

      for (const filename of imageFilenames) {
        const filePath = join(options.imageDir, filename)
        if (existsSync(filePath)) {
          try {
            const fileBuffer = readFileSync(filePath)
            const base64 = fileBuffer.toString('base64')
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`
              }
            })
          } catch (err) {
            console.warn(`[personification agent] Failed to read image file ${filename}:`, err)
          }
        }
      }

      messages.push({
        role: 'user',
        name: `user_${msg.userId}`,
        content: contentParts
      })
    } else {
      messages.push({
        role: 'assistant',
        content: msg.content
      })
    }
  }

  // Format OpenAI tool specifications
  const openAITools = Object.values(tools).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))

  const maxRounds = 5
  let currentRound = 0

  while (currentRound < maxRounds) {
    currentRound++
    try {
      console.log(`[personification agent] Round ${currentRound} query...`)
      
      const completion = await openai.chat.completions.create({
        model: options.model,
        messages: messages,
        tools: openAITools,
        temperature: 0.7
      })

      const choice = completion.choices[0]
      if (!choice) {
        throw new Error('Received empty choice from model completion')
      }

      const message = choice.message
      messages.push(message) // Store assistant message in context

      // Check if tool calls were requested
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[personification agent] Tool calls requested:`, message.tool_calls.map(tc => tc.function.name))
        
        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function.name
          let functionArgs: any = {}
          try {
            functionArgs = JSON.parse(toolCall.function.arguments || '{}')
          } catch (e: any) {
            console.warn(`[personification agent] Failed to parse tool arguments for ${functionName}:`, toolCall.function.arguments)
          }
          
          const tool = tools[functionName]
          let toolOutput = ''
          
          if (tool) {
            try {
              const res = tool.execute(functionArgs, {
                userId: options.userId,
                personaName: options.personaName,
                defaultNickname: options.defaultNickname
              })
              toolOutput = res instanceof Promise ? await res : res
            } catch (err: any) {
              toolOutput = `Error executing tool ${functionName}: ${err.message || err}`
            }
          } else {
            toolOutput = `Tool ${functionName} is not available.`
          }

          console.log(`[personification agent] Tool ${functionName} execution finished. Output length: ${toolOutput.length}`)

          // Add tool output to context
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolOutput
          })
        }
      } else {
        // No more tool calls, return final response text
        return message.content || ''
      }
    } catch (err: any) {
      console.error(`[personification agent] Error in loop round ${currentRound}:`, err)
      throw err
    }
  }

  throw new Error(`Exceeded maximum agent rounds (${maxRounds}) without final response`)
}
