import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  boundaryRequestCovers,
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
  paddedBoundaryBbox,
  shouldLoadBoundaryPolygons,
} from './boundaryViewport'
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
  it('loads polygons only below the configured visible-cell limit', () => {
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 49_999 })).toBe(
      true,
    )
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 50_000 })).toBe(
      false,
    )
    expect(
      shouldLoadBoundaryPolygons(
        { ...candidate, visibleCellCount: 750 },
        {
          cellLimit: 800,
        },
      ),
    ).toBe(true)
  })

  it('loads polygons at cell-scale zoom even when the count estimate is dense', () => {
    expect(
      shouldLoadBoundaryPolygons({
        ...candidate,
        visibleCellCount: 120_000,
        viewState: { ...candidate.viewState, zoom: -0.25 },
      }),
    ).toBe(true)
    expect(
      shouldLoadBoundaryPolygons(
        {
          ...candidate,
          visibleCellCount: 120_000,
          viewState: { ...candidate.viewState, zoom: 0 },
        },
        { cellScaleZoom: 0.5 },
      ),
    ).toBe(false)
  })

  it('skips polygons for dense overview candidates and empty viewports', () => {
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 120_000 })).toBe(
      false,
    )
    expect(shouldLoadBoundaryPolygons({ ...candidate, visibleCellCount: 0 })).toBe(false)
  })

  it('normalizes the configurable cell limit', () => {
    expect(normalizeBoundaryCellLimit(undefined)).toBe(50_000)
    expect(normalizeBoundaryCellLimit(Number.NaN)).toBe(50_000)
    expect(normalizeBoundaryCellLimit(12.6)).toBe(13)
    expect(normalizeBoundaryCellLimit(-4)).toBe(1)
    expect(normalizeBoundaryCellLimit(60_000)).toBe(60_000)
    expect(normalizeBoundaryCellLimit(120_000)).toBe(100_000)
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

describe('padded boundary requests', () => {
  const viewport: BoundaryViewportCandidate = {
    bbox: {
      minX: micrometers(100),
      maxX: micrometers(300),
      minY: micrometers(0),
      maxY: micrometers(100),
    },
    visibleCellCount: 1_000,
    viewState: { ...candidate.viewState, target: [200, 50, 0], zoom: 1 },
  }

  it('pads the viewport by a quarter on each side within the cell limit', () => {
    expect(paddedBoundaryBbox(viewport, { cellLimit: 50_000 })).toEqual({
      minX: 50,
      maxX: 350,
      minY: -25,
      maxY: 125,
    })
    // 40k visible cells leave room for 1.25x the area: 5.9% padding per side.
    const tight = paddedBoundaryBbox(
      { ...viewport, visibleCellCount: 40_000 },
      { cellLimit: 50_000 },
    )
    expect(tight.maxX - tight.minX).toBeCloseTo(200 * Math.sqrt(1.25), 6)
    expect(
      paddedBoundaryBbox(
        { ...viewport, visibleCellCount: 60_000 },
        { cellLimit: 50_000 },
      ),
    ).toEqual(viewport.bbox)
  })

  it('reuses a request that covers the viewport at a similar zoom', () => {
    const request = { bbox: paddedBoundaryBbox(viewport), zoom: 1 }
    const panned = {
      ...viewport,
      bbox: { ...viewport.bbox, minX: micrometers(140), maxX: micrometers(340) },
    }

    expect(boundaryRequestCovers(request, panned)).toBe(true)
    expect(
      boundaryRequestCovers(request, {
        ...panned,
        bbox: { ...panned.bbox, maxX: micrometers(360) },
      }),
    ).toBe(false)
    expect(
      boundaryRequestCovers(request, {
        ...viewport,
        viewState: { ...viewport.viewState, zoom: 2 },
      }),
    ).toBe(false)
    expect(boundaryRequestCovers(null, viewport)).toBe(false)
  })
})
