import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { annotationPaletteColor } from '../rendering/annotationPalette'
import type { SpatialElement } from './spatialDataset'
import {
  VisiumHdSegmentationGeojsonBudgetExceededError,
  createVisiumHdSegmentationIndexParser,
  normalizeVisiumHdGeojsonCellId,
  parseVisiumHdNucleusInstanceMaskRaster,
  parseVisiumHdSegmentationGeojson,
  readVisiumHdSegmentationElements,
  visiumHdSegmentationInfos,
} from './visiumHdSegmentations'
import { selectVisiumHdSegmentationIndexElements } from './visiumHdSegmentationIndex'

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

  it('links Space Ranger nuclei to their cells by cell_id', () => {
    const elements = parseVisiumHdSegmentationGeojson(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { cell_id: 2 },
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

    expect(elements[0]?.metadata).toEqual({
      segmentation: { kind: 'nucleus', cellId: normalizeVisiumHdGeojsonCellId(2) },
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

  // Boundaries are read per view, so a colour picked from the labels in view
  // changed as the view panned (EXP-048).
  it('gives each label without a colour one palette colour, in file order', () => {
    const square = (x: number) => [
      [
        [x, 0],
        [x + 4, 0],
        [x + 4, 4],
        [x, 0],
      ],
    ]
    const feature = (cellId: number, properties: Record<string, unknown>) => ({
      type: 'Feature',
      properties: { cell_id: cellId, ...properties },
      geometry: { type: 'Polygon', coordinates: square(cellId * 100) },
    })
    const geojson = {
      type: 'FeatureCollection',
      features: [
        feature(1, { label: 'Tumour' }),
        feature(2, { label: 'Immune', color: '#00ff00' }),
        feature(3, { label: 'Stroma' }),
        feature(4, { label: 'Tumour' }),
      ],
    }
    const colors = (elements: readonly SpatialElement[]) =>
      elements.map((element) => element.metadata?.segmentation?.annotation?.color)
    // Micrometres: 0.5 per pixel, so cell n spans x 50n to 50n + 2.
    const around = (cellId: number) => ({
      minX: micrometers(cellId * 50 - 1),
      maxX: micrometers(cellId * 50 + 3),
      minY: micrometers(-1),
      maxY: micrometers(3),
    })
    const parser = createVisiumHdSegmentationIndexParser({ kind: 'cell', scalefactors })
    parser.push(new TextEncoder().encode(JSON.stringify(geojson)))
    const index = parser.finish()

    expect(colors(parseVisiumHdSegmentationGeojson(geojson, { scalefactors }))).toEqual([
      annotationPaletteColor(0),
      '#00ff00',
      annotationPaletteColor(1),
      annotationPaletteColor(0),
    ])
    // A view holding only Stroma, or only the second Tumour, keeps the colours.
    expect(
      colors(
        parseVisiumHdSegmentationGeojson(geojson, { scalefactors, bbox: around(3) }),
      ),
    ).toEqual([annotationPaletteColor(1)])
    expect(
      colors([...selectVisiumHdSegmentationIndexElements(index, around(4)).values()]),
    ).toEqual([annotationPaletteColor(0)])
  })

  it('indexes GeoJSON that arrives in pieces as the whole-file parse reads it', () => {
    const annotation = { label: 'Tumour – core', color: '#ff0000' }
    const geojson = {
      type: 'FeatureCollection',
      name: 'cells',
      features: [
        {
          type: 'Feature',
          properties: { cell_id: 1, ...annotation, note: 'a "quoted" \\ value' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [40, 0],
                [40, 40],
                [0, 40],
                [0, 0],
              ],
              [
                [10, 10],
                [20, 10],
                [20, 20],
                [10, 10],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          id: 'split-cell',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [100, 100],
                  [104, 100],
                  [104, 104],
                  [100, 100],
                ],
              ],
              [
                [
                  [200, 200],
                  [204, 200],
                  [204, 204],
                  [200, 200],
                ],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { cell_id: 3, ...annotation },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [300, 300],
                [304, 300],
                [304, 304],
                [300, 300],
              ],
            ],
          },
        },
      ],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(geojson, null, 1))
    const parser = createVisiumHdSegmentationIndexParser({ kind: 'cell', scalefactors })

    // Seven-byte pieces split features, strings, escapes and the en dash.
    for (let offset = 0; offset < bytes.length; offset += 7) {
      parser.push(bytes.subarray(offset, offset + 7))
    }

    const index = parser.finish()
    const everything = {
      minX: micrometers(-1000),
      maxX: micrometers(1000),
      minY: micrometers(-1000),
      maxY: micrometers(1000),
    }

    expect(index.ids).toEqual([
      'cellid_000000001-1',
      'split-cell',
      'split-cell#2',
      'cellid_000000003-1',
    ])
    // The two annotated cells share one metadata entry.
    expect(index.metadata).toHaveLength(2)
    expect(Array.from(index.metadataIndexes)).toEqual([1, 0, 0, 1])
    expect(
      Array.from(selectVisiumHdSegmentationIndexElements(index, everything).values()),
    ).toEqual(parseVisiumHdSegmentationGeojson(geojson, { scalefactors }))
  })

  it('rejects indexed GeoJSON that ends before its features array closes', () => {
    const parser = createVisiumHdSegmentationIndexParser({ kind: 'cell', scalefactors })

    parser.push(new TextEncoder().encode('{"type":"FeatureCollection","features":[{"ty'))

    expect(() => parser.finish()).toThrow('Unexpected end')
  })

  it('rejects indexed GeoJSON without a features array', () => {
    const parser = createVisiumHdSegmentationIndexParser({ kind: 'cell', scalefactors })

    // Refused as soon as the root object closes without one.
    expect(() =>
      parser.push(new TextEncoder().encode('{"type":"Feature","geometry":null}')),
    ).toThrow('to be a FeatureCollection')
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
