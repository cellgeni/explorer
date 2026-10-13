import * as zarr from 'zarrita'

export type ConsolidatedZarrStore = Required<zarr.AsyncReadable> & {
  contents(): { path: string; kind: 'array' | 'group' }[]
}

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
// still surface as errors.
export function createZarrFetchStore(
  url: string,
  options: { readonly fetcher?: typeof fetch } = {},
): zarr.FetchStore {
  const fetcher = options.fetcher

  return new zarr.FetchStore(url, {
    async fetch(request: Request) {
      const response = await (fetcher ?? fetch)(request)

      if (response.status === 403 && isZarrMetadataKey(new URL(request.url).pathname)) {
        return new Response(null, { status: 404, statusText: 'Not Found' })
      }

      return response
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
  options: { readonly chunkCacheMaxBytes?: number } = {},
): ConsolidatedZarrStore {
  const encoder = new TextEncoder()
  const chunkCache =
    options.chunkCacheMaxBytes === undefined
      ? undefined
      : new ByteLimitedCache(options.chunkCacheMaxBytes)

  return {
    async get(key, getOptions) {
      if (knownMetadata.has(key)) {
        return encoder.encode(JSON.stringify(knownMetadata.get(key)))
      }

      if (isZarrMetadataKey(key)) {
        return undefined
      }

      const cached = chunkCache?.get(key)

      if (cached !== undefined) {
        return cached
      }

      const bytes = await base.get(key, getOptions)

      if (bytes !== undefined) {
        chunkCache?.set(key, bytes)
      }

      return bytes
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
  }
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

function jsonFromBytes(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes))
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
