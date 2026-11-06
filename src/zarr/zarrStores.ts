import * as zarr from 'zarrita'

export type ConsolidatedZarrStore = Required<zarr.AsyncReadable> & {
  contents(): { path: string; kind: 'array' | 'group' }[]
  // Chunk keys the host reported as absent. Zarr reads them as the array fill
  // value, which hides incomplete uploads.
  missingChunkKeys(): readonly string[]
}

// A chunk the host refused (403) or, for arrays that cannot be represented by
// a fill value such as variable-length strings, did not return (404).
export class ZarrChunkUnavailableError extends Error {
  readonly key: string
  readonly status: number

  constructor(key: string, status: number, detail: string) {
    super(
      `Zarr chunk ${key.replace(/^\/+/, '')} could not be read (HTTP ${status}). ${detail}`,
    )
    this.name = 'ZarrChunkUnavailableError'
    this.key = key
    this.status = status
  }
}

const MAX_TRACKED_MISSING_CHUNKS = 1_000

export interface ConsolidatedZarrMetadata {
  readonly knownMetadata: ReadonlyMap<string, unknown>
  readonly zarrFormat: 2 | 3
}

// Probed in order of preference: v3 `zarr.json` with `consolidated_metadata`,
// then the v2 `zmetadata` / `.zmetadata` conventions.
const CONSOLIDATED_METADATA_KEYS = [
  { key: '/zarr.json', zarrFormat: 3 },
  { key: '/zmetadata', zarrFormat: 2 },
  { key: '/.zmetadata', zarrFormat: 2 },
] as const

// Object stores that deny listing (for example S3 buckets without public
// ListBucket) return 403 instead of 404 for missing keys. zarrita probes
// optional metadata such as `zarr.json` and per-array `.zattrs`, and FetchStore
// only treats 404 as missing, so metadata 403s are remapped to 404. Chunk 403s
// surface as ZarrChunkUnavailableError.
export function createZarrFetchStore(
  url: string,
  options: { readonly fetcher?: typeof fetch } = {},
): zarr.FetchStore {
  const fetcher = options.fetcher
  const rootPath = new URL(url).pathname.replace(/\/+$/, '')

  return new zarr.FetchStore(url, {
    async fetch(request: Request) {
      const response = await (fetcher ?? fetch)(request)

      if (response.status !== 403) {
        return response
      }

      const pathname = new URL(request.url).pathname

      if (isZarrMetadataKey(pathname)) {
        return new Response(null, { status: 404, statusText: 'Not Found' })
      }

      throw new ZarrChunkUnavailableError(
        pathname.startsWith(rootPath) ? pathname.slice(rootPath.length) : pathname,
        403,
        'The object is missing or not publicly readable.',
      )
    },
  })
}

// Reads consolidated metadata from the store root, or returns null when none
// of the known layouts is present. All layouts are requested at once so a
// store without consolidated metadata costs a single round trip.
export async function readConsolidatedZarrMetadata(
  store: zarr.AsyncReadable,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ConsolidatedZarrMetadata | null> {
  const results = await Promise.all(
    CONSOLIDATED_METADATA_KEYS.map(async (attempt) => {
      try {
        const bytes = await store.get(
          attempt.key,
          options.signal === undefined ? undefined : { signal: options.signal },
        )

        if (bytes === undefined) {
          return null
        }

        const json = jsonFromBytes(bytes)
        return attempt.zarrFormat === 3
          ? consolidatedV3Metadata(json)
          : consolidatedV2Metadata(json)
      } catch (error) {
        // HTML error pages from proxies surface as JSON parse errors and other
        // failures (for example 403s on non-metadata-named keys) mean "try
        // the next layout".
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }

        return null
      }
    }),
  )

  for (const [index, knownMetadata] of results.entries()) {
    const attempt = CONSOLIDATED_METADATA_KEYS[index]

    if (knownMetadata !== null && attempt !== undefined) {
      return { knownMetadata, zarrFormat: attempt.zarrFormat }
    }
  }

  return null
}

// Serves Zarr metadata from consolidated metadata and answers absent metadata
// keys (for example optional `.zattrs`) locally, so opening arrays needs no
// per-array metadata requests.
export function consolidatedZarrStore(
  base: zarr.AsyncReadable,
  knownMetadata: ReadonlyMap<string, unknown>,
  options: {
    readonly chunkCacheMaxBytes?: number
    // Limits the chunk cache to some keys, for example table arrays whose
    // readers re-request the same chunks.
    readonly cacheChunk?: (key: string) => boolean
  } = {},
): ConsolidatedZarrStore {
  const encoder = new TextEncoder()
  const chunkCache =
    options.chunkCacheMaxBytes === undefined
      ? undefined
      : new ByteLimitedCache(options.chunkCacheMaxBytes)

  const missingChunks = new Set<string>()

  return {
    async get(key, getOptions) {
      if (knownMetadata.has(key)) {
        return encoder.encode(JSON.stringify(knownMetadata.get(key)))
      }

      if (isZarrMetadataKey(key)) {
        return undefined
      }

      const cache = options.cacheChunk?.(key) === false ? undefined : chunkCache
      const cached = cache?.get(key)

      if (cached !== undefined) {
        return cached
      }

      const bytes = await base.get(key, getOptions)

      if (bytes !== undefined) {
        cache?.set(key, bytes)
        return bytes
      }

      if (missingChunks.size < MAX_TRACKED_MISSING_CHUNKS) {
        missingChunks.add(key)
      }

      if (isStringArrayMetadata(arrayMetadataForChunkKey(knownMetadata, key))) {
        throw new ZarrChunkUnavailableError(
          key,
          404,
          'String arrays have no fill value, so the store is incomplete.',
        )
      }

      return undefined
    },
    async getRange(key, range, getOptions) {
      if (base.getRange === undefined) {
        throw new Error('Zarr store does not support range requests.')
      }

      return base.getRange(key, range, getOptions)
    },
    contents() {
      const contents: { path: string; kind: 'array' | 'group' }[] = []

      for (const [key, value] of knownMetadata) {
        const parts = key.split('/')
        const fileName = parts.pop()
        const path = parts.join('/') || '/'

        if (fileName === '.zarray') {
          contents.push({ path, kind: 'array' })
        } else if (fileName === '.zgroup') {
          contents.push({ path, kind: 'group' })
        } else if (fileName === 'zarr.json') {
          const nodeType = recordOrNull(value)?.node_type
          contents.push({ path, kind: nodeType === 'array' ? 'array' : 'group' })
        }
      }

      return contents
    },
    missingChunkKeys() {
      return Array.from(missingChunks, (key) => key.replace(/^\/+/, ''))
    },
  }
}

// Finds the metadata of the array that owns a chunk key, for example
// `/table/obs/name/0` -> `/table/obs/name/.zarray`.
function arrayMetadataForChunkKey(
  knownMetadata: ReadonlyMap<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const parts = key.split('/')

  for (let end = parts.length - 1; end > 0; end -= 1) {
    const prefix = parts.slice(0, end).join('/')
    const v2 = recordOrNull(knownMetadata.get(`${prefix}/.zarray`))

    if (v2 !== null) {
      return v2
    }

    const v3 = recordOrNull(knownMetadata.get(`${prefix}/zarr.json`))

    if (v3 !== null) {
      return v3.node_type === 'array' ? v3 : null
    }
  }

  return null
}

export function isStringArrayMetadata(metadata: Record<string, unknown> | null): boolean {
  if (metadata === null) {
    return false
  }

  const dtype = metadata.dtype ?? metadata.data_type
  return (
    dtype === '|O' ||
    dtype === 'string' ||
    dtype === 'str' ||
    dtype === 'vlen-utf8' ||
    dtype === 'variable_length_utf8'
  )
}

export function isZarrMetadataKey(key: string): boolean {
  return /(?:^|\/)(?:\.zarray|\.zgroup|\.zattrs|\.zmetadata|zmetadata|zarr\.json)$/.test(
    key,
  )
}

class ByteLimitedCache {
  private readonly entries = new Map<string, Uint8Array>()
  private readonly maxBytes: number
  private byteLength = 0

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  get(key: string): Uint8Array | undefined {
    const value = this.entries.get(key)

    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }

    return value
  }

  set(key: string, value: Uint8Array): void {
    if (value.byteLength > this.maxBytes) {
      return
    }

    const previous = this.entries.get(key)

    if (previous !== undefined) {
      this.byteLength -= previous.byteLength
      this.entries.delete(key)
    }

    this.entries.set(key, value)
    this.byteLength += value.byteLength

    for (const [oldestKey, oldestValue] of this.entries) {
      if (this.byteLength <= this.maxBytes) {
        break
      }

      this.entries.delete(oldestKey)
      this.byteLength -= oldestValue.byteLength
    }
  }
}

function consolidatedV2Metadata(value: unknown): Map<string, unknown> | null {
  const record = recordOrNull(value)
  const metadata = recordOrNull(record?.metadata)

  if (record?.zarr_consolidated_format !== 1 || metadata === null) {
    return null
  }

  return new Map(Object.entries(metadata).map(([key, entry]) => [`/${key}`, entry]))
}

function consolidatedV3Metadata(value: unknown): Map<string, unknown> | null {
  const record = recordOrNull(value)
  const metadata = recordOrNull(recordOrNull(record?.consolidated_metadata)?.metadata)

  if (record?.zarr_format !== 3 || record.node_type !== 'group' || metadata === null) {
    return null
  }

  const known = new Map<string, unknown>([
    [
      '/zarr.json',
      { zarr_format: 3, node_type: 'group', attributes: record.attributes ?? {} },
    ],
  ])

  for (const [path, entry] of Object.entries(metadata)) {
    known.set(`/${path.replace(/^\/+/, '')}/zarr.json`, entry)
  }

  return known
}

// Chunk keys of a v2 `.zarray` or v3 `zarr.json` array, relative to the array
// path, in row-major chunk order.
export function zarrChunkKeys(
  metadata: Record<string, unknown>,
  options: { readonly limit?: number } = {},
): readonly string[] {
  const shape = numberList(metadata.shape)
  const v3Grid = recordOrNull(recordOrNull(metadata.chunk_grid)?.configuration)
  const chunks = numberList(v3Grid?.chunk_shape ?? metadata.chunks)
  const keyEncoding = recordOrNull(metadata.chunk_key_encoding)
  const isV3 = metadata.zarr_format === 3
  const v3Separator = recordOrNull(keyEncoding?.configuration)?.separator
  const separator = isV3
    ? typeof v3Separator === 'string'
      ? v3Separator
      : keyEncoding?.name === 'v2'
        ? '.'
        : '/'
    : metadata.dimension_separator === '/'
      ? '/'
      : '.'
  const prefix = isV3 && keyEncoding?.name !== 'v2' ? `c${separator}` : ''

  if (shape === null || chunks === null || shape.length !== chunks.length) {
    return []
  }

  if (shape.length === 0) {
    return [isV3 && keyEncoding?.name !== 'v2' ? 'c' : '0']
  }

  const counts = shape.map((size, index) => Math.ceil(size / (chunks[index] ?? size)))
  const total = counts.reduce((product, count) => product * count, 1)
  const limit = Math.min(total, options.limit ?? total)
  const keys: string[] = []

  for (let flat = 0; flat < limit; flat += 1) {
    const coords: number[] = []
    let rest = flat

    for (let axis = counts.length - 1; axis >= 0; axis -= 1) {
      const count = counts[axis] ?? 1
      coords.unshift(rest % count)
      rest = Math.floor(rest / count)
    }

    keys.push(`${prefix}${coords.join(separator)}`)
  }

  return keys
}

function numberList(value: unknown): readonly number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
    ? (value as number[])
    : null
}

function jsonFromBytes(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes))
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
