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
  // I1: seq 严格递增
  if (e.seq <= t.lastSeq) {
    throw new InvariantError('SEQ_NOT_MONOTONIC', `seq ${e.seq} 不大于上一条 ${t.lastSeq}`)
  }
  const next: Trace = { ...t, lastSeq: e.seq, pendingCalls: new Set(t.pendingCalls) }

  switch (e.type) {
    case 'turn/start':
      // I2: turn 必须开闭配对，且序号连续
      if (t.openTurn !== null) throw new InvariantError('TURN_ALREADY_OPEN', `turn ${t.openTurn} 还没关`)
      if (e.data.turn !== t.nextTurn) throw new InvariantError('TURN_OUT_OF_ORDER', `期望 turn ${t.nextTurn}，收到 ${e.data.turn}`)
      next.openTurn = e.data.turn
      next.nextTurn = t.nextTurn + 1
      next.nextStep = 1
      break
    case 'turn/end':
      if (t.openTurn === null) throw new InvariantError('NO_OPEN_TURN', 'turn/end 时没有打开的 turn')
      // I4: turn 关闭时不能还有开着的 step
      if (t.openStep !== null) throw new InvariantError('STEP_STILL_OPEN', `step ${t.openStep} 还没关`)
      next.openTurn = null
      break
    case 'step/start':
      if (t.openTurn === null) throw new InvariantError('STEP_OUTSIDE_TURN', 'step 必须在 turn 里')
      if (t.openStep !== null) throw new InvariantError('STEP_ALREADY_OPEN', `step ${t.openStep} 还没关`)
      if (e.data.step !== t.nextStep) throw new InvariantError('STEP_OUT_OF_ORDER', `期望 step ${t.nextStep}，收到 ${e.data.step}`)
      next.openStep = e.data.step
      next.nextStep = t.nextStep + 1
      break
    case 'step/end':
      if (t.openStep === null) throw new InvariantError('NO_OPEN_STEP', 'step/end 时没有打开的 step')
      // step 结束时不该还欠着工具结果
      if (t.pendingCalls.size > 0) {
        throw new InvariantError('CALLS_PENDING', `还欠 ${[...t.pendingCalls].join(', ')} 的结果`)
      }
      next.openStep = null
      break
    case 'tool/call':
      if (t.openStep === null) throw new InvariantError('CALL_OUTSIDE_STEP', 'tool/call 必须在 step 里')
      next.pendingCalls.add(e.data.callId)
      break
    case 'tool/result':
      // I3: tool/result 的 callId 必须在同一 step 的 pendingCalls 里
      if (!t.pendingCalls.has(e.data.callId)) {
        throw new InvariantError('UNKNOWN_CALL', `没有等待中的调用 ${e.data.callId}`)
      }
      next.pendingCalls.delete(e.data.callId)
      break
  }
  return next
}

/** 这个前缀能不能安全地 fork。 */
export function isForkable(t: Trace): boolean {
  return t.openTurn === null
}
