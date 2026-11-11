import { describe, expect, it } from 'vitest'
import { selectionOverlayModel } from './viewerSelectionModel'

const viewport = { width: 200, height: 100 }
const viewState = {
  target: [10, -20, 0] as [number, number, number],
  zoom: 1,
  minZoom: -10,
  maxZoom: 10,
}

describe('selectionOverlayModel', () => {
  it('rings a point where the map draws it, a little larger than the point', () => {
    expect(
      selectionOverlayModel(
        { kind: 'point', id: 'c1', position: [10, -20, 0], radius: 5 },
        viewState,
        viewport,
      ),
    ).toEqual({ kind: 'ring', cx: 100, cy: 50, r: 13 })
    // One world unit right and up is two pixels right and up at zoom 1.
    expect(
      selectionOverlayModel(
        { kind: 'point', id: 'c1', position: [11, -19, 0], radius: 0 },
        viewState,
        viewport,
      ),
    ).toEqual({ kind: 'ring', cx: 102, cy: 48, r: 7 })
  })

  it('outlines a boundary or bin polygon', () => {
    expect(
      selectionOverlayModel(
        {
          kind: 'polygon',
          id: 'b1',
          polygon: [
            [10, -20],
            [12, -20],
            [12, -22],
          ],
        },
        viewState,
        viewport,
      ),
    ).toEqual({ kind: 'outline', d: 'M100.0 50.0 L104.0 50.0 L104.0 54.0 Z' })
  })

  it('draws nothing without a selection or a viewport', () => {
    expect(selectionOverlayModel(null, viewState, viewport)).toBeNull()
    expect(
      selectionOverlayModel(
        { kind: 'point', id: 'c1', position: [0, 0, 0], radius: 1 },
        viewState,
        { width: 0, height: 0 },
      ),
    ).toBeNull()
  })
})
