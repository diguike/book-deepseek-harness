# mini-dsh

《一切皆插件：DeepSeek Harness 源码精读、Mini 实现与插件开发实战》的配套实现。

**它是理解工具，不是产品。** 结构刻意与真 dsh 同构，方便一一对照。

## 跑起来

**零依赖**。Node 22.6+ 靠原生类型剥离直接跑 `.ts`，不用 `npm install`。

```sh
node --test packages/*/tests/*.spec.ts        # 全部 65 个测试
node --test packages/cordis/tests/*.spec.ts   # 单章
```

## 每章两个 tag

```sh
git checkout ch07-start     # 起点：函数体挖空，签名、JSDoc、测试都在
cat CHECKPOINT.md           # 这一章要填哪几个函数，各自的提示
# ...动手填...
node --test packages/session/tests/session.spec.ts   # 绿了就是对了
git checkout ch07-done      # 卡住了看参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。

| tag | 章 | 挖空的函数 |
|---|---|---|
| `ch05-*` | 服务、注入与激活顺序 | `computeState` `refresh` `setEpoch` `provide` |
| `ch06-*` | 注册即可撤销 | `waterfall` `bail` `unload` `effect` |
| `ch07-*` | 会话日志即真相 | `validateEvent` `deriveMessages` `surfaceOf` `fork` |
| `ch08-*` | 请求信封与流式协议 | `stream` `prime` `collect` |
| `ch09-*` | 主循环：turn 与 step | `runTurn` `runStep` `assertRequestDerivesFromLog` |
| `ch10-*` | 三段瀑布与并发确定性 | `execute` `executionMode` `executeBatch` |
| `ch12-*` | 三层配置合成 | `composeEntries` `renderDump` `assertEntriesActivated` |
| `ch13-*` | 换 provider 搬走执行世界 | `run` |

重新生成 tag：`node scripts/make-checkpoints.mjs`（挖空规则写在脚本顶部的 `CHAPTERS` 里）。

## 包对照

| mini-dsh | 行数 | 真 dsh | 行数 | 章 |
|---|---:|---|---:|---|
| `packages/cordis` | 606 | `vendor/cordis` | 2,693 | 5、6 |
| `packages/session` | 314 | `packages/core/session` | 3,156 | 7 |
| `packages/llm` | 155 | `packages/llm/llm` | 2,625 | 8 |
| `packages/agent-loop` | 213 | `packages/core/agent-loop` | 1,643 | 9 |
| `packages/tools` | 174 | `packages/core/tools` | 5,620 | 10 |
| `packages/loader` | 133 | `vendor/include` + `boot/app-boot` | — | 12 |
| `packages/shell` | 175 | `packages/shell/*` | — | 13 |

差出来的部分主要在四类：重入与并发的严谨处理、隔离域与作用域路由、调用链追踪与错误归属、配置校验与热更新协调。**核心机制本身就在这几百行里。**

## 两个约束

Node 的类型剥离模式不支持**构造器参数属性**和 **`enum`**，所以这里用显式字段赋值和 `const` 对象加联合类型。这不是风格选择，是为了零依赖。

包间引用用**相对路径**，同样是为了不装 `node_modules`。

## 第 13 章需要 Docker

`packages/shell` 的容器 provider 测试需要本机有 Docker 和一个可用镜像（默认 `node:22-alpine`）。没有的话那几个测试会自动跳过，其余照常。
