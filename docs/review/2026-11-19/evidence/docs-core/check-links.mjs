// Checks relative links and #anchors in the core docs and plan records.
// Run from the repository root: node docs/review/2026-11-19/evidence/docs-core/check-links.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const files = [
  'README.md',
  'PLAN.md',
  'docs/README.md',
  'docs/user-guide.md',
  'docs/ui-reference.md',
  'docs/architecture.md',
  'docs/profiling.md',
  ...readdirSync('docs/plan')
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/plan/${f}`),
  ...readdirSync('docs/plan/phases')
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/plan/phases/${f}`),
]

// GitHub-style slugs.
function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}
const anchorCache = new Map()
function anchors(file) {
  if (!anchorCache.has(file)) {
    const set = new Set()
    const counts = new Map()
    let inFence = false
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('```')) inFence = !inFence
      if (inFence) continue
      const m = /^#{1,6}\s+(.*)$/.exec(line)
      if (!m) continue
      const base = slug(m[1])
      const n = counts.get(base) ?? 0
      counts.set(base, n + 1)
      set.add(n === 0 ? base : `${base}-${n}`)
    }
    anchorCache.set(file, set)
  }
  return anchorCache.get(file)
}

let problems = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]
    if (/^(https?:|mailto:)/.test(target)) continue
    const [path, hash] = target.split('#')
    const resolved =
      path === '' ? file : normalize(join(dirname(file), decodeURIComponent(path)))
    if (!existsSync(resolved)) {
      console.log(`${file}: missing file ${target}`)
      problems++
      continue
    }
    if (hash && resolved.endsWith('.md') && !anchors(resolved).has(hash)) {
      console.log(`${file}: missing anchor ${target}`)
      problems++
    }
  }
}
console.log(`${files.length} files checked, ${problems} problems`)
