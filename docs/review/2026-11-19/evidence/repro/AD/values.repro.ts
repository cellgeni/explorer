// Area AD, review 2026-11-19: what the AnnData reader's value semantics do
// downstream: ROI gene statistics over negative values, and a NaN stored value
// in the map's z-score colouring. Expected numbers are worked by hand from
// fixtures/AD/expected.json (numpy), not from the code under review.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/AD/values.repro.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AnnDataH5adDataset } from '../../../../../../src/datasets/h5adDataset'
import { summarizeRoiGeneExpression } from '../../../../../../src/data/roiGeneStats'
import { geneExpressionScores } from '../../../../../../src/rendering/geneExpressionRenderer'
import { micrometers } from '../../../../../../src/data/coords'
import type { SpatialElementId } from '../../../../../../src/datasets/spatialDataset'

const FIXTURES = join(process.cwd(), 'docs/review/2026-11-19/evidence/fixtures/AD')

function open(kind: 'csr' | 'dense'): AnnDataH5adDataset {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, `axes-${kind}.h5ad`)))
  return new AnnDataH5adDataset({
    url: `https://example.test/axes-${kind}.h5ad`,
    fetcher: (async () => new Response(bytes.slice())) as typeof fetch,
  })
}

describe('ROI gene statistics over an X with negative values (AD-02)', () => {
  it.each(['csr', 'dense'] as const)('%s: Neg mean per cell', async (kind) => {
    const dataset = open(kind)
    // The ROI path for AnnData (App.tsx loadActiveRoiGeneStats): matrix() of
    // the sampled cells, then summarizeRoiGeneExpression. Cells c3 and c5
    // hold Neg = -1 and 3 (expected.json row 3 and 5).
    const ids = ['c3', 'c5'] as SpatialElementId[]
    const stats = summarizeRoiGeneExpression(await dataset.matrix(ids), {
      cellCount: 2,
      sampledCellIds: ids,
      geneLimit: 100,
    })
    const neg = stats.genes.find((gene) => gene.gene === 'Neg')
    // Stored values: (-1 + 3) / 2 = 1. The docs say ROI values "are as the
    // matrix stores them" (ui-reference.md, ROI Genes method).
    expect(neg?.meanPerCell).toBe(1.5) // observed: the -1 is dropped, 3 / 2
    expect(neg?.count).toBe(3) // stored sum is 2
    dataset.dispose()
  })
})

describe('a NaN stored value in z-score colouring (AD-03)', () => {
  it('turns every cell of the batch NaN', async () => {
    const dataset = open('csr')
    const batch = await dataset.geneExpression(
      {
        minX: micrometers(-1e6),
        maxX: micrometers(1e6),
        minY: micrometers(-1e6),
        maxY: micrometers(1e6),
      },
      ['Nan'],
    )
    // Stored column Nan: [0, 0, 1, NaN, 0, 2]; c3 is the NaN. Row 1 shows
    // row 2's 1 because both rows have the ID c0-2 (AD-01).
    expect(batch.elements.map((element) => element.count)).toEqual([
      0,
      1,
      1,
      Number.NaN,
      0,
      2,
    ])
    const zScores = geneExpressionScores(batch.elements, ['Nan'], 'z-score')
    // One missing value makes the mean NaN, so no cell gets a score.
    expect(zScores.every((score) => Number.isNaN(score))).toBe(true)
    const sums = geneExpressionScores(batch.elements, ['Nan'], 'sum')
    expect(sums.filter((score) => Number.isNaN(score))).toHaveLength(1)
    dataset.dispose()
  })
})
