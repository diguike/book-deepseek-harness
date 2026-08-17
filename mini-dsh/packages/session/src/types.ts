/**
 * 会话事件的词汇。
 *
 * 对照真 dsh：packages/core/session/src/types.ts。
 * 那边的 SessionEventMap 是可合并扩展的——任何包都能往里加自己的事件类型，
 * 这也是「想给模型加一句话就得新增一个事件类型」那条规矩的落地方式。
 */

export type Role = 'user' | 'assistant'

export interface ContentBlock {
  type: 'text' | 'tool_call' | 'tool_result'
  text?: string
  /** tool_call / tool_result 用 */
  callId?: string
  name?: string
  args?: unknown
  result?: unknown
  isError?: boolean
}

/**
 * surface 操作：这条消息事件对「模型可见面」做了什么。
 *
 * 默认是 append。`replace` 用来把一段历史整体换掉——压缩产生的摘要就走这条路。
 * 注意 start/end 是**surface 上的位置**，不是 seq 区间。真 dsh 的注释原话是
 * "a surface-POSITION span, not a numeric seq interval"。
 */
export interface SurfaceOp {
  op: 'replace'
  start: number
  end: number
}

/** 所有事件共有的信封。 */
export interface EventEnvelope {
  seq: number
  at: number
  /** 不认识这个类型时能不能跳过。默认不能——宁可拒绝整份日志。 */
  ignorable?: boolean
}

export type SessionEvent = EventEnvelope &
  (
    | { type: 'session/created'; data: { sessionId: string; cwd: string } }
    | { type: 'permission/preset'; data: { preset: string } }
    | { type: 'turn/start'; data: { turn: number } }
    | { type: 'turn/end'; data: { turn: number } }
    | { type: 'step/start'; data: { step: number } }
    | { type: 'step/end'; data: { step: number; reason?: string } }
    | { type: 'user/message'; data: { content: ContentBlock[]; surfaceOp?: SurfaceOp } }
    | { type: 'assistant/message'; data: { content: ContentBlock[]; usage?: Usage } }
    | { type: 'assistant/chunk'; data: { text: string } }
    | { type: 'tool/call'; data: { callId: string; name: string; args: unknown } }
    | { type: 'tool/result'; data: { callId: string; result: unknown; isError?: boolean } }
    | { type: 'request/header'; data: RequestHeader }
    | { type: 'session/title'; data: { title: string } }
    | { type: 'compaction/summary'; data: { summary: string; shadowedStart: number; shadowedEnd: number } }
  )

export type SessionEventType = SessionEvent['type']

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
}

/**
 * 请求信封里那些「会影响缓存复用」的字段。
 *
 * 真 dsh 把它单独记成一个事件（request/header），理由写在
 * packages/llm/llm/src/call-config.ts 开头：这些是 request-header state，
 * 变了就要记一条快照，而不是允许它静默漂移。第 8、11 章展开。
 */
export interface RequestHeader {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
}

/**
 * 哪些事件类型进入模型可见面。
 *
 * 这是 surface 的定义。不在这个集合里的事件只记账，不进模型——
 * request/header、session/title、compaction/summary 都是 log-only。
 */
export const SURFACE_TYPES = new Set<SessionEventType>(['user/message', 'assistant/message'])

/** 模型请求里的一条消息。 */
export interface Message {
  role: Role
  content: ContentBlock[]
}
