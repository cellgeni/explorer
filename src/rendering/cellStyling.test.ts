import { describe, expect, it } from 'vitest'
import { type CellId, intToCellId } from '../data/cellid'
import {
  annotationMembership,
  createElementObservationColorizer,
  createObservationColorizer,
  styleOverviewCellsByObservation,
  type AnnotationColorStyle,
  type CellMetadataColorStyle,
} from './cellStyling'
import type { OverviewCellDatum } from './deckLayers'

const cellA = intToCellId(1, 1)
const cellB = intToCellId(1, 2)
const cells: readonly OverviewCellDatum[] = [
  {
    id: cellA,
    position: [0, 0, 0],
    radiusPixels: 3,
    fillColor: [215, 63, 124, 180],
    transcriptCount: 1,
    cellArea: 10,
  },
  {
    id: cellB,
    position: [10, 0, 0],
    radiusPixels: 3,
    fillColor: [215, 63, 124, 180],
    transcriptCount: 16,
    cellArea: 40,
  },
]

describe('cell observation styling', () => {
  it('colors overview cells by transcript count', () => {
    const styled = styleOverviewCellsByObservation(cells, 'transcript-count')

    expect(styled[0]?.fillColor).not.toEqual(styled[1]?.fillColor)
    expect(styled[1]?.fillColor[3]).toBeGreaterThan(styled[0]?.fillColor[3] ?? 0)
  })

  it('leaves cells to the gene expression styling in gene expression mode', () => {
    expect(styleOverviewCellsByObservation(cells, 'gene-expression')).toBe(cells)
  })

  it('colors overview cells by cell area', () => {
    const styled = styleOverviewCellsByObservation(cells, 'cell-area')

    expect(styled[0]?.fillColor).not.toEqual(styled[1]?.fillColor)
  })

  it('colors matching cells by loaded annotations', () => {
    const styled = styleOverviewCellsByObservation(cells, 'annotations', {
      annotations: [
        {
          id: 'annotation-1',
          cellIds: [cellB],
          color: '#1f77b4',
        },
      ],
    })

    // Cells in no shown class fade.
    expect(styled[0]?.fillColor).toEqual([72, 68, 58, 16])
    expect(styled[1]?.fillColor).toEqual([31, 119, 180, 230])
  })

  it('fades every cell when every class is hidden', () => {
    const styled = styleOverviewCellsByObservation(cells, 'annotations', {
      annotations: [],
    })

    expect(styled.map((cell) => cell.fillColor)).toEqual(
      cells.map(() => [72, 68, 58, 16]),
    )
  })

  it('keeps the first matching annotation color when skipping non-rendered cells', () => {
    const styled = styleOverviewCellsByObservation(
      [cells[1] as OverviewCellDatum],
      'annotations',
      {
        annotations: [
          {
            id: 'annotation-offscreen',
            cellIds: [cellA],
            color: '#ff0000',
          },
          {
            id: 'annotation-first-match',
            cellIds: [cellB],
            color: '#1f77b4',
          },
          {
            id: 'annotation-later-match',
            cellIds: [cellB],
            color: '#2ca02c',
          },
        ],
      },
    )

    expect(styled[0]?.fillColor).toEqual([31, 119, 180, 230])
  })

  it('colors matching cells by continuous metadata values', () => {
    const styled = styleOverviewCellsByObservation(cells, 'metadata', {
      metadataTrack: {
        id: 'metadata:confidence',
        values: [{ cellId: cellB, value: 0.75 }],
        min: 0,
        max: 1,
      },
    })

    expect(styled[0]?.fillColor).toEqual([72, 68, 58, 44])
    expect(styled[1]?.fillColor).not.toEqual(cells[1]?.fillColor)
  })

  // AnnData stores a missing obs value as NaN (EXP-046).
  it('draws a NaN or infinite metadata value as no value', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const styled = styleOverviewCellsByObservation(cells, 'metadata', {
        metadataTrack: {
          id: 'metadata:doublet-score',
          values: [
            { cellId: cellA, value },
            { cellId: cellB, value: 0.75 },
          ],
          min: 0,
          max: 1,
        },
      })

      expect(styled[0]?.fillColor).toEqual([72, 68, 58, 44])
    }
  })
})

describe('element observation styling', () => {
  it('colours bins by the annotation listing their barcode', () => {
    const colorize = createElementObservationColorizer('annotations', {
      annotations: [{ id: 'cluster-1', cellIds: [cellA], color: '#ff0000' }],
    })

    expect(colorize?.({ id: cellA })).toEqual([255, 0, 0, 230])
    // A bin in no shown class fades, as a cell does.
    expect(colorize?.({ id: cellB })[3]).toBeLessThan(230)
  })

  it('leaves bins unchanged in modes only cells have values for', () => {
    for (const mode of ['transcript-count', 'cell-area', 'gene-expression'] as const) {
      expect(createElementObservationColorizer(mode)).toBeNull()
    }

    expect(
      createElementObservationColorizer('annotations', { annotations: [] }),
    ).toBeNull()
  })

  it('colours bins by a metadata track', () => {
    const colorize = createElementObservationColorizer('metadata', {
      metadataTrack: {
        id: 'score',
        values: [
          { cellId: cellA, value: 0 },
          { cellId: cellB, value: 10 },
        ],
        min: 0,
        max: 10,
      },
    })

    expect(colorize?.({ id: cellA })).not.toEqual(colorize?.({ id: cellB }))
  })
})

describe('annotation membership', () => {
  const cellC = intToCellId(1, 3)

  it('names every class listing a cell, in class order, once each', () => {
    const membership = annotationMembership([
      { id: 'a', label: 'A', cellIds: [cellA, cellB, cellA], color: '#ff0000' },
      { id: 'b', cellIds: [cellB], color: '#00ff00' },
      { id: 'c', label: 'C', cellIds: [cellB, cellB], color: '#0000ff' },
    ])

    expect(membership.labelsOf(cellA)).toEqual(['A'])
    expect(membership.labelsOf(cellB)).toEqual(['A', 'b', 'C'])
    expect(membership.labelsOf(cellC)).toBeUndefined()
    expect(membership.firstClassOf(cellB)).toBe(0)
  })

  it('walks the classes once, at the first lookup, for cells, bins and labels', () => {
    const counted = countedWalks<CellId>([cellA, cellB])
    const annotations: readonly AnnotationColorStyle[] = [
      { id: 'a', label: 'A', cellIds: counted.items, color: '#ff0000' },
    ]
    const colorizeCells = createObservationColorizer(cells, 'annotations', {
      annotations,
    })
    const colorizeBins = createElementObservationColorizer('annotations', {
      annotations,
    })
    expect(counted.passes()).toBe(0)

    expect(colorizeCells?.(cells[0]!)).toEqual([255, 0, 0, 230])
    expect(colorizeBins?.({ id: cellB })).toEqual([255, 0, 0, 230])
    expect(annotationMembership(annotations).labelsOf(cellA)).toEqual(['A'])
    expect(counted.passes()).toBe(1)

    // A new list of classes is walked again.
    createObservationColorizer(cells, 'annotations', {
      annotations: [...annotations],
    })?.(cells[0]!)
    expect(counted.passes()).toBe(2)
  })

  it('reads a metadata track once for the cells and the bins', () => {
    const counted = countedWalks([
      { cellId: cellA, value: 0 },
      { cellId: cellB, value: 10 },
    ])
    const metadataTrack: CellMetadataColorStyle = {
      id: 'score',
      values: counted.items,
      min: 0,
      max: 10,
    }

    const colorizeCells = createObservationColorizer(cells, 'metadata', { metadataTrack })
    const colorizeBins = createElementObservationColorizer('metadata', { metadataTrack })

    expect(colorizeCells?.(cells[1]!)).toEqual(colorizeBins?.({ id: cellB }))
    expect(counted.passes()).toBe(1)
  })
})

// A list that counts how often it is walked.
function countedWalks<T>(items: readonly T[]): {
  readonly items: readonly T[]
  readonly passes: () => number
} {
  let passes = 0
  const counted = new Proxy([...items], {
    get(target, property, receiver) {
      if (property === Symbol.iterator) passes += 1
      return Reflect.get(target, property, receiver) as unknown
    },
  })
  return { items: counted, passes: () => passes }
}
