export const DEFAULT_BYTE_RANGE_CACHE_NAME = 'cellgeni-byte-range-cache'
export const DEFAULT_BYTE_RANGE_CACHE_VERSION = 2
export const DEFAULT_BYTE_RANGE_CACHE_MAX_BYTES = 256 * 1024 * 1024
export const DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRIES = 20_000
export const DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024
export const DEFAULT_PARQUET_FOOTER_CACHE_BYTES = 512 * 1024
export const PARQUET_FOOTER_CACHE_NAMESPACE = 'parquet-footer'
export const TIFF_TILE_CACHE_NAMESPACE = 'tiff-tile'
export const ZARR_ZIP_CACHE_NAMESPACE = 'zarr-zip'

// Each range's bytes, its size and last access, and the cache's totals live in
// separate stores, so a write can check the limits and pick the least recently
// used ranges without reading any cached bytes.
const BYTES_STORE_NAME = 'range-bytes'
const ENTRIES_STORE_NAME = 'range-entries'
const TOTALS_STORE_NAME = 'range-totals'
const BYTE_RANGE_STORE_NAMES = [BYTES_STORE_NAME, ENTRIES_STORE_NAME, TOTALS_STORE_NAME]
const LAST_ACCESSED_INDEX_NAME = 'lastAccessed'
const TOTALS_KEY = 'totals'

export interface ByteRangeCacheKey {
  readonly namespace: string
  readonly url: string
  readonly start: number
  readonly end: number
}

export interface PersistentByteRangeCache {
  read(key: ByteRangeCacheKey): Promise<ArrayBuffer | null>
  write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void>
}

export interface IndexedDbByteRangeCacheOptions {
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
  readonly version?: number
  readonly maxBytes?: number
  readonly maxEntries?: number
  readonly maxEntryBytes?: number
  readonly now?: () => number
}

interface ByteRangeBytesRecord {
  readonly id: string
  readonly bytes: ArrayBuffer
}

interface ByteRangeEntryRecord {
  readonly id: string
  readonly byteLength: number
  readonly lastAccessed: number
}

interface ByteRangeTotals {
  readonly entries: number
  readonly bytes: number
}

export interface FetchByteRangeWithCacheOptions {
  readonly cache?: PersistentByteRangeCache | null
  readonly namespace: string
  readonly url: string
  readonly start: number
  readonly end: number
  readonly signal?: AbortSignal
  readonly fetchRange: (signal?: AbortSignal) => Promise<Uint8Array>
}

export interface AsyncByteSource {
  readonly byteLength: number
  slice(start: number, end?: number): ArrayBuffer | Promise<ArrayBuffer>
}

export interface CacheFooterByteRangesOptions {
  readonly cache?: PersistentByteRangeCache | null
  readonly namespace?: string
  readonly url: string
  readonly footerByteLength?: number
  readonly maxEntryBytes?: number
}

let defaultCache: PersistentByteRangeCache | null | undefined

export function defaultPersistentByteRangeCache(): PersistentByteRangeCache | null {
  if (defaultCache !== undefined) {
    return defaultCache
  }

  defaultCache = createIndexedDbByteRangeCache()
  return defaultCache
}

export function createIndexedDbByteRangeCache(
  options: IndexedDbByteRangeCacheOptions = {},
): PersistentByteRangeCache | null {
  const indexedDb = options.indexedDB ?? globalThis.indexedDB

  if (indexedDb === undefined) {
    return null
  }

  return new IndexedDbByteRangeCache(indexedDb, options)
}

export async function fetchByteRangeWithCache(
  options: FetchByteRangeWithCacheOptions,
): Promise<Uint8Array> {
  throwIfAborted(options.signal)

  const cached = await readCachedBytes(options)

  if (cached !== null) {
    throwIfAborted(options.signal)
    return new Uint8Array(cached)
  }

  const bytes = await options.fetchRange(options.signal)
  throwIfAborted(options.signal)
  writeCachedBytes(options, bytes)

  return bytes
}

export function cacheFooterByteRanges<T extends AsyncByteSource>(
  file: T,
  options: CacheFooterByteRangesOptions,
): T {
  const namespace = options.namespace ?? PARQUET_FOOTER_CACHE_NAMESPACE
  const footerByteLength = options.footerByteLength ?? DEFAULT_PARQUET_FOOTER_CACHE_BYTES
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRY_BYTES
  const cache = options.cache

  if (cache === null || cache === undefined) {
    return file
  }

  return {
    ...file,
    byteLength: file.byteLength,
    async slice(start: number, end = file.byteLength): Promise<ArrayBuffer> {
      if (
        !shouldCacheFooterRange({
          byteLength: file.byteLength,
          end,
          footerByteLength,
          maxEntryBytes,
          start,
        })
      ) {
        return file.slice(start, end)
      }

      const bytes = await fetchByteRangeWithCache({
        cache,
        namespace,
        url: options.url,
        start,
        end,
        fetchRange: async () => new Uint8Array(await file.slice(start, end)),
      })

      return copyToArrayBuffer(bytes)
    },
  } as T
}

export function byteRangeCacheRecordId(key: ByteRangeCacheKey): string {
  return `${key.namespace}\n${key.url}\n${key.start}\n${key.end}`
}

class IndexedDbByteRangeCache implements PersistentByteRangeCache {
  private readonly databaseName: string
  private readonly dbPromise: Promise<IDBDatabase>
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly maxEntryBytes: number
  private readonly now: () => number

  constructor(indexedDb: IDBFactory, options: IndexedDbByteRangeCacheOptions) {
    this.databaseName = options.databaseName ?? DEFAULT_BYTE_RANGE_CACHE_NAME
    this.maxBytes = options.maxBytes ?? DEFAULT_BYTE_RANGE_CACHE_MAX_BYTES
    this.maxEntries = options.maxEntries ?? DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRIES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRY_BYTES
    this.now = options.now ?? Date.now
    this.dbPromise = openByteRangeDatabase(
      indexedDb,
      this.databaseName,
      options.version ?? DEFAULT_BYTE_RANGE_CACHE_VERSION,
    )
  }

  async read(key: ByteRangeCacheKey): Promise<ArrayBuffer | null> {
    const db = await this.dbPromise
    const id = byteRangeCacheRecordId(key)
    const transaction = db.transaction(BYTES_STORE_NAME, 'readonly')
    const record = await requestToPromise<ByteRangeBytesRecord | undefined>(
      transaction.objectStore(BYTES_STORE_NAME).get(id),
    )
    await transactionDone(transaction)

    if (record === undefined) {
      return null
    }

    void this.touch(id).catch(noop)
    return copyToArrayBuffer(record.bytes)
  }

  // Stores the range and evicts the least recently used ones over the limits in
  // one transaction, so tabs writing at the same time keep the totals right.
  async write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    const byteLength = bytes.byteLength

    if (byteLength <= 0 || byteLength > this.maxEntryBytes) {
      return
    }

    const db = await this.dbPromise
    const id = byteRangeCacheRecordId(key)
    const transaction = db.transaction(BYTE_RANGE_STORE_NAMES, 'readwrite')
    const entries = transaction.objectStore(ENTRIES_STORE_NAME)
    const totalsStore = transaction.objectStore(TOTALS_STORE_NAME)
    const bytesRecord: ByteRangeBytesRecord = { id, bytes: copyToArrayBuffer(bytes) }
    const entry: ByteRangeEntryRecord = { id, byteLength, lastAccessed: this.now() }

    transaction.objectStore(BYTES_STORE_NAME).put(bytesRecord)
    const [totals, replaced] = await Promise.all([
      requestToPromise<ByteRangeTotals | undefined>(totalsStore.get(TOTALS_KEY)),
      requestToPromise<ByteRangeEntryRecord | undefined>(entries.get(id)),
    ])
    entries.put(entry)
    totalsStore.put(
      await this.evictOverLimits(transaction, {
        entries: (totals?.entries ?? 0) + (replaced === undefined ? 1 : 0),
        bytes: (totals?.bytes ?? 0) - (replaced?.byteLength ?? 0) + byteLength,
      }),
      TOTALS_KEY,
    )
    await transactionDone(transaction)
  }

  private async touch(id: string): Promise<void> {
    const db = await this.dbPromise
    const transaction = db.transaction(ENTRIES_STORE_NAME, 'readwrite')
    const lastAccessed = this.now()
    const request = transaction.objectStore(ENTRIES_STORE_NAME).openCursor(id)

    request.onsuccess = () => {
      const cursor = request.result

      // A range evicted since it was read stays evicted.
      if (cursor !== null) {
        cursor.update({ ...(cursor.value as ByteRangeEntryRecord), lastAccessed })
      }
    }
    await transactionDone(transaction)
  }

  // Deletes ranges oldest access first until the totals are within the limits,
  // reading only the small entry records, and returns the new totals.
  private async evictOverLimits(
    transaction: IDBTransaction,
    totals: ByteRangeTotals,
  ): Promise<ByteRangeTotals> {
    let { entries, bytes } = totals

    if (entries <= this.maxEntries && bytes <= this.maxBytes) {
      return totals
    }

    const bytesStore = transaction.objectStore(BYTES_STORE_NAME)
    const request = transaction
      .objectStore(ENTRIES_STORE_NAME)
      .index(LAST_ACCESSED_INDEX_NAME)
      .openCursor()
    let cursor = await requestToPromise(request)

    while (cursor !== null && (entries > this.maxEntries || bytes > this.maxBytes)) {
      const entry = cursor.value as ByteRangeEntryRecord

      bytesStore.delete(entry.id)
      cursor.delete()
      entries -= 1
      bytes -= entry.byteLength
      cursor.continue()
      cursor = await requestToPromise(request)
    }

    // Every range was deleted, so the totals are zero whatever they said.
    return cursor === null ? { entries: 0, bytes: 0 } : { entries, bytes }
  }
}

async function readCachedBytes(
  options: FetchByteRangeWithCacheOptions,
): Promise<ArrayBuffer | null> {
  if (options.cache === null || options.cache === undefined) {
    return null
  }

  try {
    return await options.cache.read(cacheKeyFromOptions(options))
  } catch {
    return null
  }
}

function writeCachedBytes(
  options: FetchByteRangeWithCacheOptions,
  bytes: Uint8Array,
): void {
  if (options.cache === null || options.cache === undefined) {
    return
  }

  void options.cache.write(cacheKeyFromOptions(options), bytes).catch(noop)
}

function cacheKeyFromOptions(options: FetchByteRangeWithCacheOptions): ByteRangeCacheKey {
  return {
    namespace: options.namespace,
    url: options.url,
    start: options.start,
    end: options.end,
  }
}

function shouldCacheFooterRange(options: {
  readonly byteLength: number
  readonly start: number
  readonly end: number
  readonly footerByteLength: number
  readonly maxEntryBytes: number
}): boolean {
  const length = options.end - options.start
  const footerStart = Math.max(0, options.byteLength - options.footerByteLength)

  return (
    Number.isFinite(length) &&
    length > 0 &&
    length <= options.maxEntryBytes &&
    options.end >= footerStart &&
    options.start < options.byteLength
  )
}

async function openByteRangeDatabase(
  indexedDb: IDBFactory,
  databaseName: string,
  version: number,
): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, version)
    let blocked = false

    request.onupgradeneeded = () => {
      const db = request.result

      // Version 1 kept each range's size and last access next to its bytes in
      // one `byte-ranges` store. Its ranges are dropped, not migrated: their
      // sizes could only be read with their bytes.
      for (const name of Array.from(db.objectStoreNames)) {
        if (!BYTE_RANGE_STORE_NAMES.includes(name)) {
          db.deleteObjectStore(name)
        }
      }

      if (!db.objectStoreNames.contains(BYTES_STORE_NAME)) {
        db.createObjectStore(BYTES_STORE_NAME, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(ENTRIES_STORE_NAME)) {
        db.createObjectStore(ENTRIES_STORE_NAME, { keyPath: 'id' }).createIndex(
          LAST_ACCESSED_INDEX_NAME,
          'lastAccessed',
        )
      }

      if (!db.objectStoreNames.contains(TOTALS_STORE_NAME)) {
        db.createObjectStore(TOTALS_STORE_NAME)
      }
    }
    // A tab still open at an older version holds up the upgrade until it
    // closes. Go without the cache rather than wait.
    request.onblocked = () => {
      blocked = true
      reject(new Error(`${databaseName} is open at an older version in another tab.`))
    }
    request.onsuccess = () => {
      const db = request.result

      if (blocked) {
        db.close()
        return
      }

      // Let a newer version open in another tab upgrade the database.
      db.onversionchange = () => {
        db.close()
      }
      resolve(db)
    }
    request.onerror = () => {
      reject(request.error ?? new Error(`Unable to open ${databaseName}.`))
    }
  })
}

async function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed.'))
    }
  })
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  return await new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    }
  })
}

function copyToArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  const source =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes, 0, bytes.byteLength)
  const copy = new Uint8Array(source.byteLength)

  copy.set(source)
  return copy.buffer
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Byte range request aborted.')
  error.name = 'AbortError'
  return error
}

function noop(): void {}
