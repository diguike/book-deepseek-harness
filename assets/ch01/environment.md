# 第 1 章实测环境

| 项 | 值 |
|---|---|
| 采集日期 | 2026-08-15 |
| dsh 版本 | `@deepseek-ai/dsh@0.1.0-rc.6`（npm latest） |
| 源码基准 | GitHub `master` @ `47f94385`，其 package.json 声明 `0.1.0-rc.5` |
| OS | Ubuntu 20.04.6 LTS |
| Node | v24.14.0 |
| 编译器 | 默认 g++ 9.4.0（**装不上**），需 `CC=gcc-10 CXX=g++-10` |
| 模型后端 | **DeepSeek 官方端点**（`deepseek-v4-flash`），2026-08-17 补测 |

## 实测数字

| 指标 | 值 | 采集命令 |
|---|---|---|
| npm 安装耗时 | 4 分钟，532 个包 | `npm i @deepseek-ai/dsh@0.1.0-rc.6` |
| `--dump-config` 耗时 | 0.26 s | `/usr/bin/time -f '%e' dsh --profile web --dump-config` |
| `--dump-config` 峰值内存 | 71 MB | 同上（`%M`） |
| dump 输出行数 | 490 行 | `wc -l dump-web.yml` |
| dump 插件行数 | 129 | `grep -c '^- id:' dump-web.yml` |
| dump 层来源注释 | 24 处 | `grep -c '^# ==' dump-web.yml` |
| web 冷启动到可访问 | 1.34 s | 循环 curl 探测 127.0.0.1:3080 |
| web 进程常驻内存 | 196 MB RSS | `ps -eo rss` |
| 首页字节数 | 12,109 B | `curl -w '%{size_download}'` |
| 前端 client 插件数 | 38 | 数首页 `/plugins/*/client.js` |
| headless 暴露工具数 | 25 | 数录制请求里的 `tools[]` |
| system prompt | 4,132 B | 录制请求 `systemBytes` |
| 工具 schema | 27,438 B | 录制请求 `toolSchemaBytes` |
| 一次任务事件数 | 38 | 解压 session.jsonl 后 `wc -l` |
| 会话日志压缩比 | 71,602 B → 23,211 B（10 个 zstd 帧） | — |
| 端到端耗时 | 4.46 秒 | `/usr/bin/time` |
| step 1 用量 | in=11,258 out=43 cacheRead=0 | 会话日志 `assistant/message.usage` |
| step 2 用量 | in=58 out=43 **cacheRead=11,264** | 同上 |

## 诚实声明

- 第 1、11、15 章的数据来自 **DeepSeek 官方端点**（2026-08-17），缓存字段是 provider 真实返回的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。
- 早期用 mock 端点（`claude -p`）跑的观察都标了 via mock，**那些的缓存数字一律不采信**——它反映的是 Claude Code 自己的缓存，跟 dsh 的前缀无关。
- `subagent-claude-code` / `tool-cordis` 相关章节没有实跑，原因是那几个包在 npm 上的版本掉队、装不上（第 16 章 16.2 有完整实测记录）。
