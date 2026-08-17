import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { apply, name } from '../src/index.js'

/** 最小的 ctx 替身：只要 on / logger。 */
function fakeCtx() {
  const listeners = new Map()
  return {
    listeners,
    on(ev, fn) { listeners.set(ev, fn); return () => listeners.delete(ev) },
    logger: { info() {}, warn() {} },
    emit(ev, ...a) { return listeners.get(ev)?.(...a) },
  }
}

const FILE = '/tmp/audit-test.jsonl'
const clean = () => { if (existsSync(FILE)) rmSync(FILE) }
const readLines = () => readFileSync(FILE, 'utf8').trim().split('\n').map(JSON.parse)

test('导出 name 和 apply', () => {
  assert.equal(name, 'dsh-plugin-audit')
  assert.equal(typeof apply, 'function')
})

test('审计记录落盘，字段齐全', async () => {
  clean()
  const ctx = fakeCtx()
  apply(ctx, { auditFile: FILE })
  const post = ctx.listeners.get('tools/post-execute')

  const exec = { callId: 'c1', name: 'bash', arguments: { command: 'ls' }, agent: { id: 's1' } }
  const result = { content: 'a.js\nb.js', isError: false }
  const out = await post(exec, result, async () => result)

  assert.equal(out, result, '必须原样返回下游结果')
  const [rec] = readLines()
  assert.equal(rec.tool, 'bash')
  assert.equal(rec.sessionId, 's1')
  assert.equal(rec.isError, false)
  assert.match(rec.args, /ls/)
  assert.deepEqual(rec.redacted, [])
})

test('脱敏命中 API key、邮箱、Bearer、私钥', async () => {
  clean()
  const ctx = fakeCtx()
  apply(ctx, { auditFile: FILE })
  const post = ctx.listeners.get('tools/post-execute')

  const secret = [
    'API_KEY=sk-abcdefghij1234567890',
    'contact: dev@example.com',
    'Authorization: Bearer abcdefghij1234567890',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const result = { content: secret, isError: false }
  await post({ callId: 'c1', name: 'read', arguments: {} }, result, async () => result)

  const [rec] = readLines()
  assert.ok(!rec.result.includes('sk-abcdefghij1234567890'), 'API key 必须被替换')
  assert.ok(!rec.result.includes('dev@example.com'), '邮箱必须被替换')
  assert.ok(!rec.result.includes('MIIabc'), '私钥必须被替换')
  for (const label of ['API key', '邮箱', 'Bearer token', '私钥']) {
    assert.ok(rec.redacted.includes(label), `redacted 应含 ${label}`)
  }
})

test('关掉脱敏就原样记录', async () => {
  clean()
  const ctx = fakeCtx()
  apply(ctx, { auditFile: FILE, redactionEnabled: false })
  const post = ctx.listeners.get('tools/post-execute')
  const result = { content: 'sk-abcdefghij1234567890', isError: false }
  await post({ callId: 'c1', name: 'x', arguments: {} }, result, async () => result)
  assert.match(readLines()[0].result, /sk-abcdefghij1234567890/)
})

test('超长字段被截断', async () => {
  clean()
  const ctx = fakeCtx()
  apply(ctx, { auditFile: FILE, maxFieldChars: 50 })
  const post = ctx.listeners.get('tools/post-execute')
  const result = { content: 'x'.repeat(500), isError: false }
  await post({ callId: 'c1', name: 'cat', arguments: {} }, result, async () => result)
  const [rec] = readLines()
  assert.ok(rec.result.length < 120)
  assert.match(rec.result, /截断，原长/)
})

test('审计目标不可用时降级，不影响工具执行', async () => {
  const ctx = fakeCtx()
  // 根目录下的路径普通用户建不了 → apply 应当降级成只写 harness 日志，而不是抛
  apply(ctx, { auditFile: '/definitely-not-writable-root/audit.jsonl' })
  const post = ctx.listeners.get('tools/post-execute')
  const result = { content: 'ok', isError: false }
  const out = await post({ callId: 'c1', name: 'x', arguments: {} }, result, async () => result)
  assert.equal(out, result, '写盘失败也要原样返回')
})

test('规约只在第一步注入，之后不重复', async () => {
  const ctx = fakeCtx()
  apply(ctx, { conventions: '提交前跑测试' })
  const pre = ctx.listeners.get('agent/pre-step')
  const agent = { id: 'a1' }
  const base = { kind: 'enter', messages: [{ id: 'm1', role: 'user', content: [], source: { kind: 'user' } }] }

  const first = await pre({ agent }, async () => base)
  assert.equal(first.messages.length, 2, '第一步应当注入')
  const injected = first.messages[1]
  assert.equal(injected.source.kind, 'user', 'UserMessage 必须带 source')
  assert.ok(injected.id, 'UserMessage 必须带 id')
  assert.match(injected.content[0].text, /提交前跑测试/)

  const second = await pre({ agent }, async () => base)
  assert.equal(second.messages.length, 1, '第二步不再注入')
})

test('规约为空时不注册 pre-step 监听器', () => {
  const ctx = fakeCtx()
  apply(ctx, { conventions: '' })
  assert.equal(ctx.listeners.has('agent/pre-step'), false)
})

test('被拒绝的 pre-step 决定原样透传', async () => {
  const ctx = fakeCtx()
  apply(ctx, { conventions: '规约' })
  const pre = ctx.listeners.get('agent/pre-step')
  const rejected = { kind: 'reject' }
  assert.equal(await pre({ agent: { id: 'a1' } }, async () => rejected), rejected)
})
