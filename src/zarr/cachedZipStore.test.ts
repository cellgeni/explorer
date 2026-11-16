import { describe, expect, it } from 'vitest'
import {
  byteRangeCacheRecordId,
  ZARR_ZIP_CACHE_NAMESPACE,
} from '../data/persistentByteRangeCache'
import { CachedHttpRangeReader } from './cachedZipStore'
import type {
  ByteRangeCacheKey,
  PersistentByteRangeCache,
} from '../data/persistentByteRangeCache'

const ZIP_URL = 'https://example.test/stores/sample.zarr.zip'

describe('cached zip range reader', () => {
  it('caches ranges under the size and ETag from the HEAD it already makes', async () => {
    const cache = new MemoryByteRangeCache()
    const original = zipServer({ byteLength: 1_000, etag: '"etag-1"', value: 1 })
    const reader = new CachedHttpRangeReader(ZIP_URL, cache, original.fetcher)

    await expect(reader.getLength()).resolves.toBe(1_000)
    await reader.read(996, 4)

    expect(original.requests).toEqual(['HEAD', 'bytes=996-999'])
    expect(cache.keys()).toEqual([
      byteRangeCacheRecordId({
        namespace: ZARR_ZIP_CACHE_NAMESPACE,
        url: ZIP_URL,
        version: '1000 "etag-1"',
        start: 996,
        end: 1_000,
      }),
    ])
  })

  it('misses ranges cached from the zip it replaced at the URL', async () => {
    const cache = new MemoryByteRangeCache()
    const readTail = async (server: ReturnType<typeof zipServer>) => {
      const reader = new CachedHttpRangeReader(ZIP_URL, cache, server.fetcher)
      await reader.getLength()
      return Array.from(await reader.read(996, 4))
    }
    const reopened = zipServer({ byteLength: 1_000, etag: '"etag-1"', value: 9 })
    const resized = zipServer({ byteLength: 1_200, etag: '"etag-1"', value: 2 })
    const rewritten = zipServer({ byteLength: 1_000, etag: '"etag-2"', value: 3 })

    await readTail(zipServer({ byteLength: 1_000, etag: '"etag-1"', value: 1 }))

    await expect(readTail(reopened)).resolves.toEqual([1, 1, 1, 1])
    expect(reopened.requests).toEqual(['HEAD'])
    await expect(readTail(resized)).resolves.toEqual([2, 2, 2, 2])
    await expect(readTail(rewritten)).resolves.toEqual([3, 3, 3, 3])
  })
})

// A zip of `byteLength` bytes, all `value`, recording each request.
function zipServer(file: {
  readonly byteLength: number
  readonly etag: string
  readonly value: number
}): { readonly fetcher: typeof fetch; readonly requests: string[] } {
  const requests: string[] = []
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)

    if (init?.method === 'HEAD') {
      requests.push('HEAD')
      return new Response(null, {
        headers: { 'Content-Length': String(file.byteLength), ETag: file.etag },
      })
    }

    const range = headers.get('Range') ?? ''
    const [start = 0, end = 0] = (/^bytes=(\d+)-(\d+)$/.exec(range) ?? [])
      .slice(1)
      .map(Number)
    requests.push(range)
    return new Response(new Uint8Array(end - start + 1).fill(file.value), {
      status: 206,
      headers: { ETag: file.etag },
    })
  }) as typeof fetch

  return { fetcher, requests }
}

class MemoryByteRangeCache implements PersistentByteRangeCache {
  private readonly cache = new Map<string, ArrayBuffer>()

  async read(key: ByteRangeCacheKey): Promise<ArrayBuffer | null> {
    return this.cache.get(byteRangeCacheRecordId(key)) ?? null
  }

  async write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    this.cache.set(byteRangeCacheRecordId(key), new Uint8Array(bytes).slice().buffer)
  }

  keys(): readonly string[] {
    return [...this.cache.keys()]
  }
}
