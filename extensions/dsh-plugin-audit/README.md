# dsh-plugin-audit-trail

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：**把每次工具调用记进审计日志，敏感内容先脱敏**；顺带支持给每个会话注入一段团队规约。

配套书籍《一切皆插件：DeepSeek Harness 源码精读、Mini 实现与插件开发实战》第 14 章，那一章从需求走到发布完整讲了它怎么写出来的。

## 装

```sh
dsh plugin --profile web add dsh-plugin-audit-trail
```

然后在 `$DSH_HOME/cordis.patch.yml` 里插一行：

```yaml
- insert:
    - id: audit
      name: 'dsh-plugin-audit-trail'
      config:
        auditFile: /var/log/dsh/audit.jsonl
        conventions: |
          1. 改动任何文件前先读它
          2. 提交前必须跑测试
        redactionEnabled: true
        maxFieldChars: 2000
```

确认它进树了：

```sh
dsh --profile web --dump-config | grep -A6 'id: audit'
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `auditFile` | `''` | 审计日志落盘路径（JSONL，逐行追加）。留空则只写 harness 日志 |
| `conventions` | `''` | 团队规约。非空时，每个 agent 的第一步会把它作为一条 user 消息注入 |
| `redactionEnabled` | `true` | 是否脱敏。**关掉之前请读下面的风险说明** |
| `maxFieldChars` | `2000` | 单条记录里工具参数/结果的最大字符数，超出截断 |

## 审计记录长什么样

```json
{
  "at": "2026-08-17T03:41:22.108Z",
  "sessionId": "session-a1b2c3",
  "callId": "call_7f3e",
  "tool": "read",
  "isError": false,
  "args": "{\"file_path\":\"secrets.txt\"}",
  "result": "<path>...</path>API_KEY=[已脱敏:API key]\ncontact: [已脱敏:邮箱]",
  "redacted": ["API key", "邮箱"]
}
```

`redacted` 列出这条记录命中了哪些脱敏类型，方便统计敏感数据的出现频率。

## 脱敏规则

内置四类，命中就**整段替换**：

| 类型 | 匹配 |
|---|---|
| API key | `sk-` / `ghp-` / `glpat-` / `xox[baprs]-` 开头的长串 |
| Bearer token | `Bearer <16 位以上>` |
| 私钥 | `-----BEGIN ... PRIVATE KEY-----` 到 `-----END-----` |
| 邮箱 | 常规邮箱格式 |

**为什么整段替换而不是部分遮蔽**：`sk-abc***xyz` 这种保留前后几位的写法，多条日志拼起来有可能把原值还原出来，而且"保留几位"这个决定本身就是在赌。整段换掉更安全，代价是不好辨认——所以单独记一个 `redacted` 字段说明命中了什么。

## 三件要知道的事

**一、这个插件只脱敏审计副本，不改模型看到的内容。** 模型仍然读到原文。脱敏保护的是"离开这台机器的数据"，不是"模型的上下文"。想连模型也不给看，那是另一个需求——得在 `tools/post-execute` 里改写 `content`，而不是只改审计副本。

**二、审计失败不会影响工具执行。** 整个记录逻辑包在 `try/catch` 里，写盘失败只发一条警告。一个记日志的插件把 agent 搞崩是不能接受的。

**三、它是观察型监听器。** 挂在 `tools/post-execute` 上并且**总是调用 `next()`**，原样返回下游结果，不改写任何东西。

## 为什么需要它

dsh 自带的遥测接缝（`session-telemetry-otel`）能把会话导出到 OTLP，但**它不自带任何脱敏规则**——`FULL` 模式下离开机器的是完整的 `event.data`：消息全文、工具参数和结果（意味着命令输出、文件内容）、完整的系统提示和工具 schema、会话工作目录。

而且它的 `shutdownTimeoutMillis` 到点会丢掉还没导出的记录，审计场景不能接受。

这个插件补的就是这两个洞：**本地落盘 + 脱敏**。你的采集 agent 从文件收走，不依赖进程优雅退出。

## 兼容性

在 `@deepseek-ai/dsh@0.1.0-rc.6` 上实测通过。

dsh 处在 `0.1.0-rc` 阶段，官方明说会有破坏性变更。这个插件用了两个事件：

- `agent/pre-step`，签名 `(payload, next)`，返回 `PreStepDecision`
- `tools/post-execute`，签名 `(exec, result, next)`

**监听器对 payload 的形状是宽容的**（全程可选链加兜底），上游多一个字段少一个字段不会崩，只是记录里少一项。但如果事件签名本身变了，需要跟着改。

调试时可以开 `AUDIT_DEBUG=1` 打印真实 payload——排查签名问题最快的办法。

## 许可

MIT
