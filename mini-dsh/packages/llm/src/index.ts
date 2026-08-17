import type { Context, Disposer } from '../../cordis/src/index.ts'
import type { Message } from '../../session/src/index.ts'

/** 流式返回的片段。真 dsh 的 StreamChunk 还有 reasoning、usage 等变体。 */
export type StreamChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; callId: string; name: string; args: unknown }
  | { kind: 'done'; usage?: Usage }

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** 前缀缓存命中的部分。第 11 章整章在讲怎么让它变大。 */
  cacheReadTokens?: number
}

/**
 * 请求信封里那些会影响缓存复用的字段。
 *
 * 真 dsh 把这组字段单独叫做 request-header state，理由写在
 * packages/llm/llm/src/call-config.ts 开头：它们变了就该记一条快照，
 * 而不是允许静默漂移。
 */
export interface CallConfig {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'off' | 'low' | 'high'
}

/** 这次改动值不值得记一条新的 header 快照。 */
export function callConfigEquals(a: CallConfig, b: CallConfig): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.temperature === b.temperature &&
    a.maxTokens === b.maxTokens &&
    a.reasoningEffort === b.reasoningEffort
  )
}

export interface GenerateOptions extends CallConfig {
  messages: Message[]
  system: string
  tools: { name: string; description: string; parameters: unknown }[]
  signal?: AbortSignal
}

/** 一个模型适配器。唯一的抽象方法是流式的——这一点是强制的。 */
export abstract class LlmAdapter {
  abstract readonly provider: string
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/**
 * 模型接缝。
 *
 * 它自己不发请求，只做两件事：管适配器注册表，
 * 以及把每次调用穿过 `llm/stream` 这条 waterfall。
 *
 * 第二件是关键——重试、计量、回放全都变成挂在这条 waterfall 上的监听器，
 * 而不是写死在调用路径里。
 */
export class LlmService {
  private readonly adapters = new Map<string, LlmAdapter>()
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }


  /**
   * 注册一个适配器，返回撤销它的 disposer。
   *
   * 注意这里**不**自己调 ctx.effect——注册表不知道是谁在调它。
   * 归属由调用方决定：`c.effect(() => llm.register(a))`，
   * 这样 disposer 挂在调用方的 fiber 上，调用方卸载时适配器才跟着消失。
   * 真 dsh 的 AGENTS.md 把这条写成规矩：注册表的 register() 返回 disposer。
   */
  register(adapter: LlmAdapter): Disposer {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`provider "${adapter.provider}" 已注册`)
    }
    this.adapters.set(adapter.provider, adapter)
    return () => this.adapters.delete(adapter.provider)
  }

  providers(): string[] {
    return [...this.adapters.keys()].sort()
  }

  /**
   * 发一次流式请求。
   *
   * 注意返回的是 AsyncIterable，不是 Promise<string>。这是硬约束：
   * 真 dsh 的 LlmAdapter 抽象方法签名就是 `stream(): AsyncIterable<StreamChunk>`
   * （packages/llm/llm/src/index.ts:232），不支持流式的后端接不上。
   */
  async stream(options: GenerateOptions): Promise<AsyncIterable<StreamChunk>> {
    return this.ctx.waterfall<AsyncIterable<StreamChunk>>('llm/stream', [options], async () => {
      const adapter = this.adapters.get(options.provider)
      if (!adapter) throw new Error(`UNKNOWN_PROVIDER: ${options.provider}`)
      return prime(adapter.stream(options))
    })
  }
}

/**
 * 预热一个流：先把第一个片段拉出来，再把它接回去。
 *
 * 为什么需要这一步：`async *stream()` 的函数体要到第一次迭代才执行，
 * 所以适配器里的异常在 `stream()` 返回时还没抛出来——挂在 waterfall 上的
 * 重试监听器 `try { await next() }` 一次都 catch 不到，等到主循环开始
 * 消费流时才炸，那时候已经出了拦截链。
 *
 * 预热之后，连接失败、鉴权失败、限流这些**在建立连接阶段**就能被拦截链看见。
 * 真 dsh 在 LlmRuntime.stream() 里做同一件事：把适配器的失败规范化成
 * 接缝层面的终止，而不是让它从迭代器里漏出去。
 */
async function prime(inner: AsyncIterable<StreamChunk>): Promise<AsyncIterable<StreamChunk>> {
  const it = inner[Symbol.asyncIterator]()
  const first = await it.next()          // ← 异常在这里抛，还在 waterfall 里
  return (async function* () {
    if (first.done) return
    yield first.value
    while (true) {
      const n = await it.next()
      if (n.done) return
      yield n.value
    }
  })()
}

/** 把流折成一条完整的助手消息。主循环用它。 */
export async function collect(stream: AsyncIterable<StreamChunk>): Promise<{
  text: string
  calls: { callId: string; name: string; args: unknown }[]
  usage?: Usage
}> {
  let text = ''
  const calls: { callId: string; name: string; args: unknown }[] = []
  let usage: Usage | undefined
  for await (const chunk of stream) {
    if (chunk.kind === 'text') text += chunk.text
    else if (chunk.kind === 'tool_call') calls.push(chunk)
    else if (chunk.kind === 'done') usage = chunk.usage
  }
  return { text, calls, usage }
}

/** 装成插件：提供 ctx.llm。 */
export const llmPlugin = {
  name: 'llm',
  apply(ctx: Context) {
    ctx.provide('llm', new LlmService(ctx))
  },
}
