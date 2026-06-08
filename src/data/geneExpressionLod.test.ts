import { describe, expect, it } from 'vitest'
import { micrometers } from './coords'
import {
  GENE_EXPRESSION_EXACT_CELL_LIMIT,
  GENE_EXPRESSION_EXACT_REGION_CELL_LIMIT,
  GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT,
  GENE_EXPRESSION_SAMPLE_CELL_LIMIT,
  geneExpressionRequestKey,
  planGeneExpressionLod,
} from './geneExpressionLod'
import type { BBox } from './coords'
import type { GeneExpressionViewportDetail } from './geneExpressionLod'

const viewportBbox: BBox = {
  minX: micrometers(100),
  maxX: micrometers(300),
  minY: micrometers(200),
  maxY: micrometers(400),
}

const slideBbox: BBox = {
  minX: micrometers(0),
  maxX: micrometers(10_000),
  minY: micrometers(0),
  maxY: micrometers(8_000),
}

function detail(
  patch: Partial<GeneExpressionViewportDetail> = {},
): GeneExpressionViewportDetail {
  return {
    bbox: viewportBbox,
    visibleCellCount: 2_000,
    viewState: {
      target: [150, -250, 0],
      zoom: 0,
    },
    ...patch,
  }
}

describe('gene expression LOD planner', () => {
  it('uses exact region mode when the requested viewport is below the cap', () => {
    expect(
      planGeneExpressionLod(detail({ visibleCellCount: 6_000 }), {
        detailMode: 'exact-region',
        slideBbox,
        totalCellCount: 60_000,
      }),
    ).toEqual({
      kind: 'request',
      mode: 'exact-region',
      bbox: viewportBbox,
      cellLimit: 6_000,
      sampleStride: 1,
      sourceCellCount: 6_000,
    })
  })

  it('waits instead of requesting exact region expression above the cap', () => {
    expect(
      planGeneExpressionLod(
        detail({ visibleCellCount: GENE_EXPRESSION_EXACT_REGION_CELL_LIMIT + 1 }),
        {
          detailMode: 'exact-region',
          slideBbox,
          totalCellCount: 60_000,
        },
      ),
    ).toEqual({
      kind: 'waiting',
      message: 'Exact region needs 50,000 or fewer visible cells',
    })
  })

  it('uses a stable whole-slide sample for low overview zooms', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 60_000,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'overview-sampled',
      bbox: slideBbox,
      cellLimit: GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT,
      sampleStride: 4,
      sourceCellCount: 60_000,
    })
  })

  it('uses exact visible expression in auto mode up to the exact cap', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: GENE_EXPRESSION_EXACT_CELL_LIMIT,
          viewState: { target: [150, -250, 0], zoom: 0 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 60_000,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'exact',
      bbox: viewportBbox,
      cellLimit: GENE_EXPRESSION_EXACT_CELL_LIMIT,
      sampleStride: 1,
      sourceCellCount: GENE_EXPRESSION_EXACT_CELL_LIMIT,
    })
  })

  it('keeps whole-slide request keys independent from pan and zoom buckets', () => {
    const plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 60_000,
        viewState: { target: [150, -250, 0], zoom: -3 },
      }),
      {
        detailMode: 'auto',
        slideBbox,
        totalCellCount: 120_000,
      },
    )

    if (plan.kind !== 'request') {
      throw new Error('Expected an expression request plan.')
    }

    expect(
      geneExpressionRequestKey(
        'https://example.test/xenium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        plan,
        ['Actb'],
      ),
    ).toBe(
      geneExpressionRequestKey(
        'https://example.test/xenium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [500, -900, 0], zoom: -2.75 },
        }),
        plan,
        ['Actb'],
      ),
    )
  })

  it('uses padded sampled viewport requests above the exact cap outside overview zooms', () => {
    const plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 75_000,
        viewState: { target: [150, -250, 0], zoom: 0 },
      }),
      {
        detailMode: 'auto',
        slideBbox,
        totalCellCount: 120_000,
      },
    )

    expect(plan).toEqual({
      kind: 'request',
      mode: 'sampled',
      bbox: {
        minX: micrometers(60),
        maxX: micrometers(340),
        minY: micrometers(160),
        maxY: micrometers(440),
      },
      cellLimit: GENE_EXPRESSION_SAMPLE_CELL_LIMIT,
      sampleStride: 5,
      sourceCellCount: 75_000,
    })
  })
})
