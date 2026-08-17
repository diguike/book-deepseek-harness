import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Events } from '../src/index.ts'

test('waterfall：调 next 放行，不调就短路', async () => {
  const ev = new Events()
  const log: string[] = []
  ev.on('pipe', async (x: number, next: () => Promise<number>) => {
    log.push('A 进'); const r = await next(); log.push('A 出'); return r
  })
  ev.on('pipe', async (x: number, next: () => Promise<number>) => {
    log.push('B 短路'); return -1                       // 不调 next
  })
  ev.on('pipe', async () => { log.push('C 永远跑不到'); return 99 })

  const out = await ev.waterfall<number>('pipe', [1], () => 0)
  assert.equal(out, -1)
  assert.deepEqual(log, ['A 进', 'B 短路', 'A 出'])     // 洋葱形状：A 包着 B
})

test('waterfall：没有监听器时走 final', async () => {
  const ev = new Events()
  assert.equal(await ev.waterfall<string>('x', [], () => 'default'), 'default')
})

test('waterfall：监听器可以改写参数对象再放行', async () => {
  const ev = new Events()
  ev.on('req', async (req: { model: string }, next: () => Promise<string>) => {
    req.model = 'cheap'                                  // 协作式：改共享对象再委托
    return next()
  })
  const req = { model: 'expensive' }
  const out = await ev.waterfall<string>('req', [req], () => `发给 ${req.model}`)
  assert.equal(out, '发给 cheap')
})

test('bail：第一个非 undefined 的返回值胜出', async () => {
  const ev = new Events()
  ev.on('ask', () => undefined)
  ev.on('ask', () => 'B 答了')
  ev.on('ask', () => 'C 不会被问到')
  assert.equal(await ev.bail<string>('ask'), 'B 答了')
})

test('serial 按顺序，parallel 不保证顺序但都跑完', async () => {
  const ev = new Events()
  const order: string[] = []
  const mk = (n: string, ms: number) => async () => {
    await new Promise((r) => setTimeout(r, ms)); order.push(n)
  }
  ev.on('s', mk('慢', 20)); ev.on('s', mk('快', 1))
  await ev.serial('s')
  assert.deepEqual(order, ['慢', '快'], 'serial 必须按注册顺序')

  order.length = 0
  const ev2 = new Events()
  ev2.on('p', mk('慢', 20)); ev2.on('p', mk('快', 1))
  await ev2.parallel('p')
  assert.deepEqual(order, ['快', '慢'], 'parallel 里快的先完')
})

test('prepend 的监听器抢在普通注册前面', async () => {
  const ev = new Events()
  const log: string[] = []
  ev.on('e', () => log.push('普通'))
  ev.on('e', () => log.push('抢先'), true)
  ev.emit('e')
  assert.deepEqual(log, ['抢先', '普通'])
})

test('插件卸载时，它注册的监听器一起消失', async () => {
  const ctx = new Context()
  const log: string[] = []
  const p = ctx.plugin({ name: 'p', apply: (c) => { c.on('tick', () => log.push('hit')) } })
  await ctx.settled()
  ctx.emit('tick')
  assert.deepEqual(log, ['hit'])

  await ctx.unplug(p)
  ctx.emit('tick')
  assert.deepEqual(log, ['hit'], '卸载后监听器不该再响应')
})

test('effect：setup 的逆操作被 fiber 保管，逆序回滚', async () => {
  const ctx = new Context()
  const log: string[] = []
  const p = ctx.plugin({
    name: 'p',
    apply: (c) => {
      c.effect(() => { log.push('开文件'); return () => log.push('关文件') })
      c.effect(() => { log.push('开连接'); return () => log.push('关连接') })
    },
  })
  await ctx.settled()
  assert.deepEqual(log, ['开文件', '开连接'])
  await ctx.unplug(p)
  assert.deepEqual(log, ['开文件', '开连接', '关连接', '关文件'], '后开的先关')
})

test('disposer 重复调用无害', async () => {
  const ctx = new Context()
  let n = 0
  const p = ctx.plugin({ name: 'p', apply: (c) => { const d = c.effect(() => () => n++); d(); d(); d() } })
  await ctx.settled()
  await ctx.unplug(p)
  assert.equal(n, 1)
})
