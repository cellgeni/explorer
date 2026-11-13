import { ZipFileStore } from '@zarrita/storage'
import type { AsyncBuffer } from 'hyparquet'
import { defaultPersistentByteRangeCache } from '../data/persistentByteRangeCache'
import { CachedHttpRangeReader } from './cachedZipStore'

// A Zarr store shipped as one zip file, such as the SpatialData `.zarr.zip`
// exports on the BioImage Archive, read over HTTP byte ranges. The store root
// may sit at the top of the zip or in a folder inside it (zipping
// `sample.zarr/` keeps the folder), so keys are relative to that root.
export interface ZippedZarrStore {
  readonly url: string
  readonly store: ZipFileStore
  // Folder inside the zip that holds the Zarr root, with a trailing slash;
  // empty when the root is at the top of the zip.
  readonly root: string
  readonly fileCount: number
  // Size and zip compression of a file in the store, or undefined when the
  // zip lacks it. Paths are relative to the root, with no leading slash.
  entry(path: string): ZipFileInfo | undefined
  // Byte source for a file in the store, or null when the zip lacks it.
  // Stored (uncompressed) entries are read by range; compressed entries are
  // fetched and inflated whole on the first read.
  file(path: string): AsyncBuffer | null
}

export class ZarrZipRootError extends Error {
  readonly url: string

  constructor(url: string, detail: string) {
    super(`The zip at ${url} ${detail}`)
    this.name = 'ZarrZipRootError'
    this.url = url
  }
}

export interface OpenZippedZarrStoreOptions {
  readonly fetcher?: typeof fetch
}

export interface ZipFileInfo {
  // Uncompressed size in bytes.
  readonly size: number
  // Deflated in the zip, so read whole rather than by range.
  readonly compressed: boolean
}

const ROOT_METADATA_FILES = new Set([
  'zarr.json',
  '.zgroup',
  '.zattrs',
  'zmetadata',
  '.zmetadata',
])
// Folders macOS adds when it zips a folder; never part of the store.
const IGNORED_ZIP_FOLDER = '__MACOSX/'
// Stores opened by detection are reused by the dataset that follows.
const OPENED_STORE_CACHE_SIZE = 4

interface CachedStore {
  readonly fetcher: typeof fetch | undefined
  readonly promise: Promise<ZippedZarrStore>
}

const openedStores = new Map<string, CachedStore>()

// Opens the zip's central directory and finds the Zarr root. A store opened
// before with the same fetcher is reused.
export function openZippedZarrStore(
  url: string,
  options: OpenZippedZarrStoreOptions = {},
): Promise<ZippedZarrStore> {
  const cached = openedStores.get(url)

  if (cached !== undefined && cached.fetcher === options.fetcher) {
    openedStores.delete(url)
    openedStores.set(url, cached)
    return cached.promise
  }

  const promise = readZippedZarrStore(url, options.fetcher)
  openedStores.set(url, { fetcher: options.fetcher, promise })

  while (openedStores.size > OPENED_STORE_CACHE_SIZE) {
    const oldest = openedStores.keys().next().value

    if (oldest === undefined) {
      break
    }

    openedStores.delete(oldest)
  }

  promise.catch(() => {
    if (openedStores.get(url)?.promise === promise) {
      openedStores.delete(url)
    }
  })

  return promise
}

async function readZippedZarrStore(
  url: string,
  fetcher: typeof fetch | undefined,
): Promise<ZippedZarrStore> {
  let root = ''
  const files = new Map<string, ZipFileInfo>()
  const store = new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache(), fetcher),
    {
      transformEntries: (entries) => {
        root = zarrRootInZip(url, Object.keys(entries))
        const rooted: typeof entries = {}

        for (const [name, entry] of Object.entries(entries)) {
          if (entry.isDirectory || !name.startsWith(root) || name === root) {
            continue
          }

          const path = name.slice(root.length)
          rooted[path] = entry
          files.set(path, { size: entry.size, compressed: entry.compressionMethod !== 0 })
        }

        return rooted
      },
    },
  )

  // Any lookup waits for the central directory.
  await store.has('/zarr.json')

  return {
    url,
    store,
    root,
    fileCount: files.size,
    entry: (path) => files.get(path),
    file: (path) => {
      const info = files.get(path)
      return info === undefined ? null : zipEntryBuffer(store, path, info)
    },
  }
}

// The shallowest folder holding Zarr root metadata. A store's root group is
// always shallower than its arrays and child groups.
export function zarrRootInZip(url: string, names: readonly string[]): string {
  let depth = Number.POSITIVE_INFINITY
  const roots = new Set<string>()

  for (const name of names) {
    if (name.startsWith(IGNORED_ZIP_FOLDER)) {
      continue
    }

    const slash = name.lastIndexOf('/')
    const folder = name.slice(0, slash + 1)

    if (!ROOT_METADATA_FILES.has(name.slice(slash + 1))) {
      continue
    }

    const folderDepth = folder.split('/').length

    if (folderDepth < depth) {
      depth = folderDepth
      roots.clear()
    }

    if (folderDepth === depth) {
      roots.add(folder)
    }
  }

  const [root, ...others] = roots

  if (root === undefined) {
    throw new ZarrZipRootError(
      url,
      'holds no Zarr store: no zarr.json, .zgroup, .zattrs, or zmetadata file was found.',
    )
  }

  if (others.length > 0) {
    throw new ZarrZipRootError(
      url,
      `holds more than one Zarr store (${[root, ...others].map((folder) => folder || '/').join(', ')}). Zip one store per file.`,
    )
  }

  return root
}

function zipEntryBuffer(
  store: ZipFileStore,
  path: string,
  info: ZipFileInfo,
): AsyncBuffer {
  const key = `/${path}` as const

  if (!info.compressed) {
    return {
      byteLength: info.size,
      async slice(start, end = info.size) {
        const bytes = await store.getRange(key, { offset: start, length: end - start })
        return arrayBufferOf(bytes, path)
      },
    }
  }

  let whole: Promise<Uint8Array | undefined> | null = null
  const inflated = () => {
    if (whole === null) {
      const promise = store.get(key)
      whole = promise
      promise.catch(() => {
        if (whole === promise) {
          whole = null
        }
      })
    }

    return whole
  }

  return {
    byteLength: info.size,
    // A copy, so a caller that transfers the buffer leaves the entry intact.
    async slice(start, end = info.size) {
      return arrayBufferOf((await inflated())?.slice(start, end), path)
    },
  }
}

function arrayBufferOf(bytes: Uint8Array | undefined, path: string): ArrayBuffer {
  if (bytes === undefined) {
    throw new Error(`${path} could not be read from the zip.`)
  }

  const { buffer } = bytes

  return buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
    ? buffer
    : bytes.slice().buffer
}
