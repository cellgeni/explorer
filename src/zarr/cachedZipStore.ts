import { ZipFileStore } from '@zarrita/storage'
import {
  defaultPersistentByteRangeCache,
  fetchByteRangeWithCache,
  ZARR_ZIP_CACHE_NAMESPACE,
  type PersistentByteRangeCache,
} from '../data/persistentByteRangeCache'

// Zipped Zarr stores read over HTTP byte ranges. Ranges go through the
// persistent byte-range cache, so reopening a dataset reuses the zip central
// directory and chunks already fetched.
export function cachedZipFileStoreFromUrl(url: string): ZipFileStore {
  return new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache()),
  )
}

export interface ZipStoreWithEntries {
  readonly store: ZipFileStore
  // Every entry path in the zip, without a leading slash.
  readonly entryNames: readonly string[]
}

// Opens a zipped store and lists its entries, for stores without consolidated
// metadata whose layout has to be discovered from the zip directory.
export async function cachedZipFileStoreWithEntries(
  url: string,
): Promise<ZipStoreWithEntries> {
  let entryNames: readonly string[] = []
  const store = new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache()),
    {
      transformEntries: (entries) => {
        entryNames = Object.keys(entries)
        return entries
      },
    },
  )

  // Any lookup waits for the central directory, which fills entryNames.
  await store.has('/.zgroup')
  return { store, entryNames }
}

export class CachedHttpRangeReader {
  private byteLength: number | undefined

  constructor(
    readonly url: string,
    private readonly cache: PersistentByteRangeCache | null,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async getLength(): Promise<number> {
    if (this.byteLength !== undefined) {
      return this.byteLength
    }

    const response = await this.fetcher(this.url, { method: 'HEAD' })

    if (!response.ok) {
      throw new Error(
        `failed http request ${this.url}, status: ${response.status}: ${response.statusText}`,
      )
    }

    const byteLength = Number(response.headers.get('content-length'))

    if (!Number.isFinite(byteLength)) {
      throw new Error('could not get length')
    }

    this.byteLength = byteLength
    return byteLength
  }

  async read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
    if (size === 0) {
      return new Uint8Array(0)
    }

    const bytes = await fetchByteRangeWithCache({
      cache: this.cache,
      namespace: ZARR_ZIP_CACHE_NAMESPACE,
      url: this.url,
      start: offset,
      end: offset + size,
      fetchRange: async () => {
        const response = await this.fetcher(this.url, {
          headers: {
            Range: `bytes=${offset}-${offset + size - 1}`,
          },
        })

        if (!response.ok) {
          throw new Error(
            `failed http request ${this.url}, status: ${response.status} offset: ${offset} size: ${size}: ${response.statusText}`,
          )
        }

        return new Uint8Array(await response.arrayBuffer())
      },
    })

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy
  }
}
