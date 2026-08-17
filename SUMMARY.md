# 目录

* [前言](preface/README.md)

## 第一部分　它为什么长这样

* [第 1 章　主循环也只是配置里的一行](book/01-first-look.md)
* [第 2 章　agent harness 的系统模型](book/02-harness-model.md)
* [第 3 章　DeepSeek 的六个取舍](book/03-tradeoffs.md)
* [第 4 章　什么团队该上 dsh，什么团队不该](book/04-adoption.md)

## 第二部分　核心机制：亲手写一遍才懂

* [第 5 章　服务、注入与激活顺序](book/05-service-inject.md)
* [第 6 章　注册即可撤销](book/06-effect-events.md)
* [第 7 章　会话日志即真相](book/07-session-log.md)
* [第 8 章　请求信封与流式协议](book/08-llm-seam.md)
* [第 9 章　主循环：turn 与 step](book/09-agent-loop.md)
* [第 10 章　三段瀑布、守卫与并发确定性](book/10-tool-pipeline.md)
* [第 11 章　把 KV cache 写进架构契约](book/11-prefix-stability.md)

## 第三部分　组合与落地

* [第 12 章　三层配置合成](book/12-config-compose.md)
* [第 13 章　换一个 provider，搬走整个执行世界](book/13-capability-seam.md)
* [第 14 章　给真 dsh 装一个能上线的插件](book/14-write-a-plugin.md)

## 第四部分　生产级子系统

* [第 15 章　压缩、裁剪与预算](book/15-context.md)
* [第 16 章　把 Claude Code 挂成子 agent](book/16-subagent.md)
* [第 17 章　前端也是插件](book/17-frontend.md)

## 第五部分　工程化与迁移

* [第 18 章　从单机 harness 到内部平台](book/18-platform.md)
* [第 19 章　把约束变成可执行的门禁](book/19-gates.md)
* [第 20 章　让文档和测试跟着代码走](book/20-docs-tests.md)
* [第 21 章　把这套思想搬进你自己的项目](book/21-migrate.md)

## 附录

* [附录 A　mini-dsh 源码导读与数字复现](appendix/a-mini-dsh.md)
* [附录 B　集成面速查](appendix/b-integration.md)
* [附录 C　术语与速查表](appendix/c-glossary.md)
* [附录 D　读这本书需要的 TypeScript](appendix/d-typescript.md)
