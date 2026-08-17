import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../../cordis/src/index.ts'
import { composeEntries, renderDump, mount, assertEntriesActivated, type Layer } from '../src/index.ts'

const base: Layer = { label: 'mini-base', patches: [{ insert: [
  { id: 'llm', name: 'mini-llm' },
  { id: 'session', name: 'mini-session' },
  { id: 'agent-default-model', name: 'mini-default-model', config: { provider: 'deepseek', model: 'v4', temperature: 0.2 } },
  { id: 'hmr', name: 'mini-hmr', config: { root: ['.'] } },
]}]}

test('后面的层能顶掉前面的行，dump 标出是谁顶的', () => {
  const webApp: Layer = { label: 'mini-web-app', patches: [{ id: 'hmr', disabled: true }] }
  const entries = composeEntries([base, webApp])
  const hmr = entries.find((e) => e.id === 'hmr')!
  assert.equal(hmr.disabled, true)
  assert.deepEqual(hmr.provenance, { origin: 'mini-base', patchedBy: ['mini-web-app'] })
  assert.match(renderDump(entries), /# == mini-base, patched by mini-web-app/)
})

test('patch 是整体替换，不深合并——没写的字段会消失', () => {
  const home: Layer = { label: 'home', patches: [{ id: 'agent-default-model', config: { provider: 'mock' } }] }
  const entries = composeEntries([base, home])
  const row = entries.find((e) => e.id === 'agent-default-model')!
  assert.deepEqual(row.config, { provider: 'mock' })
  assert.equal((row.config as any).model, undefined, 'model 和 temperature 都没了')
})

test('层的叠加满足结合律：怎么分组都一样', () => {
  const l2: Layer = { label: 'L2', patches: [{ id: 'llm', config: { a: 1 } }] }
  const l3: Layer = { label: 'L3', patches: [{ id: 'llm', config: { b: 2 } }] }
  const abc = composeEntries([base, l2, l3])
  // 先把 l2、l3 当一层用，结果应当一致
  const merged: Layer = { label: 'L2', patches: [...l2.patches, ...l3.patches] }
  const ab_c = composeEntries([base, merged])
  assert.deepEqual(
    abc.map((e) => ({ id: e.id, config: e.config })),
    ab_c.map((e) => ({ id: e.id, config: e.config })),
  )
})

test('patch 到不存在的 id 只告警，不报错', () => {
  const warns: string[] = []
  const entries = composeEntries([base, { label: 'home', patches: [{ id: 'not-there', config: {} }] }], (m) => warns.push(m))
  assert.equal(entries.length, 4)
  assert.match(warns[0], /"not-there" 在树里不存在/)
})

test('插入重复 id 直接报错', () => {
  assert.throws(() => composeEntries([base, { label: 'x', patches: [{ insert: [{ id: 'llm', name: 'other' }] }] }]), /DUPLICATE_ID/)
})

test('dump 用的就是 boot 用的那个函数，不可能漂移', () => {
  const entries = composeEntries([base])
  const dumped = renderDump(entries)
  // dump 里出现的每一行 id，都必须是真正会被挂载的那批
  const ids = [...dumped.matchAll(/^- id: (.+)$/gm)].map((m) => m[1])
  assert.deepEqual(ids, entries.map((e) => e.id))
})

test('disabled 的行不挂载', () => {
  const ctx = new Context()
  const entries = composeEntries([base, { label: 'web', patches: [{ id: 'hmr', disabled: true }] }])
  const fibers = mount(ctx, entries, (name) => ({ name, apply: (c) => c.provide(name, {}) }))
  assert.equal(fibers.length, 3, '四行里有一行被禁用了')
})

test('启动自检报出卡住的插件缺哪个服务', async () => {
  const ctx = new Context()
  const entries = composeEntries([{ label: 'L', patches: [{ insert: [
    { id: 'consumer', name: 'needs-llm' },
  ]}]}])
  mount(ctx, entries, () => ({ name: 'needs-llm', inject: ['llm'], apply: () => {} }))
  await ctx.settled()
  assert.throws(() => assertEntriesActivated(ctx), /STARTUP_INCOMPLETE[\s\S]*缺 \[llm\]/)
})

test('行序不影响结果——第 5 章那条规矩在这里兑现', async () => {
  const forward = composeEntries([{ label: 'L', patches: [{ insert: [
    { id: 'provider', name: 'p' }, { id: 'consumer', name: 'c' },
  ]}]}])
  const backward = composeEntries([{ label: 'L', patches: [{ insert: [
    { id: 'consumer', name: 'c' }, { id: 'provider', name: 'p' },
  ]}]}])
  const run = async (entries: any) => {
    const ctx = new Context()
    const order: string[] = []
    mount(ctx, entries, (name) => name === 'p'
      ? { name: 'p', apply: (c) => { order.push('p'); c.provide('svc', 1) } }
      : { name: 'c', inject: ['svc'], apply: () => order.push('c') })
    await ctx.settled()
    return order
  }
  assert.deepEqual(await run(forward), ['p', 'c'])
  assert.deepEqual(await run(backward), ['p', 'c'], '配置行序反过来，执行顺序不变')
})
