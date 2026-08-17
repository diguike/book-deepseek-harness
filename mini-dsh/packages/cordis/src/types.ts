/**
 * mini-cordis 的公共词汇。
 *
 * 对照真 dsh：vendor/cordis/src/fiber.ts:147 定义了同名的 FiberState，
 * 六个状态一模一样。这里省掉的是 tracing、隔离域、跨 realm 品牌检查。
 */

/**
 * 插件实例的六种生命周期状态。
 *
 * 用 const 对象而不是 enum：Node 的类型剥离模式不支持 enum，
 * 而 mini-dsh 要做到零依赖直接 `node xxx.ts` 就能跑。
 */
export const FiberState = {
  /** 依赖没齐，等着。插件体一次都没跑过，或者已经被卸载了。 */
  PENDING: 'PENDING',
  /** 依赖刚齐，插件体正在跑。 */
  LOADING: 'LOADING',
  /** 插件体跑完了，它注册的东西都生效了。 */
  ACTIVE: 'ACTIVE',
  /** 插件体抛了异常。不会自动重试。 */
  FAILED: 'FAILED',
  /** 正在卸载，注册过的东西正在逆序回滚。 */
  UNLOADING: 'UNLOADING',
  /** 已经被移除，不会再启动。 */
  DISPOSED: 'DISPOSED',
} as const

export type FiberState = (typeof FiberState)[keyof typeof FiberState]

/** 卸载一个注册。调用应当是幂等的。 */
export type Disposer = () => void | Promise<void>

/**
 * 一个插件。
 *
 * 两种写法：带 apply 的对象，或者直接一个函数。
 * `inject` 声明这个插件需要哪些服务才能启动——这是激活顺序的唯一依据。
 */
export interface Plugin<C = any> {
  /** 用来在日志和报错里指认它。 */
  name?: string
  /** 需要的服务名。全部就位之前，这个插件不会被执行。 */
  inject?: string[]
  /** 插件体。它注册的一切都应当挂在传进来的 ctx 上。 */
  apply(ctx: Context, config?: C): void | Promise<void>
}

export type PluginLike<C = any> = Plugin<C> | ((ctx: Context, config?: C) => void | Promise<void>)

/** 一个服务实现，连同提供它的那个 fiber 的身份。 */
export interface Impl {
  name: string
  value: unknown
  /** 提供者的 uid。它变了，意味着换了一个实现——消费者必须重启。 */
  providerUid: number
}

import type { Context } from './context.ts'
