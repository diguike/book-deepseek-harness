# 第 1 章实测环境

| 项 | 值 |
|---|---|
| 采集日期 | 2026-08-15 初采；**2026-08-17 用干净的两文件目录重采**（本表 headless 任务相关数字均为重采值） |
| dsh 版本 | `@deepseek-ai/dsh@0.1.0-rc.6`（npm latest） |
| 源码基准 | GitHub `master` @ `47f94385`，其 package.json 声明 `0.1.0-rc.5` |
| OS | Ubuntu 20.04.6 LTS |
| Node | v24.14.0 |
| 编译器 | 默认 g++ 9.4.0（**装不上**），需 `CC=gcc-10 CXX=g++-10` |
| 模型后端 | **DeepSeek 官方端点**（`deepseek-v4-flash`） |
| 任务目录 | `demo-project/`，只有 `math.js` 和 `package.json` 两个文件 |

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
| system prompt | 4,138 B | 会话日志 `request/header.system` 的 UTF-8 字节数 |
| 工具 schema | 26,288 B | 会话日志 `request/header.tools` 序列化后的字节数（旧版记的 27,438 B 是 mock 端点上 OpenAI 线格式的大小，口径不同） |
| 一次任务日志行数 | 43 行（1 行会话头 + 42 行事件） | 逐帧解 zstd 后 `wc -l` |
| 事件序号上限 | seq 121 | 流式 chunk 折叠成 `*-chunks` 行写盘，故行数 < 序号数 |
| 会话日志压缩比 | 72,975 B → 24,226 B（14 个 zstd 帧） | — |
| 端到端耗时 | 4.89 秒 | `/usr/bin/time` |
| step 1 用量 | in=11,250 out=82 cacheRead=0 | 会话日志 `assistant/message.usage`（seq 70） |
| step 2 用量 | in=85 out=39 **cacheRead=11,264** | 同上（seq 119） |

## 诚实声明

- 第 1、11、15 章的数据来自 **DeepSeek 官方端点**（2026-08-17），缓存字段是 provider 真实返回的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。
- 早期用 mock 端点（`claude -p`）跑的观察都标了 via mock，**那些的缓存数字一律不采信**——它反映的是 Claude Code 自己的缓存，跟 dsh 的前缀无关。
- `subagent-claude-code` / `tool-cordis` 相关章节没有实跑，原因是那几个包在 npm 上的版本掉队、装不上（第 16 章 16.2 有完整实测记录）。
