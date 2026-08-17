import type { Context, Disposer } from '../../cordis/src/index.ts'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /**
   * 能不能和别的工具并发跑。
   *
   * 注意判定是 fail-closed 的：只有精确返回 true 才算安全。
   * 未声明、抛异常、返回别的值，一律当成必须独占。
   */
  isConcurrencySafe?: (args: unknown) => boolean
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
}

export interface ToolExecution {
    // TODO(ch10): pre-execute → 单调守卫 → execute(around) → 工具体 → post-execute
    throw new Error('TODO(ch10): 未实现 — 见书中对应小节，或 git checkout ch10-done')
  }

export interface ToolResult {
  callId: string
  name: string
  content: unknown
  isError: boolean
  /** 被守卫或审批拦下时的原因。 */
  denied?: string
}

/** 单调守卫：只能拒绝或弃权，**没有 allow 这个返回值**。 */
export type ToolGuard = (exec: ToolExecution) => string | undefined

export type ExecutionMode = 'parallel' | 'exclusive'

/**
 * 工具注册表与执行流水线。
 *
 * 对照真 dsh：packages/core/tools/src/index.ts（整个 src 5,620 行）。
 */
export class ToolsService {
  private readonly defs = new Map<string, ToolDefinition>()
  private readonly guards: ToolGuard[] = []
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  register(def: ToolDefinition): Disposer {
    if (this.defs.has(def.name)) throw new Error(`tool "${def.name}" 已注册`)
    this.defs.set(def.name, def)
    return () => this.defs.delete(def.name)
  }

  /** 注册一个守卫。它只能拒绝，拒绝之后没人能翻案。 */
  guard(g: ToolGuard): Disposer {
    this.guards.push(g)
    return () => {
      const i = this.guards.indexOf(g)
      if (i >= 0) this.guards.splice(i, 1)
    }
  }

  list(): ToolDefinition[] {
    return [...this.defs.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 模型请求里带的工具 schema。 */
  schemas(): { name: string; description: string; parameters: unknown }[] {
    return this.list().map((d) => ({ name: d.name, description: d.description, parameters: d.parameters }))
  }

  /**
   * 分类：这个调用能不能和别人并发。
   *
   * fail-closed —— 只有 isConcurrencySafe 精确返回 true 才算 parallel。
   * 真 dsh 的 executionMode()（tools/src/index.ts:1276）是同样的判定。
   */
  executionMode(exec: ToolExecution): ExecutionMode {
    // TODO(ch10): fail-closed：只有精确返回 true 才算可并发
    throw new Error('TODO(ch10): 未实现 — 见书中对应小节，或 git checkout ch10-done')
  }

  /**
   * 执行一个工具调用，穿过完整流水线。
   *
   * pre-execute（waterfall）→ 单调守卫 → execute（around waterfall）
   * → 工具体 → post-execute（waterfall）
   */
  async execute(exec: ToolExecution): Promise<ToolResult> {
    const base: ToolResult = { callId: exec.callId, name: exec.name, content: null, isError: false }

    // 1. pre-execute：hook、权限、沙箱包装都挂这里。可以短路成拒绝。
    const pre = await this.ctx.waterfall<ToolResult | undefined>(
      'tools/pre-execute', [exec], async () => undefined,
    )
    if (pre) return pre

    // 2. 单调守卫：只能拒绝。任何一个说不，就是不。
    for (const g of this.guards) {
      const reason = g(exec)
      if (reason !== undefined) {
        const denied = { ...base, isError: true, denied: reason, content: `拒绝：${reason}` }
        return this.post(exec, denied)
      }
    }

    // 3. execute 是 around 分发：超时、重试、埋点包在这一层
    let result: ToolResult
    try {
      result = await this.ctx.waterfall<ToolResult>('tools/execute', [exec], async () => {
        const def = this.defs.get(exec.name)
        if (!def) return { ...base, isError: true, content: `UNKNOWN_TOOL: ${exec.name}` }
        const content = await def.execute(exec.args, exec)
        return { ...base, content }
      })
    } catch (err) {
      // 工具抛异常不该炸掉整个回合——那是模型的一次尝试，把错误交回给它
      result = { ...base, isError: true, content: String((err as Error)?.message ?? err) }
    }

    return this.post(exec, result)
  }

  private async post(exec: ToolExecution, result: ToolResult): Promise<ToolResult> {
    const final = await this.ctx.waterfall<ToolResult>('tools/post-execute', [exec, result], async () => result)
    this.ctx.emit('tools/result', exec, Object.freeze({ ...final }))
    return final
  }

  /**
   * 按模型给的顺序执行一批调用，但允许安全的那些并发。
   *
   * 关键约束：**派发可以重叠，结果必须按模型顺序落库**。
   * 历史顺序一旦不确定，回放、重试重建、缓存前缀全部一起崩。
   */
  async executeBatch(calls: ToolExecution[], maxParallel = 4): Promise<ToolResult[]> {
    // TODO(ch10): 派发可以重叠，但结果必须按模型给的顺序落位
    throw new Error('TODO(ch10): 未实现 — 见书中对应小节，或 git checkout ch10-done')
  }
}

export const toolsPlugin = {
  name: 'tools',
  apply(ctx: Context) {
    ctx.provide('tools', new ToolsService(ctx))
  },
}
