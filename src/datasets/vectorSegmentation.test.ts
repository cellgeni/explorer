// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { spatialDataShapesFixtureBytes } from '../test/spatialDataShapesFixtures'
import { shapeRing, type SpatialDataShapes } from './spatialDataShapes'
import {
  readVectorSegmentation,
  type VectorSegmentationFormat,
} from './vectorSegmentation'

function read(
  format: VectorSegmentationFormat,
  content: BlobPart,
  micrometersPerUnit = 1,
): Promise<SpatialDataShapes> {
  return readVectorSegmentation({
    file: { kind: 'file', file: new Blob([content]) },
    format,
    micrometersPerUnit,
  })
}

function rings(shapes: SpatialDataShapes): number[][] {
  return shapes.ids.map((_id, index) => Array.from(shapeRing(shapes, index)))
}

function fixture(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/segmentation', name)),
  )
}

const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
]

describe('readVectorSegmentation', () => {
  it('reads GeoJSON polygons in pixels, with IDs from properties, the feature or its index', async () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'uuid-1',
          properties: { cell_id: 7 },
          geometry: { type: 'Polygon', coordinates: [square(0, 0, 10)] },
        },
        {
          type: 'Feature',
          id: 'uuid-2',
          properties: { objectType: 'cell' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[square(20, 0, 2)], [square(40, 0, 4)]],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [square(0, 20, 1)] },
        },
      ],
    })
    const shapes = await read('geojson', gzipSync(geojson), 0.5)

    expect(shapes.ids).toEqual(['7', 'uuid-2', '3'])
    expect(rings(shapes)[0]).toEqual([0, 0, 5, 0, 5, 5, 0, 5, 0, 0])
    expect(rings(shapes)[1]?.slice(0, 2)).toEqual([20, 0])
  })

  it('reads one WKT polygon a line, numbering them from 0', async () => {
    const shapes = await read(
      'wkt',
      'POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0))\n\nPOINT (1 1)\r\nPOLYGON ((10 10, 12 10, 12 12, 10 10))\n',
    )

    expect(shapes.ids).toEqual(['0', '2'])
    expect(rings(shapes)[1]).toEqual([10, 10, 12, 10, 12, 12])
  })

  it('reads a CSV whose header names the geometry and ID columns', async () => {
    const shapes = await read(
      'wkt',
      'area,cell_id,geometry\n16,c1,"POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0))"\n4,c2,POLYGON ((5 5, 7 5, 7 7, 5 5))\n',
    )

    expect(shapes.ids).toEqual(['c1', 'c2'])
    expect(rings(shapes)[1]).toEqual([5, 5, 7, 5, 7, 7])
  })

  it('takes the pandas index of an unnamed first column, and tab-separated WKT found by value', async () => {
    const csv = await read('wkt', ',outline\n3,"POLYGON ((0 0, 1 0, 1 1, 0 0))"\n')
    const tsv = await read(
      'wkt',
      '12\tPOLYGON ((0 0, 1 0, 1 1, 0 0))\n13\tPOLYGON ((2 2, 3 2, 3 3, 2 2))\n',
    )

    expect(csv.ids).toEqual(['3'])
    expect(tsv.ids).toEqual(['12', '13'])
  })

  it('reads a header that names the geometry column polygon as a header', async () => {
    const single = await read(
      'wkt',
      'polygon\n"POLYGON ((0 0, 1 0, 1 1, 0 0))"\n"POLYGON ((2 2, 3 2, 3 3, 2 2))"\n',
    )
    const named = await read(
      'wkt',
      'class,cell_id,polygon\ntumor,c1,"POLYGON ((0 0, 1 0, 1 1, 0 0))"\ntumor,c2,"POLYGON ((2 2, 3 2, 3 3, 2 2))"\n',
    )

    expect(single.ids).toEqual(['0', '1'])
    expect(named.ids).toEqual(['c1', 'c2'])
  })

  it('reports a table without WKT', async () => {
    await expect(read('wkt', 'id,x,y\n1,2,3\n')).rejects.toThrow(
      'No WKT POLYGON or MULTIPOLYGON column was found',
    )
  })

  it('reads GeoParquet WKB with its pandas index', async () => {
    const shapes = await read(
      'parquet',
      Uint8Array.from(spatialDataShapesFixtureBytes('cell_boundaries.parquet')),
    )

    expect(shapes.ids).toEqual(['aaaa-1', 'aaab-1', 'aaac-1', 'aaad-1'])
  })

  it('takes a named ID column over an unnamed pandas index', async () => {
    // MERSCOPE boundaries: `ID` (a row number), `EntityID`, `ZIndex`,
    // `Geometry` and `__index_level_0__`, seven planes per cell.
    const shapes = await read(
      'parquet',
      new Uint8Array(
        readFileSync(
          join(process.cwd(), 'src/test/fixtures/merscope/cell_boundaries.parquet'),
        ),
      ),
    )

    expect(new Set(shapes.ids)).toEqual(
      new Set([
        '1577590100000000000',
        '1577590100000000001',
        '1577590100000000002',
        '1577590100000000099',
      ]),
    )
  })

  it('reads one row per vertex across row groups, as Xenium writes', async () => {
    const shapes = await read('parquet', fixture('vertices.parquet'), 2)

    expect(shapes.ids).toEqual(['a', 'b', 'c'])
    expect(rings(shapes)).toEqual([
      [0, 0, 20, 0, 20, 20, 0, 20],
      [60, 0, 80, 0, 70, 16],
      [40, 40, 48, 40, 48, 48],
    ])
  })

  it('reads a WKT string column, skipping rows that are not polygons', async () => {
    const shapes = await read('parquet', fixture('wkt.parquet'))

    expect(shapes.ids).toEqual(['5', '6'])
    expect(rings(shapes)[1]).toEqual([10, 10, 30, 10, 30, 30, 10, 30])
  })

  it('fetches a URL and reports progress', async () => {
    const fetcher = vi.fn(async () => new Response('POLYGON ((0 0, 1 0, 1 1, 0 0))\n'))
    const onProgress = vi.fn()
    const shapes = await readVectorSegmentation({
      file: { kind: 'url', url: 'https://example.org/a.wkt' },
      format: 'wkt',
      micrometersPerUnit: 1,
      fetcher,
      onProgress,
    })

    expect(shapes.ids).toEqual(['0'])
    expect(onProgress).toHaveBeenLastCalledWith(1)

    await expect(
      readVectorSegmentation({
        file: { kind: 'url', url: 'https://example.org/missing.wkt' },
        format: 'wkt',
        micrometersPerUnit: 1,
        fetcher: async () => new Response('', { status: 404 }),
      }),
    ).rejects.toThrow('HTTP 404')
  })

  it('reports a file with no polygons', async () => {
    await expect(
      read('geojson', '{"type":"FeatureCollection","features":[]}'),
    ).rejects.toThrow('no Polygon or MultiPolygon features')
  })
})
