import { describe, expect, it } from 'vitest'
import {
  geometricAnnotationsToGeoJson,
  parseGeometricAnnotationsGeoJson,
} from './geometricAnnotationModel'

describe('geometricAnnotationModel', () => {
  it('returns no annotations for an empty GeoJSON file', () => {
    expect(
      parseGeometricAnnotationsGeoJson('   ', {
        defaultCoordinateUnit: 'pixel',
        micrometersPerPixel: 0.5,
      }),
    ).toEqual([])
  })

  it('imports Polygon features using pixel coordinates by default', () => {
    const annotations = parseGeometricAnnotationsGeoJson(
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
        micrometersPerPixel: 0.5,
        idPrefix: 'import',
      },
    )

    expect(annotations).toHaveLength(1)
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
    const annotations = parseGeometricAnnotationsGeoJson(
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
        micrometersPerPixel: 0.5,
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

  it('rejects unsupported or invalid GeoJSON geometries', () => {
    expect(() =>
      parseGeometricAnnotationsGeoJson(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        }),
        {
          defaultCoordinateUnit: 'pixel',
          micrometersPerPixel: 1,
        },
      ),
    ).toThrow(/Polygon or MultiPolygon/)

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
          micrometersPerPixel: 1,
        },
      ),
    ).toThrow(/at least three distinct points/)
  })

  it('exports annotations as a micrometer FeatureCollection', () => {
    const annotations = parseGeometricAnnotationsGeoJson(
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
        micrometersPerPixel: 0.5,
      },
    )

    const exported = JSON.parse(geometricAnnotationsToGeoJson(annotations)) as {
      readonly type: string
      readonly features: readonly {
        readonly properties: Readonly<Record<string, unknown>>
        readonly geometry: {
          readonly type: string
          readonly coordinates: readonly (readonly number[][])[]
        }
      }[]
    }

    expect(exported.type).toBe('FeatureCollection')
    expect(exported.features[0]?.properties).toMatchObject({
      label: 'Shape A',
      coordinate_unit: 'micrometer',
    })
    expect(exported.features[0]?.geometry.coordinates[0]).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 0],
    ])
  })
})
