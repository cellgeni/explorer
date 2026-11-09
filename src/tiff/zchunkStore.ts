import { imagePixels, micrometers } from '../data/coords'
import { isListedAsMissing } from '../data/folderListing'
import { tiffChunkKey } from './chunkKeys'
import type { ImagePixels, UnitsDescriptor } from '../data/coords'
import type { TiffChunk, TiffLevelMeta, TiffPyramidLoaderOptions } from './loader'

type ZchunkStorePyramidOptions = Omit<TiffPyramidLoaderOptions, 'url' | 'fetcher'>

interface ZchunkStoreEntry {
  readonly offset: number
  readonly size: number
}

interface ZchunkArrayMeta {
  readonly path: string
  readonly shape: readonly number[]
  readonly chunkShape: readonly number[]
  readonly separator: '/' | '.'
  readonly version: 2 | 3
}

const DEFAULT_MICROMETERS_PER_PIXEL = 0.2125

// Sidecars fetched in the last minute, per fetch function and URL. Every
// channel file of a multi-file OME-TIFF looks up the same folder, root, or
// manifest sidecar, so each is requested and parsed once. The entry holds the
// parsed JSON, or null when the sidecar is absent.
const SIDECAR_CACHE_TTL_MS = 60_000

interface CachedSidecar {
  readonly json: Promise<unknown>
  readonly expiresAt: number
}

const sidecarCache = new WeakMap<object, Map<string, CachedSidecar>>()

export interface LoadZchunkStoreOptions {
  readonly signal?: AbortSignal
  readonly fetcher?: typeof fetch
  readonly channelIndex?: number
  // Sidecar named by the dataset manifest; replaces the derived locations.
  readonly zchunkStoreUrl?: string | undefined
  // The TIFF is one file of a multi-file OME-TIFF, so a folder sidecar may
  // cover it.
  readonly multiFile?: boolean
}

export async function loadZchunkStorePyramidOptions(
  tiffUrl: string,
  options: LoadZchunkStoreOptions = {},
): Promise<ZchunkStorePyramidOptions | null> {
  // Derived locations the dataset folder's listing rules out are not
  // requested; a sidecar the manifest names always is.
  const candidates =
    options.zchunkStoreUrl === undefined
      ? zchunkStoreCandidateUrls(tiffUrl, {
          multiFile: options.multiFile === true,
        }).filter((url) => !isListedAsMissing(url))
      : [options.zchunkStoreUrl]
  // All candidates are requested at once; the first in order that exists wins.
  const lookups = candidates.map((url) => cachedSidecarJson(url, options.fetcher))

  for (const lookup of lookups) {
    const json = await abortable(lookup, options.signal)

    if (json !== null) {
      return zchunkStoreToPyramidOptions(json, options.channelIndex ?? 0)
    }
  }

  return null
}

export function zchunkStoreCandidateUrls(
  tiffUrl: string,
  options: { readonly multiFile?: boolean } = {},
): readonly string[] {
  const url = new URL(tiffUrl)
  // Most specific first: a `<file>.zchunkstore` can only describe this TIFF,
  // while folder and dataset-root sidecars may describe a sibling image.
  const candidates = [urlWithPath(url, `${url.pathname}.zchunkstore`)]
  const focusSegmentIndex = url.pathname.indexOf('/morphology_focus/')

  if (options.multiFile === true || isXeniumMorphologyPath(url.pathname)) {
    candidates.push(urlWithPath(url, `${parentPath(url.pathname)}/.zchunkstore`))
  }

  if (focusSegmentIndex >= 0) {
    candidates.push(
      urlWithPath(url, `${url.pathname.slice(0, focusSegmentIndex)}/.zchunkstore`),
    )
  }

  return Array.from(new Set(candidates))
}

// The shared request ignores callers' abort signals, since another channel
// may still need it; `abortable` stops each caller waiting instead.
function cachedSidecarJson(
  url: string,
  fetcher: typeof fetch | undefined,
): Promise<unknown> {
  const cacheKey = fetcher ?? globalThis.fetch
  const now = Date.now()
  let entries = sidecarCache.get(cacheKey)

  if (entries === undefined) {
    entries = new Map()
    sidecarCache.set(cacheKey, entries)
  }

  for (const [cachedUrl, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(cachedUrl)
    }
  }

  const cached = entries.get(url)

  if (cached !== undefined) {
    return cached.json
  }

  const cacheEntries = entries
  const json = requestSidecarJson(
    url,
    fetcher ?? globalThis.fetch.bind(globalThis),
  ).catch(() => {
    // Network and parse errors are not cached, so a later open retries.
    cacheEntries.delete(url)
    return null
  })

  entries.set(url, { json, expiresAt: now + SIDECAR_CACHE_TTL_MS })
  return json
}

async function requestSidecarJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url)

  // Buckets answer 403 rather than 404 for missing keys.
  if (response.status === 404 || response.status === 403) {
    return null
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status.toString()} for ${url}.`)
  }

  return (await response.json()) as unknown
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise
  }

  if (signal.aborted) {
    return Promise.reject(abortReason(signal))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

export function zchunkStoreToPyramidOptions(
  manifest: unknown,
  channelIndex = 0,
): ZchunkStorePyramidOptions {
  const store = objectRecord(manifest, 'Zarr chunk store manifest')
  const arrays = readArrayMetadata(store)
  const chunkIndex = new Map<string, TiffChunk>()
  const levelMeta = new Map<number, TiffLevelMeta>()
  let tileWidth: ImagePixels | undefined
  let tileHeight: ImagePixels | undefined
  let imageWidth: ImagePixels | undefined
  let imageHeight: ImagePixels | undefined

  arrays.forEach((array, level) => {
    const width = imagePixels(readPositiveInteger(array.shape.at(-1), 'array width'))
    const height = imagePixels(readPositiveInteger(array.shape.at(-2), 'array height'))
    const arrayTileWidth = imagePixels(
      readPositiveInteger(array.chunkShape.at(-1), 'chunk width'),
    )
    const arrayTileHeight = imagePixels(
      readPositiveInteger(array.chunkShape.at(-2), 'chunk height'),
    )
    const nCols = Math.ceil(width / arrayTileWidth)
    const nRows = Math.ceil(height / arrayTileHeight)

    if (tileWidth === undefined || tileHeight === undefined) {
      tileWidth = arrayTileWidth
      tileHeight = arrayTileHeight
      imageWidth = width
      imageHeight = height
    } else if (tileWidth !== arrayTileWidth || tileHeight !== arrayTileHeight) {
      throw new Error('Zarr chunk store pyramid uses inconsistent chunk sizes.')
    }

    levelMeta.set(level, { width, height, nCols, nRows })
    indexArrayChunks({
      channelIndex,
      chunkIndex,
      level,
      meta: array,
      store,
    })
  })

  if (
    tileWidth === undefined ||
    tileHeight === undefined ||
    imageWidth === undefined ||
    imageHeight === undefined
  ) {
    throw new Error('Zarr chunk store manifest does not contain pyramid arrays.')
  }

  return {
    chunkIndex,
    levelMeta,
    units: defaultXeniumImageUnits(),
    tileWidth,
    tileHeight,
    numLevels: arrays.length,
    imageWidth,
    imageHeight,
  }
}

function readArrayMetadata(
  store: Readonly<Record<string, unknown>>,
): readonly ZchunkArrayMeta[] {
  const paths = readMultiscalePaths(store)

  if (paths.length > 0) {
    return paths.map((path) => readArrayMeta(store, path))
  }

  return Object.keys(store)
    .map((key) => key.match(/^(\d+)\/(?:zarr\.json|\.zarray)$/)?.[1])
    .filter((path): path is string => path !== undefined)
    .sort((a, b) => Number(a) - Number(b))
    .map((path) => readArrayMeta(store, path))
}

function readMultiscalePaths(
  store: Readonly<Record<string, unknown>>,
): readonly string[] {
  const zarrJson = objectRecordOrUndefined(store['zarr.json'])
  const v3Datasets = readDatasets(zarrJson?.attributes)

  if (v3Datasets.length > 0) {
    return v3Datasets
  }

  return readDatasets(store['.zattrs'])
}

function readDatasets(attrs: unknown): readonly string[] {
  const record = objectRecordOrUndefined(attrs)
  const multiscales = Array.isArray(record?.multiscales) ? record.multiscales : []
  const first = objectRecordOrUndefined(multiscales[0])
  const datasets = Array.isArray(first?.datasets) ? first.datasets : []

  return datasets
    .map((dataset) => objectRecordOrUndefined(dataset)?.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
}

function readArrayMeta(
  store: Readonly<Record<string, unknown>>,
  path: string,
): ZchunkArrayMeta {
  const v3 = objectRecordOrUndefined(store[`${path}/zarr.json`])

  if (v3 !== undefined) {
    const chunkGrid = objectRecord(v3.chunk_grid, `${path}/zarr.json chunk_grid`)
    const configuration = objectRecord(
      chunkGrid.configuration,
      `${path}/zarr.json chunk_grid.configuration`,
    )

    return {
      path,
      shape: readNumberArray(v3.shape, `${path}/zarr.json shape`),
      chunkShape: readNumberArray(
        configuration.chunk_shape,
        `${path}/zarr.json chunk_shape`,
      ),
      separator: '/',
      version: 3,
    }
  }

  const v2 = objectRecordOrUndefined(store[`${path}/.zarray`])

  if (v2 !== undefined) {
    return {
      path,
      shape: readNumberArray(v2.shape, `${path}/.zarray shape`),
      chunkShape: readNumberArray(v2.chunks, `${path}/.zarray chunks`),
      separator: '.',
      version: 2,
    }
  }

  throw new Error(`Zarr chunk store is missing array metadata for ${path}.`)
}

interface IndexArrayChunksOptions {
  readonly channelIndex: number
  readonly chunkIndex: Map<string, TiffChunk>
  readonly level: number
  readonly meta: ZchunkArrayMeta
  readonly store: Readonly<Record<string, unknown>>
}

function indexArrayChunks(options: IndexArrayChunksOptions): void {
  const prefix =
    options.meta.version === 3
      ? `${options.meta.path}/c/${options.channelIndex}/`
      : `${options.meta.path}/${options.channelIndex}${options.meta.separator}`

  for (const [key, value] of Object.entries(options.store)) {
    const position = parseChunkPosition(key, prefix, options.meta.separator)

    if (position === null) {
      continue
    }

    const entry = readChunkEntry(value, key)
    options.chunkIndex.set(tiffChunkKey(options.level, position.row, position.col), {
      offset: entry.offset,
      length: entry.size,
    })
  }
}

function parseChunkPosition(
  key: string,
  prefix: string,
  separator: '/' | '.',
): { readonly row: number; readonly col: number } | null {
  if (!key.startsWith(prefix)) {
    return null
  }

  const rest = key.slice(prefix.length)
  const parts = rest.split(separator)

  if (parts.length !== 2) {
    return null
  }

  return {
    row: readPositiveInteger(parts[0], `${key} row`),
    col: readPositiveInteger(parts[1], `${key} column`),
  }
}

function readChunkEntry(value: unknown, key: string): ZchunkStoreEntry {
  const record = objectRecord(value, `${key} chunk entry`)

  return {
    offset: readPositiveInteger(record.offset, `${key} offset`),
    size: readPositiveInteger(record.size, `${key} size`),
  }
}

function defaultXeniumImageUnits(): UnitsDescriptor {
  return {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(DEFAULT_MICROMETERS_PER_PIXEL),
    origin: 'top-left',
    imageYAxis: 'down',
  }
}

function isXeniumMorphologyPath(pathname: string): boolean {
  const fileName = pathname.split('/').at(-1) ?? ''
  return /^morphology(?:[_.]|$)/.test(fileName)
}

function parentPath(pathname: string): string {
  const index = pathname.lastIndexOf('/')

  if (index <= 0) {
    return ''
  }

  return pathname.slice(0, index)
}

function urlWithPath(url: URL, pathname: string): string {
  const next = new URL(url)
  next.pathname = pathname
  next.search = ''
  next.hash = ''
  return next.toString()
}

function objectRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const record = objectRecordOrUndefined(value)

  if (record === undefined) {
    throw new Error(`${label} must be an object.`)
  }

  return record
}

function objectRecordOrUndefined(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  return value as Readonly<Record<string, unknown>>
}

function readNumberArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a number array.`)
  }

  return value.map((item, index) =>
    readPositiveInteger(item, `${label}[${index.toString()}]`),
  )
}

function readPositiveInteger(value: unknown, label: string): number {
  const numberValue = typeof value === 'string' ? Number(value) : value

  if (
    typeof numberValue !== 'number' ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0
  ) {
    throw new Error(`${label} must be a safe non-negative integer.`)
  }

  return numberValue
}
