import { describe, expect, it } from 'vitest'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../test/annDataZarrFixtures'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'
import { byteRangeFetcher, zipArchive } from '../test/zipFixtures'
import {
  readZarrStructure,
  type ZarrStructure,
  type ZarrStructureNode,
} from './zarrStructure'
import { readZarrValues } from './zarrValuePreview'

const encoder = new TextEncoder()
const STORE_ORIGIN = 'https://store.test'

function node(structure: ZarrStructure, path: string): ZarrStructureNode {
  const find = (current: ZarrStructureNode): ZarrStructureNode | undefined =>
    current.path === path ? current : current.children.map(find).find(Boolean)
  const found = find(structure.root)
  if (found === undefined) throw new Error(`No node at ${path}`)
  return found
}

// tiny.zarr's dense X, 6 cells by 4 genes.
const MATRIX = [1, 0, 5, 0, 2, 3, 0, 0, 0, 4, 6, 1, 7, 0, 8, 0, 0, 0, 0, 2, 3, 1, 0, 0]

// Serves bytes and JSON documents by path at https://store.test, 404
// otherwise.
function storeFetcher(
  files: Readonly<Record<string, Uint8Array | object>>,
  requests: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const { pathname } = new URL(request.url)
    requests.push(pathname)
    const file = files[pathname]
    if (file === undefined) return new Response(null, { status: 404 })
    return new Response(
      file instanceof Uint8Array ? Uint8Array.from(file) : JSON.stringify(file),
    )
  }) as typeof fetch
}

function v2Array(metadata: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    zarr_format: 2,
    compressor: null,
    filters: null,
    fill_value: 0,
    order: 'C',
    ...metadata,
  }
}

describe('readZarrValues', () => {
  it('reads an array of a consolidated store, fetching only its chunks', async () => {
    const requests: string[] = []
    const fetcher = annDataZarrFixtureFetcher({ requests })
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher,
      },
    )
    requests.length = 0

    const preview = await readZarrValues(structure, node(structure, 'X'), { fetcher })

    expect(preview).toEqual({ shape: [6, 4], values: MATRIX })
    expect(requests.sort()).toEqual(['/tiny.zarr/X/0.0', '/tiny.zarr/X/0.1'])
  })

  it('reads strings, booleans and scalars', async () => {
    const fetcher = annDataZarrFixtureFetcher()
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher,
      },
    )
    const read = (path: string) =>
      readZarrValues(structure, node(structure, path), { fetcher })

    expect(await read('obs/_index/values')).toEqual({
      shape: [6],
      values: ['cell-a', 'cell-b', 'cell-c', 'cell-d', 'cell-e', 'cell-f'],
    })
    expect(await read('obs/_index/mask')).toEqual({
      shape: [6],
      values: Array.from({ length: 6 }, () => false),
    })
    expect(await read('raw')).toEqual({ shape: [], values: [false] })
  })

  it('reads a sharded array of a v3 store that was walked', async () => {
    const fetcher = annDataZarrFixtureFetcher()
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.v3.zarr`,
      { fetcher },
    )
    expect(structure.source).toBe('walked')

    const preview = await readZarrValues(structure, node(structure, 'obs/score'), {
      fetcher,
    })

    expect(preview).toEqual({
      shape: [6],
      values: [0.1, 0.5, 0.9, 0.2, 0.4, 0.6].map(Math.fround),
    })
  })

  it('reads an array in a zip', async () => {
    const url = `${STORE_ORIGIN}/values/sample.zarr.zip`
    const json = (value: unknown) => encoder.encode(JSON.stringify(value))
    const fetcher = byteRangeFetcher(
      new Map([
        [
          url,
          zipArchive([
            { name: 'sample.zarr/.zgroup', data: json({ zarr_format: 2 }) },
            {
              name: 'sample.zarr/labels/.zarray',
              data: json(v2Array({ shape: [3, 2], chunks: [2, 2], dtype: '<u4' })),
            },
            {
              name: 'sample.zarr/labels/0.0',
              data: new Uint8Array(new Uint32Array([1, 2, 3, 4]).buffer),
            },
            {
              name: 'sample.zarr/labels/1.0',
              data: new Uint8Array(new Uint32Array([5, 6, 0, 0]).buffer),
              deflate: true,
            },
          ]),
        ],
      ]),
    )
    const structure = await readZarrStructure(url, { fetcher })

    expect(
      await readZarrValues(structure, node(structure, 'labels'), { fetcher }),
    ).toEqual({ shape: [3, 2], values: [1, 2, 3, 4, 5, 6] })
  })

  it('reads an array of an Icechunk repository', async () => {
    const fetcher = icechunkFixtureFetcher()
    const structure = await readZarrStructure(
      `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
      { fetcher },
    )

    expect(
      await readZarrValues(structure, node(structure, 'obs/cluster/codes'), { fetcher }),
    ).toEqual({ shape: [6], values: [0, 1, 0, 1, 0, 1] })
  })

  it('gives the values in row-major order for an array stored in F order', async () => {
    const requests: string[] = []
    const fetcher = storeFetcher(
      {
        '/f.zarr/.zmetadata': {
          zarr_consolidated_format: 1,
          metadata: {
            '.zgroup': { zarr_format: 2 },
            'm/.zarray': v2Array({
              shape: [2, 3],
              chunks: [2, 3],
              dtype: '<i2',
              order: 'F',
            }),
          },
        },
        // Column by column: [[1, 2, 3], [4, 5, 6]].
        '/f.zarr/m/0.0': new Uint8Array(new Int16Array([1, 4, 2, 5, 3, 6]).buffer),
      },
      requests,
    )
    const structure = await readZarrStructure(`${STORE_ORIGIN}/f.zarr`, { fetcher })

    expect(await readZarrValues(structure, node(structure, 'm'), { fetcher })).toEqual({
      shape: [2, 3],
      values: [1, 2, 3, 4, 5, 6],
    })
  })

  it('reads the first 100 × 20 at index 0 of other dimensions, and nothing of an empty array', async () => {
    const requests: string[] = []
    const fetcher = storeFetcher(
      {
        '/big.zarr/.zmetadata': {
          zarr_consolidated_format: 1,
          metadata: {
            '.zgroup': { zarr_format: 2 },
            'cube/.zarray': v2Array({
              shape: [500, 50, 3],
              chunks: [50, 50, 3],
              dtype: '<f8',
              fill_value: 7,
            }),
            'empty/.zarray': v2Array({ shape: [0], chunks: [10], dtype: '<f8' }),
          },
        },
      },
      requests,
    )
    const structure = await readZarrStructure(`${STORE_ORIGIN}/big.zarr`, { fetcher })
    requests.length = 0

    const cube = await readZarrValues(structure, node(structure, 'cube'), { fetcher })
    expect(cube.shape).toEqual([100, 20, 1])
    expect(cube.values).toHaveLength(2000)
    expect(new Set(cube.values)).toEqual(new Set([7]))
    // Missing chunks read as the fill value.
    expect(requests.sort()).toEqual(['/big.zarr/cube/0.0.0', '/big.zarr/cube/1.0.0'])

    requests.length = 0
    expect(
      await readZarrValues(structure, node(structure, 'empty'), { fetcher }),
    ).toEqual({ shape: [0], values: [] })
    expect(requests).toEqual([])
  })

  it('stops when the signal aborts', async () => {
    const fetcher = annDataZarrFixtureFetcher()
    const structure = await readZarrStructure(
      `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`,
      {
        fetcher,
      },
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      readZarrValues(structure, node(structure, 'X'), {
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
