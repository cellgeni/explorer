import { describe, expect, it } from 'vitest'
import type { FileMetaData } from 'hyparquet'
import {
  geometryFromWkb,
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
    expect(shapes[1]?.geometry).toMatchObject({
      kind: 'polygon',
      rings: [
        [
          { x: 10, y: 20 },
          { x: 18, y: 20 },
          { x: 18, y: 28 },
          { x: 10, y: 28 },
          { x: 10, y: 20 },
        ],
      ],
    })
    expect(shapes[1]?.centroid).toEqual({ x: 14, y: 24 })
  })

  it('decodes WKB points and polygons when GeoParquet metadata is missing', () => {
    expect(geometryFromWkb(wkbPoint(1.5, -2))).toEqual({
      type: 'Point',
      coordinates: [1.5, -2],
    })
    expect(
      geometryFromWkb(
        wkbPolygon([
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 0],
        ]),
      ),
    ).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 0],
        ],
      ],
    })
    expect(geometryFromWkb(new Uint8Array([1, 2]))).toBeNull()
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

function wkbPolygon(ring: readonly (readonly [number, number])[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(13 + ring.length * 16))
  view.setUint8(0, 1)
  view.setUint32(1, 3, true)
  view.setUint32(5, 1, true)
  view.setUint32(9, ring.length, true)
  ring.forEach(([x, y], index) => {
    view.setFloat64(13 + index * 16, x, true)
    view.setFloat64(21 + index * 16, y, true)
  })
  return new Uint8Array(view.buffer)
}
