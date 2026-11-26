import { describe, expect, it, vi } from 'vitest'
import * as zarr from 'zarrita'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  storeWithSignal,
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

  it('reads a cached big-endian chunk the same every time', async () => {
    const store = consolidatedZarrStore(
      { get: vi.fn(async () => new Uint8Array([0, 1, 0, 2, 0, 3, 0, 4])) },
      new Map<string, unknown>([['/X/.zarray', v2Array('>i2', [4], [4])]]),
      { chunkCacheMaxBytes: 1024 },
    )
    const array = await zarr.open.v2(zarr.root(store).resolve('X'), { kind: 'array' })

    // zarrita swaps a big-endian chunk's bytes in place.
    for (let read = 0; read < 3; read += 1) {
      expect(Array.from((await zarr.get(array)).data as Int16Array)).toEqual([1, 2, 3, 4])
    }
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

  it('refuses a whole file sent for a Range read', async () => {
    let cancelled = false
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      (input as Request).headers.has('Range')
        ? // A host that ignores Range starts sending the whole file.
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(64))
              },
              cancel() {
                cancelled = true
              },
            }),
          )
        : new Response(new Uint8Array(4)),
    ) as unknown as typeof fetch
    const store = createZarrFetchStore('https://example.test/data/store.zarr/', {
      fetcher,
    })

    await expect(store.getRange('/0/c/0/0', { offset: 8, length: 4 })).rejects.toThrow(
      'Zarr chunk 0/c/0/0 cannot be range-read. Expected HTTP 206 for Range: bytes=8-11, received HTTP 200. Configure the host to honor byte-range GET requests for https://example.test/data/store.zarr/.',
    )
    expect(cancelled).toBe(true)
    // A read of a whole object is still answered with 200.
    await expect(store.get('/0/c/0/0')).resolves.toHaveLength(4)
  })

  it('sends Range reads past the HTTP cache', async () => {
    const requests: Request[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(input as Request)
      return new Response(new Uint8Array(4), { status: 206 })
    }) as unknown as typeof fetch
    const store = createZarrFetchStore('https://example.test/data/store.zarr/', {
      fetcher,
    })

    await store.get('/0/zarr.json')
    await store.getRange('/0/c/0/0', { offset: 8, length: 4 })

    expect(
      requests.map((request) => [request.headers.get('Range'), request.cache]),
    ).toEqual([
      [null, 'default'],
      ['bytes=8-11', 'no-store'],
    ])
  })

  it('reads a chunk again after a 503 or a body that breaks off (O7)', async () => {
    let sent = false
    const answers = [
      () => new Response(null, { status: 503 }),
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            // Two bytes, then the connection drops.
            pull(controller) {
              if (sent) {
                controller.error(new TypeError('network error'))
                return
              }

              sent = true
              controller.enqueue(new Uint8Array([1, 2]))
            },
          }),
          { status: 206 },
        ),
      () => new Response(new Uint8Array([3, 4]), { status: 206 }),
    ]
    const ranges: (string | null)[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      ranges.push((input as Request).headers.get('Range'))
      return answers.shift()!()
    }) as unknown as typeof fetch
    const store = createZarrFetchStore('https://example.test/data/store.zarr/', {
      fetcher,
    })

    await expect(store.getRange('/0/c/0/0', { offset: 8, length: 4 })).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    // The third attempt asks for the bytes the second did not bring.
    expect(ranges).toEqual(['bytes=8-11', 'bytes=8-11', 'bytes=10-11'])
  })

  it('reads keys whose names hold %, # and ? at their own URLs', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      urls.push((input as Request).url)
      return new Response(new Uint8Array(4), { status: 206 })
    }) as unknown as typeof fetch
    const store = createZarrFetchStore('https://example.test/data/store.zarr?token=1', {
      fetcher,
    })

    await store.get('/obs/% mito #1?/.zarray')
    await store.getRange('/obs/a%41/0', { offset: 0, length: 4 })

    expect(urls).toEqual([
      'https://example.test/data/store.zarr/obs/%25%20mito%20%231%3F/.zarray?token=1',
      'https://example.test/data/store.zarr/obs/a%2541/0?token=1',
    ])
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

describe('storeWithSignal', () => {
  it("reads every key with the signal, and the read's own", async () => {
    const signals: (AbortSignal | undefined)[] = []
    const store: zarr.AsyncReadable = {
      get: (_key, options) => {
        signals.push(options?.signal)
        return Promise.resolve(new Uint8Array([1]))
      },
      getRange: (_key, _range, options) => {
        signals.push(options?.signal)
        return Promise.resolve(new Uint8Array([2]))
      },
    }
    const read = new AbortController()
    const own = new AbortController()
    const withSignal = storeWithSignal(store, read.signal)

    await expect(withSignal.get('/a')).resolves.toEqual(new Uint8Array([1]))
    await expect(
      withSignal.getRange?.('/b', { offset: 0, length: 1 }, { signal: own.signal }),
    ).resolves.toEqual(new Uint8Array([2]))
    expect(signals[0]).toBe(read.signal)
    own.abort()
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, true])
    read.abort()
    expect(signals.map((signal) => signal?.aborted)).toEqual([true, true])
  })

  it('leaves out getRange when the store has none', () => {
    const store: zarr.AsyncReadable = { get: () => Promise.resolve(undefined) }

    expect(storeWithSignal(store, new AbortController().signal).getRange).toBeUndefined()
  })
})
