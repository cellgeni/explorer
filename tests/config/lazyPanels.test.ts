// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { dependencyChunkGroups } from '../../vite.config'

// Since O21 these load the first time they are shown, so the start screen
// does not fetch them. A module the entry imports statically, however
// indirectly, is in the chunks index.html preloads: none of these may be.
const LAZY_PANELS = [
  'src/features/query/CellQueryPanel.tsx',
  'src/features/plots/PlotsPanel.tsx',
  'src/features/store-structure/StoreStructureDrawer.tsx',
  'src/features/screenshot/ScreenshotPanel.tsx',
  'src/features/python/PythonConsole.tsx',
]

const ROOT = resolve(__dirname, '../..')
const ENTRY = 'src/main.tsx'

describe('panels loaded on first use (O21)', () => {
  it('keeps them out of what the entry imports statically', () => {
    const reached = staticImportGraph(join(ROOT, ENTRY))

    expect(reached.size).toBeGreaterThan(100)
    // The windows that load them are reached.
    expect(reached).toContain(join(ROOT, 'src/features/shell/QueryWindow.tsx'))
    expect(reached).toContain(join(ROOT, 'src/features/screenshot/ScreenshotButton.tsx'))
    expect(LAZY_PANELS.filter((panel) => reached.has(join(ROOT, panel)))).toEqual([])
  })

  it('puts what the entry imports statically into one app chunk', () => {
    const app = dependencyChunkGroups.find((group) => group.name === 'app')

    expect(app).toMatchObject({ tags: ['$initial'] })
    expect(app?.test.test('/repo/src/App.tsx')).toBe(true)
    expect(app?.test.test('/repo/node_modules/react/index.js')).toBe(false)
  })
})

// The source files `entry` reaches through static imports and re-exports,
// leaving out `import type`, `export type` and `import()`. An import whose
// named imports are all types counts, as verbatimModuleSyntax keeps it.
function staticImportGraph(entry: string): Set<string> {
  const reached = new Set<string>()
  const pending = [entry]

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (reached.has(file)) continue

    reached.add(file)

    for (const specifier of staticImports(file)) {
      const target = resolveSource(dirname(file), specifier)

      if (target !== null && !reached.has(target)) pending.push(target)
    }
  }

  return reached
}

function staticImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const specifiers: string[] = []

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.isTypeOnly !== true &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
  }

  return specifiers
}

// A relative import's source file; null for packages, styles and assets.
function resolveSource(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = resolve(from, specifier.replace(/\?.*$/, ''))

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate
  }

  if (/\.(css|json|svg|wasm|png)$/.test(base)) return null

  throw new Error(
    `Cannot resolve ${specifier} from ${relative(ROOT, from)} in the import graph test.`,
  )
}
