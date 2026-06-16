import { describe, expect, it, vi } from 'vitest'
import { micrometers } from './coords'
import { loadDatasetBoundaryElements } from './datasetBoundaries'
import type { BBox } from './coords'
import type { SpatialDataset } from '../datasets/spatialDataset'

const bbox: BBox = {
  minX: micrometers(0),
  maxX: micrometers(10),
  minY: micrometers(0),
  maxY: micrometers(10),
}

describe('dataset boundary loader', () => {
  it('delegates viewport bbox loading to the dataset abstraction', async () => {
    const elements = [{ id: 'cell-1', geometry: { kind: 'polygon' as const, rings: [] } }]
    const dataset: SpatialDataset = {
      meta: vi.fn(async () => ({
        platform: 'xenium' as const,
        units: {
          dataUnit: 'micrometer' as const,
          imageUnit: 'pixel' as const,
          micrometersPerPixel: micrometers(0.5),
          origin: 'top-left' as const,
          imageYAxis: 'down' as const,
        },
        extent: bbox,
        capabilities: {
          transcripts: true,
          cellBoundaries: true,
          pyramidImage: true,
          multiChannel: false,
        },
      })),
      elements: vi.fn(async () => ({ elements })),
      matrix: vi.fn(),
      annotations: vi.fn(),
      image: vi.fn(),
    }
    const getDataset = vi.fn(() => dataset)
    const validateRangeSupport = vi.fn(async () => undefined)

    await expect(
      loadDatasetBoundaryElements('https://example.test/xenium/', bbox, {
        getDataset,
        validateRangeSupport,
      }),
    ).resolves.toEqual({ elements })

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_boundaries.parquet',
      { label: 'cell_boundaries.parquet' },
    )
    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(dataset.elements).toHaveBeenCalledWith(bbox)
  })

  it('skips boundary loading when the active dataset has no boundary capability', async () => {
    const dataset: SpatialDataset = {
      meta: vi.fn(async () => ({
        platform: 'visium-hd' as const,
        units: {
          dataUnit: 'micrometer' as const,
          imageUnit: 'pixel' as const,
          micrometersPerPixel: micrometers(0.5),
          origin: 'top-left' as const,
          imageYAxis: 'down' as const,
        },
        extent: bbox,
        capabilities: {
          transcripts: false,
          cellBoundaries: false,
          pyramidImage: false,
          multiChannel: false,
        },
      })),
      elements: vi.fn(async () => ({ elements: [] })),
      matrix: vi.fn(),
      annotations: vi.fn(),
      image: vi.fn(),
    }
    const validateRangeSupport = vi.fn(async () => undefined)

    await expect(
      loadDatasetBoundaryElements('https://example.test/visium/', bbox, {
        getDataset: () => dataset,
        validateRangeSupport,
      }),
    ).resolves.toEqual({ elements: [] })

    expect(validateRangeSupport).not.toHaveBeenCalled()
    expect(dataset.elements).not.toHaveBeenCalled()
  })

  it('loads Visium HD segmented boundary elements without Xenium range probing', async () => {
    const elements = [
      { id: 'cellid_000000001-1', geometry: { kind: 'polygon' as const, rings: [] } },
    ]
    const dataset: SpatialDataset = {
      meta: vi.fn(async () => ({
        platform: 'visium-hd' as const,
        units: {
          dataUnit: 'micrometer' as const,
          imageUnit: 'pixel' as const,
          micrometersPerPixel: micrometers(0.5),
          origin: 'top-left' as const,
          imageYAxis: 'down' as const,
        },
        extent: bbox,
        capabilities: {
          transcripts: false,
          cellBoundaries: true,
          pyramidImage: false,
          multiChannel: false,
        },
      })),
      elements: vi.fn(async () => ({ elements })),
      matrix: vi.fn(),
      annotations: vi.fn(),
      image: vi.fn(),
    }
    const validateRangeSupport = vi.fn(async () => undefined)

    await expect(
      loadDatasetBoundaryElements('https://example.test/visium/', bbox, {
        getDataset: () => dataset,
        validateRangeSupport,
      }),
    ).resolves.toEqual({ elements })

    expect(validateRangeSupport).not.toHaveBeenCalled()
    expect(dataset.elements).toHaveBeenCalledWith(bbox)
  })
})
