import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import {
  VisiumHdSegmentationGeojsonBudgetExceededError,
  normalizeVisiumHdGeojsonCellId,
  parseVisiumHdSegmentationGeojson,
  readVisiumHdSegmentationElements,
} from './visiumHdSegmentations'

const scalefactors = { micronsPerPixel: 0.5 }

describe('Visium HD segmentation GeoJSON reader', () => {
  it('normalizes numeric Space Ranger GeoJSON cell IDs to matrix cell IDs', () => {
    expect(normalizeVisiumHdGeojsonCellId(1)).toBe('cellid_000000001-1')
    expect(normalizeVisiumHdGeojsonCellId('42')).toBe('cellid_000000042-1')
    expect(normalizeVisiumHdGeojsonCellId('cellid_7')).toBe('cellid_000000007-1')
    expect(normalizeVisiumHdGeojsonCellId('custom-cell')).toBe('custom-cell')
    expect(normalizeVisiumHdGeojsonCellId(-1)).toBeNull()
  })

  it('parses polygon coordinates in full-resolution image pixels as micrometers', () => {
    const elements = parseVisiumHdSegmentationGeojson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { cell_id: 1 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [10, 20],
                  [14, 20],
                  [14, 24],
                  [10, 20],
                ],
              ],
            },
          },
        ],
      },
      { scalefactors },
    )

    expect(elements).toEqual([
      {
        id: 'cellid_000000001-1',
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { x: micrometers(5), y: micrometers(10) },
              { x: micrometers(7), y: micrometers(10) },
              { x: micrometers(7), y: micrometers(12) },
              { x: micrometers(5), y: micrometers(10) },
            ],
          ],
        },
      },
    ])
  })

  it('flattens multipolygons and filters by viewport bbox', () => {
    const elements = parseVisiumHdSegmentationGeojson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'segmented-cell',
            properties: {},
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [0, 0],
                    [4, 0],
                    [4, 4],
                    [0, 0],
                  ],
                ],
                [
                  [
                    [100, 100],
                    [104, 100],
                    [104, 104],
                    [100, 100],
                  ],
                ],
              ],
            },
          },
        ],
      },
      {
        scalefactors,
        bbox: {
          minX: micrometers(45),
          maxX: micrometers(60),
          minY: micrometers(45),
          maxY: micrometers(60),
        },
      },
    )

    expect(elements.map((element) => element.id)).toEqual(['segmented-cell#2'])
    expect(elements[0]?.geometry.kind).toBe('polygon')
  })

  it('enforces a full-file byte budget before reading hosted segmentations', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '2048' },
        })
      }

      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await expect(
      readVisiumHdSegmentationElements('https://example.test/visium/', {
        path: 'segmented_outputs/cell_segmentations.geojson',
        scalefactors,
        maxFullFileBytes: 1024,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(VisiumHdSegmentationGeojsonBudgetExceededError)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/cell_segmentations.geojson',
      { method: 'HEAD' },
    )
  })
})
