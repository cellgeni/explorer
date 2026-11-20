// Addendum, review 2026-11-20: splitting an AnnData table into sections when
// its obs `section` column holds whole numbers. The two fixtures are written
// by anndata (fixtures/addendum/make_fixtures.py) and differ only in how
// `section` is stored: anndata writes integers as a numeric array and
// strings as a categorical (fixtures/addendum/expected.json).
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/addendum/sections-numeric-column.repro.ts
//
// Each `it` asserts what main at 5b1cd9f actually does; the comment above it
// says which contract that breaks.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDatasetCollection } from '../../../../../../src/datasets/annDataSectionCollection'
import { AnnDataH5adDataset } from '../../../../../../src/datasets/h5adDataset'
import { sectionSplitLink } from '../../../../../../src/features/collection/sectionSplitModel'

const FIXTURES = join(process.cwd(), 'docs/review/2026-11-19/evidence/fixtures/addendum')
const encodings = JSON.parse(
  readFileSync(join(FIXTURES, 'expected.json'), 'utf8'),
) as Record<string, Record<string, string>>

type Fixture = 'sections-int' | 'sections-str'

function open(name: Fixture): AnnDataH5adDataset {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, `${name}.h5ad`)))
  return new AnnDataH5adDataset({
    url: `https://example.test/${name}.h5ad`,
    fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { headers: { 'content-length': String(bytes.byteLength) } })
        : new Response(bytes.slice())) as typeof fetch,
  })
}

async function split(name: Fixture, fragment = '') {
  const dataset = open(name)
  return loadDatasetCollection(`https://example.test/${name}.h5ad${fragment}`, {
    openDataset: async () => dataset,
  })
}

async function splitLink(name: Fixture) {
  const dataset = open(name)
  return sectionSplitLink({
    datasetUrl: dataset.url,
    platform: 'h5ad',
    groupOptions: await dataset.annotationGroups(),
    inCollection: false,
    pathname: '/explorer/',
  })
}

describe('sections of one table: obs section stored as numbers', () => {
  it('fixtures: anndata stores whole numbers as an array, strings as a categorical', () => {
    expect(encodings['sections-int']?.section).toBe('array')
    expect(encodings['sections-str']?.section).toBe('categorical')
  })

  it('control: a string section column splits without naming it, with depths', async () => {
    const collection = await split('sections-str')
    expect(collection.datasets.map((entry) => [entry.name, entry.z])).toEqual([
      ['s1', 0],
      ['s2', 10],
      ['s3', 20],
    ])
    expect((await splitLink('sections-str'))?.sectionCount).toBe(3)
  })

  it('control: naming the numeric column splits it, numbers ascending', async () => {
    const collection = await split('sections-int', '#obs.section')
    expect(collection.datasets.map((entry) => [entry.name, entry.z])).toEqual([
      ['1', 0],
      ['2', 10],
      ['3', 20],
    ])
  })

  // docs/dataset-collections.md (Sections Of One Table): "The first form
  // splits the table by its first obs column named `section`, ...". The
  // numeric `section` column is skipped: sectionColumns() lists label columns
  // only, so the error asks for a column and does not list `section`.
  it('collection= without a column does not find the numeric section column', async () => {
    await expect(split('sections-int')).rejects.toThrow(
      'name the obs column that splits the table into sections, as https://example.test/sections-int.h5ad#obs.cell_type. Columns with 2 to 500 values: cell_type.',
    )
  })

  // docs/dataset-collections.md: "With the open table's annotation sets
  // listing such a column, the Cells section's `Open N Sections` link opens
  // the same collection." A numeric column is a metadata track, not an
  // annotation set, so the link is never offered for it.
  it('no Open N Sections link for the numeric section column', async () => {
    expect(await splitLink('sections-int')).toBeNull()
  })
})
