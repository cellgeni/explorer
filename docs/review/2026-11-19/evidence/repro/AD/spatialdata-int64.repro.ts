// Area AD, review 2026-11-19: a SpatialData table whose int64 instance_key
// holds ids above 2**53 (as spatialdata-io keeps MERSCOPE EntityIDs), joined
// to a shapes element indexed by the same int64 ids. The shapes parquet is
// written by pyarrow (fixtures/AD/make_fixtures.py) and read by the real
// shapes reader; the table is an in-memory Zarr v2 store laid out as in
// src/datasets/spatialDataDataset.test.ts.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/AD/spatialdata-int64.repro.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpatialDataDataset } from '../../../../../../src/datasets/spatialDataDataset'

const FIXTURES = join(process.cwd(), 'docs/review/2026-11-19/evidence/fixtures/AD')
const STORE = 'https://example.test/sample.sdata.zarr'
const XY = { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] }
// The parquet's index values, from int64-expected.json (pyarrow).
const IDS = (
  JSON.parse(readFileSync(join(FIXTURES, 'int64-expected.json'), 'utf8')) as {
    ids: string[]
  }
).ids.map((id) => BigInt(id))

function arrayMeta(shape: readonly number[], dtype: string) {
  return {
    zarr_format: 2,
    shape,
    chunks: shape,
    dtype,
    compressor: null,
    fill_value: null,
    order: 'C',
    filters: null,
  }
}

function bytes(value: ArrayBufferView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function fixedStrings(values: readonly string[], width: number): Uint8Array {
  const output = new Uint8Array(values.length * width)
  values.forEach((value, index) => {
    output.set(new TextEncoder().encode(value).slice(0, width), index * width)
  })
  return output
}

function store(instanceIds: readonly bigint[], shapesParquet: Uint8Array) {
  const metadata = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    'shapes/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zattrs': {
      'encoding-type': 'ngff:shapes',
      coordinateTransformations: [
        { type: 'identity', input: XY, output: { name: 'global', axes: XY.axes } },
      ],
      spatialdata_attrs: { version: '0.2', name: 'cells' },
    },
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': {
      'encoding-type': 'anndata',
      region: 'cells',
      region_key: 'region',
      instance_key: 'EntityID',
    },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': ['region', 'EntityID'],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([3], '|S1'),
    'tables/table/obs/EntityID/.zarray': arrayMeta([3], '<i8'),
    'tables/table/obs/region/.zgroup': { zarr_format: 2 },
    'tables/table/obs/region/.zattrs': { 'encoding-type': 'categorical' },
    'tables/table/obs/region/codes/.zarray': arrayMeta([3], '|i1'),
    'tables/table/obs/region/categories/.zarray': arrayMeta([1], '|S5'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([1], '|S4'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [3, 1] },
    'tables/table/X/data/.zarray': arrayMeta([3], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([3], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([4], '<i4'),
  }
  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      new TextEncoder().encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    ['/tables/table/obs/_index/0', fixedStrings(['a', 'b', 'c'], 1)],
    ['/tables/table/obs/EntityID/0', bytes(BigInt64Array.from(instanceIds))],
    ['/tables/table/obs/region/codes/0', bytes(new Int8Array([0, 0, 0]))],
    ['/tables/table/obs/region/categories/0', fixedStrings(['cells'], 5)],
    ['/tables/table/var/_index/0', fixedStrings(['Actb'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1, 2, 3]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0, 0, 0]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 2, 3]))],
    ['/shapes/cells/shapes.parquet', shapesParquet],
  ])
}

// Zarr keys and the parquet, with Range answered as a static host does;
// missing keys 404.
function fetcher(files: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const path = new URL(request.url).pathname.replace(/^\/sample\.sdata\.zarr/, '')
    const body = files.get(path)
    if (body === undefined) return new Response(null, { status: 404 })
    if (request.method === 'HEAD') {
      return new Response(null, { headers: { 'content-length': String(body.length) } })
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('range') ?? '')
    if (match === null) return new Response(Uint8Array.from(body))
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), body.length - 1)
    return new Response(body.slice(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${body.length}` },
    })
  }) as typeof fetch
}

describe('SpatialData int64 instance ids above 2**53 (AD-04)', () => {
  const parquet = new Uint8Array(readFileSync(join(FIXTURES, 'int64-shapes.parquet')))

  it('places no row: the table side rounds the ids, the shapes side keeps them', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE,
      fetcher: fetcher(store(IDS, parquet)),
      onProgress: (message) => progress.push(message),
    })

    // The ids are exact in both files; only the reader's conversion differs.
    expect(IDS.map(String)).toEqual([
      '2305843009213693964',
      '2305843009213693965',
      '2305843009213693966',
    ])
    expect(new Set(IDS.map((id) => Number(id))).size).toBe(1)
    await expect(dataset.overview()).rejects.toThrow(
      /rows did not match any cells instances/,
    )
    expect(progress).toContain('SpatialData shapes cells ready: 3 geometries')
    expect(progress).toContain('SpatialData placed 0 of 3 table rows in global')
  })

  it('control: the same store with ids below 2**53 places every row', async () => {
    const small = new Uint8Array(
      readFileSync(join(FIXTURES, 'int64-shapes-small.parquet')),
    )
    const dataset = new SpatialDataDataset({
      url: STORE,
      fetcher: fetcher(store([12n, 13n, 14n], small)),
    })

    const overview = await dataset.overview()
    expect(overview.map((cell) => [cell.cellId, cell.position.x])).toEqual([
      ['a', 1],
      ['b', 5],
      ['c', 9],
    ])
  })
})
