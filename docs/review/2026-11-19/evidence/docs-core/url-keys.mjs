// Compares the link keys shareableState.ts reads or writes with the keys named
// in docs/ui-reference.md's Shareable URL table. Static text comparison only.
// Run from the repository root: node docs/review/2026-11-19/evidence/docs-core/url-keys.mjs
import { readFileSync } from 'node:fs'

const source = readFileSync('src/data/shareableState.ts', 'utf8')
const doc = readFileSync('docs/ui-reference.md', 'utf8')

const codeKeys = new Set(
  [
    ...source.matchAll(
      /\b(?:get|getAll|has|set|append|delete|read[A-Za-z]*|set[A-Za-z]*)\(\s*[a-zA-Z]*,?\s*'([a-zA-Z0-9]+)'/g,
    ),
  ].map((m) => m[1]),
)
const start = doc.indexOf('## Shareable URL')
const end = doc.indexOf('## State', start)
const table = doc.slice(start, end)
const docKeys = new Set(
  [...table.matchAll(/^\| ([^|]+)\|/gm)].flatMap((m) =>
    [...m[1].matchAll(/`([a-zA-Z0-9]+)`/g)].map((k) => k[1]),
  ),
)
// Keys the prose around the table names.
for (const k of ['xv', 'lens', 'lensQv']) if (table.includes('`' + k)) docKeys.add(k)

console.log(
  'In code, not in the Shareable URL table:',
  [...codeKeys]
    .filter((k) => !docKeys.has(k))
    .sort()
    .join(', ') || '(none)',
)
console.log(
  'In the table, not in code:',
  [...docKeys]
    .filter((k) => !codeKeys.has(k))
    .sort()
    .join(', ') || '(none)',
)
