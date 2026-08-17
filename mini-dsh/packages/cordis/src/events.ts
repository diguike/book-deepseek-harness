import type { Disposer } from './types.ts'

/**
 * 五种分发方式。
 *
 * 真 Cordis 的 DispatchMode（vendor/cordis/src/events.ts:32）也是这五个。
 * 官方 primer 的表格只列了前四个——bail 只在 client 侧用，服务端读者见不到。
 */
export type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'

export type Listener = (...args: any[]) => any

interface Entry {
  listener: Listener
  prepend: boolean
}

/**
 * 事件总线。
 *
 * 分发方式是事件公开契约的一部分——同一个事件名不能一会儿 emit 一会儿 waterfall，
 * 因为监听器的写法完全不同：waterfall 的监听器多收一个 next 参数。
 */
export class Events {
  private readonly entries = new Map<string, Entry[]>()

  /**
   * 注册一个监听器。
   *
   * `prepend` 让监听器排到最前面。只在「必须先于普通注册跑」时用——
   * 比如运行时不变式检查，它要抢在可能短路的监听器前面，否则会被静默跳过。
   */
  on(event: string, listener: Listener, prepend = false): Disposer {
    let list = this.entries.get(event)
    if (!list) this.entries.set(event, (list = []))
    const entry: Entry = { listener, prepend }
    if (prepend) list.unshift(entry)
    else list.push(entry)
    return () => {
      const i = list!.indexOf(entry)
      if (i >= 0) list!.splice(i, 1)
    }
  }

  private listeners(event: string): Listener[] {
    return (this.entries.get(event) ?? []).map((e) => e.listener)
  }

  /** 观察，不关心返回值，不等待。 */
  emit(event: string, ...args: any[]): void {
    for (const l of this.listeners(event)) {
      try {
        l(...args)
      } catch (err) {
        this.emitError(err)
      }
    }
  }

  /** 全部并发跑，等它们都完事。 */
  async parallel(event: string, ...args: any[]): Promise<void> {
    await Promise.all(
      this.listeners(event).map(async (l) => {
        try {
          await l(...args)
        } catch (err) {
          this.emitError(err)
        }
      }),
    )
  }

  /** 按注册顺序挨个跑，等每一个。 */
  async serial(event: string, ...args: any[]): Promise<void> {
    for (const l of this.listeners(event)) {
      try {
        await l(...args)
      } catch (err) {
        this.emitError(err)
      }
    }
  }

  /** 按顺序跑，第一个返回非 undefined 的就停下并把它作为结果。 */
  async bail<T>(event: string, ...args: any[]): Promise<T | undefined> {
    for (const l of this.listeners(event)) {
      const result = await l(...args)
      if (result !== undefined) return result as T
    }
    return undefined
  }

  /**
   * 环绕式分发：每个监听器拿到 `(...args, next)`。
   *
   * 调 `next()` 把控制权交给下一个，拿到它的返回值；不调就在这里短路。
   * 最里层是 `final`，也就是没有任何监听器时的默认行为。
   *
   * **注意这个名字**：webpack 的 SyncWaterfallHook 是「上一个的返回值喂给下一个」，
   * 是 fold；这里是 around 中间件，语义相反。中文别译成「瀑布」。
   */
  async waterfall<T>(event: string, args: any[], final: () => T | Promise<T>): Promise<T> {
    const chain = this.listeners(event)
    const step = async (i: number): Promise<T> => {
      if (i >= chain.length) return final()
      const next = () => step(i + 1)
      return await chain[i](...args, next)
    }
    return step(0)
  }

  private emitError(err: unknown): void {
    for (const l of this.listeners('internal/error')) {
      try {
        l(err)
      } catch {
        // 错误处理器自己出错就只能咽下去，否则会无限递归
      }
    }
  }
}
