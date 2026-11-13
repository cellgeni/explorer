import { describe, expect, it } from 'vitest'
import type { FileMetaData } from 'hyparquet'
import {
  ringArea,
  shapesFromRows,
  shapesParquetLayout,
  type SpatialDataShapesParquetLayout,
} from './spatialDataShapes'

const DOUBLE_AFFINE = { a: 2, b: 0, c: 10, d: 0, e: 2, f: 20 }

describe('SpatialData shapes', () => {
  it('reads geometry, radius, and pandas index columns from GeoParquet metadata', () => {
    const layout = shapesParquetLayout(
      parquetMetadata(['geometry', 'radius', 'spot_id'], {
        geo: { primary_column: 'geometry' },
        pandas: { index_columns: ['spot_id'] },
      }),
    )

    expect(layout).toEqual({
      columns: ['geometry', 'radius', 'spot_id'],
      geometryColumn: 'geometry',
      radiusColumn: 'radius',
      index: { kind: 'column', column: 'spot_id' },
    })
  })

  it('falls back to a pandas range index', () => {
    expect(
      shapesParquetLayout(
        parquetMetadata(['geometry'], {
          pandas: { index_columns: [{ kind: 'range', start: 5, stop: 9, step: 2 }] },
        }),
      ).index,
    ).toEqual({ kind: 'range', start: 5, step: 2 })
  })

  it('places circles and polygons in the target coordinate system', () => {
    const layout: SpatialDataShapesParquetLayout = {
      columns: ['geometry', 'radius', 'id'],
      geometryColumn: 'geometry',
      radiusColumn: 'radius',
      index: { kind: 'column', column: 'id' },
    }
    const shapes = shapesFromRows(
      [
        { geometry: { type: 'Point', coordinates: [1, 2] }, radius: 3, id: 7n },
        {
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
              [
                [
                  [0, 0],
                  [4, 0],
                  [4, 4],
                  [0, 4],
                  [0, 0],
                ],
              ],
            ],
          },
          radius: null,
          id: 'cell-b',
        },
        { geometry: null, radius: 1, id: 9 },
      ],
      layout,
      DOUBLE_AFFINE,
    )

    expect(shapes).toHaveLength(2)
    expect(shapes[0]).toEqual({
      id: '7',
      geometry: { kind: 'circle', center: { x: 12, y: 24 }, radius: 6 },
      centroid: { x: 12, y: 24 },
    })
    expect(shapes[1]?.id).toBe('cell-b')
    // The larger polygon's outer ring, as interleaved x, y.
    expect(shapes[1]?.geometry).toEqual({
      kind: 'polygon',
      ring: Float32Array.of(10, 20, 18, 20, 18, 28, 10, 28, 10, 20),
    })
    expect(shapes[1]?.centroid).toEqual({ x: 14, y: 24 })
  })

  it('reads WKB points, polygon outer rings, and the largest polygon of a MultiPolygon', () => {
    const layout: SpatialDataShapesParquetLayout = {
      columns: ['geometry', 'id'],
      geometryColumn: 'geometry',
      index: { kind: 'column', column: 'id' },
    }
    const square = (size: number): [number, number][] => [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
      [0, 0],
    ]
    const shapes = shapesFromRows(
      [
        { geometry: wkbPoint(1.5, -2), id: 'point' },
        // The hole is dropped.
        { geometry: wkbPolygon([square(2), square(1)]), id: 'polygon' },
        {
          geometry: wkbMultiPolygon([wkbPolygon([square(1)]), wkbPolygon([square(3)])]),
          id: 'multi',
        },
        { geometry: new Uint8Array([1, 2]), id: 'broken' },
      ],
      layout,
      DOUBLE_AFFINE,
    )

    expect(shapes.map((shape) => shape.id)).toEqual(['point', 'polygon', 'multi'])
    expect(shapes[0]?.centroid).toEqual({ x: 13, y: 16 })
    expect(shapes[1]?.geometry).toEqual({
      kind: 'polygon',
      ring: Float32Array.of(10, 20, 14, 20, 14, 24, 10, 24, 10, 20),
    })
    expect(shapes[2]?.centroid).toEqual({ x: 13, y: 23 })
    expect(ringArea(Float32Array.of(0, 0, 3, 0, 3, 3, 0, 3))).toBe(9)
  })
})

function parquetMetadata(
  columns: readonly string[],
  keyValues: Readonly<Record<string, unknown>>,
): FileMetaData {
  return {
    schema: [{ name: 'schema' }, ...columns.map((name) => ({ name }))],
    key_value_metadata: Object.entries(keyValues).map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
    })),
  } as unknown as FileMetaData
}

function wkbPoint(x: number, y: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(21))
  view.setUint8(0, 1)
  view.setUint32(1, 1, true)
  view.setFloat64(5, x, true)
  view.setFloat64(13, y, true)
  return new Uint8Array(view.buffer)
}

function wkbPolygon(
  rings: readonly (readonly (readonly [number, number])[])[],
): Uint8Array {
  const size = 9 + rings.reduce((sum, ring) => sum + 4 + ring.length * 16, 0)
  const view = new DataView(new ArrayBuffer(size))
  view.setUint8(0, 1)
  view.setUint32(1, 3, true)
  view.setUint32(5, rings.length, true)
  let offset = 9

  for (const ring of rings) {
    view.setUint32(offset, ring.length, true)
    offset += 4

    for (const [x, y] of ring) {
      view.setFloat64(offset, x, true)
      view.setFloat64(offset + 8, y, true)
      offset += 16
    }
  }

  return new Uint8Array(view.buffer)
}

function wkbMultiPolygon(polygons: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    9 + polygons.reduce((sum, polygon) => sum + polygon.length, 0),
  )
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 1)
  view.setUint32(1, 6, true)
  view.setUint32(5, polygons.length, true)
  let offset = 9

  for (const polygon of polygons) {
    bytes.set(polygon, offset)
    offset += polygon.length
  }

  return bytes
}
