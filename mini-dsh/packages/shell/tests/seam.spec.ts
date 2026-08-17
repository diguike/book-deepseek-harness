import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { Context } from '../../cordis/src/index.ts'
import { toolsPlugin, type ToolsService } from '../../tools/src/index.ts'
import { shellPlugin, shellLocalPlugin, shellContainerPlugin, toolBashPlugin, type ShellService } from '../src/index.ts'

const hasDocker = (() => { try { execSync('docker info', { stdio: 'ignore' }); return true } catch { return false } })()

async function boot(providerPlugin: any, cfg?: any) {
  const ctx = new Context()
  ctx.plugin(toolsPlugin); ctx.plugin(shellPlugin)
  ctx.plugin(providerPlugin, cfg)
  ctx.plugin(toolBashPlugin)
  await ctx.settled()
  return { ctx, tools: (ctx as any).tools as ToolsService, shell: (ctx as any).shell as ShellService }
}

test('三个角色齐全才叫接缝：少了 provider，消费者压根起不来', async () => {
  const ctx = new Context()
  ctx.plugin(toolsPlugin); ctx.plugin(shellPlugin); ctx.plugin(toolBashPlugin)
  await ctx.settled()
  // tool-bash 起来了（shell 服务在），但没有 provider
  const shell = (ctx as any).shell as ShellService
  assert.equal(shell.kind, 'none')
  await assert.rejects(() => shell.run({ command: 'echo hi' }), /SHELL_UNAVAILABLE/)
})

test('本地 provider：工具能跑命令', async () => {
  const { tools } = await boot(shellLocalPlugin)
  const r = await tools.execute({ callId: 'c1', name: 'bash', args: { command: 'echo hello' } })
  assert.equal((r.content as any).stdout, 'hello')
  assert.equal((r.content as any).where, 'local')
})

test('换 provider：工具代码一行不改，执行世界整个换掉', { skip: !hasDocker && '本机没有 docker' }, async () => {
  const local = await boot(shellLocalPlugin)
  const inContainer = await boot(shellContainerPlugin, { image: 'node:22-alpine' })

  // 完全相同的调用
  const call = { callId: 'c1', name: 'bash', args: { command: 'cat /etc/os-release | head -1' } }
  const a = await local.tools.execute(call)
  const b = await inContainer.tools.execute(call)

  assert.equal((a.content as any).where, 'local')
  assert.equal((b.content as any).where, 'container:node:22-alpine')
  assert.notEqual((a.content as any).stdout, (b.content as any).stdout, '两个世界的 os-release 不一样')
})

test('容器 provider 默认断网——执行环境的隔离属性跟着 provider 走', { skip: !hasDocker && '本机没有 docker' }, async () => {
  const { tools } = await boot(shellContainerPlugin, { image: 'node:22-alpine' })
  const r = await tools.execute({ callId: 'c1', name: 'bash', args: { command: 'wget -T2 -q -O- http://example.com || echo BLOCKED' } })
  assert.match((r.content as any).stdout, /BLOCKED/)
})

test('defaulting 是显式的 resolve 步骤，不是藏在 run 里的 ?? default', async () => {
  const { shell } = await boot(shellLocalPlugin)
  // resolve 把 request 补成 spec，补完的值是可检查的
  const provider = (shell as any).provider
  const spec = provider.resolve({ command: 'x' })
  assert.equal(typeof spec.cwd, 'string')
  assert.equal(spec.timeoutMs, 30_000)
})

test('卸载 provider 插件，接缝立刻变成不可用而不是静默降级', async () => {
  const ctx = new Context()
  ctx.plugin(toolsPlugin); ctx.plugin(shellPlugin)
  const p = ctx.plugin(shellLocalPlugin)
  ctx.plugin(toolBashPlugin)
  await ctx.settled()
  const shell = (ctx as any).shell as ShellService
  assert.equal(shell.kind, 'local')

  await ctx.unplug(p)
  assert.equal(shell.kind, 'none')
  await assert.rejects(() => shell.run({ command: 'echo x' }), /SHELL_UNAVAILABLE/)
})
