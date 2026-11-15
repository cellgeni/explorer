import { describe, expect, it } from 'vitest'
import {
  cellPointFilterValues,
  cellPointLayerColors,
  cellPointRanks,
  cellPointSampleFraction,
  createCellPointStyler,
  normalizeCellPointScale,
  packCellPointColors,
} from './cellPointStyle'
import {
  createObservationColorizer,
  styleOverviewCellsByObservation,
} from './cellStyling'
import {
  cellPointOutlineColor,
  colorWithFillOpacity,
  colorWithOpacity,
} from './deckLayerColors'
import {
  createGeneExpressionElementStyleIndex,
  styleCellsByGeneExpression,
} from './geneExpressionRenderer'
import type { CellId } from '../data/cellid'
import type { ObservationColorMode } from './cellStyling'
import type { OverviewCellDatum } from './deckLayerTypes'

const cells: OverviewCellDatum[] = [0, 1, 2, 3].map((index) => ({
  id: `cell-${index}`,
  position: [index * 300, -index * 100, 0],
  radiusPixels: 3,
  fillColor: [10 * index, 20, 30, 150 + index],
  transcriptCount: 5 + index * 7,
  cellArea: 30 + index * 11,
}))
const expressionElements: OverviewCellDatum[] = [
  {
    id: 'cell-1',
    position: [300, -100, 0],
    radiusPixels: 4,
    fillColor: [240, 128, 120, 220],
    expressionCount: 7,
    expressionGenes: ['Actb'],
  },
]
const observationOptions = {
  annotations: [{ id: 'a', cellIds: ['cell-2' as CellId], color: '#1f9b8f' }],
  metadataTrack: {
    id: 'score',
    values: [{ cellId: 'cell-3' as CellId, value: 0.8 }],
    min: 0,
    max: 1,
  },
}

describe('cell point styling', () => {
  it.each<[ObservationColorMode, boolean]>([
    ['transcript-count', false],
    ['cell-area', false],
    ['annotations', false],
    ['metadata', true],
    ['cell-area', true],
  ])('matches the array stylers in %s mode (expression %s)', (mode, withExpression) => {
    const expressionIndex = createGeneExpressionElementStyleIndex(
      withExpression ? expressionElements : [],
    )
    const observed =
      mode === 'transcript-count'
        ? cells
        : styleOverviewCellsByObservation(cells, mode, observationOptions)
    const expected = styleCellsByGeneExpression(observed, expressionIndex, {
      styleUnmatchedCells: withExpression,
    })
    const styler = createCellPointStyler({
      observationColor:
        mode === 'transcript-count'
          ? null
          : createObservationColorizer(cells, mode, observationOptions),
      expressionIndex,
      styleUnmatchedCells: withExpression,
    })

    expect(cells.map((cell) => styler.styledCell(cell))).toEqual(expected)
    expect(cells.map((cell) => styler.fillColor(cell))).toEqual(
      expected.map((cell) => cell.fillColor),
    )
  })

  it('packs colours with the point layer opacity rules', () => {
    const styler = createCellPointStyler({
      observationColor: null,
      expressionIndex: createGeneExpressionElementStyleIndex([]),
      styleUnmatchedCells: false,
    })
    const { fill, line } = cellPointLayerColors(
      packCellPointColors(cells, styler),
      0.4,
      0.7,
    )

    cells.forEach((cell, index) => {
      expect(Array.from(fill.slice(index * 4, index * 4 + 4))).toEqual(
        colorWithFillOpacity(cell.fillColor, 0.4),
      )
      expect(Array.from(line.slice(index * 4, index * 4 + 4))).toEqual(
        colorWithOpacity(cellPointOutlineColor(cell.fillColor), 0.7),
      )
    })
  })

  it('fades cells in no shown class, in both colour paths', () => {
    const styler = createCellPointStyler({
      observationColor: createObservationColorizer(
        cells,
        'annotations',
        observationOptions,
      ),
      expressionIndex: createGeneExpressionElementStyleIndex([]),
      styleUnmatchedCells: false,
    })
    const { fill, line } = cellPointLayerColors(
      packCellPointColors(cells, styler),
      0.5,
      1,
    )
    const alphas = (colors: Uint8Array) =>
      [0, 1, 2, 3].map((index) => colors[index * 4 + 3])

    // cell-2 is in the shown class; the others fade.
    expect(alphas(fill)).toEqual([19, 19, 128, 19])
    expect(alphas(line)).toEqual([24, 24, 230, 24])
    cells.forEach((cell, index) => {
      const color = styler.fillColor(cell)
      expect(Array.from(fill.slice(index * 4, index * 4 + 4))).toEqual(
        colorWithFillOpacity(color, 0.5),
      )
      expect(Array.from(line.slice(index * 4, index * 4 + 4))).toEqual(
        colorWithOpacity(cellPointOutlineColor(color), 1),
      )
    })
  })

  it('samples nested, evenly sized subsets by rank', () => {
    const ranks = cellPointRanks(10_000)
    const below = (fraction: number) =>
      Array.from(ranks).filter((rank) => rank <= fraction).length

    expect(below(0.25)).toBeGreaterThan(2_450)
    expect(below(0.25)).toBeLessThan(2_550)
    expect(
      Array.from(ranks.slice(0, 1_000)).filter((rank) => rank <= 0.1).length,
    ).toBeGreaterThan(90)
    expect(cellPointSampleFraction(250, 1_000)).toBe(0.25)
    expect(cellPointSampleFraction(250, 100)).toBe(1)
    expect(cellPointSampleFraction(null, 1_000)).toBe(1)
  })

  it('flags outlined cells in the filter values', () => {
    const values = cellPointFilterValues(cellPointRanks(3), [2])

    expect(Array.from(values.filter((_value, index) => index % 2 === 1))).toEqual([
      0, 0, 1,
    ])
  })
})

describe('normalizeCellPointScale', () => {
  it('snaps scales to the nearest slider step on a log scale', () => {
    expect(normalizeCellPointScale(1)).toBe(1)
    expect(normalizeCellPointScale(10)).toBe(12)
    expect(normalizeCellPointScale(9)).toBe(8)
    expect(normalizeCellPointScale(0.1)).toBe(0.5)
    expect(normalizeCellPointScale(500)).toBe(32)
  })

  it('falls back to 1x for scales that are not positive numbers', () => {
    expect(normalizeCellPointScale(Number.NaN)).toBe(1)
    expect(normalizeCellPointScale(0)).toBe(1)
    expect(normalizeCellPointScale(-2)).toBe(1)
  })
})
