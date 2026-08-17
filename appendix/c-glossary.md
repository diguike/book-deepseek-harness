---
title: 附录 C　术语与速查表
feishu_url: "https://fivwvysqdz.feishu.cn/wiki/GYAOw3ZPEiIQ8ZkRNmVck0LDnR5"
last_synced: "2026-08-17"
verified_against: "@deepseek-ai/dsh@0.1.0-rc.6 / 源码 47f94385 / 2026-08-16"
---

> **译法说明**：本表**对齐官方 `docs/glossary.zh.md`**，不另立标准。官方那份经过双语配对流水线校对，另搞一套的后果是你照书学完、去 Discussions 提问时用的词跟所有人都对不上。
> 本表在官方基础上补三样：官方没译的词、容易误解的词的澄清、以及**不建议翻译**的词。

## C.1 最容易认错的六个词

| 词 | dsh 里的意思 | 容易误解成 | 建议 |
|---|---|---|---|
| **fiber** | 一个插件的运行时实例：生命周期状态 + 它注册过的东西 + 依赖快照 | 用户态协程（Boost.Fiber / Ruby Fiber / Java Loom），或 React Fiber 那个工作单元 | **不译**。最近的类比是 OSGi bundle 的 lifecycle state |
| **waterfall** | 环绕式中间件，`(...args, next)`，调 `next()` 放行、不调即短路 | webpack/Tapable 的 `SyncWaterfallHook`——那个是"上一个返回值喂下一个"的 fold，**语义相反** | 译「环绕式分发」或不译。**绝不译"瀑布"** |
| **effect** | 一次带逆元的注册：做一件事，同时交出撤销它的方法 | effect system / 代数效应；或者"副作用" | 译「可逆注册」。**不译"副作用"**。（配套论文用的词是 revertible，不是 reversible） |
| **capability** | 一个能力／子系统 | capability-based security 的 capability（不可伪造引用即权限） | 译「能力」。dsh 的 `ctx.<key>` 是按名查表的环境权威，和 ocap 正相反 |
| **invariant** | 运行时监视器，检查权威事件流或可变数据 | Hoare 逻辑那种静态验证过的不变式 | 译「运行时不变式」，**说清是监控不是证明** |
| **surface** | 日志里会进入模型请求的那部分事件 | API 表面（dsh 文档里也在这个通用义上用过这个词） | 译「模型可见面」，全书统一 |

**seam 是唯一一个用得完全正确、又值得认领来历的词**：出自 Michael Feathers《修改代码的艺术》(2004)——"a seam is a place where you can alter behavior in your program without editing in that place"。中文「接缝」是既定译法。

## C.2 三词三义：scope / isolate / realm

这三个词在 dsh 里指三件不同的事，**不要用同一个中文词覆盖**。

| 词 | 指什么 | 建议译法 |
|---|---|---|
| Cordis `isolate` | 给某个服务名换一条解析链，原型链实现 | 服务隔离域 |
| dsh agent scope | 按 agent 身份分层的注册命名空间，两层扁平、最具体者胜、限制按交集复合 | agent 作用域 |
| realm（义一） | Cordis 的隔离标签（`docs/architecture.md:112`） | 隔离域 |
| realm（义二） | ECMAScript realm（`docs/subsystems/workflow.md:65`） | JS 领域 |

## C.3 时间单位

| 词 | 定义 | 注意 |
|---|---|---|
| **step** | 一次模型请求，加上这次响应引发的工具执行 | 最小单位 |
| **turn** | 排空一次已接收输入的全过程 | **含零到多个 step；零 step 的 turn 是合法的** |
| **round** | 外层策略的一次迭代，包一个 turn | 计数属于那个策略，**不数会话里的每个 turn** |
| **Ralph round** | Ralph 循环里的一个全新子会话 | 不种父会话或前一个子会话的历史 |
| **goal round** | 同会话目标域的一次推进 | 默认上限 256 |

## C.4 四方能力对照

| 维度 | Claude Code | Codex | OpenClaw | dsh |
|---|---|---|---|---|
| 主循环能不能换 | 不能 | 不能 | 不能 | **能** |
| 加模型 provider | 内置 + 网关兼容 | 配置 | 配置 | **装一个 npm 包** |
| 加工具 | MCP | MCP | 内置 + 渠道 | **一个 `tool-*` 包** |
| 拦截工具执行 | hook（进程 + JSON） | hook（较窄） | 内部扩展点 | **进程内三段瀑布 + 单调守卫** |
| 改模型看到的消息 | 有限 | 有限 | 有限 | **`agent/pre-step`，可改写也可拒绝** |
| 换上下文压缩 | 不能 | 不能 | 可配 | **换一个包** |
| 会话状态归谁 | 产品内部 | 产品内部 | 产品内部 | **append-only 日志是契约本身** |
| 执行环境搬远端 | 无统一接口 | 无统一接口 | 无统一接口 | **换两个 provider，工具零改动** |
| 前端扩展 | 不开放 | 不开放 | 不开放 | **129 行树里 32 行是前端** |
| 配置模型 | settings.json 深合并 | config.toml + profile | 配置文件 | **四层，整体替换** |
| 多用户服务端 | 有 | 有 | 有 | **没有**（单用户本机服务，见第 4 章） |

> Claude Code 闭源，该列只写公开可见的行为。

## C.5 五种事件分发方式

源码里是**五种**（`vendor/cordis/src/events.ts:32`），官方 primer 的表格只列四种——`bail` 只在 client 侧用。

| 方式 | 等不等 | 有返回值 | 用途 | Java 类比 |
|---|---|---|---|---|
| `emit` | 不等 | 无 | 广播 | `ApplicationEventPublisher` |
| `parallel` | 等 | 无 | 并发跑完 | `ExecutorService.invokeAll` |
| `serial` | 等 | 无 | 顺序跑完 | 顺序 for |
| `bail` | 等 | 有 | 第一个给答案的胜出 | 责任链，首个非空返回 |
| `waterfall` | 等 | 有 | 环绕拦截 | **Servlet Filter 的 `chain.doFilter()`** |

实测 `@mode` 分布：emit 65 / waterfall 20 / bail 5 / parallel 4 / serial 2。

## C.6 主要接缝速查

| 接缝 | Definition | 常见 Provider | Consumer | 章 |
|---|---|---|---|---|
| shell | `dsh-shell` | `bash-local` / `bash-sandbox` / `pwsh-*` | `tool-bash` | 13 |
| subprocess | `dsh-subprocess` | `subprocess-local` / `-e2b` | 上面那些的底座 | 13 |
| fs | `dsh-fs` | `fs-local` / `fs-sandbox` / `fs-e2b` | `tool-fs` 等 | 13 |
| llm | `dsh-llm` | `llm-deepseek` / `llm-pi-ai` | 主循环 | 8 |
| tools | `dsh-tools` | — | 各 `tool-*` | 10 |
| compaction | `dsh-compaction` | `compaction-basic` | `command-compact` | 15 |
| spill | `dsh-spill` | `spill-local` | `spill-policy` | 10 |
| web | `dsh-web` | `web-search-*` / `web-fetch-http` | `tool-web` | — |
| subagent | `dsh-subagent` | **7 种**，含 `claude-code` / `codex` | `tool-subagent` 等 | 16 |
| sandbox | `dsh-sandbox` | `sandbox-local` / `-windows-acl` | 各执行 provider | 13 |
| credentials | `dsh-credentials` | `credentials-local` | llm 适配器等 | 13、18 |
| storage | `dsh-storage` | `storage-json` / `-sqlite` | 各域插件 | — |
| session-persistence | — | `-jsonl` / `-sqlite` | — | 7 |
| telemetry | `dsh-session-telemetry` | `-otel` | — | 7、18 |
| code-runtime | `dsh-code-runtime` | `-worker-thread` | tools 的 Code Mode | 10 |
| skill / lsp / terminal / jobs / attachment / sessionTitle | 各自 | 各自 | 各自 | — |

## C.7 常见错误码

| 错误码 | 含义 | 一般原因 |
|---|---|---|
| `SANDBOX_UNAVAILABLE` | 沙箱后端不可用，**拒绝执行** | 机器上没装 bubblewrap / Landlock 用不了 |
| `SHELL_UNAVAILABLE` | 没有注册 shell provider | 接缝三角色缺一个 |
| `UNKNOWN_TOOL` | 工具名不存在 | 拼错；或 Code Mode 下模型直接调了原生工具名 |
| `UNKNOWN_PROVIDER` | 模型路由不存在 | `agent-default-model` 指向了没注册的 provider |
| `OPEN_TURN` | fork 切在了没关闭的 turn 中间 | 见第 7 章的良构前缀 |
| `INACTIVE_EFFECT` | 卸载过程中创建 effect | 见第 6 章的卸载集合封闭性 |
| `CONTEXT_WINDOW_EXCEEDED` | 上下文溢出 | 压缩没跟上，或模型容量声明不对 |
| `STARTUP_INCOMPLETE` | 有插件没能激活 | 依赖服务缺席，见第 12 章排查手册 |

## C.8 常用命令

```sh
npx @deepseek-ai/dsh web                       # 起 Web，127.0.0.1:3080
dsh --profile headless "任务"                   # 跑一次，打印结果，退出
dsh --profile web --dump-config                # 打印将要启动的整棵树
dsh --profile web --dump-default-config        # 不含用户层和 --patch
dsh --profile web --patch ./extra.yml          # 额外覆盖层（可重复）
dsh plugin --profile web add <包名>             # 装插件（转发给 pnpm）
```

`$DSH_HOME` 默认 `~/.dsh`，里面四样东西：`profiles/`、`cordis.patch.yml`、`.env`、`.credentials.yaml`。
