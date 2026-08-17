import { Fiber } from './fiber.ts'
import { Events, type Listener } from './events.ts'
import { FiberState, type Disposer, type Impl, type Plugin, type PluginLike } from './types.ts'

/**
 * 服务注册表。
 *
 * 它管两件事：谁提供了什么，以及**服务变动时通知所有 fiber 重算 epoch**。
 * 第二件才是关键——激活顺序完全由它驱动。
 */
export class Registry {
  private readonly impls = new Map<string, Impl>()
  private readonly fibers = new Set<Fiber>()

  get(name: string): Impl | undefined {
    return this.impls.get(name)
  }

  /** 当前有哪些服务。调试时最常用。 */
  keys(): string[] {
    return [...this.impls.keys()].sort()
  }

  track(fiber: Fiber): void {
    this.fibers.add(fiber)
  }

  untrack(fiber: Fiber): void {
    this.fibers.delete(fiber)
  }

  /**
   * 提供一个服务，返回撤销它的 disposer。
   *
   * 注意 providerUid：同名服务被换了实现时，uid 变了，
   * 所有消费者的 epoch 跟着变，于是它们被整体重启。
   */
  provide(name: string, value: unknown, providerUid: number): Disposer {
    if (this.impls.has(name)) {
      throw new Error(`service "${name}" already provided`)
    }
    this.impls.set(name, { name, value, providerUid })
    this.notify()
    return () => {
      const current = this.impls.get(name)
      if (current?.providerUid !== providerUid) return
      this.impls.delete(name)
      this.notify()
    }
  }

  /** 通知每个 fiber 重新算一遍它的依赖指纹。 */
  notify(): void {
    for (const fiber of [...this.fibers]) fiber.refresh()
  }
}

/**
 * 一个上下文：服务的取用口 + 插件的挂载点。
 *
 * `ctx.llm` 这种写法靠一层 Proxy 转发到注册表。真 dsh 的 reflect.ts 有 418 行，
 * 处理 tracing、隔离域、跨 realm 品牌检查；这里只做最基本的读转发。
 */
export class Context {
  readonly registry: Registry
  /** 挂在这个 context 上的 fiber。根 context 才有意义。 */
  readonly fibers: Fiber[] = []
  /** 事件总线。根 context 和所有子 context 共用同一个。 */
  readonly events: Events

  /** 当前 context 归属的 fiber。根 context 为 undefined。 */
  readonly fiber?: Fiber

  constructor(registry?: Registry, fiber?: Fiber, events?: Events) {
    this.registry = registry ?? new Registry()
    this.events = events ?? new Events()
    this.fiber = fiber
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && !(prop in target)) {
          return target.registry.get(prop)?.value
        }
        return Reflect.get(target, prop, receiver)
      },
      has(target, prop) {
        if (typeof prop === 'string' && target.registry.get(prop)) return true
        return Reflect.has(target, prop)
      },
    })
  }

  /** 根 context 的引用，fiber 内部要用它发全局事件。 */
  private get root(): Context {
    return this
  }

  /**
   * 提供一个服务。
   *
   * 返回的 disposer 会被登记到当前 fiber 上，所以插件卸载时这个服务自动消失，
   * 不需要插件作者记得撤销。这就是「注册即可撤销 effect」的最小形态。
   */
  provide(name: string, value: unknown): Disposer {
    const uid = this.fiber?.uid ?? 0
    const dispose = this.registry.provide(name, value, uid)
    return this.own(dispose)
  }

  /**
   * 把一个 disposer 登记到当前 fiber。
   *
   * 第 6 章会把它扩成完整的 `ctx.effect()`。
   */
  own(dispose: Disposer): Disposer {
    let done = false
    const once: Disposer = () => {
      if (done) return
      done = true
      return dispose()
    }
    this.fiber?.disposers.push(once)
    return once
  }

  /** 挂载一个插件。返回它的 fiber，方便观察状态。 */
  plugin<C>(plugin: PluginLike<C>, config?: C): Fiber {
    const normalized: Plugin<C> =
      typeof plugin === 'function' ? { name: plugin.name, apply: plugin } : plugin

    // 每个插件拿到自己的子 context，它注册的东西归自己的 fiber 管。
    const child = new Context(this.registry, undefined, this.events)
    const fiber = new Fiber(this, child as Context, normalized as Plugin, config)
    // 让子 context 知道自己属于谁——用 defineProperty 绕开 readonly。
    Object.defineProperty(child, 'fiber', { value: fiber, configurable: true })

    this.fibers.push(fiber)
    this.registry.track(fiber)
    fiber.refresh()
    return fiber
  }

  /** 卸载一个插件，并把它注册过的东西全部回滚。 */
  async unplug(fiber: Fiber): Promise<void> {
    this.registry.untrack(fiber)
    const i = this.fibers.indexOf(fiber)
    if (i >= 0) this.fibers.splice(i, 1)
    await fiber.dispose()
  }

  /**
   * 注册一个监听器。返回的 disposer 已登记到当前 fiber，插件卸载时自动摘掉。
   *
   * `prepend` 只在监听器必须先于普通注册运行时用，比如运行时不变式检查。
   */
  on(event: string, listener: Listener, prepend = false): Disposer {
    return this.own(this.events.on(event, listener, prepend))
  }

  emit(event: string, ...args: any[]): void {
    this.events.emit(event, ...args)
  }

  parallel(event: string, ...args: any[]): Promise<void> {
    return this.events.parallel(event, ...args)
  }

  serial(event: string, ...args: any[]): Promise<void> {
    return this.events.serial(event, ...args)
  }

  bail<T>(event: string, ...args: any[]): Promise<T | undefined> {
    return this.events.bail<T>(event, ...args)
  }

  waterfall<T>(event: string, args: any[], final: () => T | Promise<T>): Promise<T> {
    return this.events.waterfall<T>(event, args, final)
  }

  /**
   * 做一件有副作用的事，并把它的逆操作交给当前 fiber 保管。
   *
   * setup 返回的 disposer 会在插件卸载时被逆序执行。这是「注册即可撤销」的完整形态：
   * `provide` 和 `on` 都是它的特例。
   *
   * 三条约束（照抄真 Cordis 踩出来的教训）：
   * - UNLOADING 期间禁止创建新 effect，否则卸载集合不封闭，逆序序列跑到一半被追加
   * - disposer 是一次性的，重复调用无害
   * - setup 同步抛异常时要回滚它已经做的部分
   */
  effect(setup: () => Disposer): Disposer {
    if (this.fiber?.state === FiberState.UNLOADING) {
      throw new Error('INACTIVE_EFFECT: 不能在卸载过程中创建新的 effect')
    }
    const dispose = setup()
    return this.own(dispose)
  }

  /** 等整棵树里所有 fiber 都不再变动。测试和启动断言用。 */
  async settled(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      await Promise.all(this.fibers.map((f) => f.settled()))
      if (this.fibers.every((f) => !['LOADING', 'UNLOADING'].includes(f.state))) return
    }
    throw new Error('tree did not settle')
  }

  /** 还有哪些插件卡在 PENDING，各自缺什么。排查「我的插件为什么没反应」的抓手。 */
  pending(): { name: string; missing: string[] }[] {
    return this.fibers
      .filter((f) => f.state === FiberState.PENDING)
      .map((f) => ({
        name: f.name,
        missing: (f.plugin.inject ?? []).filter((n) => !this.registry.get(n)),
      }))
  }
}
