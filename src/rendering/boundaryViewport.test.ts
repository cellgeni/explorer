import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import { boundaryViewportKey, shouldLoadBoundaryPolygons } from './boundaryViewport'
import type { BoundaryViewportCandidate } from './boundaryViewport'

const candidate: BoundaryViewportCandidate = {
  bbox: {
    minX: micrometers(0),
    maxX: micrometers(100),
    minY: micrometers(0),
    maxY: micrometers(100),
  },
  visibleCellCount: 600,
  viewState: {
    target: [0, 0, 0],
    zoom: -4,
    minZoom: -10,
    maxZoom: 10,
  },
}

describe('boundary viewport trigger', () => {
  it('loads polygons for sparse or close viewport candidates', () => {
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 500 })).toBe(true)
    expect(
      shouldLoadBoundaryPolygons({
        ...candidate,
        viewState: { ...candidate.viewState, zoom: -1 },
      }),
    ).toBe(true)
  })

  it('skips polygons for dense overview candidates and empty viewports', () => {
    expect(shouldLoadBoundaryPolygons(candidate)).toBe(false)
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 0 })).toBe(false)
  })

  it('quantizes bbox values into a stable request key', () => {
    expect(
      boundaryViewportKey('https://example.test/xenium/', {
        minX: micrometers(24),
        maxX: micrometers(126),
        minY: micrometers(74),
        maxY: micrometers(176),
      }),
    ).toBe('https://example.test/xenium:0:150:50:200')
  })
})
