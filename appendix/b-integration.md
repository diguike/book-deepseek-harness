---
title: 附录 B　集成面速查
feishu_url: "https://fivwvysqdz.feishu.cn/wiki/VlWywUquBivblZkuvQ9cQnyTnwf"
last_synced: "2026-08-17"
verified_against: "@deepseek-ai/dsh@0.1.0-rc.6 / 源码 47f94385 / 2026-08-16"
---

dsh 有五种"从外面接进来"的方式。这份表帮你选。

## B.1 五种方式对照

| 方式 | 谁驱动谁 | 语言 | 能力上限 | 典型用途 |
|---|---|---|---|---|
| **原生插件** | 进程内 | TS/JS | 全部扩展点 | 长期定制，见第 14 章 |
| **JSON-RPC SDK** | 你的服务驱动 dsh | 任意（有 TS/Python 客户端） | 驱动 agent、收事件 | **平台化的正路**，见第 18 章 |
| **ACP server** | 编辑器驱动 dsh | 任意（ACP 协议） | 自动化 | 编辑器集成 |
| **hooks 桥** | dsh 调你的脚本 | 任意（子进程） | 映射过的拦截点子集 | 迁移期兼容已有 CC/Codex 配置 |
| **MCP client** | dsh 调你的服务 | 任意（MCP 协议） | 加工具 | 复用已有 MCP 生态 |

## B.2 决策表

**要改模型看到什么、要拦截执行、要类型安全** → 原生插件。

**要把 dsh 嵌进你自己的服务，做多用户、多租户** → JSON-RPC SDK。这是唯一正路，因为 Web 界面是单用户的（第 4、18 章）。

**要接编辑器** → ACP。

**已经有一堆 Claude Code / Codex 的 hook 配置，想先跑起来** → hooks 桥。但记住官方对它的定位：`hooks-claude-code` 的 README 原话是「一个原生 cordis 插件能做到这个桥做的一切，而且更强、有类型返回、没有序列化边界；**这个桥的存在意义只是兼容路径**」。

**能力本身是个独立服务，或者不是 TS 写的** → MCP。

一句话：**hook 和 MCP 是接进来，原生插件是长进去，SDK 是把 dsh 装进去。**

## B.3 JSON-RPC SDK

`packages/sdk/server` 是一个插件，提供按行分隔的 JSON-RPC over stdio。

- `inject: ['agents']`，**按 sessionId 拿或创建一个 agent**
- 其余能力全部来自周围的 `cordis.yml`
- 子 agent 完成事件只在服务快照的生命周期 `local` 标记为真时转发——**provider 名字、子会话 id、持久化血缘都不能建立"本地性"**
- 已注册的适配器优先；未被占用的 `deepseek-official` 路由会自动挂 `dsh-llm-deepseek`；**其他未被占用的 provider 直接初始化失败**

配套：`packages/sdk/client`（TypeScript）、`python/sdk`（Python，带打包好的运行时二进制）。

协议本身在 `packages/sdk/protocol`：一个 `JsonRpcLineTransport` 传输类加上两端共用的请求、结果、通知类型。**纯库，没有插件、没有 Config、没有注册。**

一个细节：带 `id` 和 `method` 的帧是请求，只有 `id` 的是响应，只有 `method` 的是通知，**格式错误的行直接忽略**。

## B.4 遥测导出

`session-telemetry` + `session-telemetry-otel`，OTLP/HTTP。

```yaml
- id: session-telemetry-otel
  config:
    mode: FULL                    # 默认 DISABLED
    shutdownTimeoutMillis: 3000
```

三档：

| 模式 | 行为 |
|---|---|
| `FULL` | 每条投影记录立刻交给 OTel SDK |
| `FEEDBACK_ONLY` | 只有用户提交 `feedback/record` 时，才回放导出那之前的日志后缀 |
| `DISABLED` | **默认**，连管道都不构造 |

**两个必须自己补的洞**（第 7、18 章展开）：

1. **不自带任何脱敏规则**。`FULL` 模式下离开机器的是完整 `event.data`
2. **`shutdownTimeoutMillis` 到点会丢未导出的记录**，审计场景不能接受

## B.5 平台化的最小拓扑

```
你的服务（认证 · 租户 · 配额 · 审计外送）
   │  JSON-RPC over stdio
   ├── dsh 进程（租户 A）── 会话日志 ── 执行环境
   └── dsh 进程（租户 B）── 会话日志 ── 执行环境
```

进程模型的选择、凭证怎么换、审计怎么落、12 项上线检查表，全在第 18 章。

---

> 本附录来自《一切皆插件》开源版 · 作者「递归客」  
> 在线阅读完整书系：[inferloop.dev](https://inferloop.dev)  
> 源码仓库：[github.com/diguike/book-deepseek-harness](https://github.com/diguike/book-deepseek-harness)
