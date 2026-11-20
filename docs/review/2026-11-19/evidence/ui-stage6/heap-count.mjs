// Counts objects by constructor name in heap snapshots. Review-only.
//   node heap-count.mjs <name,name,...> <a.heapsnapshot> [b.heapsnapshot ...]
import { readFileSync } from 'node:fs'

const [names, ...files] = process.argv.slice(2)
const wanted = names.split(',')
for (const file of files) {
  const snap = JSON.parse(readFileSync(file, 'utf8'))
  const nf = snap.snapshot.meta.node_fields
  const N = nf.length
  const nameAt = nf.indexOf('name')
  const typeAt = nf.indexOf('type')
  const types = snap.snapshot.meta.node_types[0]
  const counts = Object.fromEntries(wanted.map((n) => [n, 0]))
  for (let i = 0; i < snap.nodes.length; i += N) {
    if (types[snap.nodes[i + typeAt]] !== 'object') continue
    const name = snap.strings[snap.nodes[i + nameAt]]
    if (name in counts) counts[name] += 1
  }
  console.log(file.split('/').pop(), JSON.stringify(counts))
}
