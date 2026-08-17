import { FiberState, type Disposer, type Plugin } from './types.ts'
import type { Context } from './context.ts'

/** epoch 的特殊值：依赖没齐。 */
const INACTIVE = false as const

let nextUid = 1

/**
 * 一个插件的运行时实例。
 *
 * 注意它不是执行流，和协程无关——它是「这个插件当前活成什么样」的载体：
 * 生命周期状态、它注册过的东西、它依赖的服务当前是谁提供的。
 *
 * 对照真 dsh：vendor/cordis/src/fiber.ts，754 行。
 */
export class Fiber {
  /** 这个 fiber 的身份。被 dispose 之后置 null，用来判定 DISPOSED。 */
  uid: number | null = nextUid++

  /**
   * 当前依赖快照的指纹：把每个被注入服务的**提供者 uid** 串起来。
   *
   * 这是整个激活机制的核心。任一提供者换了身份，这个字符串就变，
   * 消费者随即被重启——因为它手里那份服务引用已经过期了。
   */
  private epoch: string | typeof INACTIVE = INACTIVE

  /** 插件体抛出的异常。有值即 FAILED。 */
  private error: unknown = undefined

  /** 依赖服务的当前快照，key 是服务名。 */
  private store: Record<string, number> = Object.create(null)

  /** 这个插件注册过的东西，卸载时逆序执行。 */
  readonly disposers: Disposer[] = []

  /** 正在进行的加载或卸载。用来串行化，避免重入。 */
  private inertia: Promise<void> | undefined

  state: FiberState = FiberState.PENDING

  readonly root: Context
  readonly ctx: Context
  readonly plugin: Plugin
  readonly config: unknown

  constructor(root: Context, ctx: Context, plugin: Plugin, config: unknown) {
    this.root = root
    this.ctx = ctx
    this.plugin = plugin
    this.config = config
  }

  get name(): string {
    return this.plugin.name ?? this.plugin.apply.name ?? 'anonymous'
  }

  /**
   * 状态是**算出来的，不是存的**。
   *
   * 这一条决定了「状态和依赖不可能不同步」——因为状态压根不是一个独立变量。
   * 真 dsh 的 `_getState()`（fiber.ts:574）是同样三行判断。
   */
  private computeState(): FiberState {
    if (this.uid === null) return FiberState.DISPOSED
    if (this.error !== undefined) return FiberState.FAILED
    if (this.epoch !== INACTIVE) return FiberState.ACTIVE
    return FiberState.PENDING
  }

  private setState(next?: FiberState): void {
    const prev = this.state
    this.state = next ?? this.computeState()
    if (prev !== this.state) this.root.emit('internal/status', this, prev)
  }

  /**
   * 重新扫一遍依赖，算出新的 epoch。
   *
   * 任何服务的增删改都会触发它。对照真 dsh 的 `_refresh()`（fiber.ts:611）。
   */
  refresh(): void {
    const inject = this.plugin.inject ?? []
    let epoch: string | typeof INACTIVE = ''
    for (const name of inject) {
      const impl = this.root.registry.get(name)
      if (!impl) {
        // 缺一个就不启动。没有「部分可用」这种状态。
        epoch = INACTIVE
        break
      }
      this.store[name] = impl.providerUid
      epoch += ':' + impl.providerUid
    }
    this.setEpoch(epoch)
  }

  /** epoch 变了才动。没变说明依赖还是原来那批人，不用重启。 */
  private setEpoch(next: string | typeof INACTIVE): void {
    const prev = this.epoch
    if (next === prev) return
    this.epoch = next

    // 已经有一次加载/卸载在跑，让它跑完再说。真 cordis 在这里做了更细的重入处理。
    if (this.inertia) return

    if (next !== INACTIVE && prev === INACTIVE) {
      this.setState(FiberState.LOADING)
      this.run(() => this.load())
    } else {
      this.setState(FiberState.UNLOADING)
      this.run(() => this.unload())
    }
  }

  /**
   * 跑一次加载或卸载，并保证 inertia 被正确清掉。
   *
   * 不能写成 `this.inertia = this.load()`——如果任务体同步跑完（比如没有任何
   * disposer 要执行），它会先把 inertia 清空，外层赋值再把 promise 放回去，
   * 于是 inertia 永远不为空，等待它的人就死在那里。
   */
  private run(task: () => Promise<void>): Promise<void> {
    const p = task().finally(() => {
      if (this.inertia === p) this.inertia = undefined
    })
    this.inertia = p
    return p
  }

  private async load(): Promise<void> {
    try {
      await this.plugin.apply(this.ctx, this.config)
      this.error = undefined
    } catch (err) {
      this.error = err ?? new Error('plugin threw a falsy value')
    } finally {
      this.setState()
    }
  }

  /**
   * 逆序执行所有 disposer。
   *
   * 逆序不是习惯，是复合逆的定义：加载时状态变换是 eₙ∘…∘e₁，
   * 它的逆就是 e₁⁻¹∘…∘eₙ⁻¹。第 6 章展开。
   */
  private async unload(): Promise<void> {
    // TODO(ch06): 逆序执行所有 disposer。为什么逆序见第 6.4 节
    throw new Error('TODO(ch06): 未实现 — 见书中对应小节，或 git checkout ch06-done')
  }

  /** 彻底移除这个 fiber。之后它不会再被任何 refresh 唤醒。 */
  async dispose(): Promise<void> {
    if (this.uid === null) return
    await this.settled()
    if (this.epoch !== INACTIVE) {
      this.epoch = INACTIVE
      this.setState(FiberState.UNLOADING)
      await this.run(() => this.unload())
    }
    this.uid = null
    this.setState()
  }

  /** 等这个 fiber 当前的加载或卸载跑完。 */
  async settled(): Promise<void> {
    while (this.inertia) await this.inertia
  }
}
