import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, FiberState } from '../src/index.ts'

test('缺依赖的插件停在 PENDING，不执行插件体', async () => {
  const ctx = new Context()
  let ran = false
  const f = ctx.plugin({ name: 'consumer', inject: ['llm'], apply: () => { ran = true } })
  await ctx.settled()
  assert.equal(f.state, FiberState.PENDING)
  assert.equal(ran, false)
  assert.deepEqual(ctx.pending(), [{ name: 'consumer', missing: ['llm'] }])
})

test('依赖就位后自动激活——顺序由服务可用性驱动，不由挂载顺序驱动', async () => {
  const ctx = new Context()
  const order: string[] = []
  const consumer = ctx.plugin({
    name: 'consumer',
    inject: ['llm'],
    apply: (c) => { order.push('consumer:' + (c as any).llm) },
  })
  const provider = ctx.plugin({
    name: 'provider',
    apply: (c) => { order.push('provider'); c.provide('llm', 'v1') },
  })
  await ctx.settled()
  assert.equal(provider.state, FiberState.ACTIVE)
  assert.equal(consumer.state, FiberState.ACTIVE)
  assert.deepEqual(order, ['provider', 'consumer:v1'])
})

test('换一个提供者，消费者被整体重启（epoch 变了）', async () => {
  const ctx = new Context()
  const seen: string[] = []
  ctx.plugin({ name: 'consumer', inject: ['llm'], apply: (c) => { seen.push((c as any).llm as string) } })
  const p1 = ctx.plugin({ name: 'p1', apply: (c) => c.provide('llm', 'v1') })
  await ctx.settled()
  assert.deepEqual(seen, ['v1'])
  await ctx.unplug(p1)
  await ctx.settled()
  ctx.plugin({ name: 'p2', apply: (c) => c.provide('llm', 'v2') })
  await ctx.settled()
  assert.deepEqual(seen, ['v1', 'v2'], '提供者换人后消费者应当再跑一遍')
})

test('插件卸载时，它注册过的服务自动消失', async () => {
  const ctx = new Context()
  const p = ctx.plugin({ name: 'p', apply: (c) => c.provide('llm', 'v1') })
  await ctx.settled()
  assert.deepEqual(ctx.registry.keys(), ['llm'])
  await ctx.unplug(p)
  await ctx.settled()
  assert.deepEqual(ctx.registry.keys(), [], '插件作者没写任何清理代码')
})

test('插件体抛异常进 FAILED，不影响别人', async () => {
  const ctx = new Context()
  const bad = ctx.plugin({ name: 'bad', apply: () => { throw new Error('boom') } })
  const good = ctx.plugin({ name: 'good', apply: (c) => c.provide('ok', 1) })
  await ctx.settled()
  assert.equal(bad.state, FiberState.FAILED)
  assert.equal(good.state, FiberState.ACTIVE)
})

test('注册的撤销是逆序的', async () => {
  const ctx = new Context()
  const log: string[] = []
  const p = ctx.plugin({
    name: 'p',
    apply: (c) => {
      c.own(() => log.push('first'))
      c.own(() => log.push('second'))
      c.own(() => log.push('third'))
    },
  })
  await ctx.settled()
  await ctx.unplug(p)
  assert.deepEqual(log, ['third', 'second', 'first'])
})
