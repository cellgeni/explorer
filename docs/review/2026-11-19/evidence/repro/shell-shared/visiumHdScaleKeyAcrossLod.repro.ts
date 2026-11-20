// SHL: With 2 µm (or 8 µm) Visium HD bins selected, zoomed-out requests read
// 16 µm bins (planGeneExpressionLod), but the Auto Gene scale's remembered
// top is keyed only by dataset URL, Combine-genes mode and genes
// (geneExpressionScaleKeyFor). The 16 µm top therefore carries over to the
// 2 µm view after zooming in. Expected (independent): a 16 µm bin sums 64
// 2 µm bins, so its counts are on a different scale and should not share a
// remembered top with 2 µm bins.
import { describe, expect, it } from 'vitest'
import { micrometers } from '../../../../../../src/data/coords'
import {
  planGeneExpressionLod,
  type GeneExpressionViewportDetail,
} from '../../../../../../src/data/geneExpressionLod'
import { geneExpressionScaleKeyFor } from '../../../../../../src/features/genes/geneControlsModel'
import { geneScoreSpread } from '../../../../../../src/features/genes/geneScaleRange'

const slide = {
  minX: micrometers(0),
  maxX: micrometers(6500),
  minY: micrometers(0),
  maxY: micrometers(6500),
}

function detail(zoom: number, visible: number): GeneExpressionViewportDetail {
  return {
    bbox: zoom < 0 ? slide : { ...slide, maxX: micrometers(100), maxY: micrometers(100) },
    visibleCellCount: visible,
    viewState: { target: [50, 50, 0], zoom },
  }
}

describe('Visium HD gene scale key across LOD tiers', () => {
  it('2 µm selection: zoomed out reads 16 µm, zoomed in reads 2 µm, same scale key', () => {
    const out = planGeneExpressionLod(detail(-2, 3_400_000), {
      detailMode: 'auto',
      slideBbox: slide,
      totalCellCount: 3_400_000,
      visiumHdBinSizeMicrometers: 2,
    })
    const near = planGeneExpressionLod(detail(4, 2_500), {
      detailMode: 'auto',
      slideBbox: slide,
      totalCellCount: 3_400_000,
      visiumHdBinSizeMicrometers: 2,
    })
    expect(out.kind === 'request' && out.visiumHdBinSizeMicrometers).toBe(16)
    expect(near.kind === 'request' && near.visiumHdBinSizeMicrometers).toBe(2)

    const keyOut = geneExpressionScaleKeyFor('https://x/hd', 'sum', ['GENE'])
    const keyNear = geneExpressionScaleKeyFor('https://x/hd', 'sum', ['GENE'])
    expect(keyOut).toBe(keyNear)

    // Synthetic counts: 2 µm bins mostly 0-3, 16 µm bins sum 64 of them.
    const twoUm = Array.from({ length: 6400 }, (_u, i) =>
      i % 7 === 0 ? 3 : i % 3 === 0 ? 1 : 0,
    )
    const sixteenUm = Array.from({ length: 100 }, (_u, i) =>
      twoUm.slice(i * 64, i * 64 + 64).reduce((s, v) => s + v, 0),
    )
    const top16 = geneScoreSpread(sixteenUm).top
    const top2 = geneScoreSpread(twoUm).top
    // App.tsx rememberGeneExpressionScaleMax keeps max(seen.top, spread.top)
    // under the same key, and useViewerLayerData uses
    // max(stored.top, current.top) as the Auto top.
    const autoTopAfterZoomIn = Math.max(top16, top2)
    console.log(JSON.stringify({ top16, top2, autoTopAfterZoomIn }))
    expect(autoTopAfterZoomIn).toBe(top16)
    expect(top16 / top2).toBeGreaterThan(5)
  })
})
