import { LocalShellProvider, ContainerShellProvider } from '../src/index.ts'

const N = 12
async function bench(p, label) {
  const spec = p.resolve({ command: 'echo ok' })
  await p.run(spec)                       // 预热
  const xs = []
  for (let i = 0; i < N; i++) xs.push((await p.run(spec)).durationMs)
  xs.sort((a, b) => a - b)
  const q = (r) => xs[Math.min(xs.length - 1, Math.floor(xs.length * r))]
  console.log(`${label.padEnd(22)} p50=${String(q(0.5)).padStart(6)}ms  p95=${String(q(0.95)).padStart(6)}ms  min=${String(xs[0]).padStart(5)}ms`)
  return { label, p50: q(0.5), p95: q(0.95), min: xs[0], samples: xs }
}
const out = []
out.push(await bench(new LocalShellProvider(), '本地进程'))
out.push(await bench(new ContainerShellProvider({ image: 'node:22-alpine' }), '容器（同机隔离）'))
console.log('\n倍数：', (out[1].p50 / out[0].p50).toFixed(1) + '×')
const fs = await import('node:fs')
fs.mkdirSync('../../../assets/ch13', { recursive: true })
fs.writeFileSync('../../../assets/ch13/latency.json', JSON.stringify({ at: new Date().toISOString().slice(0,10), n: N, results: out }, null, 2))
