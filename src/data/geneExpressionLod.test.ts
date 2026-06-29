import { describe, expect, it } from 'vitest'
import { micrometers } from './coords'
import {
  GENE_EXPRESSION_EXACT_CELL_LIMIT,
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
  it('requests every slide cell when all-cells mode is selected', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        {
          detailMode: 'all-cells',
          slideBbox,
          totalCellCount: 120_000,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'all-cells',
      bbox: slideBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 120_000,
    })
  })

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

  it('falls back to sampled expression above the exact region cap', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 75_000,
          viewState: { target: [150, -250, 0], zoom: 0 },
        }),
        {
          detailMode: 'exact-region',
          slideBbox,
          totalCellCount: 120_000,
        },
      ),
    ).toEqual({
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

  it('falls back to whole-slide overview expression from exact region at broad zoom', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        {
          detailMode: 'exact-region',
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

  it('keeps Visium HD 16um expression dense at overview zooms', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 120_000,
          visiumHdBinSizeMicrometers: 16,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'all-cells',
      bbox: slideBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 120_000,
      visiumHdBinSizeMicrometers: 16,
    })
  })

  it('keeps Visium HD 8um expression unsampled when zoomed in', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 75_000,
          viewState: { target: [150, -250, 0], zoom: 0 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 120_000,
          visiumHdBinSizeMicrometers: 8,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'exact',
      bbox: viewportBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 75_000,
      visiumHdBinSizeMicrometers: 8,
    })
  })

  it.each([16, 8, 2] as const)(
    'honours selected Visium HD %ium expression at maximum zoom-in',
    (selectedBinSize) => {
      expect(
        planGeneExpressionLod(
          detail({
            visibleCellCount: 75_000,
            viewState: { target: [150, -250, 0], zoom: 8 },
          }),
          {
            detailMode: 'auto',
            slideBbox,
            totalCellCount: 120_000,
            visiumHdBinSizeMicrometers: selectedBinSize,
          },
        ),
      ).toEqual({
        kind: 'request',
        mode: 'exact',
        bbox: viewportBbox,
        cellLimit: 120_000,
        sampleStride: 1,
        sourceCellCount: 75_000,
        visiumHdBinSizeMicrometers: selectedBinSize,
      })
    },
  )

  it('uses dense 16um LOD for Visium HD 8um expression when zoomed out', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -1.5 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 120_000,
          visiumHdBinSizeMicrometers: 8,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'all-cells',
      bbox: slideBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 120_000,
      visiumHdBinSizeMicrometers: 16,
    })
  })

  it('uses dense 8um then 16um LOD for Visium HD 2um expression zoom outs', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -1.5 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 120_000,
          visiumHdBinSizeMicrometers: 2,
        },
      ),
    ).toMatchObject({
      kind: 'request',
      mode: 'all-cells',
      bbox: slideBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 120_000,
      visiumHdBinSizeMicrometers: 8,
    })

    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -2.5 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 120_000,
          visiumHdBinSizeMicrometers: 2,
        },
      ),
    ).toMatchObject({
      kind: 'request',
      mode: 'all-cells',
      bbox: slideBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 120_000,
      visiumHdBinSizeMicrometers: 16,
    })
  })

  it('keys dense Visium HD LOD requests by requested bin size', () => {
    const lod8Plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 60_000,
        viewState: { target: [150, -250, 0], zoom: -1.5 },
      }),
      {
        detailMode: 'auto',
        slideBbox,
        totalCellCount: 120_000,
        visiumHdBinSizeMicrometers: 2,
      },
    )
    const lod16Plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 60_000,
        viewState: { target: [150, -250, 0], zoom: -1.5 },
      }),
      {
        detailMode: 'auto',
        slideBbox,
        totalCellCount: 120_000,
        visiumHdBinSizeMicrometers: 8,
      },
    )

    if (lod8Plan.kind !== 'request' || lod16Plan.kind !== 'request') {
      throw new Error('Expected expression request plans.')
    }

    expect(
      geneExpressionRequestKey(
        'https://example.test/visium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -1.5 },
        }),
        lod8Plan,
        ['Actb'],
      ),
    ).not.toBe(
      geneExpressionRequestKey(
        'https://example.test/visium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: -1.5 },
        }),
        lod16Plan,
        ['Actb'],
      ),
    )
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

  it('keeps all-cell request keys independent from pan and zoom buckets', () => {
    const plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 60_000,
        viewState: { target: [150, -250, 0], zoom: -3 },
      }),
      {
        detailMode: 'all-cells',
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
