// FMT review: internal link and anchor checker for README.md and docs/**.md
// (docs/review/ excluded). Reads only; prints problems and writes nothing
// except stdout. External links are listed for a separate sampled check.
//
//   node docs/review/2026-11-19/evidence/docs-formats/check-links.mjs \
//     > docs/review/2026-11-19/evidence/docs-formats/check-links.log
//
// Anchors follow GitHub's heading slugs: lowercase, punctuation other than
// '-' and '_' removed, spaces to '-', repeats suffixed -1, -2, ...
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()

function mdFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return relative(root, path) === 'docs/review' ? [] : mdFiles(path)
    }
    return name.endsWith('.md') ? [path] : []
  })
}

const files = [join(root, 'README.md'), ...mdFiles(join(root, 'docs'))]

// Strip fenced code blocks and inline code spans so their contents are not
// taken for links or headings.
function stripCode(text) {
  const lines = text.split('\n')
  let inFence = false
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return ''
      }
      return inFence ? '' : line
    })
    .join('\n')
}

function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

const anchorCache = new Map()

function anchorsOf(path) {
  if (anchorCache.has(path)) return anchorCache.get(path)
  const text = stripCode(readFileSync(path, 'utf8'))
  const anchors = new Set()
  const counts = new Map()
  for (const line of text.split('\n')) {
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (match) {
      const base = slugify(match[2])
      const n = counts.get(base) ?? 0
      counts.set(base, n + 1)
      anchors.add(n === 0 ? base : `${base}-${n}`)
    }
    for (const html of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(html[1])
  }
  anchorCache.set(path, anchors)
  return anchors
}

const problems = []
const external = new Map()
let internalCount = 0

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const text = stripCode(raw).replace(/`[^`\n]*`/g, '``')
  const rel = relative(root, file)
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const targets = [
      ...[...line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(
        (m) => m[1],
      ),
      ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)].map((m) => m[1]),
      ...[...line.matchAll(/<a\s+href="([^"]+)"/g)].map((m) => m[1]),
    ]
    for (const target of targets) {
      const where = `${rel}:${index + 1}`
      if (/^(?:https?:)?\/\//i.test(target)) {
        const list = external.get(target) ?? []
        list.push(where)
        external.set(target, list)
        continue
      }
      if (/^mailto:/i.test(target)) continue
      internalCount += 1
      const [pathPart, anchor] = target.split('#')
      const decoded = decodeURIComponent(pathPart)
      const targetPath = pathPart === '' ? file : resolve(dirname(file), decoded)
      if (!existsSync(targetPath)) {
        problems.push(`${where}\tmissing file\t${target}`)
        continue
      }
      if (anchor !== undefined && anchor !== '') {
        if (statSync(targetPath).isDirectory() || !targetPath.endsWith('.md')) {
          if (/^L\d+/.test(anchor)) continue
          problems.push(`${where}\tanchor on non-Markdown target\t${target}`)
          continue
        }
        if (!anchorsOf(targetPath).has(decodeURIComponent(anchor))) {
          problems.push(`${where}\tmissing anchor\t${target}`)
        }
      }
    }
  })
}

console.log(`Checked ${files.length} Markdown files, ${internalCount} internal links.`)
console.log(`Problems: ${problems.length}`)
for (const problem of problems) console.log(problem)
console.log(`\nExternal link targets: ${external.size}`)
for (const [url, where] of [...external].sort()) {
  console.log(`EXT\t${url}\t${where.length}\t${where[0]}`)
}
