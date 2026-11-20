// FMT review: checks code spans in README.md and docs/**.md (docs/review/
// and docs/plan/ excluded: plan records are historical) that name repository
// files or code symbols. Reads only; prints to stdout.
//
//   node docs/review/2026-11-19/evidence/docs-formats/check-code-refs.mjs \
//     > docs/review/2026-11-19/evidence/docs-formats/check-code-refs.log
//
// File spans: anything with a known extension or a src/ scripts/ tests/
// public/ .github/ prefix, tried from the repo root and from the doc's folder.
// Symbol spans: camelCase or PascalCase identifiers (optionally followed by
// "()"), searched as whole words in src/, scripts/, tests/ and config files.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()

function mdFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      const rel = relative(root, path)
      return rel === 'docs/review' || rel === 'docs/plan' ? [] : mdFiles(path)
    }
    return name.endsWith('.md') ? [path] : []
  })
}

const files = [join(root, 'README.md'), ...mdFiles(join(root, 'docs'))]
const fileRefs = []
const symbolRefs = new Map()

for (const file of files) {
  const rel = relative(root, file)
  let inFence = false
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      for (const match of line.matchAll(/`([^`\n]+)`/g)) {
        const span = match[1].trim()
        const where = `${rel}:${index + 1}`
        if (
          /^(?:\.{0,2}\/)?(?:src|scripts|tests|public|\.github|docs|examples|patches)\/[\w./@+-]+$/.test(
            span,
          ) ||
          /^[\w./-]+\.(?:tsx?|mjs|py|ya?ml)$/.test(span) ||
          /^(?:package\.json|vite\.config\.ts|playwright\.config\.ts|vitest\.config\.ts|tsconfig[\w.]*\.json|index\.html)$/.test(
            span,
          )
        ) {
          fileRefs.push({ span, where, dir: dirname(file) })
          continue
        }
        const symbol = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\(\))?$/.exec(span)?.[1]
        if (
          symbol !== undefined &&
          symbol.length >= 6 &&
          /[a-z]/.test(symbol) &&
          /[A-Z]/.test(symbol.slice(1)) &&
          !/^[A-Z][a-z]+$/.test(symbol)
        ) {
          const list = symbolRefs.get(symbol) ?? []
          list.push(where)
          symbolRefs.set(symbol, list)
        }
      }
    })
}

const missingFiles = fileRefs.filter(({ span, dir }) => {
  const clean = span.replace(/^\.\//, '')
  return !existsSync(join(root, clean)) && !existsSync(resolve(dir, span))
})

// Basenames named without a folder (`useDatasetLifecycle.ts`): search for them.
const trackedFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
const stillMissing = missingFiles.filter(
  ({ span }) =>
    !span.includes('/') &&
    !trackedFiles.some((path) => path.endsWith(`/${span}`) || path === span),
)
const missingWithFolder = missingFiles.filter(({ span }) => span.includes('/'))

const searchRoots = [
  'src',
  'scripts',
  'tests',
  'vite.config.ts',
  'playwright.config.ts',
  'vitest.config.ts',
  '.github',
  'public',
]
const missingSymbols = []
for (const [symbol, where] of symbolRefs) {
  try {
    execFileSync('grep', ['-rqw', '--', symbol, ...searchRoots], { cwd: root })
  } catch {
    missingSymbols.push({ symbol, where })
  }
}

console.log(`Docs checked: ${files.length}`)
console.log(
  `File references: ${fileRefs.length}; not found with a folder: ${missingWithFolder.length}; bare names not found anywhere: ${stillMissing.length}`,
)
for (const ref of [...missingWithFolder, ...stillMissing])
  console.log(`FILE\t${ref.where}\t${ref.span}`)
console.log(
  `\nSymbol-like spans: ${symbolRefs.size}; not found in code: ${missingSymbols.length}`,
)
for (const { symbol, where } of missingSymbols)
  console.log(`SYMBOL\t${symbol}\t${where.length}\t${where.slice(0, 3).join(' ')}`)
