import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { GridCellDatum } from '../../rendering/deckLayers'
import {
  gridCellColumnsFixture,
  squareGridBasis,
} from '../../test/gridCellColumnsFixture'
import {
  IDLE_VISIUM_HD_ROI_STATE,
  gridCellDatumCenter,
  gridCellDatumDeckCenter,
  selectVisiumHdGridCellsInRoi,
  summarizeVisiumHdRoiBins,
  visiumHdRoiReady,
  visiumHdRoiBinsToCsv,
  visiumHdRoiStatusCopy,
} from './visiumHdRoiModel'

describe('visiumHdRoiModel', () => {
  it('constructs Visium HD ROI transitions', () => {
    const selection: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        maxX: micrometers(50),
        minY: micrometers(0),
        maxY: micrometers(50),
      },
    }
    const bins = [
      {
        barcode: 'BC-1',
        gridId: 'grid-16um',
        row: 1,
        col: 2,
        center: { x: micrometers(5), y: micrometers(5) },
        binSizeMicrometers: 16,
      },
    ]

    expect(IDLE_VISIUM_HD_ROI_STATE).toEqual({ status: 'idle' })
    expect(
      visiumHdRoiReady({
        url: 'https://example.test/visium',
        binSizeMicrometers: 16,
        bbox: selection.bbox,
        selection,
        bins,
        hitBinLimit: true,
      }),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/visium',
      binSizeMicrometers: 16,
      bbox: selection.bbox,
      selection,
      bins,
      hitBinLimit: true,
    })
    expect(
      visiumHdRoiReady({
        url: 'https://example.test/visium',
        bbox: selection.bbox,
        selection,
        bins: [],
        hitBinLimit: false,
      }),
    ).not.toHaveProperty('binSizeMicrometers')
  })

  it('selects Visium HD grid cells inside a box ROI by data-space center', () => {
    const selection: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        maxX: micrometers(20),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
    }

    const result = selectVisiumHdGridCellsInRoi(
      roiBins([
        { id: 'BC-1', row: 0, col: 0 },
        { id: 'BC-2', row: 2, col: 2 },
      ]),
      selection,
    )

    expect(result.hitBinLimit).toBe(false)
    expect(result.bins).toEqual([
      {
        barcode: 'BC-1',
        gridId: 'grid-16um',
        row: 0,
        col: 0,
        center: { x: micrometers(5), y: micrometers(5) },
        binSizeMicrometers: 16,
        inTissue: true,
        fullresRow: 128,
        fullresCol: 256,
      },
    ])
  })

  it('counts every bin in the selection past the limit it keeps', () => {
    const result = selectVisiumHdGridCellsInRoi(
      roiBins([
        { id: 'BC-1', row: 0, col: 0 },
        { id: 'BC-2', row: 0, col: 1 },
        { id: 'BC-3', row: 1, col: 0 },
      ]),
      {
        kind: 'box',
        bbox: {
          minX: micrometers(0),
          maxX: micrometers(100),
          minY: micrometers(0),
          maxY: micrometers(100),
        },
      },
      2,
    )

    expect(result).toMatchObject({ selectedCount: 3, hitBinLimit: true })
    expect(result.bins).toHaveLength(2)
  })

  it('styles only the bins it selects, for their expression scores', () => {
    const styled: string[] = []
    const result = selectVisiumHdGridCellsInRoi(
      roiBins([
        { id: 'inside', row: 0, col: 0 },
        { id: 'outside', row: 4, col: 4 },
      ]),
      {
        kind: 'box',
        bbox: {
          minX: micrometers(0),
          maxX: micrometers(20),
          minY: micrometers(0),
          maxY: micrometers(20),
        },
      },
      undefined,
      (cell) => {
        styled.push(cell.id)
        return { ...cell, expressionCount: 4, expressionGenes: ['Actb'] }
      },
    )

    expect(styled).toEqual(['inside'])
    expect(result.bins).toEqual([
      expect.objectContaining({
        barcode: 'inside',
        expressionCount: 4,
        expressionGenes: ['Actb'],
      }),
    ])
  })

  it('uses exact lasso geometry after the bounding-box prefilter', () => {
    const selection: RoiSelection = {
      kind: 'lasso',
      bbox: {
        minX: micrometers(0),
        maxX: micrometers(30),
        minY: micrometers(0),
        maxY: micrometers(30),
      },
      points: [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(20), y: micrometers(0) },
        { x: micrometers(0), y: micrometers(20) },
      ],
    }

    const result = selectVisiumHdGridCellsInRoi(
      roiBins(
        [
          { id: 'inside', row: 1, col: 1 },
          { id: 'outside-lasso', row: 4, col: 4 },
        ],
        4,
      ),
      selection,
    )

    expect(result.bins.map((bin) => bin.barcode)).toEqual(['inside'])
  })

  it('tracks export limits without stopping the selected-bin count check', () => {
    const selection: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        maxX: micrometers(50),
        minY: micrometers(0),
        maxY: micrometers(50),
      },
    }

    const result = selectVisiumHdGridCellsInRoi(
      roiBins([
        { id: 'BC-1', row: 0, col: 0 },
        { id: 'BC-2', row: 0, col: 1 },
        { id: 'BC-3', row: 0, col: 2 },
      ]),
      selection,
      2,
    )

    expect(result.bins.map((bin) => bin.barcode)).toEqual(['BC-1', 'BC-2'])
    expect(result.hitBinLimit).toBe(true)
  })

  it('summarizes selected bins and formats status copy', () => {
    const { bins } = selectVisiumHdGridCellsInRoi(
      roiBins([
        { id: 'BC-1', row: 0, col: 0 },
        { id: 'BC-2', row: 0, col: 1, inTissue: false },
      ]),
      {
        kind: 'box',
        bbox: {
          minX: micrometers(0),
          maxX: micrometers(50),
          minY: micrometers(0),
          maxY: micrometers(50),
        },
      },
    )

    expect(summarizeVisiumHdRoiBins(bins)).toEqual({
      binCount: 2,
      binSizeMicrometers: 16,
      inTissueCount: 1,
    })
    expect(
      visiumHdRoiStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/visium/',
          bbox: {
            minX: micrometers(0),
            maxX: micrometers(50),
            minY: micrometers(0),
            maxY: micrometers(50),
          },
          selection: {
            kind: 'box',
            bbox: {
              minX: micrometers(0),
              maxX: micrometers(50),
              minY: micrometers(0),
              maxY: micrometers(50),
            },
          },
          bins,
          hitBinLimit: false,
        },
        'idle',
      ),
    ).toBe('2 bins')
    expect(visiumHdRoiStatusCopy({ status: 'idle' }, 'lasso')).toBe('Drawing lasso')
  })

  it('serializes selected bin barcodes and metadata as escaped CSV', () => {
    const csv = visiumHdRoiBinsToCsv([
      {
        barcode: 'BC,"1"',
        gridId: 'grid-16um',
        row: 4,
        col: 7,
        center: { x: micrometers(10), y: micrometers(20) },
        binSizeMicrometers: 16,
        inTissue: true,
        fullresRow: 128,
        fullresCol: 256,
        expressionCount: 12,
        expressionGenes: ['Actb', 'Gapdh'],
      },
    ])

    expect(csv).toBe(
      [
        'barcode,bin_size_um,array_row,array_col,fullres_row,fullres_col,in_tissue,x_centroid,y_centroid,expression_count,expression_genes',
        '"BC,""1""",16,4,7,128,256,true,10,20,12,Actb;Gapdh',
      ].join('\n'),
    )
  })

  it('exposes data-space and deck-space grid-cell centers', () => {
    const cell = gridCellDatum('BC-1', [
      [4, -15, 0],
      [16, -15, 0],
      [16, -25, 0],
      [4, -25, 0],
    ])

    expect(gridCellDatumCenter(cell)).toEqual({
      x: micrometers(10),
      y: micrometers(20),
    })
    expect(gridCellDatumDeckCenter(cell)).toEqual([10, -20, 0])
  })
})

// 16 µm bins drawn as `size` µm squares from the origin.
function roiBins(
  bins: readonly {
    readonly id: string
    readonly row: number
    readonly col: number
    readonly inTissue?: boolean
  }[],
  size = 10,
) {
  return gridCellColumnsFixture(
    bins.map((bin) => ({
      inTissue: true,
      fullresRow: 128,
      fullresCol: 256,
      ...bin,
    })),
    { gridId: 'grid-16um', binSizeMicrometers: 16, basis: squareGridBasis(size) },
  )
}

function gridCellDatum(
  id: string,
  polygon: GridCellDatum['polygon'] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, -10, 0],
    [0, -10, 0],
  ],
  values: Partial<GridCellDatum> = {},
): GridCellDatum {
  return {
    id,
    gridId: 'grid-16um',
    row: 1,
    col: 2,
    binSizeMicrometers: 16,
    inTissue: true,
    fullresRow: 128,
    fullresCol: 256,
    polygon,
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
    ...values,
  }
}
