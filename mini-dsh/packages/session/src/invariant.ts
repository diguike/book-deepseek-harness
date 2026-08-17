import type { SessionEvent } from './types.ts'

/**
 * 日志上的括号结构。
 *
 * append-only 序列不代表任意位置都能切。日志上还压着两层结构：
 * turn/step 的开闭配对，以及 tool/call…tool/result 的按 callId 配对。
 * 这个状态机就是那些结构的可执行版本。
 *
 * 对照真 dsh：packages/core/session/src/invariant.ts。
 * 那边的 validateEvent 是纯函数、applyTransition 才提交——
 * 分开写的好处是「校验通过但后续监听器否决」不会污染状态。
 */
export interface Trace {
  lastSeq: number
  openTurn: number | null
  openStep: number | null
  nextTurn: number
  nextStep: number
  pendingCalls: Set<string>
}

export function emptyTrace(): Trace {
  return { lastSeq: -1, openTurn: null, openStep: null, nextTurn: 1, nextStep: 1, pendingCalls: new Set() }
}

export class InvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.code = code
  }
}

/**
 * 纯转移函数：给一个状态和一个事件，算出下一个状态。不改传进来的 trace。
 * 违反不变式就抛错。
 */
export function validateEvent(t: Trace, e: SessionEvent): Trace {
  // TODO(ch07): 纯转移函数：算出下一个状态但不改传进来的。四条不变式见 7.5 节
  throw new Error('TODO(ch07): 未实现 — 见书中对应小节，或 git checkout ch07-done')
}

/** 这个前缀能不能安全地 fork。 */
export function isForkable(t: Trace): boolean {
  return t.openTurn === null
}
