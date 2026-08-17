import { spawn } from 'node:child_process'
import type { Context, Disposer } from '../../cordis/src/index.ts'
import type { ToolsService } from '../../tools/src/index.ts'

/* ─────────────────────── 角色一：Service Definition ───────────────────────
 * 声明「跑一条命令」是什么，不说怎么跑。
 * 一个接缝必须三个角色齐全——单有这个接口不叫接缝。
 */

export interface ShellRequest {
  command: string
  cwd?: string
  timeoutMs?: number
}

export interface ShellSpec extends ShellRequest {
  cwd: string
  timeoutMs: number
}

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  /** 这条命令实际在哪跑的。审计和排查要用。 */
  where: string
}

export abstract class ShellProvider {
  abstract readonly kind: string
  /**
   * 显式的默认值解析步骤。
   *
   * dsh 的规矩：defaulting 是一个明确的 resolve(request): Spec 步骤，
   * 不是藏在 run() 里的 `?? default`。这样"最终用了什么参数"是可检查的。
   */
  resolve(req: ShellRequest): ShellSpec {
    return { cwd: req.cwd ?? process.cwd(), timeoutMs: req.timeoutMs ?? 30_000, command: req.command }
  }
  abstract run(spec: ShellSpec): Promise<ShellResult>
}

export class ShellService {
  private provider: ShellProvider | undefined
  register(p: ShellProvider): Disposer {
    if (this.provider) throw new Error(`shell provider 已经是 ${this.provider.kind}`)
    this.provider = p
    return () => { this.provider = undefined }
  }
  get kind(): string { return this.provider?.kind ?? 'none' }
  async run(req: ShellRequest): Promise<ShellResult> {
    if (!this.provider) throw new Error('SHELL_UNAVAILABLE: 没有注册任何 provider')
    return this.provider.run(this.provider.resolve(req))
  }
}

export const shellPlugin = {
  name: 'shell',
  apply(ctx: Context) { ctx.provide('shell', new ShellService()) },
}

/* ─────────────────── 角色二之一：本地 Provider ─────────────────── */

export class LocalShellProvider extends ShellProvider {
  readonly kind = 'local'
  async run(spec: ShellSpec): Promise<ShellResult> {
    const t0 = Date.now()
    return new Promise((resolve) => {
      const p = spawn('bash', ['-lc', spec.command], { cwd: spec.cwd })
      let out = '', err = ''
      const timer = setTimeout(() => p.kill('SIGKILL'), spec.timeoutMs)
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { err += d })
      p.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout: out, stderr: err, exitCode: code ?? -1, durationMs: Date.now() - t0, where: 'local' })
      })
    })
  }
}

export const shellLocalPlugin = {
  name: 'shell-local',
  inject: ['shell'],
  apply(ctx: Context) {
    ctx.effect(() => ((ctx as any).shell as ShellService).register(new LocalShellProvider()))
  },
}

/* ─────────────────── 角色二之二：容器 Provider ───────────────────
 * 同一个接口，换一个执行世界。消费者一行不改。
 */

export interface ContainerConfig {
  image?: string
  /** 把哪个本地目录挂进容器。不挂就是完全隔离。 */
  mount?: string
}

export class ContainerShellProvider extends ShellProvider {
  readonly kind = 'container'
  private readonly image: string
  private readonly mount: string | undefined
  constructor(cfg: ContainerConfig = {}) {
    super()
    this.image = cfg.image ?? 'node:22-alpine'
    this.mount = cfg.mount
  }
  async run(spec: ShellSpec): Promise<ShellResult> {
    const t0 = Date.now()
    const args = ['run', '--rm', '--network=none']
    if (this.mount) args.push('-v', `${this.mount}:/work`, '-w', '/work')
    args.push(this.image, 'sh', '-c', spec.command)
    return new Promise((resolve) => {
      const p = spawn('docker', args)
      let out = '', err = ''
      const timer = setTimeout(() => p.kill('SIGKILL'), spec.timeoutMs)
      p.stdout.on('data', (d) => { out += d })
      p.stderr.on('data', (d) => { err += d })
      p.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout: out, stderr: err, exitCode: code ?? -1, durationMs: Date.now() - t0, where: `container:${this.image}` })
      })
    })
  }
}

export const shellContainerPlugin = {
  name: 'shell-container',
  inject: ['shell'],
  apply(ctx: Context, cfg?: ContainerConfig) {
    ctx.effect(() => ((ctx as any).shell as ShellService).register(new ContainerShellProvider(cfg)))
  },
}

/* ─────────────────── 角色三：Consumer ───────────────────
 * 模型可见的 bash 工具。它只认 ctx.shell 这个接口，
 * 完全不知道下面是本地还是容器——这就是「零 fork」的含义。
 */

export const toolBashPlugin = {
  name: 'tool-bash',
  inject: ['tools', 'shell'],
  apply(ctx: Context) {
    const tools = (ctx as any).tools as ToolsService
    const shell = (ctx as any).shell as ShellService
    ctx.effect(() => tools.register({
      name: 'bash',
      description: '执行一条 shell 命令',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      // 两条 bash 可能踩同一个工作目录，所以不声明并发安全 → 独占
      execute: async (args) => {
        const { command } = args as { command: string }
        const r = await shell.run({ command })
        return { stdout: r.stdout.trim(), exitCode: r.exitCode, where: r.where }
      },
    }))
  },
}
