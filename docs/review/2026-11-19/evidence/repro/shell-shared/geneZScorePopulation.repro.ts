// SHL: "Combine genes: Z-score" is described as how far a cell's mean is
// from "the average cell". The score is computed over whatever batch the
// reader returned, so the same cell gets different z-scores depending on
// whether the reader returns zero-expression cells (Xenium does not, H5AD
// does) and on which cells are in view.
// Oracle: population z-score over all 10 cells, computed here by hand.
import { describe, expect, it } from 'vitest'
import { geneExpressionScores } from '../../../../../../src/rendering/geneExpressionRenderer'
import type { GeneExpressionElement } from '../../../../../../src/datasets/xeniumDataset'

// Two genes; per-cell summed counts. Cells 0-5 express, 6-9 do not.
const counts = [8, 6, 4, 3, 2, 2, 0, 0, 0, 0]
const genes = ['A', 'B']

function element(index: number): GeneExpressionElement {
  return {
    id: `cell-${index}`,
    position: { x: index, y: 0 },
    count: counts[index] ?? 0,
  } as unknown as GeneExpressionElement
}

// Hand oracle over the whole population (all 10 cells).
const means = counts.map((c) => c / 2)
const mu = means.reduce((s, v) => s + v, 0) / means.length // 1.25
const sd = Math.sqrt(means.reduce((s, v) => s + (v - mu) ** 2, 0) / means.length)
const oracleZ = means.map((v) => (v - mu) / sd)

describe('z-score population', () => {
  it('all cells in the batch (H5AD-style reader) matches the population oracle', () => {
    const all = counts.map((_c, i) => element(i))
    const z = geneExpressionScores(all, genes, 'z-score')
    expect(z[3]).toBeCloseTo(oracleZ[3] ?? NaN, 9)
  })

  it('expressing cells only (Xenium reader) gives another z for the same cell', () => {
    const expressing = [0, 1, 2, 3, 4, 5].map(element)
    const z = geneExpressionScores(expressing, genes, 'z-score')
    console.log(
      JSON.stringify({ cell3_population: oracleZ[3], cell3_expressingOnly: z[3] }),
    )
    // Cell 3 (count 3, mean 1.5) is above the population mean but below the mean of
    // expressing cells, so its sign flips.
    expect(oracleZ[3]).toBeGreaterThan(0)
    expect(z[3]).toBeLessThan(0)
  })

  it('a viewport holding cells 2-7 gives yet another z', () => {
    const viewport = [2, 3, 4, 5, 6, 7].map(element)
    const z = geneExpressionScores(viewport, genes, 'z-score')
    console.log(JSON.stringify({ cell3_viewport: z[1] }))
    expect(Math.abs((z[1] ?? 0) - (oracleZ[3] ?? 0))).toBeGreaterThan(0.1)
  })
})
