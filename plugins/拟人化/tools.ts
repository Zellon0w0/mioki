import { getUserProfile, updateUserProfile, searchChatHistory } from './db'

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
  execute: (args: any, context: { userId: string; defaultNickname: string }) => Promise<string> | string
}

export const tools: Record<string, ToolDefinition> = {
  get_current_time: {
    name: 'get_current_time',
    description: '获取当前时间。',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute() {
      const date = new Date()
      const options: Intl.DateTimeFormatOptions = {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long'
      }
      return new Intl.DateTimeFormat('zh-CN', options).format(date)
    }
  },

  query_user_profile: {
    name: 'query_user_profile',
    description: '查询当前说话用户的好感度评分、印象描述和昵称。',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute(args, context) {
      const profile = getUserProfile(context.userId, context.personaName || 'default', context.defaultNickname)
      return JSON.stringify({
        userId: profile.userId,
        personaName: profile.personaName,
        nickname: profile.nickname,
        favorability: profile.favorability,
        impressions: profile.impressions,
        lastUpdated: new Date(profile.updatedAt).toISOString()
      }, null, 2)
    }
  },

  update_user_profile: {
    name: 'update_user_profile',
    description: '更新用户的昵称、印象，并调整好感度。好感度每次变化限制在 -5 到 +5 之间。',
    parameters: {
      type: 'object',
      properties: {
        nickname: {
          type: 'string',
          description: '修改该用户的昵称，可选，不需要修改时不填。'
        },
        favorabilityChange: {
          type: 'number',
          description: '好感度变化值（-5 到 +5 之间的实数）。例如用户说话有趣加1，惹人生气扣2。'
        },
        impressions: {
          type: 'string',
          description: '用户新的印象描述，总结当前用户的性格特点或近期发言行为特点，字数控制在100字以内。'
        }
      },
      required: ['favorabilityChange', 'impressions']
    },
    execute(args, context) {
      let change = Number(args.favorabilityChange)
      if (isNaN(change)) change = 0
      change = Math.max(-5, Math.min(5, change))

      const updated = updateUserProfile(context.userId, context.personaName || 'default', args.nickname || '', change, args.impressions)
      return JSON.stringify({
        status: 'success',
        message: '用户画像已更新',
        profile: {
          userId: updated.userId,
          personaName: updated.personaName,
          nickname: updated.nickname,
          favorability: updated.favorability,
          impressions: updated.impressions
        }
      }, null, 2)
    }
  },

  recall_memory: {
    name: 'recall_memory',
    description: '从本地长期聊天历史中搜索过去的对话记录（通过关键词匹配）。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要搜索的对话关键词。'
        }
      },
      required: ['query']
    },
    execute(args) {
      if (!args.query) return '请提供搜索关键词。'
      const matches = searchChatHistory(args.query, 10)
      if (matches.length === 0) {
        return `未在长期聊天历史中找到关于 "${args.query}" 的记录。`
      }
      return matches.map((m) => {
        const timeStr = new Date(m.timestamp).toISOString()
        return `[${timeStr}] ${m.nickname} (${m.role}): ${m.content}`
      }).join('\n')
    }
  },

  web_search: {
    name: 'web_search',
    description: '联网搜索指定关键词，获取最新的网络资讯和信息。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要搜索的网络查询句或关键词。'
        }
      },
      required: ['query']
    },
    async execute(args) {
      const query = args.query
      if (!query) return '请提供搜索词。'

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        })
        if (!response.ok) {
          throw new Error(`HTTP status ${response.status}`)
        }
        const html = await response.text()
        const results: { title: string; link: string; snippet: string }[] = []
        
        const resultRegex = /<div class="result results_links results_links_deep web-result ">([\s\S]*?)<\/div>/g
        let match
        let count = 0
        
        while ((match = resultRegex.exec(html)) !== null && count < 5) {
          const block = match[1]
          const titleMatch = block.match(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
          const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
          
          if (titleMatch) {
            let link = titleMatch[1]
            if (link.includes('uddg=')) {
              const urlParam = link.split('uddg=')[1]?.split('&')[0]
              if (urlParam) {
                link = decodeURIComponent(urlParam)
              }
            }
            const title = titleMatch[2].replace(/<[^>]*>/g, '').trim()
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : ''
            
            results.push({ title, link, snippet })
            count++
          }
        }
        
        if (results.length === 0) {
          return `没有找到与 "${query}" 相关的有价值的网络搜索结果。可能频率过高被拦截。`
        }
        
        return results.map((r, i) => `[${i + 1}] 标题: ${r.title}\n链接: ${r.link}\n摘要: ${r.snippet}`).join('\n\n')
      } catch (err: any) {
        return `网络搜索失败: ${err.message || err}`
      }
    }
  }
}
