import {
  encodeObjectId12,
  IcechunkStore,
  NotFoundError,
  StorageError,
  type ByteRange,
  type FetchClient,
  type RequestOptions,
  type Storage,
} from 'icechunk-js'
import type * as zarr from 'zarrita'
import { abortable } from '../utils/abortable'
import { createAsyncLimiter } from '../utils/asyncLimiter'

// An Icechunk repository read through icechunk-js. Its snapshot holds every
// node's Zarr v3 metadata, so the hierarchy is known as soon as it opens and
// opening groups and arrays needs no further requests.
export interface IcechunkRepository {
  readonly url: string
  readonly store: Required<zarr.AsyncReadable>
  // Every group and array in the snapshot, root first, as paths without a
  // leading slash ('' is the root).
  readonly nodes: readonly IcechunkNode[]
  readonly rootAttributes: Readonly<Record<string, unknown>>
  // Each node's `zarr.json` by store key ('/zarr.json', '/obs/zarr.json'), in
  // the form `consolidatedZarrStore` takes.
  readonly metadata: ReadonlyMap<string, unknown>
  // Starts reading the chunk manifests of these arrays, several at once. Each
  // array has its own manifest, read before its first chunk, so a reader that
  // goes through arrays one at a time otherwise waits for one more round trip
  // per array.
  prefetchManifests(arrayPaths: readonly string[]): void
}

export interface IcechunkNode {
  readonly path: string
  readonly kind: 'array' | 'group'
}

export interface OpenIcechunkRepositoryOptions {
  readonly fetcher?: typeof fetch
  // Reads every virtual chunk from this URL instead of the location stored in
  // the repository, as for an H5AD's companion repository.
  readonly virtualChunkUrl?: string | undefined
  // Stops waiting; the open itself carries on for other callers.
  readonly signal?: AbortSignal
}

export class IcechunkRepositoryUnavailableError extends Error {
  readonly url: string
  // False when no object of the repository could be read, as when there is no
  // repository at the URL.
  readonly found: boolean

  constructor(url: string, cause: unknown, found: boolean) {
    super(
      `No readable Icechunk repository at ${url}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
    this.name = 'IcechunkRepositoryUnavailableError'
    this.url = url
    this.found = found
  }
}

// Repository files, manifests, chunks, and virtual chunks share one limit.
const ICECHUNK_FETCH_CONCURRENCY = 6
// Repositories opened by detection are reused by the dataset that follows.
const OPENED_REPOSITORY_CACHE_SIZE = 4

interface CachedRepository {
  readonly fetcher: typeof fetch | undefined
  readonly promise: Promise<IcechunkRepository>
}

const openedRepositories = new Map<string, CachedRepository>()

// Opens the `main` branch. A repository opened before with the same fetcher
// is reused.
export function openIcechunkRepository(
  url: string,
  options: OpenIcechunkRepositoryOptions = {},
): Promise<IcechunkRepository> {
  const normalizedUrl = normalizeRepositoryUrl(url)
  const key = `${normalizedUrl} ${options.virtualChunkUrl ?? ''}`
  const cached = openedRepositories.get(key)

  if (cached !== undefined && cached.fetcher === options.fetcher) {
    openedRepositories.delete(key)
    openedRepositories.set(key, cached)
    return abortable(cached.promise, options.signal)
  }

  const promise = readIcechunkRepository(
    normalizedUrl,
    options.fetcher ?? globalThis.fetch.bind(globalThis),
    options.virtualChunkUrl,
  )
  openedRepositories.set(key, { fetcher: options.fetcher, promise })

  while (openedRepositories.size > OPENED_REPOSITORY_CACHE_SIZE) {
    const oldest = openedRepositories.keys().next().value

    if (oldest === undefined) {
      break
    }

    openedRepositories.delete(oldest)
  }

  promise.catch(() => {
    if (openedRepositories.get(key)?.promise === promise) {
      openedRepositories.delete(key)
    }
  })

  return abortable(promise, options.signal)
}

async function readIcechunkRepository(
  url: string,
  fetcher: typeof fetch,
  virtualChunkUrl: string | undefined,
): Promise<IcechunkRepository> {
  const limit = createAsyncLimiter(ICECHUNK_FETCH_CONCURRENCY)
  const storage = new FetcherStorage(url, fetcher, limit)
  let store: IcechunkStore

  try {
    store = await IcechunkStore.open(storage, {
      fetchClient: virtualChunkFetchClient(fetcher, limit, virtualChunkUrl),
    })
  } catch (error) {
    throw new IcechunkRepositoryUnavailableError(url, error, storage.readCount > 0)
  }

  const nodes: IcechunkNode[] = []
  const metadata = new Map<string, unknown>()

  for (const node of store.listNodes()) {
    const path = node.path.replace(/^\/+|\/+$/g, '')
    nodes.push({ path, kind: node.nodeData.type })
    metadata.set(
      path === '' ? '/zarr.json' : `/${path}/zarr.json`,
      store.getMetadata(node.path),
    )
  }

  nodes.sort((left, right) => left.path.localeCompare(right.path))
  const rootMetadata = metadata.get('/zarr.json')

  return {
    url,
    store: store as Required<zarr.AsyncReadable>,
    nodes,
    rootAttributes: recordOrEmpty(recordOrEmpty(rootMetadata).attributes),
    metadata,
    prefetchManifests(arrayPaths) {
      for (const arrayPath of arrayPaths) {
        const node = store.getNode(`/${arrayPath.replace(/^\/+/, '')}`)

        if (node?.nodeData.type !== 'array') {
          continue
        }

        for (const manifest of node.nodeData.manifests) {
          storage.prefetch(`manifests/${encodeObjectId12(manifest.objectId)}`)
        }
      }
    },
  }
}

// Repository objects are read with the app's fetcher, so tests and hosts with
// special handling see the same requests as every other reader.
class FetcherStorage implements Storage {
  // Objects read so far; HEAD checks do not count.
  readCount = 0
  // Whole objects read ahead by `prefetch`, kept for icechunk-js to re-read if
  // its manifest cache drops one.
  private readonly prefetched = new Map<string, Promise<Uint8Array>>()

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch,
    private readonly limit: <T>(task: () => Promise<T>) => Promise<T>,
  ) {}

  prefetch(path: string): void {
    if (this.prefetched.has(path)) {
      return
    }

    const promise = this.readObject(path)
    this.prefetched.set(path, promise)
    // A failed read is dropped, so the reader's own request reports it.
    promise.catch(() => {
      this.prefetched.delete(path)
    })
  }

  async getObject(
    path: string,
    range?: ByteRange,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    const prefetched = range === undefined ? this.prefetched.get(path) : undefined

    if (prefetched !== undefined) {
      try {
        return await abortable(prefetched, options?.signal)
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }
      }
    }

    return this.readObject(path, range, options)
  }

  private async readObject(
    path: string,
    range?: ByteRange,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    const url = repositoryObjectUrl(this.baseUrl, path)
    let response: Response

    try {
      response = await this.limit(() =>
        this.fetcher(url, {
          ...(range === undefined
            ? {}
            : { headers: { Range: `bytes=${range.start}-${range.end - 1}` } }),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      )
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      throw new StorageError(
        `Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }

    // Object stores that deny listing answer 403 for a missing object. A v1
    // repository has no `repo` file, and icechunk-js only tries the v1 layout
    // after a NotFoundError.
    if (response.status === 404 || response.status === 403) {
      throw new NotFoundError(path)
    }

    if (!response.ok) {
      throw new StorageError(`HTTP ${response.status} for ${url}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    this.readCount += 1

    // Hosts that ignore Range send the whole object.
    return range !== undefined &&
      response.status === 200 &&
      bytes.byteLength > range.end - range.start
      ? bytes.subarray(range.start, range.end)
      : bytes
  }

  async exists(path: string, options?: RequestOptions): Promise<boolean> {
    try {
      const response = await this.limit(() =>
        this.fetcher(repositoryObjectUrl(this.baseUrl, path), {
          method: 'HEAD',
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      )
      return response.ok
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      return false
    }
  }

  // HTTP has no listing. icechunk-js then reads refs from their fixed paths.
  // eslint-disable-next-line require-yield
  async *listPrefix(): AsyncIterable<string> {
    throw new StorageError('Listing is not supported over HTTP.')
  }
}

// Failures name the URL requested; icechunk-js would name the stored location
// even when `virtualChunkUrl` replaces it.
function virtualChunkFetchClient(
  fetcher: typeof fetch,
  limit: <T>(task: () => Promise<T>) => Promise<T>,
  virtualChunkUrl: string | undefined,
): FetchClient {
  return {
    async fetch(url, init) {
      const target = virtualChunkUrl ?? url

      if (!/^https?:\/\//i.test(target)) {
        throw new Error(
          `Virtual chunk location ${target} is not an HTTP(S) URL. The browser reads virtual chunks only over HTTP(S); write the repository's references with the file's hosted URL.`,
        )
      }

      let response: Response

      try {
        response = await limit(() => fetcher(target, init))
      } catch (error) {
        if (isAbortError(error)) {
          throw error
        }

        throw new Error(
          `Failed to fetch virtual chunk from ${target}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        )
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch virtual chunk from ${target}: HTTP ${response.status}`,
        )
      }

      return response
    },
  }
}

// The repository URL's query string, such as an access token, is kept on every
// object URL.
function repositoryObjectUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  return url.toString()
}

function normalizeRepositoryUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString()
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
