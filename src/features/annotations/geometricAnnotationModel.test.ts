import { describe, expect, it, vi } from 'vitest'
import {
  micrometers,
  scaledImagePixelFrame,
  type ImagePixelFrame,
} from '../../data/coords'
import {
  geometricAnnotationFromRoiSelection,
  geometricAnnotationsEmptyMessage,
  geometricAnnotationsImportFailedMessage,
  geometricAnnotationsSkippedMessage,
  geometricAnnotationsToGeoJson,
  parseGeometricAnnotationsGeoJson,
} from './geometricAnnotationModel'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface ExportedFeature {
  readonly type: string
  readonly id: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly geometry: {
    readonly type: string
    readonly coordinates: readonly (readonly number[][])[]
  }
}

function exportedFeatures(text: string): readonly ExportedFeature[] {
  const parsed = JSON.parse(text) as {
    readonly type: string
    readonly features: readonly ExportedFeature[]
  }
  expect(parsed.type).toBe('FeatureCollection')
  return parsed.features
}

const square = (x: number, y: number, size: number) => [
  [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ],
]

describe('geometricAnnotationModel', () => {
  it('returns no annotations for an empty GeoJSON file', () => {
    expect(
      parseGeometricAnnotationsGeoJson('   ', {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(0.5),
      }),
    ).toEqual({ annotations: [], skipped: {} })
  })

  it('names shapes of one class in turn, in time that grows with their number', () => {
    const feature = (name: string, x: number) => ({
      type: 'Feature',
      properties: { classification: { name, color: [255, 0, 0] } },
      geometry: { type: 'Polygon', coordinates: square(x, 0, 1) },
    })
    // A shape named like a numbered one comes first, then 3,000 of one class.
    const features = [
      feature('Tumor 3', 0),
      ...Array.from({ length: 3_000 }, (_, index) => feature('Tumor', index)),
    ]
    const has = vi.spyOn(Set.prototype, 'has')

    const { annotations } = parseGeometricAnnotationsGeoJson(
      JSON.stringify({ type: 'FeatureCollection', features }),
      { defaultCoordinateUnit: 'micrometer', pixelFrame: scaledImagePixelFrame(1) },
    )
    const lookups = has.mock.calls.length
    has.mockRestore()

    expect(annotations.slice(0, 5).map((annotation) => annotation.id)).toEqual([
      'geojson:tumor-3',
      'geojson:tumor',
      'geojson:tumor-2',
      'geojson:tumor-4',
      'geojson:tumor-5',
    ])
    expect(new Set(annotations.map((annotation) => annotation.id)).size).toBe(3_001)
    // Quadratic probing made about 4.5 million lookups for this file.
    expect(lookups).toBeLessThan(100_000)
  })

  it('imports Polygon features using pixel coordinates by default', () => {
    const { annotations } = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              label: 'Tumor region',
              color: '#abcdef',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [10, 20],
                  [30, 20],
                  [30, 40],
                  [10, 20],
                ],
              ],
            },
          },
        ],
      }),
      {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(0.5),
        idPrefix: 'import',
      },
    )

    expect(annotations).toHaveLength(1)
    expect(annotations[0]?.objectId).toMatch(UUID)
    expect(annotations[0]).toMatchObject({
      id: 'import:tumor-region',
      label: 'Tumor region',
      color: '#abcdef',
      visible: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            { x: 5, y: 10 },
            { x: 15, y: 10 },
            { x: 15, y: 20 },
          ],
        ],
      },
    })
  })

  it('imports MultiPolygon features using micrometer coordinates from properties', () => {
    const { annotations } = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'Feature',
        properties: {
          name: 'Necrosis',
          coordinate_unit: 'micrometer',
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 0],
              ],
            ],
            [
              [
                [20, 20],
                [30, 20],
                [30, 30],
                [20, 20],
              ],
            ],
          ],
        },
      }),
      {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(0.5),
      },
    )

    expect(annotations).toHaveLength(1)
    expect(annotations[0]?.geometry).toMatchObject({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        ],
        [
          [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
          ],
        ],
      ],
    })
  })

  it('skips features without polygons, and rejects invalid polygons', () => {
    expect(
      parseGeometricAnnotationsGeoJson(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        }),
        {
          defaultCoordinateUnit: 'pixel',
          pixelFrame: scaledImagePixelFrame(1),
        },
      ),
    ).toEqual({ annotations: [], skipped: { LineString: 1 } })

    expect(() =>
      parseGeometricAnnotationsGeoJson(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        }),
        {
          defaultCoordinateUnit: 'pixel',
          pixelFrame: scaledImagePixelFrame(1),
        },
      ),
    ).toThrow(/at least three distinct points/)
  })

  it('says why an import added no shapes', () => {
    let syntaxError: unknown
    try {
      parseGeometricAnnotationsGeoJson('{not json', {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(1),
      })
    } catch (error) {
      syntaxError = error
    }

    expect(geometricAnnotationsImportFailedMessage('a.geojson', syntaxError)).toBe(
      'Could not import a.geojson. The file is not valid JSON.',
    )
    expect(
      geometricAnnotationsImportFailedMessage(
        'b.geojson',
        new Error('GeoJSON geometry must be Polygon or MultiPolygon.'),
      ),
    ).toBe(
      'Could not import b.geojson. GeoJSON geometry must be Polygon or MultiPolygon.',
    )
    expect(geometricAnnotationsImportFailedMessage('c.geojson', 'oops')).toBe(
      'Could not import c.geojson. The file could not be read.',
    )
    expect(geometricAnnotationsEmptyMessage('d.geojson')).toBe(
      'd.geojson has no Polygon or MultiPolygon shapes.',
    )
    expect(geometricAnnotationsEmptyMessage('e.geojson', { LineString: 1 })).toBe(
      'e.geojson has no Polygon or MultiPolygon shapes. Skipped 1 line.',
    )
    expect(geometricAnnotationsSkippedMessage('f.geojson', 3, {})).toBeNull()
    expect(
      geometricAnnotationsSkippedMessage('f.geojson', 1, {
        Point: 1,
        MultiPoint: 2,
        detection: 40,
        none: 1,
      }),
    ).toBe(
      'Imported 1 shape from f.geojson. Skipped 3 points, 40 QuPath detections and ' +
        '1 feature without geometry. Open detections and cells in the Segmentation ' +
        'section to draw them as outlines.',
    )
  })

  it('exports annotations as a micrometer FeatureCollection', () => {
    const { annotations } = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'Feature',
        properties: { label: 'Shape A', coordinate_unit: 'micrometer' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 0],
            ],
          ],
        },
      }),
      {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(0.5),
      },
    )

    const [exported] = exportedFeatures(
      geometricAnnotationsToGeoJson(annotations, {
        coordinateUnit: 'micrometer',
        pixelFrame: scaledImagePixelFrame(0.5),
      }),
    )

    expect(exported?.id).toBe(annotations[0]?.objectId)
    expect(exported?.properties).toEqual({
      objectType: 'annotation',
      name: 'Shape A',
      color: [31, 119, 180],
      coordinate_unit: 'micrometer',
    })
    expect(exported?.geometry.coordinates[0]).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 0],
    ])
  })

  it('reads QuPath annotations: class, colour, UUID and other properties', () => {
    // A bare array, as QuPath writes without FEATURE_COLLECTION.
    const { annotations, skipped } = parseGeometricAnnotationsGeoJson(
      JSON.stringify([
        {
          type: 'Feature',
          id: '6f1c2c1e-3b6a-4a4e-9a51-1f2d3c4b5a69',
          geometry: { type: 'Polygon', coordinates: square(10, 20, 10) },
          properties: {
            objectType: 'annotation',
            classification: { name: 'Tumor', color: [200, 0, 0] },
            isLocked: true,
            measurements: { Area: 100, Perimeter: 'NaN' },
            metadata: { reviewer: 'A' },
          },
        },
        {
          type: 'Feature',
          id: '0b9e5c8a-2a0d-4f7e-8b0e-6c1d2e3f4a5b',
          geometry: {
            type: 'Polygon',
            coordinates: square(0, 0, 4),
            plane: { c: -1, z: 2, t: 0 },
          },
          properties: {
            objectType: 'annotation',
            name: 'Region 1',
            color: [0, 255, 0],
            classification: { names: ['Tumor', 'Positive'], color: [255, 0, 0, 128] },
          },
        },
        {
          type: 'Feature',
          // QuPath 0.2 named the object type here.
          id: 'PathAnnotationObject',
          geometry: { type: 'Polygon', coordinates: square(0, 0, 2) },
          properties: { classification: { name: 'Stroma', colorRGB: -16744448 } },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(0, 0, 2) },
          properties: { classification: 'Immune: Positive', color: -65536 },
        },
        {
          type: 'Feature',
          geometry: { type: 'MultiPoint', coordinates: [[1, 2]] },
          properties: { objectType: 'annotation' },
        },
        {
          type: 'Feature',
          id: '5c1b6f0e-6e1d-4b8a-8e6a-2f7d1a3c4b5d',
          geometry: { type: 'Polygon', coordinates: square(0, 0, 2) },
          nucleusGeometry: { type: 'Polygon', coordinates: square(0, 0, 1) },
          properties: { objectType: 'cell' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(0, 0, 2) },
          properties: { objectType: 'detection' },
        },
        {
          type: 'Feature',
          id: 'PathDetectionObject',
          geometry: { type: 'Polygon', coordinates: square(0, 0, 2) },
          properties: {},
        },
      ]),
      {
        defaultCoordinateUnit: 'pixel',
        pixelFrame: scaledImagePixelFrame(0.5),
        idPrefix: 'qupath',
      },
    )

    expect(skipped).toEqual({ MultiPoint: 1, cell: 1, detection: 2 })
    expect(annotations.map((annotation) => annotation.label)).toEqual([
      'Tumor',
      'Region 1',
      'Stroma',
      'Immune: Positive',
    ])
    expect(annotations[0]).toMatchObject({
      id: 'qupath:tumor',
      objectId: '6f1c2c1e-3b6a-4a4e-9a51-1f2d3c4b5a69',
      color: '#c80000',
      classification: { names: ['Tumor'], color: '#c80000' },
      properties: {
        isLocked: true,
        measurements: { Area: 100, Perimeter: 'NaN' },
        metadata: { reviewer: 'A' },
      },
    })
    expect(annotations[0]?.geometry.coordinates[0]?.[0]).toEqual({ x: 5, y: 10 })
    expect(annotations[1]).toMatchObject({
      objectId: '0b9e5c8a-2a0d-4f7e-8b0e-6c1d2e3f4a5b',
      color: '#00ff00',
      classification: { names: ['Tumor', 'Positive'], color: '#ff0000' },
    })
    expect(annotations[1]?.properties).toBeUndefined()
    // A 0.2 type name is not an identity.
    expect(annotations[2]?.objectId).toMatch(UUID)
    expect(annotations[2]).toMatchObject({
      color: '#008000',
      classification: { names: ['Stroma'], color: '#008000' },
    })
    expect(annotations[3]).toMatchObject({
      color: '#ff0000',
      classification: { names: ['Immune', 'Positive'], color: null },
    })
  })

  it('reads polygons from GeometryCollections and bare geometries', () => {
    const options = {
      defaultCoordinateUnit: 'micrometer',
      pixelFrame: scaledImagePixelFrame(1),
    } as const
    const collection = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Mixed' },
            geometry: {
              type: 'GeometryCollection',
              geometries: [
                { type: 'LineString', coordinates: [] },
                { type: 'Polygon', coordinates: square(0, 0, 1) },
              ],
            },
          },
          {
            type: 'Feature',
            properties: { name: 'Lines' },
            geometry: {
              type: 'GeometryCollection',
              geometries: [{ type: 'LineString', coordinates: [] }],
            },
          },
          { type: 'Feature', properties: { name: 'Empty' }, geometry: null },
        ],
      }),
      options,
    )
    const bare = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [square(0, 0, 1), square(5, 5, 1)],
      }),
      options,
    )

    expect(collection.annotations).toHaveLength(1)
    expect(collection.annotations[0]?.geometry.type).toBe('Polygon')
    expect(collection.skipped).toEqual({ GeometryCollection: 1, none: 1 })
    expect(bare.annotations[0]?.geometry.type).toBe('MultiPolygon')
    expect(bare.annotations[0]?.label).toBe('Shape 1')
  })

  it('maps pixels through the image origin and placement, both ways', () => {
    // A 0.5 by 0.25 µm pixel, the frame at (100, 50), flipped in x about 1000.
    const pixelFrame: ImagePixelFrame = {
      originX: 100,
      originY: 50,
      micrometersPerPixelX: 0.5,
      micrometersPerPixelY: 0.25,
      placement: {
        a: -1,
        b: 0,
        c: micrometers(1000),
        d: 0,
        e: 1,
        f: micrometers(0),
      },
    }
    const file = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '6f1c2c1e-3b6a-4a4e-9a51-1f2d3c4b5a69',
          geometry: { type: 'Polygon', coordinates: square(10.25, 20.5, 8) },
          properties: {
            objectType: 'annotation',
            classification: { name: 'Tumor', color: [200, 0, 0] },
            measurements: { Area: 64 },
          },
        },
      ],
    })
    const { annotations } = parseGeometricAnnotationsGeoJson(file, {
      defaultCoordinateUnit: 'pixel',
      pixelFrame,
    })

    expect(annotations[0]?.geometry.coordinates[0]?.[0]).toEqual({
      x: 1000 - (100 + 10.25 * 0.5),
      y: 50 + 20.5 * 0.25,
    })

    const [exported] = exportedFeatures(
      geometricAnnotationsToGeoJson(annotations, { coordinateUnit: 'pixel', pixelFrame }),
    )

    expect(exported?.id).toBe('6f1c2c1e-3b6a-4a4e-9a51-1f2d3c4b5a69')
    expect(exported?.geometry.coordinates).toEqual(square(10.25, 20.5, 8))
    // The class colour is the shape's, so QuPath draws it in the class colour.
    expect(exported?.properties).toEqual({
      measurements: { Area: 64 },
      objectType: 'annotation',
      name: 'Tumor',
      classification: { name: 'Tumor', color: [200, 0, 0] },
      coordinate_unit: 'pixel',
    })
  })

  it('writes derived classes as names, and always gives a class a colour', () => {
    const [shape] = parseGeometricAnnotationsGeoJson(
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: square(0, 0, 1) },
        properties: { name: 'Hotspot', classification: 'Tumor: Positive' },
      }),
      { defaultCoordinateUnit: 'micrometer', pixelFrame: scaledImagePixelFrame(1) },
    ).annotations

    expect(shape).toBeDefined()
    if (shape === undefined) return

    const [exported] = exportedFeatures(
      geometricAnnotationsToGeoJson([{ ...shape, color: '#123456' }], {
        coordinateUnit: 'micrometer',
        pixelFrame: scaledImagePixelFrame(1),
      }),
    )

    expect(exported?.properties).toMatchObject({
      name: 'Hotspot',
      classification: { names: ['Tumor', 'Positive'], color: [18, 52, 86] },
      color: [18, 52, 86],
    })
  })

  it('gives a drawn shape a UUID', () => {
    const shape = geometricAnnotationFromRoiSelection({
      id: 'geometry:1:roi-1',
      label: 'ROI 1',
      color: '#1f77b4',
      selection: {
        kind: 'box',
        bbox: {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(1),
          maxY: micrometers(1),
        },
      },
    })

    expect(shape.objectId).toMatch(UUID)
  })
})
