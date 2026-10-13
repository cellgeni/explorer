import { ReferenceStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { RoiSelectionInput } from '../data/roiSelection'
import { normalizeRoiSelection } from '../data/roiSelection'
import { slug } from '../utils/slug'
import type { ContinuousCellMetadataTrack } from '../data/customAnnotations'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import {
  analysisEmbeddingLabel,
  type AnalysisEmbedding,
  type AnalysisEmbeddingKind,
  type AnalysisEmbeddingOption,
} from '../data/analysisEmbeddings'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from '../data/datasetAnnotations'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElementId,
} from './spatialDataset'
import type { DatasetCell, GeneExpressionBatch } from './xeniumDataset'

export interface AnnDataH5adDatasetOptions {
  readonly url: string
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  // Reads AnnData from a group inside an already-open Zarr store (for example
  // a SpatialData table) instead of fetching an .h5ad file.
  readonly zarrSource?: AnnDataZarrSource
}

export type H5adLoadProgressReporter = (message: string) => void

export interface AnnDataZarrSource {
  readonly store: zarr.Readable
  readonly zarrFormat: 2 | 3
  readonly path: string
  readonly nodes: readonly AnnDataZarrNode[]
  readonly label?: string
  readonly resolveCoordinates?: AnnDataCoordinateResolver
}

export interface AnnDataZarrNode {
  readonly path: string
  readonly kind: 'array' | 'group'
}

export interface AnnDataObsAccess {
  readonly cellIds: readonly string[]
  readObsColumn(key: string): Promise<readonly (string | number | null)[] | null>
  readObsmPoints(): Promise<readonly { readonly x: number; readonly y: number }[] | null>
}

// Returns one coordinate per obs row. Rows that cannot be placed use NaN and
// are left out of spatial queries.
export type AnnDataCoordinateResolver = (
  obs: AnnDataObsAccess,
) => Promise<readonly DataPoint[] | null>

interface H5adCache {
  readonly url: string
  readonly cellIds: readonly string[]
  readonly geneNames: readonly string[]
  readonly coordinates: readonly DataPoint[]
  readonly root: H5GroupLike
  readonly embeddingOptions: readonly AnalysisEmbeddingOption[]
  readonly categoricalTracks: readonly H5adCategoricalTrack[]
  readonly continuousTracks: readonly H5adContinuousTrack[]
  readonly matrix: H5adMatrix
  readonly extent: BBox
}

interface H5adCategoricalTrack {
  readonly id: string
  readonly label: string
  readonly categoryCount: number
  readonly values: readonly (string | null)[]
}

interface H5adContinuousTrack {
  readonly id: string
  readonly label: string
  readonly values: readonly number[]
  readonly min: number
  readonly max: number
}

type H5adMatrix =
  | {
      readonly kind: 'dense'
      readonly values: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csr'
      readonly data: NumericArrayLike
      readonly indices: NumericArrayLike
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csc'
      readonly data: NumericArrayLike
      readonly indices: NumericArrayLike
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'dense-zarr'
      readonly values: H5adZarrArray
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csr-zarr'
      readonly data: H5adZarrArray
      readonly indices: H5adZarrArray
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csc-zarr'
      readonly data: H5adZarrArray
      readonly indices: H5adZarrArray
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }

type NumericArrayLike =
  | readonly number[]
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

interface H5AttributeLike {
  readonly value: unknown
}

interface H5EntityLike {
  readonly attrs?: Readonly<Record<string, H5AttributeLike>>
}

interface H5DatasetLike extends H5EntityLike {
  readonly shape: readonly number[] | null
  readonly value: unknown
  readonly source?: H5adArraySource
}

interface H5GroupLike extends H5EntityLike {
  keys(): string[]
  get(path: string): unknown
}

interface H5adArraySource {
  readonly kind: 'zarr'
  readonly array: H5adZarrArray
}

type H5adZarrArray = zarr.Array<zarr.DataType, zarr.Readable>

const DEFAULT_H5AD_UNITS = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
} as const

const H5AD_COORDINATE_KEYS = [
  'X_spatial',
  'spatial',
  'X_umap',
  'umap',
  'X_tsne',
  'X_tSNE',
  'tsne',
  'X_pca',
] as const

const H5AD_EMBEDDING_DISPLAY_KEYS = [
  'X_umap',
  'umap',
  'X_tsne',
  'X_tSNE',
  'tsne',
  'X_pca',
  'X_spatial',
  'spatial',
] as const

const H5AD_FETCH_TIMEOUT_MS = 60_000
const H5AD_MAX_FILE_BYTES = 300 * 1024 * 1024
const H5AD_REFERENCE_FETCH_CONCURRENCY = 6
const CSR_ZARR_BATCH_MAX_VALUES = 4_000_000
const CSR_ZARR_BATCH_MAX_GAP_VALUES = 262_144

export class H5adFileSizeLimitExceededError extends Error {
  readonly url: string
  readonly byteLength: number
  readonly maxBytes: number

  constructor(url: string, byteLength: number, maxBytes = H5AD_MAX_FILE_BYTES) {
    super(
      `H5AD file is ${formatByteCount(
        byteLength,
      )}, exceeding the browser load limit of ${formatByteCount(maxBytes)}.`,
    )
    this.name = 'H5adFileSizeLimitExceededError'
    this.url = url
    this.byteLength = byteLength
    this.maxBytes = maxBytes
  }
}

export class H5adReferenceFileUnavailableError extends Error {
  readonly url: string
  readonly referenceUrl: string
  readonly byteLength: number
  readonly maxBytes: number

  constructor(
    url: string,
    referenceUrl: string,
    byteLength: number,
    maxBytes = H5AD_MAX_FILE_BYTES,
  ) {
    super(
      `H5AD file is ${formatByteCount(
        byteLength,
      )}, exceeding the browser load limit of ${formatByteCount(
        maxBytes,
      )}, and no readable kerchunk reference file was found at ${referenceUrl}.`,
    )
    this.name = 'H5adReferenceFileUnavailableError'
    this.url = url
    this.referenceUrl = referenceUrl
    this.byteLength = byteLength
    this.maxBytes = maxBytes
  }
}

export class H5adAllGeneCscMatrixUnsupportedError extends Error {
  readonly rowCount: number
  readonly geneCount: number

  constructor(rowCount: number, geneCount: number) {
    super(
      `H5AD reference-backed CSC matrices cannot load all genes for selected cells without scanning the whole expression matrix (${rowCount.toLocaleString()} cells x ${geneCount.toLocaleString()} genes).`,
    )
    this.name = 'H5adAllGeneCscMatrixUnsupportedError'
    this.rowCount = rowCount
    this.geneCount = geneCount
  }
}

export class AnnDataH5adDataset implements SpatialDataset<SpatialElementId> {
  readonly url: string
  private readonly fetcher: typeof fetch
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly zarrSource: AnnDataZarrSource | undefined
  private cachePromise: Promise<H5adCache> | null = null

  constructor(options: AnnDataH5adDatasetOptions) {
    this.url = options.url
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.zarrSource = options.zarrSource
  }

  async meta(): Promise<DatasetMeta> {
    const cache = await this.cache()

    return {
      platform: 'h5ad',
      units: DEFAULT_H5AD_UNITS,
      extent: cache.extent,
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    }
  }

  elements(): Promise<ElementBatch<SpatialElementId>> {
    return Promise.resolve({ elements: [] })
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    const cache = await this.cache()

    const points: CellOverviewPoint[] = []

    cache.cellIds.forEach((cellId, index) => {
      const position = cache.coordinates[index]

      if (position === undefined || !isFinitePoint(position)) {
        return
      }

      points.push({
        cellId: cellId as never,
        position,
        transcriptCount: 0,
        metadata: h5adCellMetadata(cache, index),
      })
    })

    return points
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    const cache = await this.cache()
    return h5adMatrixForCells(cache, ids, cache.geneNames)
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: CellFeatureMatrixReadOptions & { readonly limit?: number } = {},
  ): Promise<GeneExpressionBatch> {
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const selectedCells = h5adCellsInBbox(cache, bbox, options.limit)
    const matrix = await h5adMatrixForCells(
      cache,
      selectedCells.map((cell) => cell.id),
      genes,
    )
    const elements = selectedCells.map((cell) => {
      const expression = matrix.cells.get(cell.id)
      const count = expression?.counts.reduce((sum, value) => sum + value, 0) ?? 0

      return {
        id: cell.id,
        position: cell.position,
        count,
      }
    })
    let maxCount = 0

    for (const element of elements) {
      maxCount = Math.max(maxCount, element.count)
    }

    return {
      elements,
      genes,
      maxCount,
    }
  }

  async annotationGroups(): Promise<readonly AnnotationGroupOption[]> {
    const cache = await this.cache()

    return cache.categoricalTracks.map((track) => ({
      id: h5adAnnotationGroupId(track),
      label: track.label,
      groupingName: track.id,
      groupCount: track.categoryCount,
    }))
  }

  async annotations(
    options: LoadDatasetAnnotationsOptions = {},
  ): Promise<readonly Annotation<SpatialElementId>[]> {
    throwIfAborted(options.signal)
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const selectedTracks =
      options.groupId === undefined || options.groupId === 'all'
        ? cache.categoricalTracks
        : cache.categoricalTracks.filter(
            (track) => h5adAnnotationGroupId(track) === options.groupId,
          )
    const annotations: Annotation<SpatialElementId>[] = []

    for (const track of selectedTracks) {
      const cellIdsByLabel = new Map<string, string[]>()

      for (let index = 0; index < track.values.length; index += 1) {
        const label = track.values[index]
        const cellId = cache.cellIds[index]

        if (label === null || label === undefined || cellId === undefined) {
          continue
        }

        const cellIds = cellIdsByLabel.get(label) ?? []
        cellIds.push(cellId)
        cellIdsByLabel.set(label, cellIds)
      }

      for (const [label, cellIds] of cellIdsByLabel) {
        annotations.push({
          id: `analysis:${slug(track.label)}:${slug(label)}`,
          label: `${track.label}: ${label}`,
          cellIds,
        })
      }
    }

    return annotations
  }

  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    const cache = await this.cache()

    return cache.continuousTracks.map((track) => ({
      id: `h5ad:${slug(track.id)}`,
      label: track.label,
      values: track.values.map((value, index) => ({
        cellId: cache.cellIds[index] as never,
        value,
      })),
      min: track.min,
      max: track.max,
    }))
  }

  async embeddings(
    options: {
      readonly kind?: AnalysisEmbeddingKind
      readonly signal?: AbortSignal
    } = {},
  ): Promise<readonly AnalysisEmbedding[]> {
    throwIfAborted(options.signal)
    const cache = await this.cache()
    throwIfAborted(options.signal)

    const optionsToLoad =
      options.kind === undefined
        ? cache.embeddingOptions
        : cache.embeddingOptions.filter((embedding) => embedding.kind === options.kind)
    const embeddings: AnalysisEmbedding[] = []

    for (const embeddingOption of optionsToLoad) {
      throwIfAborted(options.signal)
      embeddings.push(
        await readObsmEmbeddingFromRoot(cache.root, embeddingOption.kind, cache.cellIds),
      )
    }

    return embeddings
  }

  async embeddingOptions(): Promise<readonly AnalysisEmbeddingOption[]> {
    const cache = await this.cache()
    return cache.embeddingOptions
  }

  async genePanel(): Promise<readonly string[]> {
    const cache = await this.cache()
    return cache.geneNames
  }

  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const cache = await this.cache()
    const normalizedSelection = normalizeRoiSelection(selection)
    const candidates = h5adCellsInBbox(cache, normalizedSelection.bbox, options.limit)
    const selected =
      normalizedSelection.kind === 'box'
        ? candidates
        : candidates.filter((cell) =>
            pointInPolygon(cell.position, normalizedSelection.points),
          )

    return selected.map((cell) => ({
      id: cell.id as never,
      position: cell.position,
    }))
  }

  image(): Promise<ImageSource | null> {
    return Promise.resolve(null)
  }

  private cache(): Promise<H5adCache> {
    if (this.cachePromise === null) {
      this.cachePromise = (
        this.zarrSource === undefined
          ? readH5ad(this.url, {
              fetcher: this.fetcher,
              ...(this.onProgress === undefined ? {} : { onProgress: this.onProgress }),
            })
          : readAnnDataZarr(this.url, this.zarrSource, this.onProgress)
      ).catch((error: unknown) => {
        this.cachePromise = null
        throw error
      })
    }

    return this.cachePromise
  }
}

async function readH5ad(
  url: string,
  options: {
    readonly fetcher: typeof fetch
    readonly onProgress?: H5adLoadProgressReporter
  },
): Promise<H5adCache> {
  const { fetcher, onProgress } = options
  reportH5adProgress(onProgress, 'H5AD size check started')
  const headResponse = await fetchH5adHead(url, fetcher).catch(() => null)
  const declaredByteLength =
    headResponse?.ok === true ? readContentLength(headResponse.headers) : null

  if (declaredByteLength !== null && declaredByteLength > H5AD_MAX_FILE_BYTES) {
    reportH5adProgress(
      onProgress,
      `H5AD file is ${formatByteCount(
        declaredByteLength,
      )}, above the ${formatByteCount(H5AD_MAX_FILE_BYTES)} browser limit`,
    )
    return readH5adReferenceOrThrow(url, fetcher, declaredByteLength, onProgress)
  }

  if (declaredByteLength === null) {
    reportH5adProgress(
      onProgress,
      `H5AD size check unavailable; loading with ${formatByteCount(
        H5AD_MAX_FILE_BYTES,
      )} guard`,
    )
  } else {
    reportH5adProgress(
      onProgress,
      `H5AD file is ${formatByteCount(declaredByteLength)}; loading directly`,
    )
  }

  const response = await fetchH5adFile(url, fetcher)

  if (!response.ok) {
    throw new Error(`H5AD file returned HTTP ${response.status}.`)
  }

  let bytes: Uint8Array

  try {
    bytes = await readH5adResponseBytes(url, response)
  } catch (error) {
    if (error instanceof H5adFileSizeLimitExceededError) {
      reportH5adProgress(
        onProgress,
        `H5AD stream exceeded ${formatByteCount(
          H5AD_MAX_FILE_BYTES,
        )}; looking for companion reference`,
      )
      return readH5adReferenceOrThrow(url, fetcher, error.byteLength, onProgress)
    }

    throw error
  }

  reportH5adProgress(onProgress, 'H5AD file loaded; opening AnnData arrays')

  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/anndata-${hashString(url)}.h5ad`

  try {
    FS.unlink(fileName)
  } catch {
    // No previous virtual file exists for this H5AD URL.
  }

  FS.writeFile(fileName, bytes)

  const file = new h5wasm.File(fileName, 'r') as H5GroupLike & { close(): unknown }

  try {
    return readH5adCacheFromGroup(url, file)
  } catch (error) {
    try {
      file.close()
    } catch {
      // The schema error is more useful than cleanup failure.
    }
    throw error
  }
}

async function readH5adReferenceOrThrow(
  url: string,
  fetcher: typeof fetch,
  byteLength: number,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const referenceUrl = h5adReferenceUrl(url)
  reportH5adProgress(onProgress, `Looking for H5AD reference ${referenceUrl}`)
  const response = await fetchH5adReferenceFile(referenceUrl, fetcher).catch(() => {
    throw new H5adReferenceFileUnavailableError(url, referenceUrl, byteLength)
  })

  if (!response.ok) {
    throw new H5adReferenceFileUnavailableError(url, referenceUrl, byteLength)
  }

  reportH5adProgress(onProgress, `Loading H5AD reference ${referenceUrl}`)
  const spec = h5adReferenceSpecWithTarget(
    objectRecord(await response.json(), 'H5AD reference spec'),
    url,
  )
  reportH5adProgress(onProgress, 'H5AD reference loaded; opening referenced arrays')
  const store = ReferenceStore.fromSpec(spec, {
    fetch: referenceStoreFetch(fetcher),
  })
  const root = await hydrateZarrAnnDataGroup(
    { store, zarrFormat: 2, rootPath: '' },
    h5adReferenceIndexFromSpec(spec),
    '',
  )
  const cache = await readH5adCacheFromGroup(url, root)
  reportH5adProgress(
    onProgress,
    `H5AD reference ready: ${cache.cellIds.length.toLocaleString()} cells, ${cache.geneNames.length.toLocaleString()} genes`,
  )
  return cache
}

async function readAnnDataZarr(
  url: string,
  source: AnnDataZarrSource,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const label = source.label ?? 'AnnData table'
  const rootPath = normalizeZarrPath(source.path)
  reportH5adProgress(onProgress, `Opening ${label} arrays`)
  const root = await hydrateZarrAnnDataGroup(
    { store: source.store, zarrFormat: source.zarrFormat, rootPath },
    annDataIndexFromNodes(source.nodes, rootPath),
    '',
  )
  const cache = await readH5adCacheFromGroup(url, root, source.resolveCoordinates)
  reportH5adProgress(
    onProgress,
    `${label} ready: ${cache.cellIds.length.toLocaleString()} observations, ${cache.geneNames.length.toLocaleString()} genes`,
  )
  return cache
}

function reportH5adProgress(
  onProgress: H5adLoadProgressReporter | undefined,
  message: string,
): void {
  onProgress?.(message)
}

async function readH5adCacheFromGroup(
  url: string,
  file: H5GroupLike,
  resolveCoordinates?: AnnDataCoordinateResolver,
): Promise<H5adCache> {
  const obs = expectGroup(file.get('/obs'), '/obs')
  const varGroup = expectGroup(file.get('/var'), '/var')
  const cellIds = uniqueNames(
    (await readDataframeIndex(obs, 'obs')).map((id, index) =>
      id.length === 0 ? `obs-${index}` : id,
    ),
    'obs',
  )
  const geneNames = uniqueNames(await readGeneNames(varGroup), 'var')
  const embeddingOptions = readObsmEmbeddingOptions(file, cellIds.length)
  const resolvedCoordinates =
    resolveCoordinates === undefined
      ? null
      : await resolveCoordinates({
          cellIds,
          readObsColumn: (key) => readObsColumnValues(obs, key, cellIds.length),
          readObsmPoints: async () => {
            const embedding = await readOverviewCoordinateEmbedding(
              file,
              embeddingOptions,
              cellIds,
            ).catch(() => null)
            return embedding?.points ?? null
          },
        })
  const coordinates =
    resolvedCoordinates ??
    embeddingToCoordinates(
      await readOverviewCoordinateEmbedding(file, embeddingOptions, cellIds),
    )
  const observationTracks = await readObservationTracks(obs, cellIds.length)
  const matrix = await readMatrix(file, cellIds.length, geneNames.length)

  return {
    url,
    cellIds,
    geneNames,
    coordinates,
    root: file,
    embeddingOptions,
    categoricalTracks: observationTracks.categoricalTracks,
    continuousTracks: observationTracks.continuousTracks,
    matrix,
    extent: bboxForPoints(coordinates),
  }
}

class HydratedH5adGroup implements H5GroupLike {
  readonly attrs?: Readonly<Record<string, H5AttributeLike>>
  readonly children: ReadonlyMap<string, unknown>

  constructor(
    attrs: Readonly<Record<string, H5AttributeLike>>,
    children: ReadonlyMap<string, unknown>,
  ) {
    this.attrs = attrs
    this.children = children
  }

  keys(): string[] {
    return Array.from(this.children.keys())
  }

  get(path: string): unknown {
    const parts = normalizeH5Path(path)

    if (parts.length === 0) {
      return this
    }

    return hydratedH5adGroupGet(this, parts)
  }
}

function hydratedH5adGroupGet(
  group: HydratedH5adGroup,
  parts: readonly string[],
): unknown {
  let current: unknown = group

  for (const part of parts) {
    if (!isGroup(current)) {
      return undefined
    }

    current =
      current instanceof HydratedH5adGroup
        ? current.children.get(part)
        : current.get(part)
  }

  return current
}

interface H5adReferenceIndex {
  readonly nodeKinds: ReadonlyMap<string, 'array' | 'group'>
  readonly childrenByPath: ReadonlyMap<string, readonly string[]>
}

interface ZarrAnnDataLocation {
  readonly store: zarr.Readable
  readonly zarrFormat: 2 | 3
  readonly rootPath: string
}

function zarrAnnDataNodeLocation(
  location: ZarrAnnDataLocation,
  path: string,
): zarr.Location<zarr.Readable> {
  const fullPath = joinZarrPath(location.rootPath, path)
  return fullPath === ''
    ? zarr.root(location.store)
    : zarr.root(location.store).resolve(fullPath)
}

async function hydrateZarrAnnDataGroup(
  location: ZarrAnnDataLocation,
  index: H5adReferenceIndex,
  path: string,
): Promise<H5GroupLike> {
  const nodeLocation = zarrAnnDataNodeLocation(location, path)
  const group =
    location.zarrFormat === 3
      ? await zarr.open.v3(nodeLocation, { kind: 'group' })
      : await zarr.open.v2(nodeLocation, { kind: 'group' })
  const children = new Map<string, unknown>()

  for (const childName of index.childrenByPath.get(path) ?? []) {
    const childPath = joinZarrPath(path, childName)
    const childKind = index.nodeKinds.get(childPath)

    if (childKind === 'group') {
      children.set(childName, await hydrateZarrAnnDataGroup(location, index, childPath))
      continue
    }

    if (childKind === 'array') {
      children.set(childName, await hydrateZarrAnnDataDataset(location, childPath))
    }
  }

  return new HydratedH5adGroup(h5AttrsFromRecord(group.attrs), children)
}

async function hydrateZarrAnnDataDataset(
  location: ZarrAnnDataLocation,
  path: string,
): Promise<H5DatasetLike> {
  const nodeLocation = zarrAnnDataNodeLocation(location, path)
  const array: H5adZarrArray =
    location.zarrFormat === 3
      ? await zarr.open.v3(nodeLocation, { kind: 'array' })
      : await zarr.open.v2(nodeLocation, { kind: 'array' })
  const source = { kind: 'zarr', array } as const

  return {
    attrs: h5AttrsFromRecord(array.attrs),
    shape: array.shape,
    value: undefined,
    source,
  }
}

function h5adReferenceIndexFromSpec(spec: unknown): H5adReferenceIndex {
  const refs = objectRecord(objectRecord(spec, 'H5AD reference spec').refs, 'refs')
  const nodeKinds = new Map<string, 'array' | 'group'>()
  const childrenByPath = new Map<string, Set<string>>()

  for (const rawKey of Object.keys(refs)) {
    const key = rawKey.replace(/^\/+/, '')
    const metadataMatch = /^(.*?)(?:\/)?\.(zarray|zgroup)$/.exec(key)

    if (metadataMatch === null) {
      continue
    }

    const path = normalizeZarrPath(metadataMatch[1] ?? '')
    const kind = metadataMatch[2] === 'zarray' ? 'array' : 'group'
    nodeKinds.set(path, kind)

    if (path === '') {
      continue
    }

    const parts = path.split('/')
    const childName = parts.at(-1)

    if (childName === undefined) {
      continue
    }

    const parentPath = parts.slice(0, -1).join('/')
    const children = childrenByPath.get(parentPath) ?? new Set<string>()
    children.add(childName)
    childrenByPath.set(parentPath, children)
  }

  return {
    nodeKinds,
    childrenByPath: new Map(
      Array.from(childrenByPath, ([path, children]) => [
        path,
        Array.from(children).sort((left, right) => left.localeCompare(right)),
      ]),
    ),
  }
}

function annDataIndexFromNodes(
  nodes: readonly AnnDataZarrNode[],
  rootPath: string,
): H5adReferenceIndex {
  const nodeKinds = new Map<string, 'array' | 'group'>()
  const childrenByPath = new Map<string, Set<string>>()
  const prefix = rootPath === '' ? '' : `${rootPath}/`

  for (const node of nodes) {
    const fullPath = normalizeZarrPath(node.path)

    if (prefix !== '' && !fullPath.startsWith(prefix)) {
      continue
    }

    const path = fullPath.slice(prefix.length)

    if (path === '') {
      continue
    }

    nodeKinds.set(path, node.kind)
    const parts = path.split('/')
    const childName = parts.at(-1)

    if (childName === undefined) {
      continue
    }

    const parentPath = parts.slice(0, -1).join('/')
    const children = childrenByPath.get(parentPath) ?? new Set<string>()
    children.add(childName)
    childrenByPath.set(parentPath, children)
  }

  return {
    nodeKinds,
    childrenByPath: new Map(
      Array.from(childrenByPath, ([path, children]) => [
        path,
        Array.from(children).sort((left, right) => left.localeCompare(right)),
      ]),
    ),
  }
}

function h5adReferenceSpecWithTarget(
  spec: Record<string, unknown>,
  targetUrl: string,
): Record<string, unknown> {
  const refs = objectRecord(spec.refs, 'refs')
  const targetedRefs: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(refs)) {
    targetedRefs[key] = h5adReferenceEntryWithTarget(value, targetUrl)
  }

  return { ...spec, refs: targetedRefs }
}

function h5adReferenceEntryWithTarget(value: unknown, targetUrl: string): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  if (value.length !== 1 && value.length !== 3) {
    return value
  }

  return typeof value[0] === 'string' || value[0] === null
    ? [targetUrl, ...value.slice(1)]
    : value
}

function h5AttrsFromRecord(
  attrs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, H5AttributeLike>> {
  const h5Attrs: Record<string, H5AttributeLike> = {}

  for (const [key, value] of Object.entries(attrs)) {
    h5Attrs[key] = { value }
  }

  return h5Attrs
}

function normalizeH5Path(path: string): readonly string[] {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0)
}

function normalizeZarrPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '')
}

function joinZarrPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}/${child}`
}

function h5adReferenceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.pathname = `${parsed.pathname}.json`
    return parsed.toString()
  } catch {
    return `${url}.json`
  }
}

function referenceStoreFetch(
  fetcher: typeof fetch,
): (request: Request) => Promise<Response> {
  const limit = createAsyncLimiter(H5AD_REFERENCE_FETCH_CONCURRENCY)

  return (request: Request) =>
    limit(() => {
      const resolvedUrl = ReferenceStore.resolveUri(request.url)
      const resolvedRequest =
        resolvedUrl === request.url ? request : new Request(resolvedUrl, request)
      return fetcher(resolvedRequest)
    })
}

function createAsyncLimiter(
  maxConcurrent: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = []
  let active = 0

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    }

    active += 1

    try {
      return await task()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Expected ${label} to be an object.`)
}

async function readDataframeIndex(
  group: H5GroupLike,
  label: string,
): Promise<readonly string[]> {
  const indexKey = readStringAttribute(group, '_index')
  const candidateKeys = [
    indexKey,
    '_index',
    'index',
    `${label}_names`,
    label === 'obs' ? 'cell_id' : 'gene_ids',
  ].filter((key): key is string => key !== undefined)

  for (const key of candidateKeys) {
    const dataset = group.get(key)

    if (isDataset(dataset)) {
      return readStringArray(await readDatasetValue(dataset), `/${label}/${key}`)
    }
  }

  throw new Error(`H5AD /${label} dataframe does not expose a readable index column.`)
}

async function readGeneNames(varGroup: H5GroupLike): Promise<readonly string[]> {
  const indexNames = await readDataframeIndex(varGroup, 'var')

  for (const key of ['gene_symbols', 'gene_symbol', 'feature_name', 'name']) {
    const dataset = varGroup.get(key)

    if (!isDataset(dataset)) {
      continue
    }

    const values = readStringArray(await readDatasetValue(dataset), `/var/${key}`)

    if (values.length === indexNames.length && values.some((value) => value !== '')) {
      return values
    }
  }

  return indexNames
}

function readObsmEmbeddingOptions(
  file: H5GroupLike,
  cellCount: number,
): readonly AnalysisEmbeddingOption[] {
  const obsm = expectGroup(file.get('/obsm'), '/obsm')
  const embeddings: AnalysisEmbeddingOption[] = []

  for (const key of obsm.keys()) {
    const dataset = obsm.get(key)

    if (!isDataset(dataset)) {
      continue
    }

    if (!isObsmEmbeddingDataset(key, dataset, cellCount)) {
      continue
    }

    embeddings.push({
      kind: key,
      label: analysisEmbeddingLabel(key),
      sourcePath: `/obsm/${key}`,
    })
  }

  return embeddings.sort(compareH5adEmbeddings)
}

function isObsmEmbeddingDataset(
  key: string,
  dataset: H5DatasetLike,
  cellCount: number,
): boolean {
  const shape = dataset.shape

  if (shape === null || shape.length !== 2) {
    return false
  }

  const rows = readShapeDimension(shape, 0, `/obsm/${key}`)
  const cols = readShapeDimension(shape, 1, `/obsm/${key}`)

  return rows === cellCount && cols >= 2
}

async function readObsmEmbeddingFromRoot(
  file: H5GroupLike,
  key: string,
  cellIds: readonly string[],
): Promise<AnalysisEmbedding> {
  return readObsmEmbedding(
    key,
    expectDataset(file.get(`/obsm/${key}`), `/obsm/${key}`),
    cellIds,
  )
}

async function readObsmEmbedding(
  key: string,
  dataset: H5DatasetLike,
  cellIds: readonly string[],
): Promise<AnalysisEmbedding> {
  const shape = dataset.shape

  if (shape === null || shape.length !== 2) {
    throw new Error(`H5AD /obsm/${key} is not a 2D matrix.`)
  }

  const rows = readShapeDimension(shape, 0, `/obsm/${key}`)
  const cols = readShapeDimension(shape, 1, `/obsm/${key}`)

  if (rows !== cellIds.length || cols < 2) {
    throw new Error(`H5AD /obsm/${key} does not match the cell count.`)
  }

  const values = readNumericArray(await readDatasetValue(dataset), `/obsm/${key}`)

  if (values.length < rows * cols) {
    throw new Error(`H5AD /obsm/${key} is shorter than its declared shape.`)
  }

  const points = cellIds.map((cellId, row) => {
    const x = numericValue(values, row * cols)
    const y = numericValue(values, row * cols + 1)

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`H5AD /obsm/${key} contains non-finite coordinates.`)
    }

    return { id: cellId, x, y }
  })

  return {
    kind: key,
    label: analysisEmbeddingLabel(key),
    sourcePath: `/obsm/${key}`,
    points,
  }
}

async function readOverviewCoordinateEmbedding(
  file: H5GroupLike,
  embeddings: readonly AnalysisEmbeddingOption[],
  cellIds: readonly string[],
): Promise<AnalysisEmbedding> {
  for (const key of H5AD_COORDINATE_KEYS) {
    const embedding = embeddings.find((candidate) => candidate.kind === key)

    if (embedding !== undefined) {
      return readObsmEmbeddingFromRoot(file, embedding.kind, cellIds)
    }
  }

  throw new Error(
    `H5AD file needs a 2D coordinate matrix at one of ${H5AD_COORDINATE_KEYS.map(
      (key) => `/obsm/${key}`,
    ).join(', ')}.`,
  )
}

function embeddingToCoordinates(embedding: AnalysisEmbedding): readonly DataPoint[] {
  return embedding.points.map((point) => ({
    x: micrometers(point.x),
    y: micrometers(point.y),
  }))
}

function compareH5adEmbeddings(
  left: AnalysisEmbeddingOption,
  right: AnalysisEmbeddingOption,
): number {
  const leftRank = h5adEmbeddingDisplayRank(left.kind)
  const rightRank = h5adEmbeddingDisplayRank(right.kind)

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  return left.kind.localeCompare(right.kind)
}

function h5adEmbeddingDisplayRank(kind: string): number {
  const index = H5AD_EMBEDDING_DISPLAY_KEYS.findIndex((key) => key === kind)
  return index < 0 ? H5AD_EMBEDDING_DISPLAY_KEYS.length : index
}

async function readObservationTracks(
  obs: H5GroupLike,
  rowCount: number,
): Promise<{
  readonly categoricalTracks: readonly H5adCategoricalTrack[]
  readonly continuousTracks: readonly H5adContinuousTrack[]
}> {
  const indexKey = readStringAttribute(obs, '_index')
  const columnOrder = readStringArrayAttribute(obs, 'column-order')
  const keys =
    columnOrder.length > 0
      ? columnOrder
      : obs
          .keys()
          .filter((key) => key !== indexKey && key !== '_index' && !key.startsWith('__'))
  const categoricalTracks: H5adCategoricalTrack[] = []
  const continuousTracks: H5adContinuousTrack[] = []

  for (const key of keys) {
    const entity = obs.get(key)

    if (entity === null || entity === undefined || key === indexKey) {
      continue
    }

    if (isCategoricalGroup(entity)) {
      const codes = readNumericArray(
        await readDatasetValue(expectDataset(entity.get('codes'), `/obs/${key}/codes`)),
        `/obs/${key}/codes`,
      )
      const categories = readCategoryLabels(
        await readDatasetValue(
          expectDataset(entity.get('categories'), `/obs/${key}/categories`),
        ),
        `/obs/${key}/categories`,
      )

      if (codes.length !== rowCount) {
        continue
      }

      categoricalTracks.push({
        id: key,
        label: key,
        categoryCount: categories.length,
        values: Array.from({ length: rowCount }, (_value, index) => {
          const code = Math.trunc(numericValue(codes, index))
          return code < 0 ? null : (categories[code] ?? null)
        }),
      })
      continue
    }

    if (!isDataset(entity)) {
      continue
    }

    const shape = entity.shape

    if (shape === null || readShapeDimension(shape, 0, `/obs/${key}`) !== rowCount) {
      continue
    }

    const categories = await readDataframeCategories(obs, key)
    const entityValue = await readDatasetValue(entity)

    if (categories !== null && isNumericArray(entityValue)) {
      const codes = readNumericArray(entityValue, `/obs/${key}`)

      categoricalTracks.push({
        id: key,
        label: key,
        categoryCount: categories.length,
        values: Array.from({ length: rowCount }, (_value, index) => {
          const code = Math.trunc(numericValue(codes, index))
          return code < 0 ? null : (categories[code] ?? null)
        }),
      })
      continue
    }

    if (isNumericArray(entityValue)) {
      const values = numericArrayToNumbers(readNumericArray(entityValue, `/obs/${key}`))
      const finiteValues = values.filter(Number.isFinite)

      if (finiteValues.length === 0) {
        continue
      }

      continuousTracks.push({
        id: key,
        label: key,
        values,
        min: Math.min(...finiteValues),
        max: Math.max(...finiteValues),
      })
      continue
    }

    const labels = readStringArray(entityValue, `/obs/${key}`)

    if (labels.length === rowCount) {
      categoricalTracks.push({
        id: key,
        label: key,
        categoryCount: countUniqueLabels(labels),
        values: labels.map((value) => (value.length === 0 ? null : value)),
      })
    }
  }

  return { categoricalTracks, continuousTracks }
}

async function fetchH5adHead(url: string, fetcher: typeof fetch): Promise<Response> {
  return fetchH5adRequest(url, fetcher, { method: 'HEAD' }, 'H5AD file metadata')
}

async function fetchH5adFile(url: string, fetcher: typeof fetch): Promise<Response> {
  return fetchH5adRequest(url, fetcher, {}, 'H5AD file')
}

async function fetchH5adReferenceFile(
  url: string,
  fetcher: typeof fetch,
): Promise<Response> {
  return fetchH5adRequest(url, fetcher, {}, 'H5AD reference file')
}

async function fetchH5adRequest(
  url: string,
  fetcher: typeof fetch,
  init: RequestInit,
  label: string,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, H5AD_FETCH_TIMEOUT_MS)

  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `${label} request timed out after ${H5AD_FETCH_TIMEOUT_MS.toLocaleString()} ms.`,
        { cause: error },
      )
    }

    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

async function readH5adResponseBytes(
  url: string,
  response: Response,
): Promise<Uint8Array> {
  const declaredByteLength = readContentLength(response.headers)

  if (declaredByteLength !== null) {
    throwIfH5adFileTooLarge(url, declaredByteLength)
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    throwIfH5adFileTooLarge(url, bytes.byteLength)
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    byteLength += value.byteLength

    if (byteLength > H5AD_MAX_FILE_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // The size-limit error is more useful than a stream cleanup failure.
      }

      throw new H5adFileSizeLimitExceededError(url, byteLength)
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function readContentLength(headers: Headers): number | null {
  const value = headers.get('content-length')

  if (value === null) {
    return null
  }

  const byteLength = Number(value)
  return Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : null
}

function throwIfH5adFileTooLarge(url: string, byteLength: number): void {
  if (byteLength > H5AD_MAX_FILE_BYTES) {
    throw new H5adFileSizeLimitExceededError(url, byteLength)
  }
}

function formatByteCount(byteLength: number): string {
  if (byteLength >= 1024 * 1024 * 1024) {
    return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  }

  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${byteLength.toLocaleString()} B`
}

async function readDataframeCategories(
  obs: H5GroupLike,
  key: string,
): Promise<readonly string[] | null> {
  const categoryGroup = obs.get('__categories')

  if (!isGroup(categoryGroup)) {
    return null
  }

  const categoryDataset = categoryGroup.get(key)

  if (!isDataset(categoryDataset)) {
    return null
  }

  const categories = readCategoryLabels(
    await readDatasetValue(categoryDataset),
    `/obs/__categories/${key}`,
  )
  return categories.length === 0 ? null : categories
}

async function readObsColumnValues(
  obs: H5GroupLike,
  key: string,
  rowCount: number,
): Promise<readonly (string | number | null)[] | null> {
  const entity = obs.get(key)

  if (isCategoricalGroup(entity)) {
    const codes = readNumericArray(
      await readDatasetValue(expectDataset(entity.get('codes'), `/obs/${key}/codes`)),
      `/obs/${key}/codes`,
    )
    const categories = readCategoryLabels(
      await readDatasetValue(
        expectDataset(entity.get('categories'), `/obs/${key}/categories`),
      ),
      `/obs/${key}/categories`,
    )

    return codes.length === rowCount
      ? Array.from({ length: rowCount }, (_value, index) => {
          const code = Math.trunc(numericValue(codes, index))
          return code < 0 ? null : (categories[code] ?? null)
        })
      : null
  }

  if (!isDataset(entity)) {
    return null
  }

  const value = await readDatasetValue(entity)

  if (isNumericArray(value)) {
    return value.length === rowCount ? numericArrayToNumbers(value) : null
  }

  if (isStringArrayLike(value)) {
    const strings = Array.from(value)
    return strings.length === rowCount ? strings : null
  }

  return null
}

async function readMatrix(
  file: H5GroupLike,
  rows: number,
  cols: number,
): Promise<H5adMatrix> {
  const x = file.get('/X')

  if (isDataset(x)) {
    const shape = x.shape

    if (
      shape === null ||
      readShapeDimension(shape, 0, '/X') !== rows ||
      readShapeDimension(shape, 1, '/X') !== cols
    ) {
      throw new Error('H5AD /X dense matrix shape does not match obs x var.')
    }

    if (isZarrDataset(x)) {
      return {
        kind: 'dense-zarr',
        values: x.source.array,
        rows,
        cols,
      }
    }

    return {
      kind: 'dense',
      values: readNumericArray(await readDatasetValue(x), '/X'),
      rows,
      cols,
    }
  }

  const group = expectGroup(x, '/X')
  const encodingType = readStringAttribute(group, 'encoding-type')
  const shape = readShapeAttribute(group, 'shape')
  const matrixRows = readShapeDimension(shape, 0, '/X.attrs.shape')
  const matrixCols = readShapeDimension(shape, 1, '/X.attrs.shape')

  if (matrixRows !== rows || matrixCols !== cols) {
    throw new Error('H5AD /X sparse matrix shape does not match obs x var.')
  }

  const data = expectDataset(group.get('data'), '/X/data')
  const indices = expectDataset(group.get('indices'), '/X/indices')
  const indptrDataset = expectDataset(group.get('indptr'), '/X/indptr')
  const indptr = readNumericArray(await readDatasetValue(indptrDataset), '/X/indptr')

  if (isZarrDataset(data) || isZarrDataset(indices)) {
    if (!isZarrDataset(data) || !isZarrDataset(indices)) {
      throw new Error('H5AD /X sparse reference arrays must expose data and indices.')
    }

    const matrix = {
      data: data.source.array,
      indices: indices.source.array,
      indptr,
      rows,
      cols,
    }

    if (encodingType === 'csc_matrix') {
      return { kind: 'csc-zarr', ...matrix }
    }

    return { kind: 'csr-zarr', ...matrix }
  }

  const matrix = {
    data: readNumericArray(await readDatasetValue(data), '/X/data'),
    indices: readNumericArray(await readDatasetValue(indices), '/X/indices'),
    indptr,
    rows,
    cols,
  }

  if (encodingType === 'csc_matrix') {
    return { kind: 'csc', ...matrix }
  }

  return { kind: 'csr', ...matrix }
}

async function h5adMatrixForCells(
  cache: H5adCache,
  ids: readonly SpatialElementId[],
  genes: readonly string[],
): Promise<GexResult<SpatialElementId>> {
  const rowByCellId = new Map<string, number>()
  const colByGeneName = new Map<string, number>()

  cache.cellIds.forEach((cellId, row) => {
    rowByCellId.set(cellId, row)
  })
  cache.geneNames.forEach((geneName, col) => {
    colByGeneName.set(geneName, col)
  })

  const requestedCols = genes
    .map((gene) => colByGeneName.get(gene))
    .filter((col): col is number => col !== undefined)
  const requestedGenes = requestedCols.map((col) => cache.geneNames[col] ?? '')
  const requestedRows = ids
    .map((id) => {
      const row = rowByCellId.get(id)
      return row === undefined ? null : { id, row }
    })
    .filter(
      (target): target is { readonly id: SpatialElementId; readonly row: number } =>
        target !== null,
    )

  if (requestedRows.length === 0) {
    return {
      geneNames: requestedGenes,
      cells: new Map(),
    }
  }

  if (requestedCols.length === 0) {
    return {
      geneNames: requestedGenes,
      cells: emptyH5adCells(requestedRows),
    }
  }

  const includeZeroCounts = genes.length === 1
  const cells = await h5adMatrixCellsForRows(
    cache.matrix,
    requestedRows,
    requestedCols,
    cache.geneNames,
    includeZeroCounts,
  )

  return {
    geneNames: requestedGenes,
    cells,
  }
}

async function h5adMatrixCellsForRows(
  matrix: H5adMatrix,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  includeZeroCounts: boolean,
): Promise<ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }>> {
  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()
  const allGenesRequested = requestedCols.length === matrix.cols

  if (matrix.kind === 'dense') {
    for (const { id, row } of rows) {
      cells.set(
        id,
        denseRowCell(matrix.values, row, matrix.cols, requestedCols, geneNames, {
          includeZeroCounts,
        }),
      )
    }

    return cells
  }

  if (matrix.kind === 'dense-zarr') {
    for (const { id, row } of rows) {
      cells.set(
        id,
        denseRowCell(
          readNumericArray(
            zarrChunkValue(await zarr.get(matrix.values, [row, null])),
            matrix.values.path,
          ),
          0,
          matrix.cols,
          requestedCols,
          geneNames,
          { includeZeroCounts },
        ),
      )
    }

    return cells
  }

  if (matrix.kind === 'csr') {
    for (const { id, row } of rows) {
      const start = Math.trunc(numericValue(matrix.indptr, row))
      const end = Math.trunc(numericValue(matrix.indptr, row + 1))
      cells.set(
        id,
        sparseVectorCell(
          matrix.indices,
          matrix.data,
          start,
          end,
          requestedCols,
          geneNames,
          {
            allGenesRequested,
            includeZeroCounts,
          },
        ),
      )
    }

    return cells
  }

  if (matrix.kind === 'csr-zarr') {
    for (const batch of csrZarrRowBatches(matrix.indptr, rows)) {
      const [indices, data] =
        batch.end > batch.start
          ? await Promise.all([
              zarrNumericVector(matrix.indices, batch.start, batch.end),
              zarrNumericVector(matrix.data, batch.start, batch.end),
            ])
          : [[], []]

      for (const { id, start, end } of batch.rows) {
        cells.set(
          id,
          sparseVectorCell(
            indices,
            data,
            start - batch.start,
            end - batch.start,
            requestedCols,
            geneNames,
            {
              allGenesRequested,
              includeZeroCounts,
            },
          ),
        )
      }
    }

    return cells
  }

  if (matrix.kind === 'csc-zarr' && allGenesRequested) {
    throw new H5adAllGeneCscMatrixUnsupportedError(matrix.rows, matrix.cols)
  }

  return h5adMatrixCellsFromColumns(
    matrix,
    rows,
    requestedCols,
    geneNames,
    includeZeroCounts,
  )
}

interface CsrZarrRowBatch {
  readonly start: number
  readonly end: number
  readonly rows: readonly {
    readonly id: SpatialElementId
    readonly start: number
    readonly end: number
  }[]
}

// Groups CSR rows into contiguous value ranges so nearby rows share one zarr
// read instead of re-reading the same chunks row by row.
function csrZarrRowBatches(
  indptr: NumericArrayLike,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
): readonly CsrZarrRowBatch[] {
  const spans = rows
    .map(({ id, row }) => ({
      id,
      start: Math.trunc(numericValue(indptr, row)),
      end: Math.trunc(numericValue(indptr, row + 1)),
    }))
    .sort((left, right) => left.start - right.start)
  const batches: CsrZarrRowBatch[] = []
  let current: {
    start: number
    end: number
    rows: { id: SpatialElementId; start: number; end: number }[]
  } | null = null

  for (const span of spans) {
    if (
      current !== null &&
      span.start - current.end <= CSR_ZARR_BATCH_MAX_GAP_VALUES &&
      Math.max(current.end, span.end) - current.start <= CSR_ZARR_BATCH_MAX_VALUES
    ) {
      current.end = Math.max(current.end, span.end)
      current.rows.push(span)
      continue
    }

    if (current !== null) {
      batches.push(current)
    }

    current = { start: span.start, end: span.end, rows: [span] }
  }

  if (current !== null) {
    batches.push(current)
  }

  return batches
}

async function h5adMatrixCellsFromColumns(
  matrix: Extract<H5adMatrix, { readonly kind: 'csc' | 'csc-zarr' }>,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  includeZeroCounts: boolean,
): Promise<ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }>> {
  const rowByIndex = new Map<number, SpatialElementId>()
  const valuesByCell = new Map<SpatialElementId, Map<number, number>>()

  for (const { id, row } of rows) {
    rowByIndex.set(row, id)
    valuesByCell.set(id, new Map())
  }

  for (const col of requestedCols) {
    const start = Math.trunc(numericValue(matrix.indptr, col))
    const end = Math.trunc(numericValue(matrix.indptr, col + 1))

    if (start >= end) {
      continue
    }

    const [indices, data] =
      matrix.kind === 'csc-zarr'
        ? await Promise.all([
            zarrNumericVector(matrix.indices, start, end),
            zarrNumericVector(matrix.data, start, end),
          ])
        : [matrix.indices, matrix.data]
    const offset = matrix.kind === 'csc-zarr' ? 0 : start

    for (let index = offset; index < offset + (end - start); index += 1) {
      const row = Math.trunc(numericValue(indices, index))
      const id = rowByIndex.get(row)

      if (id === undefined) {
        continue
      }

      valuesByCell.get(id)?.set(col, numericValue(data, index))
    }
  }

  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()

  for (const { id } of rows) {
    cells.set(
      id,
      cellFromCountsByColumn(
        valuesByCell.get(id) ?? new Map(),
        requestedCols,
        geneNames,
        {
          includeZeroCounts,
        },
      ),
    )
  }

  return cells
}

function denseRowCell(
  values: NumericArrayLike,
  row: number,
  cols: number,
  requestedCols: readonly number[],
  geneNames: readonly string[],
  options: { readonly includeZeroCounts: boolean },
): { geneNames: string[]; counts: number[] } {
  const countsByColumn = new Map<number, number>()

  for (const col of requestedCols) {
    countsByColumn.set(col, numericValue(values, row * cols + col))
  }

  return cellFromCountsByColumn(countsByColumn, requestedCols, geneNames, options)
}

function sparseVectorCell(
  indices: NumericArrayLike,
  data: NumericArrayLike,
  start: number,
  end: number,
  requestedCols: readonly number[],
  geneNames: readonly string[],
  options: {
    readonly allGenesRequested: boolean
    readonly includeZeroCounts: boolean
  },
): { geneNames: string[]; counts: number[] } {
  const requestedColSet = options.allGenesRequested ? null : new Set(requestedCols)
  const countsByColumn = new Map<number, number>()

  for (let index = start; index < end; index += 1) {
    const col = Math.trunc(numericValue(indices, index))

    if (requestedColSet !== null && !requestedColSet.has(col)) {
      continue
    }

    countsByColumn.set(col, numericValue(data, index))
  }

  const outputCols = options.allGenesRequested
    ? Array.from(countsByColumn.keys()).sort((left, right) => left - right)
    : requestedCols

  return cellFromCountsByColumn(countsByColumn, outputCols, geneNames, {
    includeZeroCounts: options.includeZeroCounts,
  })
}

function cellFromCountsByColumn(
  countsByColumn: ReadonlyMap<number, number>,
  outputCols: readonly number[],
  geneNames: readonly string[],
  options: { readonly includeZeroCounts: boolean },
): { geneNames: string[]; counts: number[] } {
  const cellGeneNames: string[] = []
  const counts: number[] = []

  for (const col of outputCols) {
    const count = countsByColumn.get(col) ?? 0

    if (count <= 0 && !options.includeZeroCounts) {
      continue
    }

    cellGeneNames.push(geneNames[col] ?? `var-${col}`)
    counts.push(count)
  }

  return { geneNames: cellGeneNames, counts }
}

function emptyH5adCells(
  rows: readonly { readonly id: SpatialElementId }[],
): ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }> {
  return new Map(rows.map(({ id }) => [id, { geneNames: [], counts: [] }]))
}

function h5adCellsInBbox(
  cache: H5adCache,
  bbox: BBox,
  limit: number | undefined,
): readonly DatasetCell[] {
  const cells: DatasetCell[] = []
  const maxCells = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, limit)

  for (let index = 0; index < cache.cellIds.length; index += 1) {
    const position = cache.coordinates[index]
    const id = cache.cellIds[index]

    if (position === undefined || id === undefined || !isFinitePoint(position)) {
      continue
    }

    if (
      position.x < bbox.minX ||
      position.x > bbox.maxX ||
      position.y < bbox.minY ||
      position.y > bbox.maxY
    ) {
      continue
    }

    cells.push({
      id: id as never,
      position,
    })

    if (cells.length >= maxCells) {
      break
    }
  }

  return cells
}

function h5adCellMetadata(
  cache: H5adCache,
  row: number,
): Readonly<Record<string, string | number | boolean>> {
  const metadata: Record<string, string | number | boolean> = {}

  for (const track of cache.categoricalTracks) {
    const value = track.values[row]

    if (value !== null && value !== undefined) {
      metadata[track.label] = value
    }
  }

  for (const track of cache.continuousTracks) {
    const value = track.values[row]

    if (value !== undefined && Number.isFinite(value)) {
      metadata[track.label] = value
    }
  }

  return metadata
}

function h5adAnnotationGroupId(track: H5adCategoricalTrack): string {
  return `analysis:${slug(track.label)}`
}

function countUniqueLabels(labels: readonly string[]): number {
  const values = new Set<string>()

  for (const label of labels) {
    if (label.length > 0) {
      values.add(label)
    }
  }

  return values.size
}

function pointInPolygon(point: DataPoint, polygon: readonly DataPoint[]): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i]
    const previous = polygon[j]

    if (current === undefined || previous === undefined) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function bboxForPoints(points: readonly DataPoint[]): BBox {
  if (points.length === 0) {
    return {
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    if (!isFinitePoint(point)) {
      continue
    }

    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  if (!Number.isFinite(minX)) {
    return bboxForPoints([])
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function isFinitePoint(point: DataPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function uniqueNames(
  names: readonly string[],
  fallbackPrefix: string,
): readonly string[] {
  const seen = new Map<string, number>()

  return names.map((name, index) => {
    const fallback = `${fallbackPrefix}-${index}`
    const base = name.trim() === '' ? fallback : name.trim()
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)

    return count === 0 ? base : `${base}-${count + 1}`
  })
}

function readStringAttribute(group: H5EntityLike, name: string): string | undefined {
  const value = group.attrs?.[name]?.value

  return typeof value === 'string' ? value : undefined
}

function readStringArrayAttribute(group: H5EntityLike, name: string): readonly string[] {
  const value = group.attrs?.[name]?.value

  if (value === undefined) {
    return []
  }

  return readStringArray(value, `attrs.${name}`)
}

function readShapeAttribute(group: H5EntityLike, name: string): readonly number[] {
  const value = group.attrs?.[name]?.value

  if (value === undefined) {
    throw new Error(`Expected H5AD ${name} attribute to be present.`)
  }

  return Array.from(readNumericArray(value, `attrs.${name}`), Number)
}

function readStringArray(value: unknown, label: string): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }

  if (isStringArrayLike(value)) {
    return Array.from(value)
  }

  throw new Error(`Expected H5AD ${label} to contain strings.`)
}

function readCategoryLabels(value: unknown, label: string): readonly string[] {
  if (isNumericArray(value)) {
    return Array.from({ length: value.length }, (_item, index) =>
      String(numericValue(value, index)),
    )
  }

  return readStringArray(value, label)
}

function readNumericArray(value: unknown, label: string): NumericArrayLike {
  if (isNumericArray(value)) {
    return value
  }

  throw new Error(`Expected H5AD ${label} to contain numeric values.`)
}

async function readDatasetValue(dataset: H5DatasetLike): Promise<unknown> {
  if (dataset.value !== undefined) {
    return dataset.value
  }

  if (isZarrDataset(dataset)) {
    return zarrChunkValue(
      await zarr.get(dataset.source.array, fullArraySelection(dataset.source.array)),
    )
  }

  return dataset.value
}

function isNumericArray(value: unknown): value is NumericArrayLike {
  return (
    (Array.isArray(value) && value.every((item) => typeof item === 'number')) ||
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  )
}

function numericValue(values: NumericArrayLike, index: number): number {
  const value = values[index]
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

function numericArrayToNumbers(values: NumericArrayLike): readonly number[] {
  const numbers: number[] = []

  for (let index = 0; index < values.length; index += 1) {
    numbers.push(numericValue(values, index))
  }

  return numbers
}

function fullArraySelection(array: H5adZarrArray): null[] {
  return Array.from({ length: array.shape.length }, () => null)
}

function zarrChunkValue(value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    isZarrChunkData((value as { readonly data?: unknown }).data)
  ) {
    return (value as { readonly data: unknown }).data
  }

  return value
}

async function zarrNumericVector(
  array: H5adZarrArray,
  start: number,
  end: number,
): Promise<NumericArrayLike> {
  if (start >= end) {
    return []
  }

  const value = zarrChunkValue(await zarr.get(array, [zarr.slice(start, end, 1)]))
  return readNumericArray(value, array.path)
}

function isZarrChunkData(value: unknown): boolean {
  return isNumericArray(value) || isStringArrayLike(value)
}

function isStringArrayLike(value: unknown): value is Iterable<string> {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string')
  }

  if (typeof value !== 'object' || value === null || !(Symbol.iterator in value)) {
    return false
  }

  const preview = Array.from(value as Iterable<unknown>)
  return preview.every((item) => typeof item === 'string')
}

function readShapeDimension(
  shape: readonly number[],
  index: number,
  label: string,
): number {
  const value = shape[index]

  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected H5AD ${label} shape[${index}] to be valid.`)
  }

  return value
}

function isDataset(value: unknown): value is H5DatasetLike {
  return (
    typeof value === 'object' && value !== null && 'shape' in value && 'value' in value
  )
}

function isZarrDataset(value: H5DatasetLike): value is H5DatasetLike & {
  readonly source: H5adArraySource
} {
  return value.source?.kind === 'zarr'
}

function isGroup(value: unknown): value is H5GroupLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keys' in value &&
    typeof (value as { readonly keys?: unknown }).keys === 'function' &&
    'get' in value &&
    typeof (value as { readonly get?: unknown }).get === 'function'
  )
}

function isCategoricalGroup(value: unknown): value is H5GroupLike {
  return (
    isGroup(value) &&
    value.get('codes') !== null &&
    value.get('codes') !== undefined &&
    value.get('categories') !== null &&
    value.get('categories') !== undefined
  )
}

function expectDataset(value: unknown, label: string): H5DatasetLike {
  if (!isDataset(value)) {
    throw new Error(`Expected H5AD ${label} to be a dataset.`)
  }

  return value
}

function expectGroup(value: unknown, label: string): H5GroupLike {
  if (!isGroup(value)) {
    throw new Error(`Expected H5AD ${label} to be a group.`)
  }

  return value
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('H5AD request aborted.')
    error.name = 'AbortError'
    throw error
  }
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }

  return (hash >>> 0).toString(16)
}
