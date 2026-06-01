import { describe, expect, it, vi } from 'vitest'
import {
  byteRangeCacheRecordId,
  cacheFooterByteRanges,
  fetchByteRangeWithCache,
} from './persistentByteRangeCache'
import type {
  ByteRangeCacheKey,
  PersistentByteRangeCache,
} from './persistentByteRangeCache'

describe('persistent byte range cache', () => {
  it('reuses cached byte ranges before calling the network fetcher', async () => {
    const cache = new MemoryByteRangeCache()
    const fetchRange = vi.fn(async () => new Uint8Array([1, 2, 3, 4]))
    const options = {
      cache,
      namespace: 'tiles',
      url: 'https://example.test/image.ome.tif',
      start: 10,
      end: 14,
      fetchRange,
    }

    await expect(fetchByteRangeWithCache(options)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    await expect(fetchByteRangeWithCache(options)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )

    expect(fetchRange).toHaveBeenCalledOnce()
    expect(cache.keys()).toEqual([
      byteRangeCacheRecordId({
        namespace: 'tiles',
        url: 'https://example.test/image.ome.tif',
        start: 10,
        end: 14,
      }),
    ])
  })

  it('caches parquet footer-like slices while leaving data pages uncached', async () => {
    const cache = new MemoryByteRangeCache()
    const slice = vi.fn(async (start: number, end = 1_000) => {
      return new Uint8Array([start, end]).buffer
    })
    const file = cacheFooterByteRanges(
      {
        byteLength: 1_000,
        slice,
      },
      {
        cache,
        footerByteLength: 100,
        namespace: 'parquet-footer',
        url: 'https://example.test/cells.parquet',
      },
    )

    await file.slice(900, 1_000)
    await file.slice(900, 1_000)
    await file.slice(0, 100)
    await file.slice(0, 100)

    expect(slice.mock.calls).toEqual([
      [900, 1_000],
      [0, 100],
      [0, 100],
    ])
    expect(cache.keys()).toEqual([
      byteRangeCacheRecordId({
        namespace: 'parquet-footer',
        url: 'https://example.test/cells.parquet',
        start: 900,
        end: 1_000,
      }),
    ])
  })

  it('falls back to the fetcher when cache reads fail', async () => {
    const cache = {
      read: vi.fn(async () => {
        throw new Error('indexeddb unavailable')
      }),
      write: vi.fn(async () => undefined),
    }
    const fetchRange = vi.fn(async () => new Uint8Array([5]))

    await expect(
      fetchByteRangeWithCache({
        cache,
        namespace: 'tiles',
        url: 'https://example.test/image.ome.tif',
        start: 0,
        end: 1,
        fetchRange,
      }),
    ).resolves.toEqual(new Uint8Array([5]))
    expect(fetchRange).toHaveBeenCalledOnce()
  })
})

class MemoryByteRangeCache implements PersistentByteRangeCache {
  private readonly cache = new Map<string, ArrayBuffer>()

  async read(key: ByteRangeCacheKey): Promise<ArrayBuffer | null> {
    return this.cache.get(byteRangeCacheRecordId(key)) ?? null
  }

  async write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    this.cache.set(byteRangeCacheRecordId(key), copyToArrayBuffer(bytes))
  }

  keys(): readonly string[] {
    return [...this.cache.keys()]
  }
}

function copyToArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  const source =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes, 0, bytes.byteLength)
  const copy = new Uint8Array(source.byteLength)

  copy.set(source)
  return copy.buffer
}
