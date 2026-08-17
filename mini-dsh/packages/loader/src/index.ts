import type { Context, Fiber, PluginLike } from '../../cordis/src/index.ts'

/** 配置树里的一行。 */
export interface Entry {
  id: string
  name: string
  config?: Record<string, unknown>
  disabled?: boolean
}

/**
 * 一条 patch。
 *
 * 按 id 定位，**整体替换** config，不深合并。
 * `insert` 往列表末尾追加新行。
 */
export interface Patch {
  id?: string
  config?: Record<string, unknown>
  disabled?: boolean
  insert?: Entry[]
}

/** 一层 patch，带个名字，用来在 dump 里标出处。 */
export interface Layer {
  label: string
  patches: Patch[]
}

export interface ComposedEntry extends Entry {
  /** 这一行来自哪层，又被哪些层改过。dump 时打成 `# ==` 注释。 */
  provenance: { origin: string; patchedBy: string[] }
}

/**
 * 把若干层 patch 叠到一个空列表上。
 *
 * **这个函数是 dump 和 boot 共用的**——不是两份实现跑出一样的结果，
 * 是同一份实现。真 dsh 为此把 include 插件的 applyPatches 提成了导出的纯函数
 * applyEntryPatches，vendor/README.md 本地修改第 11 条的理由原话是：
 * "config tooling must never reimplement (and drift from) the patch algorithm"。
 */
export function composeEntries(layers: Layer[], warn: (msg: string) => void = () => {}): ComposedEntry[] {
  const out: ComposedEntry[] = []
  for (const layer of layers) {
    for (const patch of layer.patches) {
      if (patch.insert) {
        for (const e of patch.insert) {
          if (out.some((x) => x.id === e.id)) {
            throw new Error(`DUPLICATE_ID: 已经有一行 id 是 "${e.id}"`)
          }
          out.push({ ...e, provenance: { origin: layer.label, patchedBy: [] } })
        }
        continue
      }
      if (!patch.id) {
        warn(`${layer.label}: 一条 patch 既没有 id 也没有 insert，忽略`)
        continue
      }
      const target = out.find((x) => x.id === patch.id)
      if (!target) {
        // 定位不到只告警，不报错。真 dsh 也是这个行为。
        warn(`${layer.label}: patch 指向的 id "${patch.id}" 在树里不存在`)
        continue
      }
      // ★ 整体替换，不深合并。写了 config 就把整段换掉。
      if ('config' in patch) target.config = patch.config
      if ('disabled' in patch) target.disabled = patch.disabled
      target.provenance.patchedBy.push(layer.label)
    }
  }
  return out
}

/**
 * 把合成结果渲染成可读文本，带层来源注释。
 *
 * 用的是 composeEntries 的输出，所以它和真正启动的树不可能不一致。
 */
export function renderDump(entries: ComposedEntry[]): string {
  const lines: string[] = []
  let lastTag = ''
  for (const e of entries) {
    const tag = e.provenance.patchedBy.length
      ? `${e.provenance.origin}, patched by ${e.provenance.patchedBy.join(', ')}`
      : e.provenance.origin
    if (tag !== lastTag) {
      lines.push(`# == ${tag}`)
      lastTag = tag
    }
    lines.push(`- id: ${e.id}`)
    lines.push(`  name: '${e.name}'`)
    if (e.disabled) lines.push(`  disabled: true`)
    if (e.config && Object.keys(e.config).length) {
      lines.push(`  config:`)
      for (const [k, v] of Object.entries(e.config)) {
        lines.push(`    ${k}: ${JSON.stringify(v)}`)
      }
    }
  }
  return lines.join('\n')
}

/** 插件名 → 实现。真 dsh 靠 npm 包名解析，mini 版用一张表。 */
export type PluginResolver = (name: string) => PluginLike | undefined

/**
 * 按合成结果挂载整棵树。
 *
 * 注意它不关心行序——第 5 章讲过，激活顺序由服务可用性驱动。
 */
export function mount(ctx: Context, entries: ComposedEntry[], resolve: PluginResolver): Fiber[] {
  const fibers: Fiber[] = []
  for (const e of entries) {
    if (e.disabled) continue
    const plugin = resolve(e.name)
    if (!plugin) throw new Error(`UNRESOLVED_PLUGIN: 找不到 "${e.name}"（行 id: ${e.id}）`)
    fibers.push(ctx.plugin(plugin, e.config))
  }
  return fibers
}

/**
 * 启动后的自检：有没有插件卡着没起来。
 *
 * 对照真 dsh 的 assertEntriesActivated。这是排查
 * 「我的插件为什么没反应」的主要抓手。
 */
export function assertEntriesActivated(ctx: Context): void {
  const stuck = ctx.pending()
  if (stuck.length === 0) return
  const detail = stuck.map((s) => `  ${s.name} 缺 [${s.missing.join(', ')}]`).join('\n')
  throw new Error(`STARTUP_INCOMPLETE: 有 ${stuck.length} 个插件没能激活\n${detail}`)
}
