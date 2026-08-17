import { emptyTrace, isForkable, validateEvent, type Trace } from './invariant.ts'
import { SURFACE_TYPES, type Message, type SessionEvent, type SessionEventType } from './types.ts'

export * from './types.ts'
export * from './invariant.ts'

/** 不认识的事件类型怎么办。默认拒绝整份日志。 */
const KNOWN: ReadonlySet<string> = new Set<SessionEventType>([
  'session/created', 'permission/preset', 'turn/start', 'turn/end', 'step/start', 'step/end',
  'user/message', 'assistant/message', 'assistant/chunk', 'tool/call', 'tool/result',
  'request/header', 'session/title', 'compaction/summary',
])

/**
 * 一条会话的事件日志。
 *
 * 只追加，不修改。模型看到的历史是从它算出来的，不是另外攒的。
 * 对照真 dsh：packages/core/session/src/index.ts（3,156 行的其中一部分）。
 */
export class Session {
  readonly id: string
  private readonly log: SessionEvent[] = []
  private trace: Trace = emptyTrace()
  private seq = 0

  constructor(id: string) {
    this.id = id
  }

  /** 追加一个事件。校验先跑，通过了才提交。 */
  append<T extends SessionEvent['type']>(
    type: T,
    data: Extract<SessionEvent, { type: T }>['data'],
    opts: { ignorable?: boolean } = {},
  ): SessionEvent {
    const event = { seq: this.seq++, at: Date.now(), type, data, ...opts } as SessionEvent
    // 纯校验：算出下一个状态但先不提交。失败就抛，日志不动。
    const next = validateEvent(this.trace, event)
    this.log.push(event)
    this.trace = next
    return event
  }

  events(): readonly SessionEvent[] {
    return this.log
  }

  get openTurn(): number | null {
    return this.trace.openTurn
  }

  /**
   * 从日志投影出模型看到的历史。
   *
   * 这是「日志是源」那条规矩的全部实现：模型历史不是另一份数据，
   * 是这个函数每次现算的结果。
   *
   * 两步：先折出 surface（哪些事件对模型可见，含 replace 操作），
   * 再把 surface 上的事件转成消息。
   */
  deriveMessages(): Message[] {
    // TODO(ch07): 先折出 surface，再把 surface 上的事件转成消息
    throw new Error('TODO(ch07): 未实现 — 见书中对应小节，或 git checkout ch07-done')
  }

  /**
   * fork 出一个新会话，切在 seq <= boundary 的位置。
   *
   * 难的不是复制，是判断哪些位置能切——见 6.x 节。
   */
  fork(newId: string, boundary?: number): Session {
    // TODO(ch07): 取前缀重放，但要先判断这个前缀合不合法
    throw new Error('TODO(ch07): 未实现 — 见书中对应小节，或 git checkout ch07-done')
  }

  /** 从一份原始日志重建会话。不认识的事件类型会让整份日志作废。 */
  static replay(id: string, raw: SessionEvent[]): Session {
    const s = new Session(id)
    for (const e of raw) {
      if (!KNOWN.has(e.type)) {
        if (e.ignorable) continue
        throw new Error(`UNKNOWN_EVENT_TYPE: 不认识 "${e.type}"，且它没有标 ignorable。拒绝加载整份日志。`)
      }
      s.append(e.type as any, e.data as any, { ignorable: e.ignorable })
    }
    return s
  }
}

/**
 * 折出模型可见面。
 *
 * 只有 SURFACE_TYPES 里的事件参与。带 surfaceOp: replace 的消息会把
 * surface 上 [start, end) 这一段位置换成它自己——压缩的摘要就这么落地。
 */
export function surfaceOf(log: readonly SessionEvent[]): SessionEvent[] {
  // TODO(ch07): 只留 SURFACE_TYPES；遇到 surfaceOp:replace 就 splice 掉那一段
  throw new Error('TODO(ch07): 未实现 — 见书中对应小节，或 git checkout ch07-done')
}

function toMessage(e: SessionEvent): Message {
  if (e.type === 'user/message') return { role: 'user', content: e.data.content }
  if (e.type === 'assistant/message') return { role: 'assistant', content: e.data.content }
  throw new Error(`不是 surface 事件：${e.type}`)
}
