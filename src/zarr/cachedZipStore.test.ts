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

  it('refuses a host that ignores Range without reading the whole zip', async () => {
    const cache = new MemoryByteRangeCache()
    const body = countedBody(100, 10)
    const reader = new CachedHttpRangeReader(
      ZIP_URL,
      cache,
      rangeReplies(() => new Response(body.stream, { status: 200 })),
    )

    await expect(reader.read(96, 4)).rejects.toThrow(
      'the host ignored the range request (HTTP 200 for bytes 96-99)',
    )
    expect(body.cancelled()).toBe(true)
    expect(body.pulled()).toBeLessThan(100)
    expect(cache.keys()).toEqual([])
  })

  it('refuses a range shorter than asked for', async () => {
    const cache = new MemoryByteRangeCache()
    const reader = new CachedHttpRangeReader(
      ZIP_URL,
      cache,
      rangeReplies(() => new Response(new Uint8Array(3), { status: 206 })),
    )

    await expect(reader.read(96, 4)).rejects.toThrow(
      '3 bytes returned for bytes 96-99 (4 expected)',
    )
    expect(cache.keys()).toEqual([])
  })

  it('stops reading a range longer than asked for', async () => {
    const body = countedBody(1_000, 10)
    const reader = new CachedHttpRangeReader(
      ZIP_URL,
      null,
      rangeReplies(() => new Response(body.stream, { status: 206 })),
    )

    await expect(reader.read(96, 4)).rejects.toThrow(
      'more than 4 bytes returned for bytes 96-99',
    )
    expect(body.cancelled()).toBe(true)
    expect(body.pulled()).toBe(10)
  })

  it('refuses a range whose headers name other bytes before reading it', async () => {
    const replies = [
      { 'Content-Range': 'bytes 0-3/100' },
      { 'Content-Range': 'bytes 0-99/100' },
      { 'Content-Length': '100' },
    ]

    for (const headers of replies) {
      const body = countedBody(4, 4)
      const reader = new CachedHttpRangeReader(
        ZIP_URL,
        null,
        rangeReplies(() => new Response(body.stream, { status: 206, headers })),
      )

      await expect(reader.read(96, 4)).rejects.toThrow('bytes 96-99')
      expect(body.cancelled()).toBe(true)
      expect(body.pulled()).toBe(0)
    }
  })

  it('reads a range whose headers match it', async () => {
    const reader = new CachedHttpRangeReader(
      ZIP_URL,
      null,
      rangeReplies(
        () =>
          new Response(Uint8Array.of(1, 2, 3, 4), {
            status: 206,
            headers: { 'Content-Range': 'bytes 96-99/100', 'Content-Length': '4' },
          }),
      ),
    )

    await expect(reader.read(96, 4)).resolves.toEqual(Uint8Array.of(1, 2, 3, 4))
  })
})

// A 100-byte zip whose range requests get `reply`.
function rangeReplies(reply: () => Response): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'HEAD'
      ? new Response(null, { headers: { 'Content-Length': '100' } })
      : reply()) as typeof fetch
}

// A body of `byteLength` bytes sent `chunkLength` at a time, counting the
// bytes the reader pulled and whether it was cancelled.
function countedBody(
  byteLength: number,
  chunkLength: number,
): {
  readonly stream: ReadableStream<Uint8Array>
  readonly pulled: () => number
  readonly cancelled: () => boolean
} {
  let pulled = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const length = Math.min(chunkLength, byteLength - pulled)

        if (length === 0) {
          controller.close()
          return
        }

        pulled += length
        controller.enqueue(new Uint8Array(length))
      },
      cancel() {
        cancelled = true
      },
    },
    { highWaterMark: 0 },
  )

  return { stream, pulled: () => pulled, cancelled: () => cancelled }
}

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
