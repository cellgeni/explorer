import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
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
