import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../../cordis/src/index.ts'
import { toolsPlugin, type ToolsService, type ToolExecution, type ToolResult } from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  ctx.plugin(toolsPlugin)
  await ctx.settled()
  return { ctx, tools: (ctx as any).tools as ToolsService }
}

const exec = (name: string, args: unknown = {}, callId = 'c1'): ToolExecution => ({ callId, name, args })

test('工具是插件注册的，插件卸载工具就消失', async () => {
  const { ctx, tools } = await setup()
  const p = ctx.plugin({ name: 'tool-bash', inject: ['tools'], apply: (c) => {
    c.effect(() => ((c as any).tools as ToolsService).register({
      name: 'bash', description: '跑命令', parameters: {}, execute: async () => 'ok',
    }))
  }})
  await ctx.settled()
  assert.deepEqual(tools.list().map((d) => d.name), ['bash'])
  await ctx.unplug(p)
  assert.deepEqual(tools.list(), [])
})

test('pre-execute 可以短路成拒绝，工具体压根不跑', async () => {
  const { ctx, tools } = await setup()
  let ran = false
  tools.register({ name: 'rm', description: '', parameters: {}, execute: async () => { ran = true; return 'done' } })
  ctx.plugin({ name: 'policy', apply: (c) => {
    c.on('tools/pre-execute', async (e: ToolExecution) => {
      if (e.name === 'rm') return { callId: e.callId, name: e.name, content: '不许删', isError: true, denied: 'policy' }
      // 注意：这里没调 next 也没返回 undefined 的分支，实际写法见正文
    })
  }})
  await ctx.settled()
  const r = await tools.execute(exec('rm'))
  assert.equal(r.isError, true)
  assert.equal(ran, false, '工具体一次都没跑')
})

test('守卫只能拒绝——返回类型里没有 allow', async () => {
  const { tools } = await setup()
  tools.register({ name: 'write', description: '', parameters: {}, execute: async () => 'written' })

  tools.guard((e) => (e.name === 'write' ? '只读模式' : undefined))
  tools.guard(() => undefined)                     // 弃权
  const r = await tools.execute(exec('write'))
  assert.equal(r.denied, '只读模式')
  assert.equal(r.isError, true)
})

test('守卫是单调的：加再多守卫只会更严，顺序不影响最终决定', async () => {
  const { tools } = await setup()
  tools.register({ name: 'x', description: '', parameters: {}, execute: async () => 'ok' })
  tools.guard(() => undefined)
  tools.guard(() => '第二个说不')
  tools.guard(() => undefined)
  const r1 = await tools.execute(exec('x'))

  const { tools: t2 } = await setup()
  t2.register({ name: 'x', description: '', parameters: {}, execute: async () => 'ok' })
  t2.guard(() => '第二个说不')                      // 换个顺序
  t2.guard(() => undefined)
  const r2 = await t2.execute(exec('x'))

  assert.equal(r1.isError, r2.isError, '顺序不影响最终决定')
})

test('execute 是 around 分发：超时能包在外面', async () => {
  const { ctx, tools } = await setup()
  tools.register({
    name: 'slow', description: '', parameters: {},
    execute: async () => { await new Promise((r) => setTimeout(r, 200)); return '终于好了' },
  })
  ctx.plugin({ name: 'timeout-policy', apply: (c) => {
    c.on('tools/execute', async (e: ToolExecution, next: () => Promise<ToolResult>) => {
      const timeout = new Promise<ToolResult>((resolve) =>
        setTimeout(() => resolve({ callId: e.callId, name: e.name, content: '超时了', isError: true }), 20))
      return Promise.race([next(), timeout])
    })
  }})
  await ctx.settled()
  const r = await tools.execute(exec('slow'))
  assert.equal(r.content, '超时了')
})

test('post-execute 能改写结果——超长结果落盘就挂这里', async () => {
  const { ctx, tools } = await setup()
  tools.register({ name: 'cat', description: '', parameters: {}, execute: async () => 'x'.repeat(5000) })
  ctx.plugin({ name: 'spill-policy', apply: (c) => {
    c.on('tools/post-execute', async (_e: ToolExecution, r: ToolResult, next: () => Promise<ToolResult>) => {
      const settled = await next()
      const text = String(settled.content)
      if (text.length <= 100) return settled
      return { ...settled, content: `【结果太长已落盘，${text.length} 字节，用 spill_read 取回】` }
    })
  }})
  await ctx.settled()
  const r = await tools.execute(exec('cat'))
  assert.match(String(r.content), /已落盘/)
})

test('工具抛异常不炸掉流程，错误交回给模型', async () => {
  const { tools } = await setup()
  tools.register({ name: 'boom', description: '', parameters: {}, execute: async () => { throw new Error('文件不存在') } })
  const r = await tools.execute(exec('boom'))
  assert.equal(r.isError, true)
  assert.match(String(r.content), /文件不存在/)
})

test('并发分类是 fail-closed：只有精确 true 才算安全', async () => {
  const { tools } = await setup()
  tools.register({ name: 'read', description: '', parameters: {}, isConcurrencySafe: () => true, execute: async () => 1 })
  tools.register({ name: 'write', description: '', parameters: {}, isConcurrencySafe: () => false, execute: async () => 1 })
  tools.register({ name: 'unknown', description: '', parameters: {}, execute: async () => 1 })
  tools.register({ name: 'throws', description: '', parameters: {}, isConcurrencySafe: () => { throw new Error('x') }, execute: async () => 1 })

  assert.equal(tools.executionMode(exec('read')), 'parallel')
  assert.equal(tools.executionMode(exec('write')), 'exclusive')
  assert.equal(tools.executionMode(exec('unknown')), 'exclusive', '没声明 = 独占')
  assert.equal(tools.executionMode(exec('throws')), 'exclusive', '抛异常 = 独占')
})

test('派发可以重叠，但结果按模型给的顺序排', async () => {
  const { tools } = await setup()
  const finished: string[] = []
  const mk = (name: string, ms: number, safe: boolean) => tools.register({
    name, description: '', parameters: {},
    isConcurrencySafe: safe ? () => true : undefined,
    execute: async () => { await new Promise((r) => setTimeout(r, ms)); finished.push(name); return name },
  })
  mk('slow', 40, true); mk('fast', 1, true); mk('lock', 1, false)

  const results = await tools.executeBatch([
    exec('slow', {}, 'c1'), exec('fast', {}, 'c2'), exec('lock', {}, 'c3'),
  ])
  assert.deepEqual(finished, ['fast', 'slow', 'lock'], '执行是重叠的：快的先完')
  assert.deepEqual(results.map((r) => r.name), ['slow', 'fast', 'lock'], '但结果按模型顺序')
})

test('独占的工具形成 barrier，把并发池劈成两段', async () => {
  const { tools } = await setup()
  const log: string[] = []
  const mk = (name: string, safe: boolean) => tools.register({
    name, description: '', parameters: {},
    isConcurrencySafe: safe ? () => true : undefined,
    execute: async () => { log.push(`开${name}`); await new Promise((r) => setTimeout(r, 5)); log.push(`完${name}`); return name },
  })
  mk('a', true); mk('b', true); mk('X', false); mk('c', true)

  await tools.executeBatch([exec('a', {}, '1'), exec('b', {}, '2'), exec('X', {}, '3'), exec('c', {}, '4')])
  // a、b 重叠；X 独占；c 在 X 之后
  assert.deepEqual(log.slice(0, 2), ['开a', '开b'])
  assert.equal(log.indexOf('开X') > log.indexOf('完b'), true, 'X 必须等 a、b 都完')
  assert.equal(log.indexOf('开c') > log.indexOf('完X'), true, 'c 必须等 X 完')
})

test('tools/result 拿到的是冻结过的最终结果', async () => {
  const { ctx, tools } = await setup()
  tools.register({ name: 'x', description: '', parameters: {}, execute: async () => 'v' })
  let observed: ToolResult | undefined
  ctx.plugin({ name: 'observer', apply: (c) => { c.on('tools/result', (_e: ToolExecution, r: ToolResult) => { observed = r }) }})
  await ctx.settled()
  await tools.execute(exec('x'))
  assert.equal(observed?.content, 'v')
  assert.throws(() => { (observed as any).content = '改了' }, TypeError)
})
