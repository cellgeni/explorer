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
      meta: vi.fn(),
      elements: vi.fn(async () => ({ elements })),
      matrix: vi.fn(),
      annotations: vi.fn(),
      image: vi.fn(),
    }
    const getDataset = vi.fn(() => dataset)

    await expect(
      loadDatasetBoundaryElements('https://example.test/xenium/', bbox, {
        getDataset,
      }),
    ).resolves.toEqual({ elements })

    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(dataset.elements).toHaveBeenCalledWith(bbox)
  })
})
