# 一切皆插件

**DeepSeek Harness 源码精读、Mini 实现与插件开发实战**

这本书讲 DeepSeek 官方开源的 agent harness `dsh` 本身是怎么设计的——不是怎么用它写代码，是它凭什么能让主循环、模型适配器、会话日志都变成配置里的一行。

`dsh --profile web --dump-config` 会打印出你这台机器上将要启动的整棵插件树。490 行 YAML、129 个插件行。模型适配器是一行，会话日志是一行，主循环 `agent-loop` 也是一行。**任意一行都能被你自己的一行 YAML 顶掉。**

## 为什么读这本书

如果你用过 Claude Code 或 Codex，想给它加点东西，最后发现只能挂一个 hook——那你已经碰到这本书要解决的问题了。你能扩展的，是人家预留给你的那几个洞。

dsh 给了另一个答案：没有内核，所以没有洞，因为没有墙。

这本书做四件官方文档不做的事：

1. **把设计取舍和代价讲透**。「没有内核」放弃了什么，「日志是唯一真相源」谁在付账
2. **横向对比与选型判断**。dsh 和 Claude Code / Codex / OpenClaw 的分野，以及为什么 LangGraph 压根不在同一个抽象层
3. **源码走读 + 亲手重建**。用 TypeScript 写一个能跑的迷你实现，约 3500 行
4. **把工程方法提炼成能搬走的清单**。dsh 是人和 agent 共同维护 50 万行代码的公开样本

## 写给谁

- **在公司搭 agent 平台的人**（第一优先）——第 4、13、14、18 章能直接变成设计文档和 PR
- **已在用 CC / Codex、想扩展却碰壁的中高级工程师**——技术栈 TypeScript / Node
- **从传统后端转 AI 的工程师**——第 2 章做概念对齐，附录 D 补 TypeScript 缺口

不适合：想找「用 AI 写代码技巧」的人；想要中文 API 手册的人（官方文档更准）。

## 怎么读

| 目的 | 路线 | 时间 |
|---|---|---|
| 只做选型 | 1 → 3 → 4 | 半天 |
| 系统学架构 | 全书顺读，5–11 章跟着写 mini-dsh | — |
| 只要工程方法 | 1 → 19 → 20 → 21 | — |
| 搭内部平台 | 1、3、4 打底，跳 13、14、18 | — |

**模型 API key 不是必需的。** 配套仓库里的 `examples/mock-llm-server` 把本机 `claude` CLI 包成 OpenAI 兼容端点，全书的运行结果都是这么跑出来的。

## 目录

* [前言](preface/README.md)

**第一部分　它为什么长这样**

- [第 1 章　主循环也只是配置里的一行](book/01-first-look.md)
- [第 2 章　agent harness 的系统模型](book/02-harness-model.md)
- [第 3 章　DeepSeek 的六个取舍](book/03-tradeoffs.md)
- [第 4 章　什么团队该上 dsh，什么团队不该](book/04-adoption.md)

**第二部分　核心机制：亲手写一遍才懂**

- [第 5 章　服务、注入与激活顺序](book/05-service-inject.md)
- [第 6 章　注册即可撤销](book/06-effect-events.md)
- [第 7 章　会话日志即真相](book/07-session-log.md)
- [第 8 章　请求信封与流式协议](book/08-llm-seam.md)
- [第 9 章　主循环：turn 与 step](book/09-agent-loop.md)
- [第 10 章　三段瀑布、守卫与并发确定性](book/10-tool-pipeline.md)
- [第 11 章　把 KV cache 写进架构契约](book/11-prefix-stability.md)

**第三部分　组合与落地**

- [第 12 章　三层配置合成](book/12-config-compose.md)
- [第 13 章　换一个 provider，搬走整个执行世界](book/13-capability-seam.md)
- [第 14 章　给真 dsh 装一个能上线的插件](book/14-write-a-plugin.md)

**第四部分　生产级子系统**

- [第 15 章　压缩、裁剪与预算](book/15-context.md)
- [第 16 章　把 Claude Code 挂成子 agent](book/16-subagent.md)
- [第 17 章　前端也是插件](book/17-frontend.md)

**第五部分　工程化与迁移**

- [第 18 章　从单机 harness 到内部平台](book/18-platform.md)
- [第 19 章　把约束变成可执行的门禁](book/19-gates.md)
- [第 20 章　让文档和测试跟着代码走](book/20-docs-tests.md)
- [第 21 章　把这套思想搬进你自己的项目](book/21-migrate.md)

**附录**

- [附录 A　mini-dsh 源码导读与数字复现](appendix/a-mini-dsh.md)
- [附录 B　集成面速查](appendix/b-integration.md)
- [附录 C　术语与速查表](appendix/c-glossary.md)
- [附录 D　读这本书需要的 TypeScript](appendix/d-typescript.md)

## 配套代码

```
mini-dsh/     手写的迷你实现，2,655 行 TS，65 个测试。零依赖，Node 22.6+ 直接跑
examples/     mock-llm-server：没有 API key 时把本机 claude CLI 包成 OpenAI 兼容端点
extensions/   第 14 章那个真能装到 dsh 上的审计插件
assets/       各章原始实测产物：dump 全文、会话日志、请求录制、实验数据、采集命令
```

### 跟着写 mini-dsh

八章各有两个 tag：

```sh
git checkout ch07-start          # 起点：函数体挖空，签名、JSDoc、测试都在
cat mini-dsh/CHECKPOINT.md       # 这一章要填哪几个函数
cd mini-dsh && node --test packages/session/tests/session.spec.ts   # 绿了就是对了
git checkout ch07-done           # 卡住了看参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。可用 tag：`ch05` `ch06` `ch07` `ch08` `ch09` `ch10` `ch12` `ch13`。

## 关于版本

本书写的是一个 **0.1.0-rc** 阶段的项目，官方 README 明写会有破坏性变更。

- **源码基准**：[`47f94385`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)（2026-08-13，声明 `0.1.0-rc.5`），所有行号引用以它为准
- **运行结果**：npm 上的 `0.1.0-rc.6`。rc.5 从未发布，你装到的比能读到的源码新约一小时
- 每章 frontmatter 带 `verified_against`，标明核对版本与日期
- 易腐内容集中在第四部分；勘误见 `ERRATA.md`

**取证纪律**：书中每个数字都附有产生它的命令（汇总在附录 A）；每条「dsh 会 / 必须 / 强制 X」的断言都落到代码或门禁脚本，落不到的写成「文档如此描述」。**凡是让 dsh 显得更强的论断，取证标准比让它显得更弱的高一档。**

## 参考

- 源码：https://github.com/deepseek-ai/deepseek-harness
- 官方文档：仓库 `docs/`，含 7 课时 Cordis 教程与 9 篇中文开发者教程
- 反馈与勘误：本仓库 Issues

## 许可

正文 CC BY-NC-SA 4.0，代码 MIT。
