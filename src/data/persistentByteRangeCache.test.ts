import {
  IDBFactory as FakeIDBFactory,
  IDBIndex as FakeIDBIndex,
  IDBObjectStore as FakeIDBObjectStore,
} from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  byteRangeCacheRecordId,
  cacheFooterByteRanges,
  createIndexedDbByteRangeCache,
  DEFAULT_BYTE_RANGE_CACHE_NAME,
  DEFAULT_BYTE_RANGE_CACHE_VERSION,
  fetchByteRangeWithCache,
} from './persistentByteRangeCache'
import type {
  ByteRangeCacheKey,
  IndexedDbByteRangeCacheOptions,
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

describe('IndexedDB byte range cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads back written ranges and skips empty or oversized ones', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntryBytes: 4 })

    await cache.write(rangeKey(0), filledBytes(1))
    await cache.write(rangeKey(10), new Uint8Array(0))
    await cache.write(rangeKey(20), filledBytes(2, 5))

    await expect(readValues(cache, rangeKey(0))).resolves.toEqual([1, 1, 1, 1])
    await expect(cache.read(rangeKey(10))).resolves.toBeNull()
    await expect(cache.read(rangeKey(20))).resolves.toBeNull()
    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(0)],
      entryIds: [rangeId(0)],
      totals: { entries: 1, bytes: 4 },
    })
  })

  it('evicts the least recently read ranges over the byte limit', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxBytes: 12 })

    await cache.write(rangeKey(0), filledBytes(1))
    await cache.write(rangeKey(10), filledBytes(2))
    await cache.write(rangeKey(20), filledBytes(3))
    await readValues(cache, rangeKey(0))
    await cache.write(rangeKey(30), filledBytes(4))

    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(0), rangeId(20), rangeId(30)].sort(),
      entryIds: [rangeId(0), rangeId(20), rangeId(30)].sort(),
      totals: { entries: 3, bytes: 12 },
    })
    await expect(cache.read(rangeKey(10))).resolves.toBeNull()
    await expect(readValues(cache, rangeKey(0))).resolves.toEqual([1, 1, 1, 1])
  })

  it('evicts the oldest ranges over the entry limit', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntries: 2 })

    await cache.write(rangeKey(0), filledBytes(1))
    await cache.write(rangeKey(10), filledBytes(2, 8))
    await cache.write(rangeKey(20), filledBytes(3))

    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(10), rangeId(20)],
      entryIds: [rangeId(10), rangeId(20)],
      totals: { entries: 2, bytes: 12 },
    })
  })

  it('counts a rewritten range once', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntries: 2, maxBytes: 8 })

    await cache.write(rangeKey(0), filledBytes(1))
    await cache.write(rangeKey(0), filledBytes(5))
    await cache.write(rangeKey(10), filledBytes(2))

    await expect(readValues(cache, rangeKey(0))).resolves.toEqual([5, 5, 5, 5])
    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(0), rangeId(10)],
      entryIds: [rangeId(0), rangeId(10)],
      totals: { entries: 2, bytes: 8 },
    })
  })

  it('keeps the totals across connections', async () => {
    const indexedDB = new FakeIDBFactory()
    const now = clock()
    const first = indexedDbCache(indexedDB, { now })

    await first.write(rangeKey(0), filledBytes(1))
    await first.write(rangeKey(10), filledBytes(2))
    await first.write(rangeKey(20), filledBytes(3))

    const second = indexedDbCache(indexedDB, { maxBytes: 12, now })
    await second.write(rangeKey(30), filledBytes(4))

    await expect(second.read(rangeKey(0))).resolves.toBeNull()
    await expect(storedState(indexedDB)).resolves.toMatchObject({
      totals: { entries: 3, bytes: 12 },
    })
  })

  it('evicts without reading cached bytes', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntries: 3 })
    const storeReads = ['get', 'getAll', 'openCursor'] as const
    const spies = [
      ...storeReads.map((method) => vi.spyOn(FakeIDBObjectStore.prototype, method)),
      vi.spyOn(FakeIDBIndex.prototype, 'getAll'),
    ]

    for (let index = 0; index < 8; index += 1) {
      await cache.write(rangeKey(index * 10), filledBytes(index))
    }

    const storesRead = spies
      .flatMap((spy) => spy.mock.contexts)
      .map((context) =>
        context instanceof FakeIDBIndex
          ? context.objectStore.name
          : (context as IDBObjectStore).name,
      )
    expect(storesRead.length).toBeGreaterThan(0)
    expect(new Set(storesRead)).toEqual(new Set(['range-entries', 'range-totals']))
    await expect(storedState(indexedDB)).resolves.toMatchObject({
      entryIds: [rangeId(50), rangeId(60), rangeId(70)],
      totals: { entries: 3, bytes: 12 },
    })
  })

  it('keeps a range evicted while it was being read evicted', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntries: 1 })

    await cache.write(rangeKey(0), filledBytes(1))
    // The write's transaction is queued behind the read's and ahead of the
    // read's access-time update, so it evicts the range in between.
    const [read] = await Promise.all([
      readValues(cache, rangeKey(0)),
      cache.write(rangeKey(10), filledBytes(2)),
    ])
    await cache.write(rangeKey(20), filledBytes(3))

    expect(read).toEqual([1, 1, 1, 1])
    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(20)],
      entryIds: [rangeId(20)],
      totals: { entries: 1, bytes: 4 },
    })
  })

  it('resets overcounted totals once eviction has emptied the cache', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB, { maxEntries: 2 })

    await cache.write(rangeKey(0), filledBytes(1))
    const db = await openDatabase(indexedDB)
    const transaction = db.transaction('range-totals', 'readwrite')
    await requestResult(
      transaction.objectStore('range-totals').put({ entries: 100, bytes: 400 }, 'totals'),
    )
    db.close()
    await cache.write(rangeKey(10), filledBytes(2))
    await cache.write(rangeKey(20), filledBytes(3))

    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(20)],
      entryIds: [rangeId(20)],
      totals: { entries: 1, bytes: 4 },
    })
  })

  it('drops version 1 ranges when it upgrades the database', async () => {
    const indexedDB = new FakeIDBFactory()
    const version1 = await openVersion1Database(indexedDB)
    version1.close()

    const cache = indexedDbCache(indexedDB)
    await expect(cache.read(rangeKey(0))).resolves.toBeNull()
    await cache.write(rangeKey(0), filledBytes(7))

    await expect(readValues(cache, rangeKey(0))).resolves.toEqual([7, 7, 7, 7])
    await expect(storedState(indexedDB)).resolves.toEqual({
      byteIds: [rangeId(0)],
      entryIds: [rangeId(0)],
      totals: { entries: 1, bytes: 4 },
    })
    const db = await openDatabase(indexedDB)
    expect(Array.from(db.objectStoreNames)).toEqual([
      'range-bytes',
      'range-entries',
      'range-totals',
    ])
    db.close()
  })

  it('fetches without the cache while an older version blocks the upgrade', async () => {
    const indexedDB = new FakeIDBFactory()
    const version1 = await openVersion1Database(indexedDB)
    const cache = indexedDbCache(indexedDB)
    const fetchRange = vi.fn(async () => filledBytes(3))

    await expect(cache.read(rangeKey(0))).rejects.toThrow(/older version/)
    await expect(
      fetchByteRangeWithCache({ cache, ...rangeKey(0), fetchRange }),
    ).resolves.toEqual(filledBytes(3))
    expect(fetchRange).toHaveBeenCalledOnce()
    version1.close()
  })

  it('closes its connection when a newer version opens', async () => {
    const indexedDB = new FakeIDBFactory()
    const cache = indexedDbCache(indexedDB)
    await cache.write(rangeKey(0), filledBytes(1))

    const newer = await openDatabase(indexedDB, DEFAULT_BYTE_RANGE_CACHE_VERSION + 1)
    newer.close()

    await expect(cache.read(rangeKey(0))).rejects.toThrow()
  })
})

function indexedDbCache(
  indexedDB: IDBFactory,
  options: Omit<IndexedDbByteRangeCacheOptions, 'indexedDB'> = {},
): PersistentByteRangeCache {
  const cache = createIndexedDbByteRangeCache({ indexedDB, now: clock(), ...options })

  if (cache === null) {
    throw new Error('Expected an IndexedDB byte range cache.')
  }

  return cache
}

function clock(): () => number {
  let time = 0
  return () => (time += 1)
}

function rangeKey(start: number): ByteRangeCacheKey {
  return {
    namespace: 'zarr-zip',
    url: 'https://example.test/data.zarr.zip',
    start,
    end: start + 4,
  }
}

function rangeId(start: number): string {
  return byteRangeCacheRecordId(rangeKey(start))
}

function filledBytes(value: number, length = 4): Uint8Array {
  return new Uint8Array(length).fill(value)
}

async function readValues(
  cache: PersistentByteRangeCache,
  key: ByteRangeCacheKey,
): Promise<number[] | null> {
  const bytes = await cache.read(key)
  return bytes === null ? null : Array.from(new Uint8Array(bytes))
}

async function storedState(indexedDB: IDBFactory): Promise<{
  readonly byteIds: readonly IDBValidKey[]
  readonly entryIds: readonly IDBValidKey[]
  readonly totals: unknown
}> {
  const db = await openDatabase(indexedDB)
  const transaction = db.transaction(['range-bytes', 'range-entries', 'range-totals'])
  const [byteIds, entryIds, totals] = await Promise.all([
    requestResult(transaction.objectStore('range-bytes').getAllKeys()),
    requestResult(transaction.objectStore('range-entries').getAllKeys()),
    requestResult(transaction.objectStore('range-totals').get('totals')),
  ])

  db.close()
  return { byteIds, entryIds, totals }
}

// The version 1 schema, as an older build of the app left it.
async function openVersion1Database(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return await openDatabase(indexedDB, 1, (db) => {
    const store = db.createObjectStore('byte-ranges', { keyPath: 'id' })

    store.createIndex('lastAccessed', 'lastAccessed')
    store.put({
      id: rangeId(0),
      ...rangeKey(0),
      byteLength: 4,
      lastAccessed: 1,
      bytes: filledBytes(9).buffer,
    })
  })
}

async function openDatabase(
  indexedDB: IDBFactory,
  version?: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  const request = indexedDB.open(DEFAULT_BYTE_RANGE_CACHE_NAME, version)

  request.onupgradeneeded = () => {
    upgrade?.(request.result)
  }
  return await requestResult(request)
}

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error)
    }
  })
}

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
