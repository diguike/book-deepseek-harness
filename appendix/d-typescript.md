---
title: 附录 D　读这本书需要的 TypeScript
feishu_url: "https://fivwvysqdz.feishu.cn/wiki/JsUGwmWXAiq1uokIQHIc5bDgnVf"
last_synced: "2026-08-17"
verified_against: "@deepseek-ai/dsh@0.1.0-rc.6 / 源码 47f94385 / 2026-08-16"
---

> 给从 Java / Go / Python 转过来的读者。**七条，全部用 dsh 或 mini-dsh 的真实代码做例子**，不用 `interface Animal`。
> 用到哪条时正文会指过来，不用一次读完。

| 需要它的地方 | 条目 |
|---|---|
| 第 5 章 | D.1 声明合并、D.2 Proxy 与 Reflect |
| 第 6 章 | D.3 条件类型与 `infer`、D.4 generator |
| 第 8、9 章 | D.5 Promise 与取消 |
| 第 6、10 章 | D.6 闭包与 WeakMap |
| 配套仓库 | D.7 ESM 与 `.ts` 后缀 |

## D.1 声明合并：往别人的接口上加成员

**Java 和 Go 里没有对应物。** 不是"像什么"，是"没有"。

TypeScript 允许你**从外部**往一个已有的 `interface` 上加成员，而且是编译期的：

```ts
// dsh 里每个提供服务的包都会写这么一段
declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmService
  }
}
```

写完之后，**任何地方**的 `ctx.llm` 都有类型了——哪怕 cordis 这个包自己压根不知道 `llm` 的存在。

同名 `interface` 的多次声明会**合并**，不是覆盖。所以二十个包各加各的，最后 `Context` 上就有二十个服务。

**这解释了第 5 章那个 Proxy 为什么能有类型。** 运行时靠 Proxy 转发，编译期靠声明合并补类型——两条路，各管一半。

事件表也是同样的机制：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'tools/pre-execute'(exec: ToolExecution, next: () => Promise<...>): Promise<...>
  }
}
```

**要点**：`interface` 能合并，`type` 不能。所以这类可扩展的表必须用 `interface`。

## D.2 Proxy 与 Reflect：`ctx.llm` 是怎么变出来的

`Context` 上并没有一个叫 `llm` 的字段。它是运行时拦截出来的：

```ts
// mini-dsh/packages/cordis/src/context.ts
return new Proxy(this, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && !(prop in target)) {
      return target.registry.get(prop)?.value      // 转发到服务注册表
    }
    return Reflect.get(target, prop, receiver)     // 本来就有的属性，正常走
  },
})
```

`new Proxy(目标, 处理器)` 造一个"看起来像目标"的对象，读写它的时候先过处理器。

`Reflect.get(target, prop, receiver)` 是"按默认方式取属性"，比 `target[prop]` 好的地方是它正确处理 getter 里的 `this`。

**Java 的类比是动态代理**（`java.lang.reflect.Proxy`），但 JS 的 Proxy 能拦截的操作多得多：读、写、删、`in`、枚举、函数调用、`new`。

真 dsh 的 `reflect.ts` 是 418 行，多出来的部分在做调用链追踪、隔离域、跨 realm 的品牌检查。

## D.3 条件类型与 `infer`：从类型里"取出"类型

读 dsh 源码会撞到这种：

```ts
intercept<K extends InjectKey>(
  name: K,
  config: Context[K] extends { [symbols.config]: infer T } ? T : never
)
```

拆开看：

- `A extends B ? X : Y` 是**条件类型**——如果 A 能赋给 B，结果是 X，否则 Y
- `infer T` 是**在匹配过程中捕获一个类型**，捕到的东西叫 T

整句的意思：如果 `Context[K]` 这个类型上有个 `[symbols.config]` 属性，就把那个属性的类型取出来当 `config` 参数的类型；没有的话这个参数就是 `never`（传什么都不对）。

**Java 泛型没有这个能力。** 最接近的心智模型是"编译期的模式匹配"。

常见的几个内置工具类型都是这么实现的：

```ts
type Parameters<T> = T extends (...args: infer P) => any ? P : never
type ReturnType<T> = T extends (...args: any) => infer R ? R : never
type Awaited<T>    = T extends Promise<infer U> ? U : T
```

**读代码时的实用建议**：看到 `infer` 就找它后面那个 `?`，问号左边是"匹配模式"，捕获的东西在右边用。

## D.4 generator：函数体延迟执行

第 8 章那个 bug 的根源。

```ts
async function* stream(): AsyncIterable<StreamChunk> {
  throw new Error('RATE_LIMIT')      // ← 这句什么时候执行？
  yield { kind: 'text', text: 'hi' }
}

const s = stream()     // ← 不执行任何东西，只造了个迭代器
for await (const c of s) { }   // ← 到这里才执行，才抛
```

**`async *` 函数的函数体，要到第一次迭代才开始跑。** 调用它只是造一个迭代器对象。

这和普通 `async` 函数完全不同——普通 async 函数一调用就开始执行，直到第一个 `await`。

**后果**：任何"包住一次调用"的拦截器，如果被拦截的是 generator，异常会从拦截器的 `try/catch` 里漏掉，因为调用返回时它还没抛。

**解法**是预热（第 8 章那个 `prime()`）：先手动拉一个值出来，再把它接回去。

Python 读者对这个行为熟——Python 的生成器也是惰性的。Java 没有直接对应物，`Stream` 的惰性是另一回事。

## D.5 Promise 与取消

四样东西，读主循环和工具流水线要用。

**`AbortController` / `AbortSignal`**

```ts
const ac = new AbortController()
someOperation({ signal: ac.signal })
ac.abort()      // 通知取消
```

**Go 读者注意**：它很像 `context.Context` 的取消部分，这个映射基本对。但它**不携带值**，不是 Go context 那种"取消 + 值传递"的二合一。

**`Promise.race`**

```ts
return Promise.race([next(), timeout])   // 谁先完事用谁的结果
```

第 10 章的超时策略就是它。注意：**输的那个不会被取消**，它还在跑，只是结果被丢弃了。要真取消得配 `AbortSignal`。

**`Promise.allSettled` vs `Promise.all`**

`all` 一个失败就整体拒绝，其余的结果丢了。`allSettled` 等全部完事，每个给一个 `{status, value|reason}`。

**批量执行工具时通常要 `allSettled`**——一个工具失败不该丢掉其他工具的结果。

**`Promise.withResolvers()`**

```ts
const { promise, resolve, reject } = Promise.withResolvers<void>()
```

把 resolve/reject 拿到手，在别处调用。真 dsh 的主循环用它协调 inbox 唤醒。

### 一条必须点破的反类比

**JS 是单线程的。** 第 9、10 章讲的那个"并发工具调用的 barrier"，**防的不是数据竞争**。

不会有两个工具同时修改同一块内存——JS 没有那种并发。barrier 防的是**副作用顺序**：两个 `bash` 调用都往同一个工作目录写文件，谁先谁后结果不一样。

**如果你把它映射成 goroutine 或者线程池，那两章的直觉全是错的。**

## D.6 闭包与 WeakMap

**闭包捕获的是变量，不是值**：

```ts
private run(task: () => Promise<void>): Promise<void> {
  const p = task().finally(() => {
    if (this.inertia === p) this.inertia = undefined   // 闭包捕获了 p
  })
  this.inertia = p
  return p
}
```

那个 `if (this.inertia === p)` 检查的是"当前这个 inertia 还是不是我这次设的"。第 5 章那个死循环 bug 就是这么修的。

**WeakMap 的键是弱引用**：

```ts
const seen = new WeakSet()      // 第 14 章那个插件用它记"这个 agent 注入过了"
if (seen.has(agent)) return decision
seen.add(agent)
```

用 `WeakSet` 而不是 `Set`，是因为**它不阻止 agent 被垃圾回收**。用普通 Set 会造成内存泄漏——每个跑过的 agent 都被永久持有。

Java 类比：`WeakHashMap`。

## D.7 ESM 与 `.ts` 后缀

**dsh 全仓 ESM**（`"type": "module"`），不用 CommonJS。

**跨包用包名，包内相对导入带 `.ts` 后缀**：

```ts
import { Fiber } from './fiber.ts'                    // 包内，带 .ts
import type { Context } from '@deepseek-ai/cordis'    // 跨包，用包名
```

带 `.ts` 后缀是刻意的：TypeScript 编译时会把它重写成 `.js`，而类型声明里保持显式的、NodeNext 安全的 `.ts`。

**`import type` 只导入类型**，编译后整行消失。循环依赖时特别有用。

### mini-dsh 的两个额外约束

Node 的原生类型剥离模式（`node xxx.ts` 直接跑）**不支持两样东西**：

```ts
// ✗ 构造器参数属性
constructor(readonly ctx: Context) {}

// ✓ 显式字段赋值
readonly ctx: Context
constructor(ctx: Context) { this.ctx = ctx }
```

```ts
// ✗ enum
enum FiberState { PENDING, ACTIVE }

// ✓ const 对象 + 联合类型
export const FiberState = { PENDING: 'PENDING', ACTIVE: 'ACTIVE' } as const
export type FiberState = (typeof FiberState)[keyof typeof FiberState]
```

原因是"剥离"模式只删类型注解，不做代码转换——而参数属性和 enum 都需要生成运行时代码。

**mini-dsh 全程遵守这两条，所以它零依赖，`node --test` 直接跑。**
