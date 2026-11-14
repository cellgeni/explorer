import { describe, expect, it } from 'vitest'
import type { FileMetaData } from 'hyparquet'
import {
  readSpatialDataShapes,
  ringArea,
  SHAPE_CIRCLE,
  shapeRing,
  shapesFromRows,
  shapesParquetLayout,
  SpatialDataShapesBuilder,
  spatialDataShapesTransferables,
  type SpatialDataShapes,
  type SpatialDataShapesParquetLayout,
} from './spatialDataShapes'
import { IDENTITY_AFFINE } from './spatialDataTransforms'
import { spatialDataShapesFixture } from '../test/spatialDataShapesFixtures'
import { merscopeFixtureBytes } from '../test/merscopeFixtures'
import { asyncBufferFromBytes, rangeFetcher } from '../test/xeniumCellsFixtures'

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

    expect(listShapes(shapes)).toEqual([
      {
        id: '7',
        kind: 'circle',
        centroid: [12, 24],
        radius: 6,
        area: Number.NaN,
        bounds: [6, 18, 18, 30],
        ring: [],
      },
      {
        id: 'cell-b',
        kind: 'polygon',
        centroid: [14, 24],
        radius: 0,
        area: 64,
        bounds: [10, 20, 18, 28],
        // The larger polygon's outer ring, as interleaved x, y.
        ring: [10, 20, 18, 20, 18, 28, 10, 28, 10, 20],
      },
    ])
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

    const list = listShapes(shapes)
    expect(list.map((shape) => shape.id)).toEqual(['point', 'polygon', 'multi'])
    expect(list[0]?.centroid).toEqual([13, 16])
    expect(list[1]?.ring).toEqual([10, 20, 14, 20, 14, 24, 10, 24, 10, 20])
    expect(list[2]?.centroid).toEqual([13, 23])
    expect(ringArea(Float32Array.of(0, 0, 3, 0, 3, 3, 0, 3))).toBe(9)
  })

  it('reads a spatialdata-io shapes.parquet', async () => {
    const polygons = await readSpatialDataShapes({
      url: 'https://example.test/shapes.parquet',
      file: spatialDataShapesFixture('cell_boundaries.parquet'),
      affine: DOUBLE_AFFINE,
    })
    const list = listShapes(polygons)

    expect(list.map((shape) => shape.id)).toEqual([
      'aaaa-1',
      'aaab-1',
      'aaac-1',
      'aaad-1',
    ])
    // The hole of aaab-1, the smaller polygon of aaac-1, and the z of aaad-1
    // are dropped.
    expect(list.map((shape) => shape.ring)).toEqual([
      [10, 20, 14, 20, 14, 24, 10, 24, 10, 20],
      [18, 20, 26, 20, 26, 28, 18, 28, 18, 20],
      [34, 20, 40, 20, 40, 26, 34, 26, 34, 20],
      [10, 40, 14, 40, 14, 44, 10, 44, 10, 40],
    ])
    expect(list.map((shape) => shape.area)).toEqual([16, 64, 36, 16])
    expect(list[2]).toMatchObject({ centroid: [37, 23], bounds: [34, 20, 40, 26] })

    const circles = await readSpatialDataShapes({
      url: 'https://example.test/shapes.parquet',
      file: spatialDataShapesFixture('cell_circles.parquet'),
      affine: DOUBLE_AFFINE,
    })

    expect(
      listShapes(circles).map(({ id, kind, centroid, radius }) => [
        id,
        kind,
        centroid,
        radius,
      ]),
    ).toEqual([
      ['7', 'circle', [12, 22], 2],
      ['8', 'circle', [22, 24], 4],
      ['9', 'circle', [37, 23], 3],
    ])
  })

  it('grows the ring buffer and transfers every column', () => {
    const builder = new SpatialDataShapesBuilder()

    for (let index = 0; index < 300; index += 1) {
      builder.addPolygon(
        String(index),
        [index, 0, index + 1, 0, index, 1],
        IDENTITY_AFFINE,
      )
    }

    builder.addCircle('circle', 1, 2, 3)
    builder.addPolygon('too-short', [0, 0, 1, 1])
    const shapes = builder.build()

    expect(shapes.ids).toHaveLength(301)
    expect(Array.from(shapeRing(shapes, 299))).toEqual([299, 0, 300, 0, 299, 1])
    expect(shapeRing(shapes, 300)).toHaveLength(0)
    expect(shapes.kinds[300]).toBe(SHAPE_CIRCLE)
    expect(shapes.coords).toHaveLength(300 * 6)
    expect(shapes.coords.buffer.byteLength).toBe(300 * 6 * 4)

    const buffers = spatialDataShapesTransferables(shapes)
    expect(buffers).toHaveLength(7)
    expect(new Set(buffers).size).toBe(7)
  })
})

// The shapes as one record each, for readable expectations.
// src/test/fixtures/merscope: one row per cell per z plane, 8 µm squares at
// plane 3 and 4 µm squares elsewhere.
describe('MERSCOPE boundaries', () => {
  const merscopeLayout = { idColumn: 'EntityID', planeColumn: 'ZIndex' } as const

  it('reads IDs from a named column and keeps the middle plane', async () => {
    const shapes = await readSpatialDataShapes({
      ...merscopeLayout,
      url: 'https://example.test/cell_boundaries.parquet',
      file: asyncBufferFromBytes(merscopeFixtureBytes('cell_boundaries.parquet')),
      affine: IDENTITY_AFFINE,
    })
    const list = listShapes(shapes)

    expect(shapes.plane).toBe(3)
    // int64 IDs above 2^53 stay exact.
    expect(list.map((shape) => shape.id)).toEqual([
      '1577590100000000000',
      '1577590100000000001',
      '1577590100000000002',
      '1577590100000000099',
    ])
    expect(list[0]?.bounds).toEqual([1006, 2006, 1014, 2014])
  })

  it('fetches a gzipped file whole', async () => {
    const shapes = await readSpatialDataShapes({
      ...merscopeLayout,
      url: 'https://example.test/cell_boundaries.parquet.gz',
      wholeFile: true,
      fetcher: rangeFetcher(merscopeFixtureBytes('cell_boundaries.parquet.gz')),
      affine: IDENTITY_AFFINE,
    })

    expect(shapes.ids).toHaveLength(4)
    expect(shapes.plane).toBe(3)
  })

  it('needs the named ID column', () => {
    expect(() =>
      shapesParquetLayout(parquetMetadata(['geometry', 'ZIndex'], {}), merscopeLayout),
    ).toThrow('Shapes parquet does not contain a EntityID column.')
  })
})

function listShapes(shapes: SpatialDataShapes) {
  return shapes.ids.map((id, index) => ({
    id,
    kind: shapes.kinds[index] === SHAPE_CIRCLE ? 'circle' : 'polygon',
    centroid: Array.from(shapes.centroids.subarray(index * 2, index * 2 + 2)),
    radius: shapes.radii[index],
    area: shapes.areas[index],
    bounds: Array.from(shapes.bounds.subarray(index * 4, index * 4 + 4)),
    ring: Array.from(shapeRing(shapes, index)),
  }))
}

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
