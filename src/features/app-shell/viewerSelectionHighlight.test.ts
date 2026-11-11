import { describe, expect, it } from 'vitest'
import type { CellBoundaryDatum, OverviewCellDatum } from '../../rendering/deckLayers'
import { viewerSelectionHighlight } from './viewerSelectionHighlight'

const cell: OverviewCellDatum = {
  id: 'cell-1',
  position: [5, -6, 0],
  radiusPixels: 3,
  radiusMicrometers: 4,
  fillColor: [0, 0, 0, 255],
}
const boundary: CellBoundaryDatum = {
  id: 'cell-1',
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  fillColor: [0, 0, 0, 0],
  lineColor: [0, 0, 0, 0],
}
const none = { selectedCell: null, selectedBoundaryCell: null, selectedGridCell: null }

describe('viewerSelectionHighlight', () => {
  it('rings a selected point', () => {
    expect(viewerSelectionHighlight({ ...none, selectedCell: cell })).toEqual({
      kind: 'point',
      id: 'cell-1',
      position: [5, -6, 0],
      radius: 4,
    })
  })

  it('outlines a selected point whose boundary is drawn', () => {
    expect(
      viewerSelectionHighlight({
        ...none,
        selectedCell: cell,
        drawnBoundaries: new Map([['cell-1', boundary]]),
      }),
    ).toEqual({ kind: 'polygon', id: 'cell-1', polygon: boundary.polygon })
  })

  it('outlines a selected boundary, and marks nothing without a selection', () => {
    expect(
      viewerSelectionHighlight({ ...none, selectedBoundaryCell: boundary }),
    ).toMatchObject({
      kind: 'polygon',
    })
    expect(viewerSelectionHighlight(none)).toBeNull()
  })
})
