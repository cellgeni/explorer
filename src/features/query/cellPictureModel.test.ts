import { describe, expect, it } from 'vitest'
import { micrometers, type DataPoint } from '../../data/coords'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import {
  cellPictureOutline,
  cellPictureShape,
  cellPictureViewState,
  defaultCellPictureField,
} from './cellPictureModel'

// A cell at (100, 200) µm in the dataset's frame; overview positions keep y
// negated, as deck.gl draws them.
function cell(overrides: Partial<OverviewCellDatum> = {}): OverviewCellDatum {
  return {
    id: 'c1',
    position: [100, -200, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
    ...overrides,
  }
}

const point = (x: number, y: number): DataPoint => ({
  x: micrometers(x),
  y: micrometers(y),
})

describe('cell pictures (plan 23-D10)', () => {
  it('starts at 40 µm, or wide enough for a whole spot', () => {
    expect(defaultCellPictureField(cell())).toBe(40)
    expect(defaultCellPictureField(undefined)).toBe(40)
    // A 55 µm Visium spot, with a margin, needs 68.75 µm.
    expect(defaultCellPictureField(cell({ radiusMicrometers: 27.5 }))).toBe(80)
    // A cell's radius from its area never narrows it.
    expect(defaultCellPictureField(cell({ radiusMicrometers: 4 }))).toBe(40)
  })

  it('centres the view on the cell at the chosen field', () => {
    // 64 px across 40 µm is 1.6 px/µm.
    expect(cellPictureViewState(cell(), 40)).toEqual({
      target: [100, -200, 0],
      zoom: Math.log2(1.6),
      minZoom: Math.log2(1.6),
      maxZoom: Math.log2(1.6),
    })
  })

  it("draws a dataset's outline in the picture's pixels, y down", () => {
    const outline = cellPictureOutline({
      id: 'c1',
      geometry: {
        kind: 'polygon',
        rings: [[point(90, 190), point(110, 190), point(110, 210)]],
      },
    })

    // ±10 µm is ±16 px at 40 µm across, about the centre (32, 32).
    expect(cellPictureShape(cell(), outline, 40)).toEqual({
      kind: 'path',
      d: 'M16 16L48 16L48 48Z',
    })
  })

  it('draws circles, squares, and nothing for grid cells', () => {
    expect(
      cellPictureShape(
        cell(),
        cellPictureOutline({
          id: 'c1',
          geometry: {
            kind: 'circle',
            center: point(105, 200),
            diameter: micrometers(10),
          },
        }),
        40,
      ),
    ).toEqual({ kind: 'circle', cx: 40, cy: 32, r: 8, fallback: false })
    expect(
      cellPictureOutline({
        id: 'c1',
        geometry: { kind: 'square', origin: point(0, 0), size: micrometers(2) },
      }),
    ).toEqual({
      kind: 'polygon',
      rings: [[point(0, 0), point(2, 0), point(2, 2), point(0, 2)]],
    })
    expect(
      cellPictureOutline({
        id: 'c1',
        geometry: { kind: 'grid-cell', gridId: 'g', row: 0, col: 0 },
      }),
    ).toBeNull()
  })

  it("draws a Visium spot's circle without an outline", () => {
    expect(cellPictureShape(cell({ radiusMicrometers: 27.5 }), null, 80)).toEqual({
      kind: 'circle',
      cx: 32,
      cy: 32,
      r: 22,
      fallback: false,
    })
  })

  it('rings a cell without an outline, as large as its area where it has one', () => {
    // 100π µm² is 20 µm across: a radius of 10 µm, 16 px at 40 µm across.
    expect(cellPictureShape(cell({ cellArea: 100 * Math.PI }), null, 40)).toMatchObject({
      kind: 'circle',
      r: 16,
      fallback: true,
    })
    expect(cellPictureShape(cell(), null, 40)).toMatchObject({
      kind: 'circle',
      r: 6,
      fallback: true,
    })
  })
})
