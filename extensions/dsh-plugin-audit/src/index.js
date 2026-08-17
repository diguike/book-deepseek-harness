/**
 * dsh-plugin-audit —— 团队规约注入 + 工具调用审计（带脱敏）
 *
 * 两件事：
 *   1. agent/pre-step：每个 turn 的第一步给模型注入团队规约
 *   2. tools/post-execute：把每次工具调用写进审计日志，敏感字段先脱敏
 *
 * 配套书籍《一切皆插件》第 14 章。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const name = 'dsh-plugin-audit'

/** 默认脱敏规则。命中就整段替换，不做部分遮蔽——部分遮蔽容易被拼回来。 */
const DEFAULT_REDACTIONS = [
  { label: 'API key', re: /\b(sk|ghp|glpat|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g },
  { label: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi },
  { label: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: '邮箱', re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
]

function redact(value, rules) {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  const hits = []
  for (const { label, re } of rules) {
    text = text.replace(re, () => { hits.push(label); return `[已脱敏:${label}]` })
  }
  return { text, hits }
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…（截断，原长 ${text.length}）`
}

export function apply(ctx, config = {}) {
  const {
    // 团队规约。空字符串表示不注入。
    conventions = '',
    // 审计日志落盘路径。留空则只发 harness 日志。
    auditFile = '',
    // 单条记录里工具参数/结果的最大字符数
    maxFieldChars = 2000,
    // 关掉脱敏（**不建议**，见 README 的风险说明）
    redactionEnabled = true,
  } = config

  const rules = redactionEnabled ? DEFAULT_REDACTIONS : []
  // 建目录失败不能让插件加载失败——审计是附加能力，不该拖垮宿主
  let sink = auditFile
  if (sink) {
    try {
      mkdirSync(dirname(sink), { recursive: true })
    } catch (err) {
      ctx.logger?.warn?.(`[audit] 无法创建目录 ${dirname(sink)}：${err?.message ?? err}，退回只写 harness 日志`)
      sink = ''
    }
  }

  const write = (record) => {
    const line = JSON.stringify(record)
    if (sink) {
      try { appendFileSync(sink, line + '\n') }
      catch (err) { ctx.logger?.warn?.(`[audit] 写入失败：${err?.message ?? err}`) }
    } else {
      ctx.logger?.info?.(`[audit] ${line}`)
    }
  }

  // ── 1. 规约注入 ────────────────────────────────────────────────
  // pre-step 是 waterfall：先拿下游的决定，再在它基础上追加，不覆盖。
  if (conventions.trim()) {
    const seen = new WeakSet()
    // 签名是 (payload, next) —— 两个参数，不是三个。
    // payload: { agent, messages, turn, step, signal }
    // 返回 PreStepDecision: { kind: 'reject' } | { kind: 'enter', messages }
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      const agent = payload?.agent
      // 只在这个 agent 的第一步注入，之后的 step 靠历史带着走
      if (!decision || decision.kind !== 'enter' || !agent || seen.has(agent)) return decision
      seen.add(agent)
      try {
        // UserMessage 的完整形状：content / role / id / source。
        // 缺 source 会让下游读 source.kind 时炸——这个坑只能靠打印真实 payload 发现。
        return {
          kind: 'enter',
          messages: [
            ...(decision.messages ?? []),
            {
              id: randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: `【团队规约】\n${conventions.trim()}` }],
              source: { kind: 'user' },
            },
          ],
        }
      } catch {
        return decision   // 注入失败绝不能影响主流程
      }
    })
  }

  // ── 2. 工具调用审计 ────────────────────────────────────────────
  // post-execute 也是 waterfall：必须调 next() 拿到最终结果，我们只观察。
  // 签名是 (exec, result, next) —— 三个参数。返回 PostToolDecision。
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const settled = await next()
    try {
      const args = redact(exec?.arguments, rules)
      const out = redact(settled?.content ?? result?.content, rules)
      write({
        at: new Date().toISOString(),
        sessionId: exec?.agent?.id ?? null,
        callId: exec?.callId ?? null,
        tool: exec?.name ?? null,
        isError: Boolean(settled?.isError ?? result?.isError),
        args: truncate(args.text, maxFieldChars),
        result: truncate(out.text, maxFieldChars),
        redacted: [...new Set([...args.hits, ...out.hits])],
      })
    } catch (err) {
      // 审计失败不能拖垮工具执行
      ctx.logger?.warn?.(`[audit] 记录失败：${err?.message ?? err}`)
    }
    return settled
  })

  ctx.logger?.info?.(
    `[audit] 已启用｜规约注入 ${conventions.trim() ? '开' : '关'}｜脱敏 ${redactionEnabled ? '开' : '关'}｜落盘 ${auditFile || '（仅日志）'}`,
  )
}
