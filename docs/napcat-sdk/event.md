# NapCat SDK 事件 {#events}

本文档详细介绍 NapCat SDK 支持的所有事件类型。

::: tip 💡 事件系统说明
NapCat SDK 对 NapCat 服务端原始事件进行了**重新映射和转换**，提供了更加语义化、一致性更好的事件命名。例如，将 `notify.poke` 根据上下文自动转换为 `notice.friend.poke` 或 `notice.group.poke`。
:::

## 事件监听 {#listening}

使用 `on()` 方法注册事件监听器：

```ts
napcat.on('事件名称', (event) => {
  // 处理事件
})
```

事件名称支持**点分格式**，可以监听主类型或更具体的子类型：

```ts
// 监听所有消息
napcat.on('message', handler)

// 仅监听群消息
napcat.on('message.group', handler)

// 仅监听普通群消息
napcat.on('message.group.normal', handler)
```

## WebSocket 事件 {#ws-events}

这些是 NapCat SDK 自定义的连接层事件，**不是 NapCat 服务端原生事件**。

### ws.open

WebSocket 连接已建立。

```ts
napcat.on('ws.open', () => {
  console.log('WebSocket 已连接')
})
```

### ws.close

WebSocket 连接已关闭。

```ts
napcat.on('ws.close', () => {
  console.log('WebSocket 已断开')
})
```

### ws.error

WebSocket 连接发生错误。

```ts
napcat.on('ws.error', (error) => {
  console.error('WebSocket 错误:', error)
})
```

### ws.message

收到 WebSocket 原始消息（已解析为 JSON）。

```ts
napcat.on('ws.message', (data) => {
  console.log('收到原始数据:', data)
})
```

## NapCat 连接事件 {#napcat-events}

### napcat.connected

NapCat 连接已建立且登录信息已获取。这是 SDK 自定义的高级事件，在 `meta_event.lifecycle.connect` 后触发。

```ts
napcat.on('napcat.connected', (info) => {
  console.log(`机器人: ${info.nickname}（${info.user_id}）`)
  console.log(`NapCat: ${info.app_name} v${info.app_version}`)
  console.log(`协议版本: ${info.protocol_version}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `number` | 机器人 QQ 号 |
| `nickname` | `string` | 机器人昵称 |
| `app_name` | `string` | 应用名称（如 "NapCat"） |
| `app_version` | `string` | 应用版本 |
| `protocol_version` | `string` | 协议版本 |
| `timestamp` | `number` | 时间戳（毫秒） |

## 消息事件 {#message-events}

### message

所有消息事件的总入口。

```ts
napcat.on('message', (event) => {
  console.log(`收到消息: ${event.raw_message}`)
  console.log(`消息类型: ${event.message_type}`) // 'private' | 'group'
})
```

### message.private

私聊消息事件。

```ts
napcat.on('message.private', (event) => {
  console.log(`[私聊] ${event.sender.nickname}: ${event.raw_message}`)

  // 回复消息
  await event.reply('收到！')

  // 引用回复
  await event.reply('收到！', true)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | `number` | 消息 ID |
| `user_id` | `number` | 发送者 QQ 号 |
| `target_id` | `number` | 接收者 QQ 号 |
| `message` | `RecvElement[]` | 消息段数组 |
| `raw_message` | `string` | 原始消息文本 |
| `quote_id` | `string \| null` | 引用的消息 ID |
| `sub_type` | `string` | 子类型：`friend`、`group`、`other` |
| `sender` | `object` | 发送者信息 |
| `friend` | `Friend` | 好友对象 |
| `reply` | `function` | 回复消息函数 |
| `getQuoteMsg` | `function` | 获取引用的消息 |

### message.private.friend

好友私聊消息。

```ts
napcat.on('message.private.friend', (event) => {
  console.log(`[好友私聊] ${event.sender.nickname}: ${event.raw_message}`)
})
```

### message.private.group

群临时会话消息。

```ts
napcat.on('message.private.group', (event) => {
  console.log(`[群临时会话] ${event.sender.nickname}: ${event.raw_message}`)
})
```

### message.group

群消息事件。

```ts
napcat.on('message.group', (event) => {
  console.log(`[群${event.group_id}] ${event.sender.nickname}: ${event.raw_message}`)

  // 群消息特有方法
  await event.recall()           // 撤回消息
  await event.addReaction('66')  // 添加表态
  await event.delReaction('66')  // 移除表态
  await event.setEssence()       // 设为精华
  await event.delEssence()       // 取消精华
})
```

**群消息特有属性：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `group_id` | `number` | 群号 |
| `group_name` | `string` | 群名 |
| `group` | `Group` | 群对象 |
| `sender.card` | `string` | 发送者群名片 |
| `sender.role` | `string` | 发送者角色：`owner`、`admin`、`member` |
| `recall` | `function` | 撤回该消息 |
| `addReaction` | `function` | 添加表态 |
| `delReaction` | `function` | 移除表态 |
| `setEssence` | `function` | 设为精华 |
| `delEssence` | `function` | 取消精华 |
| `getSenderMemberInfo` | `function` | 获取发送者群成员信息 |

### message.group.normal

普通群消息。

```ts
napcat.on('message.group.normal', (event) => {
  console.log(`[普通群消息] ${event.raw_message}`)
})
```

## 消息发送事件 {#message-sent-events}

机器人自己发送消息后会收到这些事件。

### message_sent

所有发送消息事件的总入口。

```ts
napcat.on('message_sent', (event) => {
  console.log(`已发送消息: ${event.raw_message}`)
})
```

### message_sent.private

发送私聊消息后触发。

### message_sent.group

发送群消息后触发。

## 通知事件 {#notice-events}

::: warning ⚠️ 事件映射说明
NapCat SDK 对 NapCat 服务端的原始通知事件进行了重新映射，使事件命名更加语义化和一致。原始事件类型保存在 `event.original_notice_type` 中。
:::

### notice

所有通知事件的总入口。

```ts
napcat.on('notice', (event) => {
  console.log(`通知类型: ${event.notice_type}.${event.sub_type}`)
})
```

### notice.friend

好友相关通知的总入口。

```ts
napcat.on('notice.friend', (event) => {
  console.log(`好友通知: ${event.sub_type}`)
})
```

### notice.friend.increase

新增好友。

```ts
napcat.on('notice.friend.increase', (event) => {
  console.log(`新好友: ${event.user_id}`)
})
```

### notice.friend.decrease

好友减少（被删除）。

```ts
napcat.on('notice.friend.decrease', (event) => {
  console.log(`好友 ${event.user_id} 已删除你`)
})
```

### notice.friend.recall

好友撤回消息。

```ts
napcat.on('notice.friend.recall', (event) => {
  console.log(`好友 ${event.user_id} 撤回了消息 ${event.message_id}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | `number` | 被撤回的消息 ID |

### notice.friend.poke

好友戳一戳。

```ts
napcat.on('notice.friend.poke', (event) => {
  console.log(`${event.sender_qq} 戳了 ${event.target_id}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `target_id` | `number` | 被戳者 QQ 号 |
| `sender_qq` | `number` | 发送者 QQ 号 |

### notice.friend.like

收到好友点赞。

```ts
napcat.on('notice.friend.like', (event) => {
  console.log(`${event.operator_nick} 给你点了 ${event.times} 个赞`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `operator_id` | `number` | 点赞者 QQ 号 |
| `operator_nick` | `string` | 点赞者昵称 |
| `times` | `number` | 点赞次数 |

### notice.friend.input

好友正在输入。

```ts
napcat.on('notice.friend.input', (event) => {
  console.log(`好友 ${event.user_id} 正在输入...`)
})
```

### notice.group

群相关通知的总入口。

```ts
napcat.on('notice.group', (event) => {
  console.log(`群通知: ${event.sub_type}，群 ${event.group_id}`)
})
```

### notice.group.increase

群成员增加。

```ts
napcat.on('notice.group.increase', (event) => {
  console.log(`${event.user_id} 加入了群 ${event.group_id}`)

  // 发送欢迎消息
  await event.group.sendMsg([
    segment.at(event.user_id),
    ' 欢迎加入！',
  ])
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `operator_id` | `number` | 操作者 QQ 号（邀请者） |
| `action_type` | `string` | 加入方式：`invite`、`add`、`approve` |

### notice.group.decrease

群成员减少。

```ts
napcat.on('notice.group.decrease', (event) => {
  console.log(`${event.user_id} 离开了群 ${event.group_id}`)
  console.log(`离开方式: ${event.action_type}`) // 'kick' | 'leave'
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `operator_id` | `number` | 操作者 QQ 号 |
| `action_type` | `string` | 离开方式：`kick`（被踢）、`leave`（主动退出） |

### notice.group.admin

群管理员变动。

```ts
napcat.on('notice.group.admin', (event) => {
  const action = event.action_type === 'set' ? '设为' : '取消'
  console.log(`${event.user_id} 被${action}管理员`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `action_type` | `string` | 操作类型：`set`（设置）、`unset`（取消） |

### notice.group.ban

群禁言。

```ts
napcat.on('notice.group.ban', (event) => {
  if (event.action_type === 'ban') {
    console.log(`${event.user_id} 被禁言 ${event.duration} 秒`)
  } else {
    console.log(`${event.user_id} 被解除禁言`)
  }
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `duration` | `number` | 禁言时长（秒），0 表示解除禁言 |
| `action_type` | `string` | 操作类型：`ban`（禁言）、`lift_ban`（解除） |
| `operator_id` | `number` | 操作者 QQ 号 |

### notice.group.poke

群内戳一戳。

```ts
napcat.on('notice.group.poke', (event) => {
  console.log(`群 ${event.group_id} 中 ${event.user_id} 戳了 ${event.target_id}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `target_id` | `number` | 被戳者 QQ 号 |

### notice.group.card

群名片变更。

```ts
napcat.on('notice.group.card', (event) => {
  console.log(`${event.user_id} 的名片从 "${event.card_old}" 改为 "${event.card_new}"`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `card_new` | `string` | 新名片 |
| `card_old` | `string` | 旧名片 |

### notice.group.title

群头衔变更。

```ts
napcat.on('notice.group.title', (event) => {
  console.log(`${event.user_id} 获得头衔: ${event.title}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 新头衔 |

### notice.group.recall

群消息撤回。

```ts
napcat.on('notice.group.recall', (event) => {
  console.log(`消息 ${event.message_id} 被 ${event.operator_id} 撤回`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | `number` | 被撤回的消息 ID |
| `operator_id` | `number` | 操作者 QQ 号 |

### notice.group.upload

群文件上传。

```ts
napcat.on('notice.group.upload', (event) => {
  console.log(`${event.user_id} 上传了文件: ${event.file.name}`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `file.id` | `string` | 文件 ID |
| `file.name` | `string` | 文件名 |
| `file.size` | `number` | 文件大小（字节） |
| `file.busid` | `number` | 业务 ID |

### notice.group.reaction

消息表态变动。

```ts
napcat.on('notice.group.reaction', (event) => {
  const action = event.is_add ? '添加' : '移除'
  console.log(`消息 ${event.message_id} ${action}了表态`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | `number` | 消息 ID |
| `is_add` | `boolean` | 是否为添加表态 |
| `likes` | `array` | 表态列表 `{ emoji_id, count }[]` |

### notice.group.essence

群精华消息变动。

```ts
napcat.on('notice.group.essence', (event) => {
  const action = event.action_type === 'add' ? '设为' : '取消'
  console.log(`消息 ${event.message_id} 被${action}精华`)
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | `number` | 消息 ID |
| `sender_id` | `number` | 原消息发送者 |
| `operator_id` | `number` | 操作者 QQ 号 |
| `action_type` | `string` | 操作类型：`add`、`remove` |

## 请求事件 {#request-events}

### request

所有请求事件的总入口。

```ts
napcat.on('request', (event) => {
  console.log(`请求类型: ${event.request_type}`)
})
```

### request.friend

好友添加请求。

```ts
napcat.on('request.friend', async (event) => {
  console.log(`收到好友请求: ${event.user_id}`)
  console.log(`验证信息: ${event.comment}`)

  // 同意请求
  await event.approve()

  // 或拒绝请求
  // await event.reject('暂不添加好友')
})
```

**事件数据：**

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `number` | 请求者 QQ 号 |
| `comment` | `string` | 验证信息 |
| `flag` | `string` | 请求标识 |
| `approve` | `function` | 同意请求 |
| `reject` | `function` | 拒绝请求 |

### request.group

群相关请求的总入口。

### request.group.add

他人申请加群（机器人是管理员时收到）。

```ts
napcat.on('request.group.add', async (event) => {
  console.log(`${event.user_id} 申请加入群 ${event.group_id}`)
  console.log(`验证信息: ${event.comment}`)

  if (event.comment.includes('正确答案')) {
    await event.approve()
  } else {
    await event.reject('答案错误')
  }
})
```

### request.group.invite

被邀请加群。

```ts
napcat.on('request.group.invite', (event) => {
  console.log(`被邀请加入群 ${event.group_id}`)
})
```

## 元事件 {#meta-events}

### meta_event

所有元事件的总入口。

### meta_event.heartbeat

心跳事件，用于确认连接状态。

```ts
napcat.on('meta_event.heartbeat', (event) => {
  console.log(`心跳间隔: ${event.interval}ms`)
  console.log(`在线状态: ${event.status.online}`)
})
```

### meta_event.lifecycle

生命周期事件。

### meta_event.lifecycle.connect

连接成功事件。

```ts
napcat.on('meta_event.lifecycle.connect', (event) => {
  console.log('OneBot 连接成功')
})
```

## 事件映射表 {#mapping}

以下是 NapCat 原始事件到 SDK 事件的映射关系：

| 原始事件 | SDK 事件 | 说明 |
| --- | --- | --- |
| `notify.input_status` | `notice.friend.input` | 好友输入状态 |
| `notify.profile_like` | `notice.friend.like` | 好友点赞 |
| `notify.poke`（私聊） | `notice.friend.poke` | 好友戳一戳 |
| `notify.poke`（群聊） | `notice.group.poke` | 群戳一戳 |
| `notify.title` | `notice.group.title` | 群头衔变更 |
| `friend_add` | `notice.friend.increase` | 新增好友 |
| `friend_recall` | `notice.friend.recall` | 好友撤回 |
| `group_admin` | `notice.group.admin` | 管理员变动 |
| `group_ban` | `notice.group.ban` | 群禁言 |
| `group_card` | `notice.group.card` | 群名片变更 |
| `group_upload` | `notice.group.upload` | 群文件上传 |
| `group_decrease` | `notice.group.decrease` | 群成员减少 |
| `group_increase` | `notice.group.increase` | 群成员增加 |
| `group_msg_emoji_like` | `notice.group.reaction` | 消息表态 |
| `essence` | `notice.group.essence` | 精华消息 |
| `group_recall` | `notice.group.recall` | 群消息撤回 |

## 下一步 {#next-steps}

- 查看 [API 文档](/napcat-sdk/api) 了解完整 API
- 回到 [NapCat SDK 概览](/napcat-sdk/) 查看更多示例
