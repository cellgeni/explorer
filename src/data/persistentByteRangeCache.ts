export const DEFAULT_BYTE_RANGE_CACHE_NAME = 'cellgeni-byte-range-cache'
export const DEFAULT_BYTE_RANGE_CACHE_VERSION = 1
export const DEFAULT_BYTE_RANGE_CACHE_MAX_BYTES = 256 * 1024 * 1024
export const DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRIES = 20_000
export const DEFAULT_BYTE_RANGE_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024
export const DEFAULT_PARQUET_FOOTER_CACHE_BYTES = 512 * 1024
export const PARQUET_FOOTER_CACHE_NAMESPACE = 'parquet-footer'
export const TIFF_TILE_CACHE_NAMESPACE = 'tiff-tile'

const BYTE_RANGE_STORE_NAME = 'byte-ranges'

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

interface ByteRangeRecord {
  readonly id: string
  readonly namespace: string
  readonly url: string
  readonly start: number
  readonly end: number
  readonly byteLength: number
  readonly lastAccessed: number
  readonly bytes: ArrayBuffer
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
    const transaction = db.transaction(BYTE_RANGE_STORE_NAME, 'readonly')
    const record = await requestToPromise<ByteRangeRecord | undefined>(
      transaction.objectStore(BYTE_RANGE_STORE_NAME).get(byteRangeCacheRecordId(key)),
    )
    await transactionDone(transaction)

    if (record === undefined) {
      return null
    }

    void this.touch(record).catch(noop)
    return copyToArrayBuffer(record.bytes)
  }

  async write(key: ByteRangeCacheKey, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    const byteLength = bytes.byteLength

    if (byteLength <= 0 || byteLength > this.maxEntryBytes) {
      return
    }

    const db = await this.dbPromise
    const transaction = db.transaction(BYTE_RANGE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(BYTE_RANGE_STORE_NAME)
    const record: ByteRangeRecord = {
      id: byteRangeCacheRecordId(key),
      namespace: key.namespace,
      url: key.url,
      start: key.start,
      end: key.end,
      byteLength,
      lastAccessed: this.now(),
      bytes: copyToArrayBuffer(bytes),
    }

    store.put(record)
    await transactionDone(transaction)
    await this.evict(db)
  }

  private async touch(record: ByteRangeRecord): Promise<void> {
    const db = await this.dbPromise
    const transaction = db.transaction(BYTE_RANGE_STORE_NAME, 'readwrite')

    transaction.objectStore(BYTE_RANGE_STORE_NAME).put({
      ...record,
      lastAccessed: this.now(),
    })
    await transactionDone(transaction)
  }

  private async evict(db: IDBDatabase): Promise<void> {
    const records = await readAllByteRangeRecords(db)
    let totalBytes = 0

    for (const record of records) {
      totalBytes += record.byteLength
    }

    if (records.length <= this.maxEntries && totalBytes <= this.maxBytes) {
      return
    }

    const oldestFirst = [...records].sort((a, b) => a.lastAccessed - b.lastAccessed)
    const idsToDelete: string[] = []

    for (const record of oldestFirst) {
      if (
        records.length - idsToDelete.length <= this.maxEntries &&
        totalBytes <= this.maxBytes
      ) {
        break
      }

      idsToDelete.push(record.id)
      totalBytes -= record.byteLength
    }

    if (idsToDelete.length === 0) {
      return
    }

    const transaction = db.transaction(BYTE_RANGE_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(BYTE_RANGE_STORE_NAME)

    for (const id of idsToDelete) {
      store.delete(id)
    }

    await transactionDone(transaction)
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

    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(BYTE_RANGE_STORE_NAME)
        ? request.transaction?.objectStore(BYTE_RANGE_STORE_NAME)
        : db.createObjectStore(BYTE_RANGE_STORE_NAME, { keyPath: 'id' })

      if (store !== undefined && !store.indexNames.contains('lastAccessed')) {
        store.createIndex('lastAccessed', 'lastAccessed')
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error(`Unable to open ${databaseName}.`))
    }
  })
}

async function readAllByteRangeRecords(
  db: IDBDatabase,
): Promise<readonly ByteRangeRecord[]> {
  const transaction = db.transaction(BYTE_RANGE_STORE_NAME, 'readonly')
  const records = await requestToPromise<ByteRangeRecord[]>(
    transaction.objectStore(BYTE_RANGE_STORE_NAME).getAll(),
  )

  await transactionDone(transaction)
  return records
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
