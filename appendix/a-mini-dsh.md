---
title: 附录 A　mini-dsh 源码导读与数字复现
feishu_url: "https://fivwvysqdz.feishu.cn/wiki/G5rCwnLZEiGHSAkYhpgcrv5XnPc"
last_synced: "2026-08-17"
verified_against: "@deepseek-ai/dsh@0.1.0-rc.6 / 源码 47f94385 / 2026-08-16"
---

## A.1 怎么跑

Node 22.6+ 即可，**零依赖**——靠原生类型剥离直接跑 `.ts`，不用装任何东西。

```sh
cd mini-dsh
node --test packages/*/tests/*.spec.ts        # 全部 65 个测试
node --test packages/cordis/tests/*.spec.ts   # 单章自检
```

每章两个 tag：

```sh
git checkout ch07-start   # 骨架，函数体挖空，标了 TODO
# ...动手填...
node --test packages/session/tests/*.spec.ts  # 绿了就是对了
git checkout ch07-done    # 参考答案
```

**任何一章都能直接 checkout 开工**，不需要前面的自己写对。

## A.2 包对照表

| mini-dsh | 行数 | 真 dsh | 行数 | 章 |
|---|---:|---|---:|---|
| `packages/cordis` | 606 | `vendor/cordis` | 2,693 | 5、6 |
| `packages/session` | 314 | `packages/core/session` | 3,156 | 7 |
| `packages/llm` | 155 | `packages/llm/llm` | 2,625 | 8 |
| `packages/agent-loop` | 213 | `packages/core/agent-loop` | 1,643 | 9 |
| `packages/tools` | 174 | `packages/core/tools` | 5,620 | 10 |
| `packages/loader` | 133 | `vendor/include` + `boot/app-boot` | — | 12 |
| `packages/shell` | 175 | `packages/shell/*` | — | 13 |
| **合计（含测试）** | **2,655** | `packages/` TS | **496,340** | — |

差出来的部分主要在四类：重入与并发的严谨处理、隔离域与作用域路由、调用链追踪与错误归属、配置校验与热更新协调。**核心机制本身就在 mini 的那几百行里。**

## A.3 两个约束，读者会撞到

**一、Node 的类型剥离模式不支持两样东西**：构造器参数属性（`constructor(readonly x: T)`）和 `enum`。所以 mini-dsh 用显式字段赋值和 `const` 对象加联合类型。这不是风格选择，是为了零依赖。

**二、包间引用用相对路径**，不是 `@mini-dsh/xxx`。同样是为了不装 `node_modules`。

## A.4 全书数字的采集命令

每个数字都能复现。环境：Ubuntu 20.04.6 / Node v24.14.0 / `@deepseek-ai/dsh@0.1.0-rc.6`，采集于 2026-08-15 至 16。

### 源码规模

```sh
cd _references/deepseek-harness
find packages -name package.json -not -path '*/node_modules/*' | wc -l    # 226 个包
find packages -name '*.ts' -o -name '*.tsx' | grep -v node_modules | xargs cat | wc -l   # 496,340 行
find packages -path '*/src/*' -name '*.ts' -not -path '*/node_modules/*' | wc -l         # 1,185 文件
wc -l vendor/cordis/src/*.ts | tail -1                                    # 2,693 行
wc -l packages/core/agent-loop/src/*.ts | tail -1                         # 1,643 行
```

### 文档与 Agent Notes（注意排除中译）

```sh
find docs -name '*.md' -not -name '*.zh.md' | wc -l          # 110 英文
find docs -name '*.zh.md' | wc -l                            # 105 中文
find docs -type f | wc -l                                    # 324（含 .i18n.yaml，别拿这个当篇数）

find .agents/notes -name '*.md' -not -name '*.zh.md' | wc -l # 688 篇
for d in implemented proposed rejected archived; do
  echo "$d: $(find .agents/notes/$d -name '*.md' -not -name '*.zh.md' | wc -l)"
done                                                          # 507 / 25 / 11 / 143
```

### 工程约束

```sh
grep -c "^- " AGENTS.md                                       # 33 条
ls scripts/verify-*.ts | wc -l                                # 34 个文件
ls scripts/verify-*.spec.ts | wc -l                           # 8 个是验证器自己的测试 → 真门禁 26
sed -n '/## Local modifications/,/^## /p' vendor/README.md | grep -cE '^[0-9]+\.'   # 18 条本地修改
```

### Model Experience 分布

```sh
python3 -c "
import glob, re
n = short = long = 0
for f in glob.glob('packages/**/README.md', recursive=True):
    t = open(f, encoding='utf-8', errors='ignore').read()
    m = re.search(r'#### KV Cache effect\n+(.+?)(?=\n#|\n##|\Z)', t, re.S)
    if m:
        n += 1
        c = len(m.group(1).strip())
        if c < 80: short += 1
        elif c > 150: long += 1
print(f'有该小节 {n}｜样板(<80字符) {short}｜实质(>150字符) {long}')
"
# 215 ｜ 110 ｜ 58
```

### 事件分发方式

```sh
grep -n "DispatchMode" vendor/cordis/src/events.ts             # 五种，含 bail
grep -rhoE "@mode +[a-z]+" --include="*.ts" packages vendor | awk '{print $2}' | sort | uniq -c | sort -rn
# emit 65 / waterfall 20 / bail 5 / parallel 4 / serial 2
```

### 运行时实测（第 1 章）

```sh
export DSH_HOME=$PWD/.dsh
CC=gcc-10 CXX=g++-10 npm i @deepseek-ai/dsh@0.1.0-rc.6        # 4 分钟，532 个包

/usr/bin/time -f "%e s / %M KB" dsh --profile web --dump-config > dump.yml
# 0.26 s / 71,088 KB
wc -l dump.yml                                                 # 490 行
grep -c '^- id:' dump.yml                                      # 129 个插件行
grep -c '^# ==' dump.yml                                       # 24 处层来源注释

dsh web --port 3080 &
# 循环 curl 探测到可访问：1.34 秒
ps -eo rss -p $(pgrep -f 'dsh web')                            # 196 MB
curl -s http://127.0.0.1:3080/ | grep -o '/plugins/[^"]*client\.js' | wc -l   # 38 个前端插件
```

### 会话日志（第 1 章）

```sh
# 多帧 zstd，逐帧解才完整
node -e "
const fs=require('fs'), zlib=require('zlib');
const buf=fs.readFileSync(process.argv[1]);
const out=[]; let off=0, frames=0;
while (off < buf.length) {
  try { out.push(zlib.zstdDecompressSync(buf.subarray(off))); frames++ } catch { break }
  let next=-1;
  for (let i=off+4; i<buf.length-3; i++) if (buf.readUInt32LE(i)===0xFD2FB528) { next=i; break }
  if (next<0) break; off=next;
}
console.log('帧数', frames, '解压后', Buffer.concat(out).length);
" -- "$DSH_HOME/sessions/*/session-*/session.jsonl.zstd"
# 9 帧，70,810 字节（压缩后 22,584）→ 35 个事件
```

### 前缀实验（第 11 章）

```sh
# 需要先用 examples/mock-llm-server 的 RECORD_DIR 录一批请求
python3 assets/ch11/prefix-experiment.py      # 结果存 assets/ch11/prefix-experiment.json
```

结果：不改 100% ／ 改 system 一个词 0.0% ／ 末尾加工具 76.7% ／ 换两个工具顺序 9.9% ／ 追加消息 100% ／ 换模型 0%。

### 执行延迟（第 13 章）

```sh
cd mini-dsh/packages/shell && node tests/latency.mjs    # 结果存 assets/ch13/latency.json
# 本地 p50=7ms p95=16ms ／ 容器 p50=357ms p95=473ms → 51 倍
```

## A.5 原始产物

`assets/` 下按章存放：

| 路径 | 内容 |
|---|---|
| `assets/ch01/dump-config-web.yml` | 490 行 dump 全文 |
| `assets/ch01/session-trace.jsonl` | 35 个事件的完整会话日志 |
| `assets/ch01/home-patch-example.yml` | 用到的 home patch |
| `assets/ch01/recordings/` | mock server 录到的请求信封 |
| `assets/ch01/environment.md` | 环境与每个数字的采集命令 |
| `assets/ch11/prefix-experiment.json` | 六变量前缀实验结果 |
| `assets/ch13/latency.json` | 本地 vs 容器延迟，12 次采样 |

**你机器上的数字会不一样**，尤其是启动时间和内存。重要的是量级和比例。

---

> 本附录来自《一切皆插件》开源版 · 作者「递归客」  
> 在线阅读完整书系：[inferloop.dev](https://inferloop.dev)  
> 源码仓库：[github.com/diguike/book-deepseek-harness](https://github.com/diguike/book-deepseek-harness)
