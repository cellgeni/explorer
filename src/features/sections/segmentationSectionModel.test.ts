import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { ImportedSegmentation } from '../../datasets/importedSegmentation'
import { segmentationViewStatus } from './segmentationSectionModel'

const source = { url: 'cells.wkt', format: 'wkt', coordinates: 'pixels' } as const
const viewport = {
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(100),
    maxY: micrometers(100),
  },
  viewState: {
    target: [50, 50, 0] as [number, number, number],
    zoom: -3,
    minZoom: -8,
    maxZoom: 8,
  },
}

function segmentation(overrides: Partial<ImportedSegmentation>): ImportedSegmentation {
  return {
    source,
    name: 'cells.wkt',
    estimateCount: () => 0,
    outlines: async () => ({ elements: [] }),
    ...overrides,
  }
}

describe('segmentationViewStatus', () => {
  it('reports what the boundary request drew or why it drew nothing', () => {
    const base = {
      boundaryCellLimit: 50,
      segmentation: segmentation({ shapeCount: 10 }),
      currentViewport: viewport,
      showOutlines: true,
    }

    expect(
      segmentationViewStatus({
        ...base,
        boundaryState: { status: 'ready', url: 'x', cellCount: 7 },
      }),
    ).toEqual({ kind: 'drawn', count: 7 })
    expect(
      segmentationViewStatus({
        ...base,
        boundaryState: { status: 'ready', url: 'x', cellCount: 0, overLimit: {} },
      }),
    ).toEqual({ kind: 'zoom-in' })
    expect(
      segmentationViewStatus({
        ...base,
        boundaryState: { status: 'loading', url: 'x' },
      }),
    ).toEqual({ kind: 'loading' })
    expect(
      segmentationViewStatus({
        ...base,
        showOutlines: false,
        boundaryState: { status: 'idle' },
      }),
    ).toEqual({ kind: 'none' })
  })

  it('estimates outlines deferred by the boundary limit, about so for a mask', () => {
    expect(
      segmentationViewStatus({
        boundaryCellLimit: 50,
        boundaryState: { status: 'idle' },
        segmentation: segmentation({ shapeCount: 1000, estimateCount: () => 600 }),
        currentViewport: viewport,
        showOutlines: true,
      }),
    ).toEqual({ kind: 'over-limit', count: 600, estimated: false, limit: 50 })
    expect(
      segmentationViewStatus({
        boundaryCellLimit: 50,
        boundaryState: { status: 'idle' },
        segmentation: segmentation({ estimateCount: () => 80 }),
        currentViewport: viewport,
        showOutlines: true,
      }),
    ).toEqual({ kind: 'over-limit', count: 80, estimated: true, limit: 50 })
  })
})
