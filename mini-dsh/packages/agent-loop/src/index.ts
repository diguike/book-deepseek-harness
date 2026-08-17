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
    // TODO(ch09): 开 turn → 认领 inbox → pre-step 决策 → 跑 step → 关 turn。零 step 的 turn 是合法的
    throw new Error('TODO(ch09): 未实现 — 见书中对应小节，或 git checkout ch09-done')
  }

  /** 一个 step：落消息 → 装配 → 请求 → 工具 → 结束。 */
  private async runStep(step: number, entered: string[]): Promise<'stop' | 'continue'> {
    // TODO(ch09): 落消息 → 装配请求 → 断言不变式 → 请求 → 工具 → 结束
    throw new Error('TODO(ch09): 未实现 — 见书中对应小节，或 git checkout ch09-done')
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
  // TODO(ch09): 那条等式：请求里的消息必须逐字节等于从日志推导的结果
  throw new Error('TODO(ch09): 未实现 — 见书中对应小节，或 git checkout ch09-done')
}
