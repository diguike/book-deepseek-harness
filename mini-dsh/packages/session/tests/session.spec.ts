import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session, surfaceOf } from '../src/index.ts'

function oneTurn(s: Session) {
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  s.append('user/message', { content: [{ type: 'text', text: '列出文件' }] })
  s.append('request/header', { provider: 'mock', model: 'm1' })
  s.append('assistant/message', { content: [{ type: 'text', text: '好的' }] })
  s.append('tool/call', { callId: 'c1', name: 'glob', args: {} })
  s.append('tool/result', { callId: 'c1', result: 'a.js' })
  s.append('step/end', { step: 1 })
  s.append('turn/end', { turn: 1 })
}

test('模型历史是从日志算出来的，不是另存的', () => {
  const s = new Session('s1')
  oneTurn(s)
  const msgs = s.deriveMessages()
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant'])
  // request/header、tool/call、tool/result 都在日志里，但不在模型历史里
  assert.equal(s.events().length, 9)
  assert.equal(msgs.length, 2)
})

test('插件注入的上下文也必须落成事件，才能被模型看到', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  s.append('user/message', { content: [{ type: 'text', text: '用户说的' }] })
  s.append('user/message', { content: [{ type: 'text', text: '插件注入的运行时上下文' }] })
  assert.equal(s.deriveMessages().length, 2, '两条都进模型，因为两条都是事件')
})

test('surfaceOp: replace 把一段历史换掉——压缩就走这条路', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  for (let i = 0; i < 5; i++) {
    s.append('user/message', { content: [{ type: 'text', text: `第 ${i} 轮` }] })
  }
  assert.equal(s.deriveMessages().length, 5)

  // 把 surface 上前 4 条换成一条摘要
  s.append('compaction/summary', { summary: '前四轮的摘要', shadowedStart: 0, shadowedEnd: 4 })
  s.append('user/message', {
    content: [{ type: 'text', text: '前四轮的摘要' }],
    surfaceOp: { op: 'replace', start: 0, end: 4 },
  })

  const msgs = s.deriveMessages()
  assert.equal(msgs.length, 2, '4 条被压成 1 条，加上原本的第 5 条')
  assert.equal(msgs[0].content[0].text, '前四轮的摘要')
  assert.equal(msgs[1].content[0].text, '第 4 轮')
  // 日志一条没少
  assert.equal(s.events().filter((e) => e.type === 'user/message').length, 6)
})

test('seq 必须严格递增', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  assert.throws(() => {
    // 伪造一条 seq 倒退的事件
    ;(s as any).seq = 0
    s.append('turn/end', { turn: 1 })
  }, /SEQ_NOT_MONOTONIC/)
})

test('turn 和 step 必须开闭配对', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  assert.throws(() => s.append('turn/start', { turn: 2 }), /TURN_ALREADY_OPEN/)

  const s2 = new Session('s2')
  s2.append('turn/start', { turn: 1 })
  s2.append('step/start', { step: 1 })
  assert.throws(() => s2.append('turn/end', { turn: 1 }), /STEP_STILL_OPEN/)
})

test('tool/result 的 callId 必须有对应的 tool/call', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  assert.throws(() => s.append('tool/result', { callId: 'ghost', result: 1 }), /UNKNOWN_CALL/)
})

test('step 结束时不能还欠着工具结果', () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  s.append('tool/call', { callId: 'c1', name: 'x', args: {} })
  assert.throws(() => s.append('step/end', { step: 1 }), /CALLS_PENDING/)
})

test('fork 只能切在 turn 关闭的位置', () => {
  const s = new Session('s1')
  oneTurn(s)
  s.append('turn/start', { turn: 2 })
  s.append('step/start', { step: 1 })
  s.append('user/message', { content: [{ type: 'text', text: '第二轮' }] })

  // 切在第一个 turn 结束处：可以
  const ok = s.fork('child', 8)
  assert.equal(ok.deriveMessages().length, 2)

  // 切在第二个 turn 中间：不行
  assert.throws(() => s.fork('bad', 11), /OPEN_TURN/)
})

test('不认识的事件类型让整份日志作废，除非标了 ignorable', () => {
  const s = new Session('s1')
  oneTurn(s)
  const raw = [...s.events()] as any[]
  raw.splice(3, 0, { seq: 2.5, at: 0, type: 'future/thing', data: {} })
  assert.throws(() => Session.replay('r', raw), /UNKNOWN_EVENT_TYPE/)

  const raw2 = [...s.events()] as any[]
  raw2.splice(3, 0, { seq: 2.5, at: 0, type: 'future/thing', data: {}, ignorable: true })
  assert.doesNotThrow(() => Session.replay('r2', raw2))
})

test('surfaceOf：log-only 事件一个都不进模型', () => {
  const s = new Session('s1')
  s.append('session/created', { sessionId: 's1', cwd: '/tmp' })
  s.append('permission/preset', { preset: 'workspace-write' })
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  s.append('session/title', { title: '标题' })
  s.append('assistant/chunk', { text: '好' })
  s.append('user/message', { content: [{ type: 'text', text: 'hi' }] })
  assert.equal(surfaceOf(s.events()).length, 1)
})
