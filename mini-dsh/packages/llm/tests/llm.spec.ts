import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../../cordis/src/index.ts'
import { LlmAdapter, LlmService, collect, callConfigEquals, llmPlugin, type GenerateOptions, type StreamChunk } from '../src/index.ts'

class FakeAdapter extends LlmAdapter {
  readonly provider = 'fake'
  calls = 0
  private readonly script: StreamChunk[]
  constructor(script: StreamChunk[] = []) { super(); this.script = script }
  async *stream(_o: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    for (const c of this.script) yield c
  }
}

const opts = (over: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: 'fake', model: 'm1', messages: [], system: 'sys', tools: [], ...over,
})

test('装一个包就多一个 provider，卸载就没了', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService

  const p = ctx.plugin({ name: 'fake-adapter', inject: ['llm'], apply: (c) => {
    // 归属交给调用方：c.effect 把 disposer 挂在这个插件的 fiber 上
    c.effect(() => ((c as any).llm as LlmService).register(new FakeAdapter()))
  }})
  await ctx.settled()
  assert.deepEqual(llm.providers(), ['fake'])

  await ctx.unplug(p)
  assert.deepEqual(llm.providers(), [], '插件卸载时适配器自动注销')
})

test('流式是硬约束：拿到的是 AsyncIterable，不是一整段字符串', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService
  llm.register(new FakeAdapter([
    { kind: 'text', text: '你' }, { kind: 'text', text: '好' },
    { kind: 'done', usage: { inputTokens: 10, outputTokens: 2 } },
  ]))
  const stream = await llm.stream(opts())
  const seen: string[] = []
  for await (const c of stream) if (c.kind === 'text') seen.push(c.text)
  assert.deepEqual(seen, ['你', '好'], '片段是一个个来的')
})

test('llm/stream 是 waterfall，所以重试是一个监听器而不是内置逻辑', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService

  let attempts = 0
  class Flaky extends LlmAdapter {
    readonly provider = 'flaky'
    async *stream(): AsyncIterable<StreamChunk> {
      attempts++
      if (attempts < 3) throw new Error('RATE_LIMIT')
      yield { kind: 'text', text: '终于成了' }
    }
  }
  llm.register(new Flaky())

  // 重试插件：挂在同一条 waterfall 上，产品代码一行不改
  ctx.plugin({ name: 'llm-retry', apply: (c) => {
    c.on('llm/stream', async (_o: GenerateOptions, next: () => Promise<AsyncIterable<StreamChunk>>) => {
      for (let i = 0; i < 5; i++) {
        try { return await next() } catch (e) { if (i === 4) throw e }
      }
      throw new Error('unreachable')
    })
  }})
  await ctx.settled()

  const { text } = await collect(await llm.stream(opts({ provider: 'flaky' })))
  assert.equal(text, '终于成了')
  assert.equal(attempts, 3)
})

test('llm/stream 是 waterfall，所以回放也是一个监听器——不用 key 就能跑', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService
  const real = new FakeAdapter([{ kind: 'text', text: '真实调用' }])
  llm.register(real)

  ctx.plugin({ name: 'llm-replay', apply: (c) => {
    c.on('llm/stream', async () => {
      // 短路，压根不调 next，所以真适配器一次都不会被碰
      return (async function* () { yield { kind: 'text', text: '录像回放' } as StreamChunk })()
    })
  }})
  await ctx.settled()

  const { text } = await collect(await llm.stream(opts()))
  assert.equal(text, '录像回放')
  assert.equal(real.calls, 0, '真适配器没被调用')
})

test('计量监听器只观察不拦截，所以必须调 next', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService
  llm.register(new FakeAdapter([{ kind: 'done', usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 90 } }]))

  const metered: number[] = []
  ctx.plugin({ name: 'token-meter', apply: (c) => {
    c.on('llm/stream', async (_o: GenerateOptions, next: () => Promise<AsyncIterable<StreamChunk>>) => {
      const inner = await next()
      return (async function* () {
        for await (const chunk of inner) {
          if (chunk.kind === 'done' && chunk.usage) metered.push(chunk.usage.cacheReadTokens ?? 0)
          yield chunk
        }
      })()
    })
  }})
  await ctx.settled()

  await collect(await llm.stream(opts()))
  assert.deepEqual(metered, [90])
})

test('callConfigEquals 决定要不要记一条新的 header 快照', () => {
  const base = { provider: 'p', model: 'm', temperature: 0.2 }
  assert.equal(callConfigEquals(base, { ...base }), true, '没变就不记')
  assert.equal(callConfigEquals(base, { ...base, model: 'm2' }), false, '换模型要记')
  assert.equal(callConfigEquals(base, { ...base, temperature: 0.9 }), false, '换采样参数也要记')
})

test('没注册的 provider 在发请求前就失败', async () => {
  const ctx = new Context()
  ctx.plugin(llmPlugin)
  await ctx.settled()
  const llm = (ctx as any).llm as LlmService
  await assert.rejects(() => llm.stream(opts({ provider: 'nope' })), /UNKNOWN_PROVIDER/)
})
