// Addendum, review 2026-11-20: the cost of opening every section of one
// large table, as the 3D stack's previews do. Each section builds its base
// with withSection, which groups every row of the table by the section
// column (sectionGroups) and keeps one group, so opening S sections scans
// the table S times. The table is an in-memory AnnData (memorySource), read
// by the same readH5adCacheFromGroup as a file; no network.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/addendum/sections-scan-cost.repro.ts
//
// Timings are written to evidence/addendum/sections-scan-cost.json. They are
// Node timings on the review machine, not browser measurements.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AnnDataH5adDataset,
  type AnnDataMemoryTable,
} from '../../../../../../src/datasets/h5adDataset'

const OUT = join(process.cwd(), 'docs/review/2026-11-19/evidence/addendum')
const CELLS = 1_000_000

function memoryTable(cells: number, sections: number): AnnDataMemoryTable {
  const sectionCodes = new Int32Array(cells)
  const typeCodes = new Int32Array(cells)
  const spatial = new Float64Array(cells * 2)
  const area = new Float64Array(cells)
  const perSection = Math.ceil(cells / sections)

  for (let row = 0; row < cells; row += 1) {
    sectionCodes[row] = Math.floor(row / perSection)
    typeCodes[row] = row % 20
    spatial[row * 2] = row % 1000
    spatial[row * 2 + 1] = Math.floor(row / 1000) % 1000
    area[row] = 50 + (row % 100)
  }

  // One gene, expressed in every tenth cell.
  const expressed = Math.ceil(cells / 10)
  const indptr = new Int32Array(cells + 1)
  for (let row = 0; row < cells; row += 1) {
    indptr[row + 1] = (indptr[row] ?? 0) + (row % 10 === 0 ? 1 : 0)
  }

  return {
    obsNames: Array.from({ length: cells }, (_, row) => `cell-${row}`),
    obs: [
      {
        name: 'section',
        kind: 'categorical',
        codes: sectionCodes,
        categories: Array.from({ length: sections }, (_, index) => `s${index}`),
      },
      {
        name: 'cell_type',
        kind: 'categorical',
        codes: typeCodes,
        categories: Array.from({ length: 20 }, (_, index) => `type-${index}`),
      },
      { name: 'area', kind: 'numeric', values: area },
    ],
    varNames: ['g1'],
    X: {
      kind: 'csr',
      data: new Float32Array(expressed).fill(1),
      indices: new Int32Array(expressed),
      indptr,
    },
    obsm: { spatial: { values: spatial, columns: 2 } },
  }
}

async function measure(sections: number) {
  const table = memoryTable(CELLS, sections)
  const file = new AnnDataH5adDataset({
    url: 'https://example.test/large.h5ad',
    memorySource: { label: 'large.h5ad', load: async () => table },
  })

  let start = performance.now()
  await file.overview()
  const fileOpenMs = performance.now() - start

  start = performance.now()
  const listed = await file.sections('section')
  const sectionsListMs = performance.now() - start

  const perSectionMs: number[] = []
  let cells = 0
  for (const { value } of listed) {
    const section = new AnnDataH5adDataset({
      url: file.url,
      section: {
        column: 'section',
        value,
        holdFile: () => ({ dataset: Promise.resolve(file), release: () => undefined }),
      },
    })
    start = performance.now()
    cells += (await section.overview()).length
    perSectionMs.push(performance.now() - start)
    section.dispose()
  }

  const totalMs = perSectionMs.reduce((sum, value) => sum + value, 0)
  return {
    cells: CELLS,
    sections,
    fileOpenMs: Math.round(fileOpenMs),
    sectionsListMs: Math.round(sectionsListMs),
    allSectionsOpenMs: Math.round(totalMs),
    medianSectionOpenMs: Math.round(
      [...perSectionMs].sort((a, b) => a - b)[Math.floor(perSectionMs.length / 2)] ?? 0,
    ),
    cellsOpened: cells,
  }
}

describe('sections of one table: cost of opening every section', () => {
  it('scales with sections x table rows', async () => {
    const results = []
    for (const sections of [10, 50, 100]) {
      results.push(await measure(sections))
    }

    mkdirSync(OUT, { recursive: true })
    writeFileSync(
      join(OUT, 'sections-scan-cost.json'),
      `${JSON.stringify(
        {
          node: process.version,
          note: 'Node timings, one run each, on the review machine; sections opened one at a time as overview().',
          results,
        },
        null,
        2,
      )}\n`,
    )
    console.info('SECTIONS-SCAN', JSON.stringify(results))

    for (const result of results) expect(result.cellsOpened).toBe(CELLS)
  }, 300_000)
})
