// Review-only: import edges between top-level src areas (non-test files),
// plus strongly connected components among files. Run from the repo root:
//   node docs/review/2026-11-19/evidence/quality-stage7/import-graph.mjs [--runtime]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const root = resolve('src')
const files = []
;(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (
      /\.(ts|tsx)$/.test(n) &&
      !/\.test\.|\.d\.ts$/.test(n) &&
      !p.includes('/test/')
    )
      files.push(p)
  }
})(root)

const area = (p) => {
  const r = relative(root, p).split('/')
  if (r.length === 1) return r[0].replace(/\.(ts|tsx)$/, '')
  return r[0] === 'features' ? `features/${r[1]}` : r[0]
}
const resolveImport = (from, spec) => {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''))
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ])
    if (existsSync(c) && statSync(c).isFile()) return c
  return null
}
const edges = new Map()
const graph = new Map()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const deps = new Set()
  // With --runtime, `import type` and `export type` statements are left out,
  // since TypeScript erases them; dynamic import() counts as runtime.
  const runtime = process.argv.includes('--runtime')
  const re =
    /(?:(?:import|export)\s+(type\s+)?[^;'"]*?from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    if (runtime && m[1]) continue
    const t = resolveImport(f, m[2])
    if (t && !t.includes('.test.')) deps.add(t)
  }
  graph.set(f, deps)
  for (const t of deps) {
    const k = `${area(f)} -> ${area(t)}`
    if (area(f) !== area(t)) edges.set(k, (edges.get(k) ?? 0) + 1)
  }
}
const layer = {
  types: 0,
  utils: 0,
  codecs: 1,
  data: 1,
  tiff: 1,
  zarr: 1,
  workers: 1,
  datasets: 2,
  rendering: 2,
  store: 3,
  components: 4,
  App: 6,
  main: 7,
}
const rank = (a) => (a.startsWith('features/') ? 5 : (layer[a] ?? 5))
console.log('# Upward edges (lower layer importing a higher one)')
for (const [k, n] of [...edges].sort()) {
  const [a, b] = k.split(' -> ')
  if (rank(a) < rank(b)) console.log(`${k}\t${n}`)
}
// Tarjan SCC
let i = 0
const idx = new Map(),
  low = new Map(),
  on = new Set(),
  st = [],
  sccs = []
function sc(v) {
  idx.set(v, i)
  low.set(v, i)
  i++
  st.push(v)
  on.add(v)
  for (const w of graph.get(v) ?? []) {
    if (!idx.has(w)) {
      sc(w)
      low.set(v, Math.min(low.get(v), low.get(w)))
    } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
  }
  if (low.get(v) === idx.get(v)) {
    const c = []
    let w
    do {
      w = st.pop()
      on.delete(w)
      c.push(w)
    } while (w !== v)
    if (c.length > 1) sccs.push(c)
  }
}
for (const v of graph.keys()) if (!idx.has(v)) sc(v)
console.log(`\n# Import cycles: ${sccs.length}`)
for (const c of sccs)
  console.log(
    `${c.length} files: ${c
      .map((p) => relative(root, p))
      .sort()
      .join(', ')}`,
  )
console.log(`\nfiles ${files.length}`)
