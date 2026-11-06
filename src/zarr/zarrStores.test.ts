import { describe, expect, it, vi } from 'vitest'
import * as zarr from 'zarrita'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  ZarrChunkUnavailableError,
  zarrChunkKeys,
} from './zarrStores'

describe('Zarr stores', () => {
  it('records absent numeric chunks and reads them as fill values', async () => {
    const store = consolidatedZarrStore(
      { get: vi.fn(async () => undefined) },
      new Map<string, unknown>([
        ['/.zgroup', { zarr_format: 2 }],
        ['/counts/.zarray', v2Array('<i4', [4], [2])],
      ]),
    )
    const array = await zarr.open.v2(zarr.root(store).resolve('counts'), {
      kind: 'array',
    })

    const values = await zarr.get(array)

    expect(Array.from(values.data as Int32Array)).toEqual([0, 0, 0, 0])
    expect(store.missingChunkKeys()).toEqual(['counts/0', 'counts/1'])
  })

  it('fails fast when a string array chunk is absent', async () => {
    const store = consolidatedZarrStore(
      { get: vi.fn(async () => undefined) },
      new Map<string, unknown>([
        ['/.zgroup', { zarr_format: 2 }],
        [
          '/var/_index/.zarray',
          { ...v2Array('|O', [2], [2]), filters: [{ id: 'vlen-utf8' }] },
        ],
      ]),
    )
    const array = await zarr.open.v2(zarr.root(store).resolve('var/_index'), {
      kind: 'array',
    })

    await expect(zarr.get(array)).rejects.toMatchObject({
      name: 'ZarrChunkUnavailableError',
      key: '/var/_index/0',
      status: 404,
    })
  })

  it('reports forbidden chunks with their store key', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      return new Response(url.endsWith('.zarray') ? null : 'denied', { status: 403 })
    }) as unknown as typeof fetch
    const store = createZarrFetchStore('https://example.test/data/store.zarr/', {
      fetcher,
    })

    await expect(store.get('/images/he/0/.zarray')).resolves.toBeUndefined()
    const error = await store.get('/images/he/0/0.0').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ZarrChunkUnavailableError)
    expect(error).toMatchObject({ key: '/images/he/0/0.0', status: 403 })
    expect((error as Error).message).toBe(
      'Zarr chunk images/he/0/0.0 could not be read (HTTP 403). The object is missing or not publicly readable.',
    )
  })

  it('enumerates chunk keys for v2 and v3 encodings', () => {
    expect(zarrChunkKeys(v2Array('<f4', [5, 3], [2, 2]))).toEqual([
      '0.0',
      '0.1',
      '1.0',
      '1.1',
      '2.0',
      '2.1',
    ])
    expect(
      zarrChunkKeys({ ...v2Array('<f4', [4], [2]), dimension_separator: '/' }),
    ).toEqual(['0', '1'])
    expect(zarrChunkKeys(v2Array('<U7', [], []))).toEqual(['0'])
    expect(
      zarrChunkKeys(
        {
          zarr_format: 3,
          node_type: 'array',
          shape: [3, 4],
          chunk_grid: { name: 'regular', configuration: { chunk_shape: [2, 4] } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
        },
        { limit: 1 },
      ),
    ).toEqual(['c/0/0'])
  })
})

function v2Array(dtype: string, shape: readonly number[], chunks: readonly number[]) {
  return {
    zarr_format: 2,
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: 0,
    order: 'C',
    filters: null,
  }
}
