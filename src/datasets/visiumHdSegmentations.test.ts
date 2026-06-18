import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import {
  VisiumHdSegmentationGeojsonBudgetExceededError,
  normalizeVisiumHdGeojsonCellId,
  parseVisiumHdNucleusInstanceMaskRaster,
  parseVisiumHdSegmentationGeojson,
  readVisiumHdSegmentationElements,
  visiumHdSegmentationInfos,
} from './visiumHdSegmentations'

const scalefactors = { micronsPerPixel: 0.5 }

describe('Visium HD segmentation GeoJSON reader', () => {
  it('describes detected segmented output sidecars without conflating source types', () => {
    expect(
      visiumHdSegmentationInfos({
        cellSegmentationsGeojsonPath: 'segmented_outputs/cell_segmentations.geojson',
        nucleusSegmentationsGeojsonPath:
          'segmented_outputs/nucleus_segmentations.geojson',
        graphclustAnnotatedCellSegmentationsGeojsonPath:
          'segmented_outputs/graphclust_annotated_cell_segmentations.geojson',
        graphclustAnnotatedNucleusSegmentationsGeojsonPath:
          'segmented_outputs/graphclust_annotated_nucleus_segmentations.geojson',
        nucleusInstanceMaskTiffPath: 'segmented_outputs/nucleus_instance_mask.tiff',
      }),
    ).toEqual([
      {
        id: 'visium-hd-cell-segmentations',
        kind: 'cell',
        label: 'Cell segmentations',
        sourceKind: 'geojson',
        path: 'segmented_outputs/cell_segmentations.geojson',
      },
      {
        id: 'visium-hd-nucleus-segmentations',
        kind: 'nucleus',
        label: 'Nucleus segmentations',
        sourceKind: 'geojson',
        path: 'segmented_outputs/nucleus_segmentations.geojson',
      },
      {
        id: 'visium-hd-graphclust-cell-segmentations',
        kind: 'cell',
        label: 'Graphclust cell segmentations',
        sourceKind: 'geojson',
        path: 'segmented_outputs/graphclust_annotated_cell_segmentations.geojson',
        annotated: true,
      },
      {
        id: 'visium-hd-graphclust-nucleus-segmentations',
        kind: 'nucleus',
        label: 'Graphclust nucleus segmentations',
        sourceKind: 'geojson',
        path: 'segmented_outputs/graphclust_annotated_nucleus_segmentations.geojson',
        annotated: true,
      },
      {
        id: 'visium-hd-nucleus-instance-mask',
        kind: 'nucleus',
        label: 'Nucleus instance mask',
        sourceKind: 'tiff',
        path: 'segmented_outputs/nucleus_instance_mask.tiff',
      },
    ])
  })

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

  it('preserves annotated segmentation labels and colors from GeoJSON properties', () => {
    const elements = parseVisiumHdSegmentationGeojson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              cell_id: 7,
              graphclust: 'Cluster 2',
              fill_color: '#ff8800',
              stroke_color: [0, 64, 128],
            },
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

    expect(elements[0]).toMatchObject({
      id: 'cellid_000000007-1',
      metadata: {
        segmentation: {
          kind: 'cell',
          annotation: {
            label: 'Cluster 2',
            fillColor: '#ff8800',
            lineColor: '#004080',
          },
        },
      },
    })
  })

  it('preserves annotated nucleus segmentation labels and colors', () => {
    const elements = parseVisiumHdSegmentationGeojson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              nucleus_id: 'nucleus-7',
              classification: 'Nucleus Cluster 4',
              color: '#248f8f',
            },
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
      { scalefactors, kind: 'nucleus' },
    )

    expect(elements[0]).toMatchObject({
      id: 'nucleus-7',
      metadata: {
        segmentation: {
          kind: 'nucleus',
          annotation: {
            label: 'Nucleus Cluster 4',
            color: '#248f8f',
            fillColor: '#248f8f',
            lineColor: '#248f8f',
          },
        },
      },
    })
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

  it('converts labelled nucleus instance-mask TIFF pixels into polygon elements', () => {
    const elements = parseVisiumHdNucleusInstanceMaskRaster(
      {
        width: 4,
        height: 4,
        data: new Uint16Array([
          0,
          0,
          0,
          0, //
          0,
          7,
          7,
          0, //
          0,
          7,
          7,
          0, //
          0,
          0,
          0,
          0,
        ]),
      },
      { scalefactors },
    )

    expect(elements).toEqual([
      {
        id: 'nucleus_000000007',
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { x: micrometers(0.5), y: micrometers(0.5) },
              { x: micrometers(1), y: micrometers(0.5) },
              { x: micrometers(1.5), y: micrometers(0.5) },
              { x: micrometers(1.5), y: micrometers(1) },
              { x: micrometers(1.5), y: micrometers(1.5) },
              { x: micrometers(1), y: micrometers(1.5) },
              { x: micrometers(0.5), y: micrometers(1.5) },
              { x: micrometers(0.5), y: micrometers(1) },
              { x: micrometers(0.5), y: micrometers(0.5) },
            ],
          ],
        },
        metadata: {
          segmentation: {
            kind: 'nucleus',
          },
        },
      },
    ])
  })

  it('uses the raster origin when converting viewport-scoped nucleus masks', () => {
    const elements = parseVisiumHdNucleusInstanceMaskRaster(
      {
        width: 1,
        height: 1,
        originRow: 20,
        originCol: 10,
        data: new Uint32Array([3]),
      },
      { scalefactors },
    )

    expect(elements[0]).toMatchObject({
      id: 'nucleus_000000003',
      geometry: {
        kind: 'polygon',
        rings: [
          [
            { x: micrometers(5), y: micrometers(10) },
            { x: micrometers(5.5), y: micrometers(10) },
            { x: micrometers(5.5), y: micrometers(10.5) },
            { x: micrometers(5), y: micrometers(10.5) },
            { x: micrometers(5), y: micrometers(10) },
          ],
        ],
      },
    })
  })

  it('reads nucleus instance-mask TIFFs through an injected viewport raster reader', async () => {
    const bbox = {
      minX: micrometers(4),
      maxX: micrometers(6),
      minY: micrometers(9),
      maxY: micrometers(11),
    }
    const maskRasterReader = vi.fn(async () => ({
      width: 1,
      height: 1,
      originRow: 20,
      originCol: 10,
      data: new Uint16Array([5]),
    }))

    const elements = await readVisiumHdSegmentationElements(
      'https://example.test/visium/',
      {
        path: 'segmented_outputs/nucleus_instance_mask.tiff',
        scalefactors,
        kind: 'nucleus',
        bbox,
        maskRasterReader,
      },
    )

    expect(maskRasterReader).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/nucleus_instance_mask.tiff',
      { bbox, scalefactors },
    )
    expect(elements.map((element) => element.id)).toEqual(['nucleus_000000005'])
  })

  it('rejects nucleus instance-mask TIFF reads without a viewport bbox', async () => {
    await expect(
      readVisiumHdSegmentationElements('https://example.test/visium/', {
        path: 'segmented_outputs/nucleus_instance_mask.tiff',
        scalefactors,
        kind: 'nucleus',
      }),
    ).rejects.toThrow('require a viewport bbox')
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
