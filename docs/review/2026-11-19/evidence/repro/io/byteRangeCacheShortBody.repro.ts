// IO-01 reproduction: the persistent byte-range cache stores a short 206 body
// and serves it to every later load of the same file version.
//
// Run: npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//   docs/review/2026-11-19/evidence/repro/io/byteRangeCacheShortBody.repro.ts
//
// Oracles are independent of the code under test: the fixture's byte length
// and the request counts kept by the stub servers below.
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { asyncBufferFromUrl, parquetMetadataAsync } from 'hyparquet'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cacheFooterByteRanges,
  createIndexedDbByteRangeCache,
  fetchByteRangeWithCache,
  fetchKeepingValidator,
  PARQUET_FOOTER_CACHE_NAMESPACE,
  TIFF_TILE_CACHE_NAMESPACE,
  type PersistentByteRangeCache,
} from '../../../../../../src/data/persistentByteRangeCache'
import { CachedHttpRangeReader } from '../../../../../../src/zarr/cachedZipStore'

const URL_ = 'https://bucket.test/run/cells.parquet'
const ETAG = '"v1"'
const bytes = new Uint8Array(
  readFileSync(join(process.cwd(), 'src/test/fixtures/xenium/cells.parquet')),
)

interface Server {
  readonly fetch: typeof fetch
  readonly rangeRequests: string[]
}

// A host that answers HEAD and Range. `short` returns only the first half of
// every ranged body while still answering 206 with a Content-Range for the
// whole range, as a truncated cache/proxy response would.
function server(mode: 'honest' | 'short'): Server {
  const rangeRequests: string[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)

    if (request.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength), ETag: ETAG },
      })
    }

    const range = request.headers.get('Range') ?? ''
    rangeRequests.push(range)
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)

    if (match === null) {
      return new Response(bytes.slice(), { status: 200, headers: { ETag: ETAG } })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    const full = bytes.slice(start, end + 1)
    const body = mode === 'short' ? full.slice(0, Math.floor(full.byteLength / 2)) : full

    return new Response(body, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
        ETag: ETAG,
      },
    })
  }) as typeof fetch

  return { fetch: fetcher, rangeRequests }
}

// What hyparquetCells.ts fileFromUrl / datasetWarmup.ts prefetchParquetFooter
// build: hyparquet's asyncBufferFromUrl under the footer cache.
async function openLikeTheApp(
  host: Server,
  cache: PersistentByteRangeCache | null,
): Promise<ReturnType<typeof cacheFooterByteRanges>> {
  const keeping = fetchKeepingValidator(host.fetch)
  const file = await asyncBufferFromUrl({ url: URL_, fetch: keeping.fetch })
  return cacheFooterByteRanges(file, { cache, url: URL_, validator: keeping.validator() })
}

async function waitForCachedLength(
  cache: PersistentByteRangeCache,
  namespace: string,
  version: string,
  start: number,
  end: number,
): Promise<number | null> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const cached = await cache.read({ namespace, url: URL_, version, start, end })

    if (cached !== null) return cached.byteLength
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return null
}

describe('IO-01 persistent byte-range cache keeps short bodies', () => {
  it('poisons the Parquet footer for later loads of the same file', async () => {
    const idb = new FakeIDBFactory()
    const version = `${bytes.byteLength} ${ETAG}`

    // Load 1: the host (or Chromium's cache) returns a short 206 body.
    const flaky = server('short')
    const firstCache = createIndexedDbByteRangeCache({ indexedDB: idb })!
    const first = await openLikeTheApp(flaky, firstCache)
    const firstError = await parquetMetadataAsync(first).then(
      () => null,
      (error: unknown) => String(error),
    )
    const storedLength = await waitForCachedLength(
      firstCache,
      PARQUET_FOOTER_CACHE_NAMESPACE,
      version,
      0,
      bytes.byteLength,
    )

    // Load 2 ("reload"): a new cache object on the same IndexedDB, host fixed.
    const honest = server('honest')
    const secondCache = createIndexedDbByteRangeCache({ indexedDB: idb })!
    const second = await openLikeTheApp(honest, secondCache)
    const secondError = await parquetMetadataAsync(second).then(
      () => null,
      (error: unknown) => String(error),
    )

    // Control: same honest host, empty IndexedDB.
    const control = await openLikeTheApp(
      server('honest'),
      createIndexedDbByteRangeCache({ indexedDB: new FakeIDBFactory() })!,
    )
    const controlRows = Number((await parquetMetadataAsync(control)).num_rows)

    console.log(
      JSON.stringify(
        {
          fixtureBytes: bytes.byteLength,
          load1: { error: firstError, rangeRequests: flaky.rangeRequests },
          storedFooterBytes: storedLength,
          load2: { error: secondError, rangeRequests: honest.rangeRequests },
          controlRows,
        },
        null,
        2,
      ),
    )

    expect(firstError).toMatch(/parquet file invalid/)
    expect(storedLength).toBe(Math.floor(bytes.byteLength / 2))
    expect(secondError).toMatch(/parquet file invalid/)
    // The footer never reached the fixed host on load 2.
    expect(honest.rangeRequests).toEqual([])
    expect(controlRows).toBe(10)
  })

  it('fetchByteRangeWithCache stores whatever fetchRange returns (TIFF tile namespace)', async () => {
    const cache = createIndexedDbByteRangeCache({ indexedDB: new FakeIDBFactory() })!
    const key = {
      cache,
      namespace: TIFF_TILE_CACHE_NAMESPACE,
      url: 'https://bucket.test/slide.tif',
      version: '1000 "x"',
      start: 100,
      end: 200,
    }
    // 100 bytes asked for, 40 returned (as loader.ts fetchRange would pass on
    // a short 206 body, which it does not length-check).
    await fetchByteRangeWithCache({ ...key, fetchRange: async () => new Uint8Array(40) })
    let honestCalls = 0
    let later: Uint8Array | null = null

    for (let attempt = 0; attempt < 50 && later?.byteLength !== 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      later = await fetchByteRangeWithCache({
        ...key,
        write: false,
        fetchRange: async () => {
          honestCalls += 1
          return new Uint8Array(100)
        },
      })
    }

    console.log(
      JSON.stringify({ asked: 100, servedLater: later?.byteLength, honestCalls }),
    )
    expect(later?.byteLength).toBe(40)
  })

  it('control: the zip store reader refuses a short body and caches nothing', async () => {
    const idb = new FakeIDBFactory()
    const cache = createIndexedDbByteRangeCache({ indexedDB: idb })!
    const flaky = server('short')
    const reader = new CachedHttpRangeReader(URL_, cache, flaky.fetch)
    const error = await reader.read(0, 100).then(
      () => null,
      (cause: unknown) => String(cause),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const honest = server('honest')
    const again = await new CachedHttpRangeReader(URL_, cache, honest.fetch).read(0, 100)

    console.log(
      JSON.stringify({
        error,
        secondLength: again.byteLength,
        honest: honest.rangeRequests,
      }),
    )
    expect(error).toMatch(/50 bytes returned|expected/)
    expect(again.byteLength).toBe(100)
    expect(honest.rangeRequests).toEqual(['bytes=0-99'])
  })
})
