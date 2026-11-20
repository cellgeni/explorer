// Compares two V8 heap snapshots: object counts and self sizes by type and
// name, the largest increases, and a retainer path for one new object of the
// most increased named class. Review-only.
//
//   node heap-diff.mjs <a.heapsnapshot> <b.heapsnapshot> [class name]
import { readFileSync } from 'node:fs'

function load(path) {
  const snap = JSON.parse(readFileSync(path, 'utf8'))
  const meta = snap.snapshot.meta
  const nf = meta.node_fields
  const ef = meta.edge_fields
  const nodeTypes = meta.node_types[0]
  const edgeTypes = meta.edge_types[0]
  const N = nf.length
  const E = ef.length
  const idx = (f) => nf.indexOf(f)
  const nodes = snap.nodes
  const count = nodes.length / N
  const firstEdge = new Uint32Array(count + 1)
  for (let i = 0, e = 0; i < count; i += 1) {
    firstEdge[i] = e
    e += nodes[i * N + idx('edge_count')] * E
    firstEdge[i + 1] = e
  }
  return {
    snap,
    nodes,
    N,
    E,
    count,
    idx,
    nodeTypes,
    edgeTypes,
    firstEdge,
    strings: snap.strings,
  }
}

function summary(h) {
  const map = new Map()
  for (let i = 0; i < h.count; i += 1) {
    const type = h.nodeTypes[h.nodes[i * h.N + h.idx('type')]]
    const name = h.strings[h.nodes[i * h.N + h.idx('name')]]
    const key = `${type}:${type === 'string' || type === 'concatenated string' ? '' : name.slice(0, 60)}`
    const entry = map.get(key) ?? { count: 0, size: 0 }
    entry.count += 1
    entry.size += h.nodes[i * h.N + h.idx('self_size')]
    map.set(key, entry)
  }
  return map
}

const [a, b, focus] = process.argv.slice(2)
const A = load(a)
const B = load(b)
const sa = summary(A)
const sb = summary(B)
const total = (h) => {
  let s = 0
  for (let i = 0; i < h.count; i += 1) s += h.nodes[i * h.N + h.idx('self_size')]
  return s
}
console.log(
  `total self size: ${(total(A) / 1048576).toFixed(1)} MiB -> ${(total(B) / 1048576).toFixed(1)} MiB`,
)
const rows = []
for (const [key, value] of sb) {
  const before = sa.get(key) ?? { count: 0, size: 0 }
  rows.push({
    key,
    dCount: value.count - before.count,
    dSize: value.size - before.size,
    count: value.count,
  })
}
console.log('largest size increases:')
for (const r of rows.sort((x, y) => y.dSize - x.dSize).slice(0, 25)) {
  console.log(
    `  ${(r.dSize / 1024).toFixed(0).padStart(7)} KiB  +${r.dCount}  (${r.count})  ${r.key}`,
  )
}
console.log('largest count increases of named objects:')
for (const r of rows
  .filter((r) => r.key.startsWith('object:'))
  .sort((x, y) => y.dCount - x.dCount)
  .slice(0, 25)) {
  console.log(
    `  +${r.dCount}  (${r.count})  ${(r.dSize / 1024).toFixed(0)} KiB  ${r.key}`,
  )
}

if (focus !== undefined) {
  // Retainer path for the newest object named `focus` in B.
  const idOf = (h, i) => h.nodes[i * h.N + h.idx('id')]
  const idsA = new Set()
  for (let i = 0; i < A.count; i += 1) {
    if (A.strings[A.nodes[i * A.N + A.idx('name')]] === focus) idsA.add(idOf(A, i))
  }
  const retainers = new Map()
  for (let from = 0; from < B.count; from += 1) {
    for (let e = B.firstEdge[from]; e < B.firstEdge[from + 1]; e += B.E) {
      const type = B.edgeTypes[B.snap.edges[e]]
      if (type === 'weak') continue
      const to = B.snap.edges[e + 2] / B.N
      const nameOrIndex = B.snap.edges[e + 1]
      const label =
        type === 'element' || type === 'hidden'
          ? `[${nameOrIndex}]`
          : B.strings[nameOrIndex]
      const list = retainers.get(to) ?? []
      list.push({ from, label, type })
      retainers.set(to, list)
    }
  }
  const nodeName = (i) =>
    `${B.nodeTypes[B.nodes[i * B.N + B.idx('type')]]}:${B.strings[B.nodes[i * B.N + B.idx('name')]].slice(0, 80)}`
  let start = -1
  for (let i = B.count - 1; i >= 0; i -= 1) {
    if (B.strings[B.nodes[i * B.N + B.idx('name')]] === focus && !idsA.has(idOf(B, i))) {
      start = i
      break
    }
  }
  console.log(`new ${focus} objects: ${start === -1 ? 'none' : 'found'}`)
  // Breadth-first search from the object to a root over retainers.
  const seen = new Map([[start, null]])
  const queue = [start]
  let end = -1
  while (queue.length > 0 && start !== -1) {
    const node = queue.shift()
    if (node === 0) {
      end = node
      break
    }
    for (const r of retainers.get(node) ?? []) {
      if (seen.has(r.from)) continue
      const n = B.strings[B.nodes[r.from * B.N + B.idx('name')]]
      if (
        /^\(.*\)$/.test(n) &&
        r.from !== 0 &&
        n !== '(GC roots)' &&
        !n.startsWith('(Global')
      ) {
        // skip internal caches except the roots
      }
      seen.set(r.from, { to: node, label: r.label })
      queue.push(r.from)
    }
  }
  if (end !== -1) {
    const path = []
    let node = end
    while (node !== start) {
      const step = seen.get(node) ?? null
      if (step === null) break
      path.push(`${nodeName(node)} --${step.label}-->`)
      node = step.to
    }
    path.push(nodeName(start))
    console.log('retainer path (root first):')
    for (const line of path) console.log('  ' + line)
  }
}
