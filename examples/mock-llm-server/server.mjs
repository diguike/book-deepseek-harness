#!/usr/bin/env node
// mock-llm-server —— 把本机 `claude -p` 包成 OpenAI 兼容端点，让 dsh 免 API key 跑起来
//
// 相比 book-agent-evals 的同名工具，这里多两样 dsh 必需的东西：
//   1. SSE 流式响应 —— dsh 的 LlmAdapter 抽象方法是 `stream(): AsyncIterable<StreamChunk>`，
//      不支持流式就接不上（packages/llm/llm/src/index.ts:232）
//   2. 请求信封录制 —— 把 dsh 发出的每一次 wire payload 原样落盘，
//      这是第 11 章「前缀稳定性」实验的采集点：HTTP 边界看到的才是模型真正收到的字节
//
// 这不是生产级 proxy。每次调用 spawn 一个 claude 进程，3-15 秒延迟。

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 3030)
const VERBOSE = process.env.VERBOSE === '1'
// 录制目录：设了才录。第 11 章实验用 RECORD_DIR=./recordings/baseline 这样区分变量
const RECORD_DIR = process.env.RECORD_DIR ? resolve(process.env.RECORD_DIR) : null
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 180_000)

if (RECORD_DIR) mkdirSync(RECORD_DIR, { recursive: true })

// ---------------------------------------------------------------- claude 桥

// 用干净的临时目录跑 claude，避免它读到本仓库的 CLAUDE.md 和项目上下文
let isolatedCwd = null
function getIsolatedCwd() {
  if (!isolatedCwd) isolatedCwd = mkdtempSync(join(tmpdir(), 'dsh-mock-llm-'))
  return isolatedCwd
}

const MODEL_MAP = [
  [/mini|haiku|flash|lite/i, 'haiku'],
  [/opus|o1|o3/i, 'opus'],
]
function mapModel(name = '') {
  for (const [re, target] of MODEL_MAP) if (re.test(name)) return target
  return 'sonnet'
}

function callClaude({ model, systemPrompt, userMessage }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', systemPrompt,
    '--dangerously-skip-permissions',
    // 去掉 cwd/git/env 这些动态 system 段，让每次调用的 system 尽量稳定
    '--exclude-dynamic-system-prompt-sections',
    // 禁掉 CC 自己的工具，避免它"以为自己能直接干活"
    '--disallowedTools',
    'Bash,Edit,Read,Write,Glob,Grep,Agent,WebFetch,WebSearch,NotebookEdit,SlashCommand,TodoWrite',
    '--disable-slash-commands',
  ]
  return new Promise((resolveP, rejectP) => {
    const t0 = Date.now()
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: getIsolatedCwd(),
      env: { ...process.env, CLAUDE_CODE_DISABLE_PROJECT_MEMORY: '1', CLAUDE_PROJECT_DIR: getIsolatedCwd() },
    })
    let stdout = '', stderr = '', killed = false
    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL') }, CLAUDE_TIMEOUT_MS)
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', (err) => { clearTimeout(timer); rejectP(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (killed) return rejectP(new Error(`claude 超时（${CLAUDE_TIMEOUT_MS}ms）`))
      if (code !== 0) return rejectP(new Error(`claude 退出码 ${code}: ${stderr.slice(0, 400)}`))
      let parsed
      try { parsed = JSON.parse(stdout) } catch { return rejectP(new Error(`claude 输出不是 JSON: ${stdout.slice(0, 300)}`)) }
      resolveP({ text: parsed.result ?? '', raw: parsed, durationMs: Date.now() - t0 })
    })
    proc.stdin.write(userMessage)
    proc.stdin.end()
  })
}

// ------------------------------------------------------------ 协议翻译

function toolProtocol(tools) {
  if (!tools?.length) return ''
  const docs = tools.map((t, i) => {
    const fn = t.function ?? t
    const params = fn.parameters ? '\n  参数 JSON Schema:\n  ' + JSON.stringify(fn.parameters).slice(0, 1200) : ''
    return `[${i + 1}] ${fn.name}\n  描述: ${fn.description ?? ''}${params}`
  }).join('\n\n')
  const first = tools[0].function ?? tools[0]
  const p = first.parameters ?? {}
  const exName = p.required?.[0] ?? Object.keys(p.properties ?? {})[0] ?? 'arg'
  return `

# 工具调用格式

本次对话由一个 OpenAI 兼容网关转发。网关不支持结构化的 tool_calls 字段，
因此工具调用改用下面的文本格式表达；网关会把它解析回结构化调用并真正执行，
再把结果作为 tool_result 回传给你。这是正常的调用通道，不是模拟。

## 可用工具

${docs}

## 格式

要调用工具时，输出（可以连续输出多个）：

<tool_call>
{"name": "${first.name}", "arguments": {"${exName}": "值"}}
</tool_call>

不需要再调工具、可以给出最终答复时，直接输出答复文本，不带任何 <tool_call> 标签。
工具名必须严格取自上面的「可用工具」列表。`
}

function flatten(messages) {
  const sys = [], turns = []
  for (const m of messages ?? []) {
    const text = typeof m.content === 'string'
      ? m.content
      : (m.content ?? []).map((b) => b.text ?? (b.type === 'image_url' ? '[图片]' : '')).join('\n')
    if (m.role === 'system' || m.role === 'developer') { sys.push(text); continue }
    if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map(
        (c) => `<tool_call>\n${JSON.stringify({ name: c.function.name, arguments: safeParse(c.function.arguments) })}\n</tool_call>`,
      ).join('\n')
      turns.push(`【assistant】\n${text}${calls ? '\n' + calls : ''}`)
      continue
    }
    if (m.role === 'tool') {
      turns.push(`【tool_result ${m.tool_call_id ?? ''}】\n${text}`)
      continue
    }
    turns.push(`【user】\n${text}`)
  }
  return { system: sys.join('\n\n'), user: turns.join('\n\n') }
}

const safeParse = (s) => { try { return JSON.parse(s) } catch { return s } }

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
function parseReply(text) {
  const calls = []
  let content = text
  for (const m of text.matchAll(TOOL_CALL_RE)) {
    let raw = m[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
    try {
      const obj = JSON.parse(raw)
      calls.push({
        id: `call_${randomUUID().slice(0, 12)}`,
        type: 'function',
        function: { name: obj.name, arguments: JSON.stringify(obj.arguments ?? obj.args ?? {}) },
      })
    } catch { /* 解析不了就当普通文本留在 content 里 */ }
  }
  content = content.replace(TOOL_CALL_RE, '').trim()
  return { content, toolCalls: calls }
}

// ------------------------------------------------------------ 请求录制

let seq = 0
function record(body, meta) {
  if (!RECORD_DIR) return null
  const n = String(++seq).padStart(4, '0')
  // 原样落盘 wire payload —— 第 11 章要按字节比对前缀
  writeFileSync(join(RECORD_DIR, `${n}.request.json`), JSON.stringify(body, null, 2))
  appendFileSync(join(RECORD_DIR, 'index.jsonl'), JSON.stringify({
    n, at: new Date().toISOString(), model: body.model, stream: !!body.stream,
    messages: body.messages?.length ?? 0, tools: body.tools?.length ?? 0,
    systemBytes: Buffer.byteLength((body.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('')),
    toolSchemaBytes: Buffer.byteLength(JSON.stringify(body.tools ?? [])),
    totalBytes: Buffer.byteLength(JSON.stringify(body)),
    ...meta,
  }) + '\n')
  return n
}

/** 把回给 dsh 的关键响应字段也落盘，否则出问题只能靠猜 */
function recordResponse(n, payload) {
  if (!RECORD_DIR || !n) return
  writeFileSync(join(RECORD_DIR, `${n}.response.json`), JSON.stringify(payload, null, 2))
}

// ------------------------------------------------------------ HTTP

const stats = { requests: 0, errors: 0, lastError: null, totalMs: 0 }

function sseChunk(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`) }

async function handleChat(req, res, body) {
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`
  const created = Math.floor(Date.now() / 1000)
  const model = body.model ?? 'mock'
  const claudeModel = mapModel(model)
  const recNo = record(body, {})

  const { system, user } = flatten(body.messages)
  const systemPrompt = (system || '你是一个通用助手。') + toolProtocol(body.tools)

  if (VERBOSE) {
    console.log(`[mock] #${recNo ?? '-'} model=${model}→${claudeModel} msgs=${body.messages?.length} tools=${body.tools?.length ?? 0} stream=${!!body.stream}`)
  }

  const t0 = Date.now()
  const { text, raw } = await callClaude({ model: claudeModel, systemPrompt, userMessage: user || '（空）' })
  stats.totalMs += Date.now() - t0
  const { content, toolCalls } = parseReply(text)
  const finish = toolCalls.length ? 'tool_calls' : 'stop'
  const u = raw?.usage ?? {}
  const usage = {
    prompt_tokens: u.input_tokens ?? 0,
    completion_tokens: u.output_tokens ?? 0,
    total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    // 透传 Claude 侧的缓存字段，但注意：这反映的是 claude -p 自己的请求组装，
    // 不是 dsh 的前缀行为。第 11 章不能拿它当 dsh 的 KV cache 证据。
    prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0 },
  }

  recordResponse(recNo, { finish, usage, contentChars: content.length, toolCalls: toolCalls.map((c) => c.function.name), rawText: text.slice(0, 4000), claudeRaw: { is_error: raw?.is_error, subtype: raw?.subtype, num_turns: raw?.num_turns, usage: raw?.usage } })

  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }],
      usage,
    }))
    return
  }

  // ---- SSE：dsh 走的就是这条路
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const base = { id, object: 'chat.completion.chunk', created, model }

  sseChunk(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })

  // 内容按小块吐出来，让 dsh 侧真的走一遍 assistant/chunk 的累积路径
  if (content) {
    const SIZE = 24
    for (let i = 0; i < content.length; i += SIZE) {
      sseChunk(res, { ...base, choices: [{ index: 0, delta: { content: content.slice(i, i + SIZE) }, finish_reason: null }] })
    }
  }

  toolCalls.forEach((c, idx) => {
    sseChunk(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: c.id, type: 'function', function: { name: c.function.name, arguments: '' } }] }, finish_reason: null }] })
    sseChunk(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: c.function.arguments } }] }, finish_reason: null }] })
  })

  sseChunk(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] })
  sseChunk(res, { ...base, choices: [], usage })
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({
      name: 'dsh mock-llm-server', backend: 'claude -p',
      streaming: true, recording: RECORD_DIR ?? false, port: PORT,
    }, null, 2))
  }
  if (req.method === 'GET' && path === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ...stats, avgMs: stats.requests ? Math.round(stats.totalMs / stats.requests) : 0, recorded: seq }, null, 2))
  }
  if (req.method === 'GET' && path === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({
      object: 'list',
      data: ['mock-sonnet', 'mock-haiku', 'mock-opus'].map((id) => ({ id, object: 'model', created: 0, owned_by: 'mock' })),
    }))
  }
  if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', async () => {
      stats.requests++
      let body
      try { body = JSON.parse(raw) } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'invalid JSON body' } }))
      }
      try {
        await handleChat(req, res, body)
      } catch (err) {
        stats.errors++
        stats.lastError = String(err?.message ?? err)
        console.error('[mock] 失败:', stats.lastError)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: stats.lastError, type: 'mock_backend_error' } }))
        } else { res.end() }
      }
    })
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${path}` } }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm-server] listening on http://127.0.0.1:${PORT}`)
  console.log(`[mock-llm-server] backend: claude -p（OAuth 配额，不用 API key）`)
  console.log(`[mock-llm-server] streaming: 支持 SSE${RECORD_DIR ? `，录制到 ${RECORD_DIR}` : '，未开录制'}`)
})
