import { describe, expect, it } from 'vitest'
import { micrometers } from './coords'
import {
  GENE_EXPRESSION_AUTO_ALL_CELLS_LIMIT,
  GENE_EXPRESSION_EXACT_CELL_LIMIT,
  geneExpressionReadCovers,
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
      // A quarter of the view's width and height on each side.
      bbox: {
        minX: micrometers(50),
        maxX: micrometers(350),
        minY: micrometers(150),
        maxY: micrometers(450),
      },
      cellLimit: 60_000,
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
      cellLimit: 120_000,
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
      cellLimit: 60_000,
      sampleStride: 4,
      sourceCellCount: 60_000,
    })
  })

  it.each([-3, 0, 4])(
    'loads every cell in auto mode up to the auto limit (zoom %d)',
    (zoom) => {
      expect(
        planGeneExpressionLod(
          detail({
            visibleCellCount: 60_000,
            viewState: { target: [150, -250, 0], zoom },
          }),
          {
            detailMode: 'auto',
            slideBbox,
            totalCellCount: GENE_EXPRESSION_AUTO_ALL_CELLS_LIMIT,
          },
        ),
      ).toEqual({
        kind: 'request',
        mode: 'all-cells',
        bbox: slideBbox,
        cellLimit: GENE_EXPRESSION_AUTO_ALL_CELLS_LIMIT,
        sampleStride: 1,
        sourceCellCount: GENE_EXPRESSION_AUTO_ALL_CELLS_LIMIT,
      })
    },
  )

  it('uses a stable whole-slide sample for low overview zooms above the auto limit', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 600_000,
          viewState: { target: [150, -250, 0], zoom: -3 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 600_000,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'overview-sampled',
      bbox: slideBbox,
      cellLimit: 600_000,
      sampleStride: 40,
      sourceCellCount: 600_000,
    })
  })

  it('uses exact visible expression in auto mode above the auto limit', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: GENE_EXPRESSION_EXACT_CELL_LIMIT,
          viewState: { target: [150, -250, 0], zoom: 0 },
        }),
        {
          detailMode: 'auto',
          slideBbox,
          totalCellCount: 600_000,
        },
      ),
    ).toEqual({
      kind: 'request',
      mode: 'exact',
      // A view at the exact limit gets no margin.
      bbox: viewportBbox,
      cellLimit: 600_000,
      sampleStride: 1,
      sourceCellCount: GENE_EXPRESSION_EXACT_CELL_LIMIT,
    })
  })

  it('narrows the exact margin as the view fills up towards the exact limit', () => {
    const plan = planGeneExpressionLod(
      // 50,000 / 1.44: a margin of a tenth keeps the box near 50,000 cells.
      detail({ visibleCellCount: 34_722 }),
      { detailMode: 'auto', slideBbox, totalCellCount: 600_000 },
    )

    if (plan.kind !== 'request') {
      throw new Error('Expected an expression request plan.')
    }

    expect(plan.mode).toBe('exact')
    expect(plan.bbox.minX).toBeCloseTo(80, 2)
    expect(plan.bbox.maxX).toBeCloseTo(320, 2)
    expect(plan.bbox.minY).toBeCloseTo(180, 2)
    expect(plan.bbox.maxY).toBeCloseTo(420, 2)
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

  it('uses dense 16um LOD for Visium HD 2um expression until close zoom', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: 2.9 },
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
      mode: 'exact',
      bbox: viewportBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 60_000,
      visiumHdBinSizeMicrometers: 16,
    })
  })

  it('reads the bins the map draws zoomed out in every Visium HD detail mode', () => {
    for (const detailMode of ['exact-region', 'all-cells'] as const) {
      for (const [selected, zoom, read] of [
        [2, 1.5, 16],
        [2, 3, 2],
        [8, -2, 16],
        [8, 0, 8],
      ] as const) {
        expect(
          planGeneExpressionLod(
            detail({
              visibleCellCount: 20_000,
              viewState: { target: [150, -250, 0], zoom },
            }),
            {
              detailMode,
              slideBbox,
              totalCellCount: 120_000,
              visiumHdBinSizeMicrometers: selected,
            },
          ),
        ).toMatchObject({ mode: detailMode, visiumHdBinSizeMicrometers: read })
      }
    }
  })

  it('uses exact 2um Visium HD expression at close zoom', () => {
    expect(
      planGeneExpressionLod(
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: 3 },
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
      mode: 'exact',
      bbox: viewportBbox,
      cellLimit: 120_000,
      sampleStride: 1,
      sourceCellCount: 60_000,
      visiumHdBinSizeMicrometers: 2,
    })
  })

  it('keys dense Visium HD LOD requests by requested bin size', () => {
    const lod2Plan = planGeneExpressionLod(
      detail({
        visibleCellCount: 60_000,
        viewState: { target: [150, -250, 0], zoom: 3 },
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
        viewState: { target: [150, -250, 0], zoom: 3 },
      }),
      {
        detailMode: 'auto',
        slideBbox,
        totalCellCount: 120_000,
        visiumHdBinSizeMicrometers: 8,
      },
    )

    if (lod2Plan.kind !== 'request' || lod16Plan.kind !== 'request') {
      throw new Error('Expected expression request plans.')
    }

    expect(
      geneExpressionRequestKey(
        'https://example.test/visium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: 3 },
        }),
        lod2Plan,
        ['Actb'],
      ),
    ).not.toBe(
      geneExpressionRequestKey(
        'https://example.test/visium/',
        detail({
          visibleCellCount: 60_000,
          viewState: { target: [150, -250, 0], zoom: 3 },
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

  it('keys exact viewport reads by zoom, not by position, and covers views inside the box read', () => {
    const options = { detailMode: 'auto', slideBbox, totalCellCount: 600_000 } as const
    const first = detail({ visibleCellCount: 2_000 })
    const plan = planGeneExpressionLod(first, options)

    if (plan.kind !== 'request') {
      throw new Error('Expected an expression request plan.')
    }

    const key = geneExpressionRequestKey('https://example.test/xenium/', first, plan, [
      'Actb',
    ])
    const read = { key, bbox: plan.bbox }
    const shifted = (dx: number): BBox => ({
      minX: micrometers(viewportBbox.minX + dx),
      maxX: micrometers(viewportBbox.maxX + dx),
      minY: viewportBbox.minY,
      maxY: viewportBbox.maxY,
    })
    const pannedDetail = (dx: number) =>
      detail({
        bbox: shifted(dx),
        visibleCellCount: 2_000,
        viewState: { target: [150 + dx, -250, 0], zoom: 0 },
      })
    const keyFor = (next: GeneExpressionViewportDetail) => {
      const nextPlan = planGeneExpressionLod(next, options)

      if (nextPlan.kind !== 'request') {
        throw new Error('Expected an expression request plan.')
      }

      return {
        key: geneExpressionRequestKey('https://example.test/xenium/', next, nextPlan, [
          'Actb',
        ]),
        plan: nextPlan,
      }
    }

    // The margin is 50 units on each side of a 200-unit view.
    const inside = keyFor(pannedDetail(40))
    const outside = keyFor(pannedDetail(60))

    expect(inside.key).toBe(key)
    expect(outside.key).toBe(key)
    expect(geneExpressionReadCovers(read, inside.key, inside.plan, shifted(40))).toBe(
      true,
    )
    expect(geneExpressionReadCovers(read, outside.key, outside.plan, shifted(60))).toBe(
      false,
    )
    expect(
      keyFor(
        detail({
          visibleCellCount: 2_000,
          viewState: { target: [150, -250, 0], zoom: 0.5 },
        }),
      ).key,
    ).not.toBe(key)
  })

  it('covers any view with a whole-slide read under the same key', () => {
    const overview = detail({
      visibleCellCount: 60_000,
      viewState: { target: [150, -250, 0], zoom: -3 },
    })
    const plan = planGeneExpressionLod(overview, {
      detailMode: 'auto',
      slideBbox,
      totalCellCount: 600_000,
    })

    if (plan.kind !== 'request') {
      throw new Error('Expected an expression request plan.')
    }

    const key = geneExpressionRequestKey('https://example.test/xenium/', overview, plan, [
      'Actb',
    ])
    const beyondSlide: BBox = {
      minX: micrometers(-5_000),
      maxX: micrometers(15_000),
      minY: micrometers(-5_000),
      maxY: micrometers(15_000),
    }

    expect(
      geneExpressionReadCovers({ key, bbox: plan.bbox }, key, plan, beyondSlide),
    ).toBe(true)
    expect(geneExpressionReadCovers(null, key, plan, beyondSlide)).toBe(false)
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
        totalCellCount: 600_000,
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
      cellLimit: 600_000,
      sampleStride: 5,
      sourceCellCount: 75_000,
    })
  })
})
