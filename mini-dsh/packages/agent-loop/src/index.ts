import type { Context } from '../../cordis/src/index.ts'
import { Session, type Message } from '../../session/src/index.ts'
import { collect, type GenerateOptions, type LlmService, callConfigEquals, type CallConfig } from '../../llm/src/index.ts'
import type { ToolExecution, ToolsService } from '../../tools/src/index.ts'

/** 投递方式。三种进同一个 inbox，区别只在什么时候唤醒驱动。 */
export type InboxTarget = 'followup' | 'steer' | 'inject'

export interface InboxItem {
  text: string
  target: InboxTarget
}

/** pre-step 的决定。返回值是权威的——驱动照单执行，不再二次判断。 */
export type PreStepDecision =
  | { action: 'enter'; messages: string[] }
  | { action: 'reject'; reason: string }

export interface AgentOptions {
  session: Session
  config: CallConfig
  systemPrompt: string
  maxSteps?: number
}

/**
 * 主循环。
 *
 * step = 一次模型请求 + 它引发的工具执行
 * turn = 排空一次输入的全过程，含零到多个 step
 *
 * 对照真 dsh：packages/core/agent-loop/src/agent.ts（496 行，整包 1,643 行）。
 */
export class AgentLoop {
  private readonly inbox: InboxItem[] = []
  private lastHeader: CallConfig | undefined
  private readonly ctx: Context
  private readonly opts: AgentOptions

  constructor(ctx: Context, opts: AgentOptions) {
    this.ctx = ctx
    this.opts = opts
  }

  /** 普通输入，立刻唤醒驱动。 */
  followup(text: string): void { this.inbox.push({ text, target: 'followup' }) }
  /** 打断当前进程的输入，也唤醒。 */
  steer(text: string): void { this.inbox.push({ text, target: 'steer' }) }
  /** 注入的上下文：不唤醒，等下一条唤醒消息把它一起带走。 */
  inject(text: string): void { this.inbox.push({ text, target: 'inject' }) }

  private get session(): Session { return this.opts.session }
  private get llm(): LlmService { return (this.ctx as any).llm }
  private get tools(): ToolsService { return (this.ctx as any).tools }

  /**
   * 跑一个 turn，直到模型和它的工具都停下来。
   *
   * 返回这个 turn 花了几个 step。**零是合法的**——输入被 pre-step 拒了，
   * 没发出任何模型请求，但这个 turn 照样开、照样关，日志记下这次尝试。
   */
  async runTurn(): Promise<number> {
    const turn = this.nextTurn()
    this.session.append('turn/start', { turn })
    let steps = 0

    try {
      while (true) {
        // 认领：把 inbox 里等着的东西取走
        const claimed = this.inbox.splice(0)
        if (claimed.length === 0 && steps > 0) break
        if (claimed.length === 0 && steps === 0) break

        // pre-step：决定模型看到什么。返回值权威。
        const decision = await this.ctx.waterfall<PreStepDecision>(
          'agent/pre-step',
          [claimed, { turn, step: steps + 1 }],
          async () => ({ action: 'enter', messages: claimed.map((c) => c.text) }),
        )

        if (decision.action === 'reject' || decision.messages.length === 0) {
          // 被拒的认领不退回 inbox。turn 照关，日志记下这次尝试。
          break
        }

        steps++
        const reason = await this.runStep(steps, decision.messages)
        if (reason === 'stop') break
        if (this.opts.maxSteps && steps >= this.opts.maxSteps) break
      }
    } finally {
      this.session.append('turn/end', { turn })
    }
    return steps
  }

  /** 一个 step：落消息 → 装配 → 请求 → 工具 → 结束。 */
  private async runStep(step: number, entered: string[]): Promise<'stop' | 'continue'> {
    this.session.append('step/start', { step })

    for (const text of entered) {
      this.session.append('user/message', { content: [{ type: 'text', text }] })
    }

    // 请求配置走 waterfall，监听器可以换模型、改采样参数
    const config = await this.ctx.waterfall<CallConfig>(
      'agent/request', [{ ...this.opts.config }], async () => ({ ...this.opts.config }),
    )
    // 变了才记快照，没变就不记——保持前缀逐字节稳定
    if (!this.lastHeader || !callConfigEquals(this.lastHeader, config)) {
      this.session.append('request/header', config)
      this.lastHeader = { ...config }
    }

    const options: GenerateOptions = {
      ...config,
      system: this.opts.systemPrompt,
      tools: this.tools.schemas(),
      // ★ 消息不是攒出来的，是从日志现算的。第 9 章那条不变式就是这一行。
      messages: this.session.deriveMessages(),
    }
    assertRequestDerivesFromLog(options, this.session)

    const stream = await this.llm.stream(options)
    const { text, calls, usage } = await collect(stream)

    if (text) this.session.append('assistant/chunk', { text })
    this.session.append('assistant/message', {
      content: [{ type: 'text', text }],
      usage: usage && { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens },
    })

    if (calls.length === 0) {
      this.session.append('step/end', { step, reason: 'natural-stop' })
      return 'stop'
    }

    const execs: ToolExecution[] = calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args }))
    for (const e of execs) this.session.append('tool/call', { callId: e.callId, name: e.name, args: e.args })

    const results = await this.tools.executeBatch(execs)
    // 按模型顺序落库，哪怕执行是重叠的
    for (const r of results) {
      this.session.append('tool/result', { callId: r.callId, result: r.content, isError: r.isError })
      // 工具结果作为下一轮的输入喂回去
      this.inbox.push({ text: `【${r.name} 的结果】${JSON.stringify(r.content)}`, target: 'followup' })
    }

    this.session.append('step/end', { step, reason: 'tools-owed' })
    return 'continue'
  }

  private nextTurn(): number {
    return this.session.events().filter((e) => e.type === 'turn/start').length + 1
  }
}

/**
 * 运行时不变式：model-visible ⟺ logged 的可执行版本。
 *
 * 每个由主循环发出的请求，它的消息数组必须**逐字节等于**从日志推导的结果。
 * 意思是：pre-step 的监听器可以改模型看到什么，但改的结果必须先落进日志
 * 再被投影出来，不能直接塞进请求。
 *
 * 这是监视器不是证明——它只在被调用时检查，抓不到不等于成立。
 */
export function assertRequestDerivesFromLog(options: { messages: Message[] }, session: Session): void {
  const derived = session.deriveMessages()
  const a = JSON.stringify(options.messages)
  const b = JSON.stringify(derived)
  if (a !== b) {
    throw new Error(
      'INVARIANT_VIOLATION: 请求里的消息和从日志推导的结果不一致。\n' +
      '有人绕过日志往请求里塞了东西。\n' +
      `请求 ${options.messages.length} 条 / 日志推导 ${derived.length} 条`,
    )
  }
}
