import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../../cordis/src/index.ts'
import { Session } from '../../session/src/index.ts'
import { LlmAdapter, llmPlugin, type GenerateOptions, type StreamChunk, type LlmService } from '../../llm/src/index.ts'
import { toolsPlugin, type ToolsService } from '../../tools/src/index.ts'
import { AgentLoop, assertRequestDerivesFromLog } from '../src/index.ts'

/** 按脚本回答的假模型：第 n 次调用返回第 n 段脚本。 */
class Scripted extends LlmAdapter {
  readonly provider = 'fake'
  n = 0
  seen: GenerateOptions[] = []
  private readonly script: StreamChunk[][]
  constructor(script: StreamChunk[][]) { super(); this.script = script }
  async *stream(o: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(o)
    for (const c of this.script[this.n++] ?? [{ kind: 'text', text: '（没词了）' }]) yield c
  }
}

async function setup(script: StreamChunk[][]) {
  const ctx = new Context()
  ctx.plugin(llmPlugin); ctx.plugin(toolsPlugin)
  await ctx.settled()
  const adapter = new Scripted(script)
  ;((ctx as any).llm as LlmService).register(adapter)
  const session = new Session('s1')
  const loop = new AgentLoop(ctx, {
    session, config: { provider: 'fake', model: 'm1' }, systemPrompt: '你是助手',
  })
  return { ctx, loop, session, adapter, tools: (ctx as any).tools as ToolsService }
}

test('一个 turn 两个 step：模型先调工具，拿到结果再作答', async () => {
  const { loop, session, tools } = await setup([
    [{ kind: 'tool_call', callId: 'c1', name: 'glob', args: {} }],
    [{ kind: 'text', text: 'math.js 和 package.json' }],
  ])
  tools.register({
    name: 'glob', description: '列出文件', parameters: {},
    execute: async () => ['math.js', 'package.json'],
  })

  loop.followup('列出当前目录的文件')
  const steps = await loop.runTurn()

  assert.equal(steps, 2)
  const types = session.events().map((e) => e.type)
  assert.deepEqual(types.filter((t) => t === 'step/start').length, 2)
  assert.ok(types.includes('tool/call'))
  assert.ok(types.includes('tool/result'))
  assert.equal(session.openTurn, null, 'turn 必须关掉')
})

test('被 pre-step 拒掉的输入，仍然关掉一个零 step 的 turn', async () => {
  const { ctx, loop, session } = await setup([])
  ctx.plugin({ name: 'blocker', apply: (c) => {
    c.on('agent/pre-step', async () => ({ action: 'reject', reason: '这次不许发' }))
  }})
  await ctx.settled()

  loop.followup('随便说点什么')
  const steps = await loop.runTurn()

  assert.equal(steps, 0, '一个 step 都没花')
  const types = session.events().map((e) => e.type)
  assert.deepEqual(types, ['turn/start', 'turn/end'], '但 turn 照开照关，日志记下这次尝试')
})

test('pre-step 能改写模型将要看到的消息', async () => {
  const { ctx, loop, session, adapter } = await setup([[{ kind: 'text', text: '收到' }]])
  ctx.plugin({ name: 'injector', apply: (c) => {
    c.on('agent/pre-step', async (claimed: any[], _pos: any, next: () => Promise<any>) => {
      const d = await next()
      if (d.action !== 'enter') return d
      return { action: 'enter', messages: [...d.messages, '【团队规约】提交前必须跑测试'] }
    })
  }})
  await ctx.settled()

  loop.followup('帮我改个 bug')
  await loop.runTurn()

  const userMsgs = session.events().filter((e) => e.type === 'user/message')
  assert.equal(userMsgs.length, 2, '注入的那条也必须落成日志事件')
  // 模型确实看到了两条
  assert.equal(adapter.seen[0].messages.length, 2)
})

test('请求里的消息必须逐字节等于从日志推导的结果', async () => {
  const s = new Session('s1')
  s.append('turn/start', { turn: 1 })
  s.append('step/start', { step: 1 })
  s.append('user/message', { content: [{ type: 'text', text: '真实的话' }] })

  const good = { messages: s.deriveMessages() }
  assert.doesNotThrow(() => assertRequestDerivesFromLog(good, s))

  // 有人绕过日志往请求里塞东西
  const bad = { messages: [...s.deriveMessages(), { role: 'user' as const, content: [{ type: 'text' as const, text: '偷塞的' }] }] }
  assert.throws(() => assertRequestDerivesFromLog(bad, s), /INVARIANT_VIOLATION/)
})

test('请求配置没变就不记新快照，变了才记', async () => {
  const { ctx, loop, session } = await setup([
    [{ kind: 'tool_call', callId: 'c1', name: 'noop', args: {} }],
    [{ kind: 'text', text: '好了' }],
  ])
  ;((ctx as any).tools as ToolsService).register({
    name: 'noop', description: '', parameters: {}, execute: async () => 'ok',
  })
  loop.followup('干活')
  await loop.runTurn()
  const headers = session.events().filter((e) => e.type === 'request/header')
  assert.equal(headers.length, 1, '两个 step 但配置没变，只记一条')
})

test('agent/request 上的监听器能换模型，换了就多一条快照', async () => {
  const { ctx, loop, session } = await setup([
    [{ kind: 'tool_call', callId: 'c1', name: 'noop', args: {} }],
    [{ kind: 'text', text: '好了' }],
  ])
  ;((ctx as any).tools as ToolsService).register({
    name: 'noop', description: '', parameters: {}, execute: async () => 'ok',
  })
  let n = 0
  ctx.plugin({ name: 'router', apply: (c) => {
    c.on('agent/request', async (cfg: any, next: () => Promise<any>) => {
      const resolved = await next()
      return n++ === 0 ? resolved : { ...resolved, model: 'm2' }   // 第二次换模型
    })
  }})
  await ctx.settled()

  loop.followup('干活')
  await loop.runTurn()
  const headers = session.events().filter((e) => e.type === 'request/header')
  assert.equal(headers.length, 2, '换了模型就该记新快照')
})

test('inject 不唤醒驱动，等下一条 followup 一起带走', async () => {
  const { loop, session } = await setup([[{ kind: 'text', text: '好' }]])
  loop.inject('这是背景信息')
  loop.followup('这是问题')
  await loop.runTurn()
  const userMsgs = session.events().filter((e) => e.type === 'user/message')
  assert.equal(userMsgs.length, 2, '两条一起进了同一个 step')
})
