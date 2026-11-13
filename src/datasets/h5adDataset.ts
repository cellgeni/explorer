import { ReferenceStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import {
  IcechunkRepositoryUnavailableError,
  openIcechunkRepository,
  type IcechunkRepository,
} from '../zarr/icechunkStore'
import { icechunkCompanionFileUrl } from '../zarr/icechunkUrl'
import { ZarrChunkUnavailableError } from '../zarr/zarrStores'
import { getWholeArray } from '../zarr/zarrWholeArray'
import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { RoiSelectionInput } from '../data/roiSelection'
import { normalizeRoiSelection } from '../data/roiSelection'
import { openH5WorkerFile, type H5WorkerFile } from '../data/h5WorkerFile'
import { createAsyncLimiter } from '../utils/asyncLimiter'
import { slug } from '../utils/slug'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../data/customAnnotations'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { H5TreeGroup } from '../workers/h5FileMessages'
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
  SpatialElement,
  SpatialElementId,
} from './spatialDataset'
import type {
  DatasetCell,
  GeneExpressionBatch,
  GeneExpressionElement,
} from './xeniumDataset'
import { normalizeSampleStride } from './xeniumDatasetRows'
import {
  encodeImageArrayAsBmp,
  parseVisiumScalefactors,
  resolveVisiumUnits,
  visiumImageScalefactor,
  visiumSpotRing,
  VISIUM_SPOT_AREA_SQUARE_MICROMETERS,
  VISIUM_SPOT_DIAMETER_MICROMETERS,
  type VisiumImageKind,
  type VisiumLatticeSample,
  type VisiumScalefactors,
  type VisiumUnits,
} from './visiumFormat'

export interface AnnDataH5adDatasetOptions {
  readonly url: string
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  // Reads AnnData from a group inside an already-open Zarr store (for example
  // a SpatialData table) instead of fetching an .h5ad file.
  readonly zarrSource?: AnnDataZarrSource
  // Builds AnnData in memory (for example from Space Ranger output) instead of
  // fetching an .h5ad file.
  readonly memorySource?: AnnDataMemorySource
  // `url` is an Icechunk repository holding AnnData, such as one written with
  // `adata.write_zarr(session.store)`, instead of an .h5ad file.
  readonly icechunk?: boolean
  // Visium tissue images hosted as files next to the table. They replace
  // `uns/spatial/<library>/images`.
  readonly visiumImageUrls?: Readonly<Partial<Record<VisiumImageKind, string>>>
}

export type H5adLoadProgressReporter = (message: string) => void

export interface AnnDataMemorySource {
  readonly label: string
  load(onProgress?: H5adLoadProgressReporter): Promise<AnnDataMemoryTable>
}

// An AnnData object held as plain arrays. `uns` values become scalar datasets
// (numbers, strings), arrays, or nested groups (records).
export interface AnnDataMemoryTable {
  readonly obsNames: readonly string[]
  readonly obs: readonly AnnDataMemoryColumn[]
  readonly varNames: readonly string[]
  readonly var?: readonly AnnDataMemoryColumn[]
  readonly X: {
    readonly kind: 'csr'
    readonly data: NumericArrayLike
    readonly indices: NumericArrayLike
    readonly indptr: NumericArrayLike
  }
  readonly obsm: Readonly<
    Record<string, { readonly values: NumericArrayLike; readonly columns: number }>
  >
  readonly uns?: AnnDataMemoryUns
}

export type AnnDataMemoryColumn =
  | {
      readonly name: string
      readonly kind: 'numeric'
      readonly values: NumericArrayLike
    }
  | {
      readonly name: string
      readonly kind: 'categorical'
      readonly codes: NumericArrayLike
      readonly categories: readonly string[]
    }
  | { readonly name: string; readonly kind: 'string'; readonly values: readonly string[] }

export interface AnnDataMemoryUns {
  readonly [key: string]: AnnDataMemoryUns | number | string | NumericArrayLike
}

// Standard Visium layout found in `uns/spatial/<library>`. Coordinates are
// converted from full-resolution pixels to micrometres with `units`.
export interface AnnDataVisiumSummary {
  readonly libraryId: string
  readonly libraryIds: readonly string[]
  // Spots shown: the library's rows under tissue.
  readonly spotCount: number
  // The library's rows with obs `in_tissue` 0 (CELLxGENE keeps every array
  // spot); hidden unless `showOffTissue`.
  readonly offTissueSpotCount: number
  readonly showOffTissue: boolean
  readonly spotDiameterMicrometers: number
  readonly units: VisiumUnits
  readonly scalefactors: VisiumScalefactors
  readonly images: readonly VisiumImageKind[]
  // From `uns/spatial/<library>/metadata`, as scanpy copies them from the
  // Space Ranger matrix.
  readonly chemistry?: string
  readonly softwareVersion?: string
}

// Which library to show and whether to show spots off the tissue.
export interface AnnDataVisiumView {
  readonly libraryId?: string
  readonly showOffTissue?: boolean
}

export interface AnnDataZarrSource {
  readonly store: zarr.Readable
  readonly zarrFormat: 2 | 3
  readonly path: string
  readonly nodes: readonly AnnDataZarrNode[]
  readonly label?: string
  readonly resolveCoordinates?: AnnDataCoordinateResolver
  // Replaces read errors with a source-specific explanation, for example an
  // incomplete SpatialData store.
  readonly describeError?: (error: unknown) => unknown
  readonly onReady?: () => void
}

export interface AnnDataZarrNode {
  readonly path: string
  readonly kind: 'array' | 'group'
}

export interface AnnDataObsAccess {
  readonly cellIds: readonly string[]
  readonly columnNames: readonly string[]
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
  readonly geneAliases: ReadonlyMap<string, string>
  readonly coordinates: readonly DataPoint[]
  readonly root: H5GroupLike
  readonly embeddingOptions: readonly AnalysisEmbeddingOption[]
  readonly categoricalTracks: readonly H5adCategoricalTrack[]
  readonly continuousTracks: readonly H5adContinuousTrack[]
  readonly matrix: H5adMatrix
  readonly extent: BBox
  // The Visium placement for the current view; `visiumSource` holds what any
  // view needs.
  readonly visium: H5adVisiumLayout | null
  readonly visiumSource: H5adVisiumSource | null
}

interface H5adVisiumSource {
  readonly libraries: readonly H5adVisiumLibrary[]
  readonly defaultLibraryId: string
  // obsm `spatial`, in full-resolution pixels.
  readonly pixels: readonly { readonly x: number; readonly y: number }[]
  // Each row's library from an obs library column; null without one.
  readonly rowLibraries: readonly (string | null)[] | null
  readonly inTissue: readonly number[] | null
  readonly arrayRows: readonly number[] | null
  readonly arrayCols: readonly number[] | null
}

interface H5adVisiumLibrary {
  readonly id: string
  readonly scalefactors: VisiumScalefactors
  readonly imagePaths: Readonly<Partial<Record<VisiumImageKind, string>>>
  readonly chemistry?: string
  readonly softwareVersion?: string
}

interface H5adVisiumLayout {
  readonly summary: Omit<AnnDataVisiumSummary, 'images'>
  // `uns/spatial/<library>/images/<kind>` datasets.
  readonly imagePaths: Readonly<Partial<Record<VisiumImageKind, string>>>
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

export type NumericArrayLike =
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

type H5adArraySource = H5adZarrArraySource | H5adWorkerArraySource

interface H5adZarrArraySource {
  readonly kind: 'zarr'
  readonly array: H5adZarrArray
}

// A dataset of an .h5ad file open in an H5 file worker.
interface H5adWorkerArraySource {
  readonly kind: 'h5-worker'
  readonly file: H5WorkerFile
  readonly path: string
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

const VISIUM_IMAGE_KINDS: readonly VisiumImageKind[] = ['hires', 'lowres']
// Obs columns that name each row's library in multi-sample Visium AnnData.
const VISIUM_LIBRARY_COLUMNS = ['library_id', 'library', 'sample']

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
  readonly repositoryUrl: string
  readonly byteLength: number
  readonly maxBytes: number

  constructor(
    url: string,
    referenceUrl: string,
    repositoryUrl: string,
    byteLength: number,
    maxBytes = H5AD_MAX_FILE_BYTES,
  ) {
    super(
      `H5AD file is ${formatByteCount(
        byteLength,
      )}, exceeding the browser load limit of ${formatByteCount(
        maxBytes,
      )}, and no readable kerchunk reference file was found at ${referenceUrl}, nor an Icechunk repository at ${repositoryUrl}.`,
    )
    this.name = 'H5adReferenceFileUnavailableError'
    this.url = url
    this.referenceUrl = referenceUrl
    this.repositoryUrl = repositoryUrl
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
  private readonly memorySource: AnnDataMemorySource | undefined
  // The fetcher passed in, which detection opened the repository with too;
  // undefined for the global fetch.
  private readonly icechunkFetcher: typeof fetch | undefined
  private readonly icechunk: boolean
  private readonly visiumImageUrls: Readonly<Partial<Record<VisiumImageKind, string>>>
  private baseCachePromise: Promise<H5adCache> | null = null
  // The base cache placed for `visiumView`.
  private cachePromise: Promise<H5adCache> | null = null
  private visiumView: AnnDataVisiumView = {}
  private spotElementsPromise: Promise<readonly VisiumSpotEntry[]> | null = null
  // Per library and image kind.
  private readonly tissueImageUrls = new Map<string, Promise<string>>()

  constructor(options: AnnDataH5adDatasetOptions) {
    this.url = options.url
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.zarrSource = options.zarrSource
    this.memorySource = options.memorySource
    this.icechunk = options.icechunk === true
    this.icechunkFetcher = options.fetcher
    this.visiumImageUrls = options.visiumImageUrls ?? {}
  }

  async meta(): Promise<DatasetMeta> {
    const cache = await this.cache()
    const visium = cache.visium?.summary

    return {
      platform: visium === undefined ? 'h5ad' : 'visium',
      units:
        visium === undefined
          ? DEFAULT_H5AD_UNITS
          : {
              ...DEFAULT_H5AD_UNITS,
              micrometersPerPixel: micrometers(visium.units.micrometersPerPixel),
            },
      extent: cache.extent,
      capabilities: {
        transcripts: false,
        cellBoundaries: visium !== undefined,
        pyramidImage: false,
        multiChannel: false,
      },
    }
  }

  // Visium spot outlines; other AnnData has no element geometry.
  async elements(bbox?: BBox): Promise<ElementBatch<SpatialElementId>> {
    const cache = await this.cache()

    if (cache.visium === null) {
      return { elements: [] }
    }

    const spots = await this.spotElements()
    const radius = cache.visium.summary.spotDiameterMicrometers / 2

    return {
      elements:
        bbox === undefined
          ? spots.map((spot) => spot.element)
          : spots
              .filter(
                (spot) =>
                  spot.center.x + radius >= bbox.minX &&
                  spot.center.x - radius <= bbox.maxX &&
                  spot.center.y + radius >= bbox.minY &&
                  spot.center.y - radius <= bbox.maxY,
              )
              .map((spot) => spot.element),
    }
  }

  // Chooses the Visium library and whether off-tissue spots are placed. The
  // file is not read again; later calls see the new placement.
  setVisiumView(view: AnnDataVisiumView): this {
    if (
      view.libraryId !== this.visiumView.libraryId ||
      (view.showOffTissue === true) !== (this.visiumView.showOffTissue === true)
    ) {
      this.visiumView = view
      this.cachePromise = null
      this.spotElementsPromise = null
    }

    return this
  }

  // Standard Visium layout read from `uns/spatial`, or null for other AnnData.
  async visiumSummary(): Promise<AnnDataVisiumSummary | null> {
    const visium = (await this.cache()).visium

    return visium === null
      ? null
      : { ...visium.summary, images: this.visiumImageKinds(visium) }
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    const cache = await this.cache()
    const spotArea = visiumSpotArea(cache)

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
        ...(spotArea === undefined ? {} : { cellArea: spotArea }),
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
    options: CellFeatureMatrixReadOptions & {
      readonly limit?: number
      readonly sampleStride?: number
    } = {},
  ): Promise<GeneExpressionBatch> {
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const selectedCells = h5adCellsInBbox(cache, bbox, options.limit)
    const matrix = await h5adMatrixForCells(
      cache,
      selectedCells.map((cell) => cell.id),
      genes,
    )
    // A sample keeps every cell with expression and every Nth cell without.
    const sampleStride = normalizeSampleStride(options.sampleStride)
    const spotArea = visiumSpotArea(cache)
    const elements: GeneExpressionElement[] = []
    let zeroCellIndex = 0

    for (const cell of selectedCells) {
      const expression = matrix.cells.get(cell.id)
      const count = expression?.counts.reduce((sum, value) => sum + value, 0) ?? 0

      if (count === 0) {
        zeroCellIndex += 1

        if ((zeroCellIndex - 1) % sampleStride !== 0) {
          continue
        }
      }

      elements.push({
        id: cell.id,
        position: cell.position,
        count,
        ...(spotArea === undefined ? {} : { cellArea: spotArea }),
      })
    }

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

  // Values stay `null` here: one object per cell per column is too much to build
  // for every column at load. `metadataTrackValues` builds one column on demand.
  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    const cache = await this.cache()

    return cache.continuousTracks.map((track) => ({
      id: h5adMetadataTrackId(track),
      label: track.label,
      values: null,
      cellCount: track.values.length,
      min: track.min,
      max: track.max,
    }))
  }

  async metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly ContinuousCellMetadataValue[]> {
    throwIfAborted(options.signal)
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const track = cache.continuousTracks.find(
      (candidate) => h5adMetadataTrackId(candidate) === trackId,
    )

    if (track === undefined) {
      throw new Error(`H5AD metadata track ${trackId} does not exist.`)
    }

    return track.values.map((value, index) => ({
      cellId: cache.cellIds[index] as never,
      value,
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

  // Gene name to var index name, for genes listed by a symbol column.
  async geneAliases(): Promise<ReadonlyMap<string, string>> {
    const cache = await this.cache()
    return cache.geneAliases
  }

  // Every obs row's id in matrix row order, including rows without
  // coordinates (which `overview` leaves out).
  async cellIds(): Promise<readonly string[]> {
    const cache = await this.cache()
    return cache.cellIds
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

  // The Visium tissue image: high-res when present, else low-res.
  async image(): Promise<ImageSource | null> {
    const visium = (await this.cache()).visium
    const kind = visium === null ? undefined : this.visiumImageKinds(visium)[0]
    return kind === undefined ? null : this.tissueImage(kind)
  }

  // A Visium tissue image placed with its `tissue_<kind>_scalef`. Images held
  // in `uns` are encoded once into an object URL.
  async tissueImage(kind: VisiumImageKind): Promise<ImageSource | null> {
    const cache = await this.cache()
    const visium = cache.visium

    const scaleFactor =
      visium === null || !this.visiumImageKinds(visium).includes(kind)
        ? undefined
        : visiumImageScalefactor(visium.summary.scalefactors, kind)

    if (visium === null || scaleFactor === undefined) {
      return null
    }

    const hostedUrl = this.visiumImageUrls[kind]

    // GEO publishes Space Ranger images gzipped (`*.png.gz`); the browser
    // only draws them once decompressed.
    if (hostedUrl !== undefined && isGzipUrl(hostedUrl)) {
      return {
        kind: 'flat',
        url: await this.cachedImageUrl(visium.summary.libraryId, kind, () =>
          readGunzippedImageUrl(hostedUrl, this.fetcher),
        ),
        scaleFactor,
      }
    }

    if (hostedUrl !== undefined) {
      return { kind: 'flat', url: hostedUrl, scaleFactor }
    }

    const path = visium.imagePaths[kind]

    if (path === undefined) {
      return null
    }

    const dataset = expectDataset(cache.root.get(path), path)
    const shape = dataset.shape ?? []
    const url = await this.cachedImageUrl(visium.summary.libraryId, kind, async () => {
      const value = await readDatasetValue(dataset)
      this.onProgress?.(`Visium ${kind} image: encoding ${shape.join(' x ')} array`)
      const bytes = encodeImageArrayAsBmp(readNumericArray(value, path), shape)
      return URL.createObjectURL(new Blob([bytes], { type: 'image/bmp' }))
    })
    const [height, width] = shape

    return {
      kind: 'flat',
      url,
      scaleFactor,
      ...(height === undefined || width === undefined ? {} : { size: [width, height] }),
    }
  }

  // Object URLs are made once per image and kept for the dataset's lifetime.
  private cachedImageUrl(
    libraryId: string,
    kind: VisiumImageKind,
    create: () => Promise<string>,
  ): Promise<string> {
    const key = `${libraryId}/${kind}`
    const existing = this.tissueImageUrls.get(key)

    if (existing !== undefined) {
      return existing
    }

    const urlPromise = create()
    this.tissueImageUrls.set(key, urlPromise)
    urlPromise.catch(() => {
      this.tissueImageUrls.delete(key)
    })
    return urlPromise
  }

  // Images that can be placed: hosted or in `uns`, with a scale factor.
  private visiumImageKinds(visium: H5adVisiumLayout): readonly VisiumImageKind[] {
    return VISIUM_IMAGE_KINDS.filter(
      (kind) =>
        visiumImageScalefactor(visium.summary.scalefactors, kind) !== undefined &&
        (this.visiumImageUrls[kind] !== undefined ||
          visium.imagePaths[kind] !== undefined),
    )
  }

  private spotElements(): Promise<readonly VisiumSpotEntry[]> {
    if (this.spotElementsPromise === null) {
      this.spotElementsPromise = this.cache().then((cache) => {
        const diameter =
          cache.visium?.summary.spotDiameterMicrometers ??
          VISIUM_SPOT_DIAMETER_MICROMETERS
        const spots: VisiumSpotEntry[] = []

        cache.cellIds.forEach((id, index) => {
          const center = cache.coordinates[index]

          if (center === undefined || !isFinitePoint(center)) {
            return
          }

          spots.push({
            center,
            element: {
              id,
              geometry: { kind: 'polygon', rings: [visiumSpotRing(center, diameter)] },
            },
          })
        })

        return spots
      })
      this.spotElementsPromise.catch(() => {
        this.spotElementsPromise = null
      })
    }

    return this.spotElementsPromise
  }

  private cache(): Promise<H5adCache> {
    if (this.cachePromise === null) {
      const view = this.visiumView
      const promise = this.baseCache().then((base) => withVisiumView(base, view))
      this.cachePromise = promise
      promise.catch(() => {
        if (this.cachePromise === promise) {
          this.cachePromise = null
        }
      })
    }

    return this.cachePromise
  }

  private baseCache(): Promise<H5adCache> {
    if (this.baseCachePromise === null) {
      this.baseCachePromise = (
        this.memorySource !== undefined
          ? readAnnDataMemory(this.url, this.memorySource, this.onProgress)
          : this.icechunk
            ? readAnnDataIcechunk(this.url, this.icechunkFetcher, this.onProgress)
            : this.zarrSource === undefined
              ? readH5ad(this.url, {
                  fetcher: this.fetcher,
                  ...(this.onProgress === undefined
                    ? {}
                    : { onProgress: this.onProgress }),
                })
              : readAnnDataZarr(this.url, this.zarrSource, this.onProgress)
      ).catch((error: unknown) => {
        this.baseCachePromise = null
        throw error
      })
    }

    return this.baseCachePromise
  }
}

function withVisiumView(base: H5adCache, view: AnnDataVisiumView): H5adCache {
  if (base.visiumSource === null) {
    return base
  }

  const { layout, coordinates } = placeVisiumView(base.visiumSource, view)
  return { ...base, coordinates, extent: bboxForPoints(coordinates), visium: layout }
}

interface VisiumSpotEntry {
  readonly center: DataPoint
  readonly element: SpatialElement<SpatialElementId>
}

function isGzipUrl(url: string): boolean {
  try {
    return /\.gz$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

async function readGunzippedImageUrl(
  url: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await fetcher(url)

  if (!response.ok || response.body === null) {
    throw new Error(`Visium tissue image ${url} returned HTTP ${response.status}.`)
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression.')
  }

  const blob = await new Response(
    response.body.pipeThrough(new DecompressionStream('gzip')),
  ).blob()
  const type = /\.jpe?g\.gz$/i.test(new URL(url).pathname) ? 'image/jpeg' : 'image/png'
  return URL.createObjectURL(new Blob([blob], { type }))
}

function visiumSpotArea(cache: H5adCache): number | undefined {
  const diameter = cache.visium?.summary.spotDiameterMicrometers

  return diameter === undefined
    ? undefined
    : diameter === VISIUM_SPOT_DIAMETER_MICROMETERS
      ? VISIUM_SPOT_AREA_SQUARE_MICROMETERS
      : Math.PI * (diameter / 2) ** 2
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

  // The worker stays open for reads after load (embeddings, tissue images)
  // and ends when the dataset is no longer referenced.
  const file = await openH5WorkerFile(bytes, { tree: true })

  try {
    return await readH5adCacheFromGroup(url, hydrateH5WorkerGroup(file))
  } catch (error) {
    file.close()
    throw error
  }
}

function hydrateH5WorkerGroup(
  file: H5WorkerFile,
  group: H5TreeGroup | null = file.tree,
  path = '',
): HydratedH5adGroup {
  if (group === null) {
    throw new Error('The H5 file worker returned no tree for the H5AD file.')
  }

  const children = new Map<string, unknown>()

  for (const [name, node] of group.children) {
    const childPath = `${path}/${name}`

    if (node.kind === 'group') {
      children.set(name, hydrateH5WorkerGroup(file, node, childPath))
      continue
    }

    const dataset: H5DatasetLike = {
      attrs: h5AttrsFromRecord(Object.fromEntries(node.attrs)),
      shape: node.shape,
      value: undefined,
      source: { kind: 'h5-worker', file, path: childPath },
    }
    children.set(name, dataset)
  }

  return new HydratedH5adGroup(
    h5AttrsFromRecord(Object.fromEntries(group.attrs)),
    children,
  )
}

async function readH5adReferenceOrThrow(
  url: string,
  fetcher: typeof fetch,
  byteLength: number,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const referenceUrl = h5adReferenceUrl(url)
  reportH5adProgress(onProgress, `Looking for H5AD reference ${referenceUrl}`)
  const response = await fetchH5adReferenceFile(referenceUrl, fetcher).catch(() => null)

  if (response?.ok !== true) {
    return readH5adIcechunkOrThrow(url, fetcher, referenceUrl, byteLength, onProgress)
  }

  reportH5adProgress(onProgress, `Loading H5AD reference ${referenceUrl}`)
  const spec = h5adReferenceSpecWithTarget(
    objectRecord(await response.json(), 'H5AD reference spec'),
    url,
  )
  reportH5adProgress(onProgress, 'H5AD reference loaded; opening referenced arrays')
  const store = ReferenceStore.fromSpec(h5adReferenceStoreSpec(spec), {
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

// The H5AD's companion Icechunk repository: virtual references to the H5AD's
// chunks, as VirtualiZarr writes them. Like the JSON reference, chunks are read
// from the H5AD URL whatever location the repository stores.
async function readH5adIcechunkOrThrow(
  url: string,
  fetcher: typeof fetch,
  referenceUrl: string,
  byteLength: number,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const repositoryUrl = h5adIcechunkUrl(url)
  reportH5adProgress(onProgress, `Looking for H5AD Icechunk repository ${repositoryUrl}`)
  let repository: IcechunkRepository

  try {
    repository = await openIcechunkRepository(repositoryUrl, {
      fetcher,
      virtualChunkUrl: url,
    })
  } catch (error) {
    if (error instanceof IcechunkRepositoryUnavailableError && !error.found) {
      throw new H5adReferenceFileUnavailableError(
        url,
        referenceUrl,
        repositoryUrl,
        byteLength,
      )
    }

    throw error
  }

  return readH5adCacheFromIcechunk(
    url,
    repository,
    'H5AD Icechunk repository',
    onProgress,
  )
}

async function readAnnDataIcechunk(
  url: string,
  fetcher: typeof fetch | undefined,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  reportH5adProgress(onProgress, `Opening Icechunk repository ${url}`)
  const repository = await openIcechunkRepository(url, {
    ...(fetcher === undefined ? {} : { fetcher }),
    virtualChunkUrl: icechunkCompanionFileUrl(url),
  })
  return readH5adCacheFromIcechunk(url, repository, 'Icechunk AnnData', onProgress)
}

async function readH5adCacheFromIcechunk(
  url: string,
  repository: IcechunkRepository,
  label: string,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  reportH5adProgress(
    onProgress,
    `${label} opened: ${repository.nodes.length.toLocaleString()} groups and arrays`,
  )
  repository.prefetchManifests(
    repository.nodes
      .filter((node) => node.kind === 'array' && isReadAtAnnDataLoad(node.path))
      .map((node) => node.path),
  )
  const root = await hydrateZarrAnnDataGroup(
    { store: repository.store, zarrFormat: 3, rootPath: '' },
    annDataIndexFromNodes(repository.nodes, ''),
    '',
  )
  const cache = await readH5adCacheFromGroup(url, root)
  reportH5adProgress(
    onProgress,
    `${label} ready: ${cache.cellIds.length.toLocaleString()} cells, ${cache.geneNames.length.toLocaleString()} genes`,
  )
  return cache
}

// Arrays read before the dataset is ready: obs, var, obsm, uns (scale factors
// and tissue images), and a sparse /X's indptr. The rest of /X, layers, raw,
// and the pairwise matrices are read later or never.
function isReadAtAnnDataLoad(path: string): boolean {
  const [group] = path.split('/')
  return (
    path === 'X/indptr' ||
    group === 'obs' ||
    group === 'var' ||
    group === 'obsm' ||
    group === 'uns'
  )
}

async function readAnnDataZarr(
  url: string,
  source: AnnDataZarrSource,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const label = source.label ?? 'AnnData table'
  const rootPath = normalizeZarrPath(source.path)
  reportH5adProgress(onProgress, `Opening ${label} arrays`)

  try {
    const root = await hydrateZarrAnnDataGroup(
      { store: source.store, zarrFormat: source.zarrFormat, rootPath },
      annDataIndexFromNodes(source.nodes, rootPath),
      '',
    )
    const cache = await readH5adCacheFromGroup(
      url,
      root,
      source.resolveCoordinates,
      (key, error) => {
        reportH5adProgress(
          onProgress,
          `${label}: skipped obs column ${key}. ${error.message}`,
        )
      },
      { visiumLayout: false },
    )
    reportH5adProgress(
      onProgress,
      `${label} ready: ${cache.cellIds.length.toLocaleString()} observations, ${cache.geneNames.length.toLocaleString()} genes`,
    )
    source.onReady?.()
    return cache
  } catch (error) {
    throw source.describeError?.(error) ?? error
  }
}

async function readAnnDataMemory(
  url: string,
  source: AnnDataMemorySource,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  const table = await source.load(onProgress)
  const cache = await readH5adCacheFromGroup(url, annDataGroupFromMemory(table))
  reportH5adProgress(
    onProgress,
    `${source.label} ready: ${cache.cellIds.length.toLocaleString()} observations, ${cache.geneNames.length.toLocaleString()} genes`,
  )
  return cache
}

// The same group tree an .h5ad file opens to, built from plain arrays.
function annDataGroupFromMemory(table: AnnDataMemoryTable): H5GroupLike {
  const rows = table.obsNames.length
  const obsm: Record<string, H5DatasetLike> = {}

  for (const [key, matrix] of Object.entries(table.obsm)) {
    obsm[key] = memoryDataset(matrix.values, [rows, matrix.columns])
  }

  return memoryGroup(
    {},
    {
      obs: memoryDataframe(table.obsNames, table.obs),
      var: memoryDataframe(table.varNames, table.var ?? []),
      X: memoryGroup(
        { 'encoding-type': 'csr_matrix', shape: [rows, table.varNames.length] },
        {
          data: memoryDataset(table.X.data),
          indices: memoryDataset(table.X.indices),
          indptr: memoryDataset(table.X.indptr),
        },
      ),
      obsm: memoryGroup({}, obsm),
      uns: memoryUnsGroup(table.uns ?? {}),
    },
  )
}

function memoryGroup(
  attrs: Readonly<Record<string, unknown>>,
  children: Readonly<Record<string, unknown>>,
): HydratedH5adGroup {
  return new HydratedH5adGroup(
    h5AttrsFromRecord(attrs),
    new Map(Object.entries(children)),
  )
}

function memoryDataset(
  value: NumericArrayLike | readonly string[] | number | string,
  shape: readonly number[] = typeof value === 'object' ? [value.length] : [],
): H5DatasetLike {
  return { shape, value }
}

function memoryDataframe(
  index: readonly string[],
  columns: readonly AnnDataMemoryColumn[],
): HydratedH5adGroup {
  const children: Record<string, unknown> = { _index: memoryDataset(index) }

  for (const column of columns) {
    children[column.name] =
      column.kind === 'categorical'
        ? memoryGroup(
            { 'encoding-type': 'categorical' },
            {
              codes: memoryDataset(column.codes),
              categories: memoryDataset(column.categories),
            },
          )
        : memoryDataset(column.values)
  }

  return memoryGroup(
    { _index: '_index', 'column-order': columns.map((column) => column.name) },
    children,
  )
}

function memoryUnsGroup(uns: AnnDataMemoryUns): HydratedH5adGroup {
  const children: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(uns)) {
    children[key] =
      typeof value === 'number' || typeof value === 'string' || isNumericArray(value)
        ? memoryDataset(value)
        : memoryUnsGroup(value)
  }

  return memoryGroup({}, children)
}

// Finds the standard Visium layout scanpy and squidpy write: obsm `spatial`
// in full-resolution pixels, and `uns/spatial/<library>` with `scalefactors`
// and `images`. Everything a placement needs is read once, so the library
// and off-tissue choice can change without reading the file again.
async function readVisiumSource(
  file: H5GroupLike,
  embedding: AnalysisEmbedding,
  tracks: {
    readonly categoricalTracks: readonly H5adCategoricalTrack[]
    readonly continuousTracks: readonly H5adContinuousTrack[]
  },
): Promise<H5adVisiumSource | null> {
  if (embedding.kind !== 'spatial' && embedding.kind !== 'X_spatial') {
    return null
  }

  const spatial = file.get('/uns/spatial')

  if (!isGroup(spatial)) {
    return null
  }

  const libraryIds = spatial.keys().filter((key) => {
    const library = spatial.get(key)
    return (
      isGroup(library) &&
      (isGroup(library.get('scalefactors')) || isGroup(library.get('images')))
    )
  })

  if (libraryIds.length === 0) {
    return null
  }

  const libraries = await Promise.all(
    libraryIds.map((id) => readVisiumLibrary(spatial, id)),
  )
  // With several libraries, an obs column says which rows belong to each.
  const libraryTrack =
    libraryIds.length > 1
      ? tracks.categoricalTracks.find(
          (track) =>
            VISIUM_LIBRARY_COLUMNS.includes(track.id) &&
            track.values.some((value) => value !== null && libraryIds.includes(value)),
        )
      : undefined
  const continuous = (id: string) =>
    tracks.continuousTracks.find((track) => track.id === id)?.values ?? null
  const inTissue = continuous('in_tissue')

  return {
    libraries,
    defaultLibraryId:
      libraryIds.find(
        (id) => libraryTrack === undefined || libraryTrack.values.includes(id),
      ) ?? libraryIds[0]!,
    pixels: embedding.points,
    rowLibraries: libraryTrack?.values ?? null,
    // Unless no row is under tissue, in which case the column is ignored.
    inTissue: inTissue?.some((value) => value !== 0) === true ? inTissue : null,
    arrayRows: continuous('array_row'),
    arrayCols: continuous('array_col'),
  }
}

async function readVisiumLibrary(
  spatial: H5GroupLike,
  id: string,
): Promise<H5adVisiumLibrary> {
  const library = expectGroup(spatial.get(id), `/uns/spatial/${id}`)
  const scalefactorGroup = library.get('scalefactors')
  const metadataGroup = library.get('metadata')
  const metadata = isGroup(metadataGroup) ? await readScalarRecord(metadataGroup) : {}
  const imageGroup = library.get('images')
  const imagePaths: Partial<Record<VisiumImageKind, string>> = {}

  if (isGroup(imageGroup)) {
    for (const kind of VISIUM_IMAGE_KINDS) {
      const image = imageGroup.get(kind)
      const dimensions = isDataset(image) ? (image.shape?.length ?? 0) : 0

      if (dimensions === 2 || dimensions === 3) {
        imagePaths[kind] = `/uns/spatial/${id}/images/${kind}`
      }
    }
  }

  return {
    id,
    scalefactors: isGroup(scalefactorGroup)
      ? parseVisiumScalefactors(await readScalarRecord(scalefactorGroup))
      : {},
    imagePaths,
    ...stringEntry('chemistry', metadata.chemistry_description),
    ...stringEntry('softwareVersion', metadata.software_version),
  }
}

// Places one library's spots in micrometres. Rows of other libraries, and
// spots off the tissue unless `showOffTissue`, are left unplaced. The scale is
// fitted on the whole library, off-tissue spots included.
function placeVisiumView(
  source: H5adVisiumSource,
  view: AnnDataVisiumView,
): { readonly layout: H5adVisiumLayout; readonly coordinates: readonly DataPoint[] } {
  const library =
    source.libraries.find((candidate) => candidate.id === view.libraryId) ??
    source.libraries.find((candidate) => candidate.id === source.defaultLibraryId) ??
    source.libraries[0]!
  const { rowLibraries, inTissue, arrayRows, arrayCols } = source
  const inLibrary = (row: number) =>
    rowLibraries === null || rowLibraries[row] === library.id
  const lattice: VisiumLatticeSample[] | null =
    arrayRows === null || arrayCols === null ? null : []
  const centers: { x: number; y: number }[] = []
  let offTissueSpotCount = 0

  source.pixels.forEach((point, row) => {
    if (!inLibrary(row)) {
      return
    }

    centers.push(point)
    offTissueSpotCount += inTissue?.[row] === 0 ? 1 : 0
    lattice?.push({
      row: arrayRows?.[row] ?? Number.NaN,
      col: arrayCols?.[row] ?? Number.NaN,
      x: point.x,
      y: point.y,
    })
  })

  const showOffTissue = view.showOffTissue === true && offTissueSpotCount > 0
  const units = resolveVisiumUnits({
    scalefactors: library.scalefactors,
    lattice,
    centers,
  })
  const scale = units.micrometersPerPixel
  let spotCount = 0
  const coordinates = source.pixels.map((point, row) => {
    if (!inLibrary(row) || (!showOffTissue && inTissue?.[row] === 0)) {
      return UNPLACED_H5AD_POINT
    }

    spotCount += 1
    return { x: micrometers(point.x * scale), y: micrometers(point.y * scale) }
  })

  return {
    layout: {
      summary: {
        libraryId: library.id,
        libraryIds: source.libraries.map((candidate) => candidate.id),
        spotCount,
        offTissueSpotCount,
        showOffTissue,
        spotDiameterMicrometers: VISIUM_SPOT_DIAMETER_MICROMETERS,
        units,
        scalefactors: library.scalefactors,
        ...(library.chemistry === undefined ? {} : { chemistry: library.chemistry }),
        ...(library.softwareVersion === undefined
          ? {}
          : { softwareVersion: library.softwareVersion }),
      },
      imagePaths: library.imagePaths,
    },
    coordinates,
  }
}

function stringEntry<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> {
  return typeof value === 'string' && value.trim().length > 0
    ? ({ [key]: value.trim() } as Partial<Record<Key, string>>)
    : {}
}

// Scalar datasets in a group, such as `uns/spatial/<library>/scalefactors`.
async function readScalarRecord(
  group: H5GroupLike,
): Promise<Readonly<Record<string, number | string>>> {
  const record: Record<string, number | string> = {}

  for (const key of group.keys()) {
    const dataset = group.get(key)

    if (!isDataset(dataset)) {
      continue
    }

    const value = await readDatasetValue(dataset)

    if (typeof value === 'number' || typeof value === 'string') {
      record[key] = value
    } else if (typeof value === 'bigint') {
      record[key] = Number(value)
    } else if (isNumericArray(value) && value.length > 0) {
      record[key] = numericValue(value, 0)
    }
  }

  return record
}

const UNPLACED_H5AD_POINT: DataPoint = {
  x: Number.NaN as DataPoint['x'],
  y: Number.NaN as DataPoint['y'],
}

function reportH5adProgress(
  onProgress: H5adLoadProgressReporter | undefined,
  message: string,
): void {
  onProgress?.(message)
}

// Tables inside a SpatialData or Atera store are placed by their store, so
// only .h5ad files and in-memory tables look for the Visium layout.
async function readH5adCacheFromGroup(
  url: string,
  file: H5GroupLike,
  resolveCoordinates?: AnnDataCoordinateResolver,
  onUnreadableColumn?: (key: string, error: ZarrChunkUnavailableError) => void,
  options: { readonly visiumLayout?: boolean } = {},
): Promise<H5adCache> {
  const obs = expectGroup(file.get('/obs'), '/obs')
  const varGroup = expectGroup(file.get('/var'), '/var')
  const cellIds = uniqueNames(
    (await readDataframeIndex(obs, 'obs')).map((id, index) =>
      id.length === 0 ? `obs-${index}` : id,
    ),
    'obs',
  )
  const varNames = await readGeneNames(varGroup)
  const geneNames = uniqueNames(varNames.names, 'var')
  const embeddingOptions = readObsmEmbeddingOptions(file, cellIds.length)
  const resolvedCoordinates =
    resolveCoordinates === undefined
      ? null
      : await resolveCoordinates({
          cellIds,
          columnNames: obs
            .keys()
            .filter((key) => key !== '_index' && !key.startsWith('__')),
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
  const coordinateEmbedding =
    resolvedCoordinates === null
      ? await readOverviewCoordinateEmbedding(file, embeddingOptions, cellIds)
      : null
  const observationTracks = await readObservationTracks(
    obs,
    cellIds.length,
    onUnreadableColumn,
  )
  const visiumSource =
    coordinateEmbedding === null || options.visiumLayout === false
      ? null
      : await readVisiumSource(file, coordinateEmbedding, observationTracks)
  const visiumPlacement = visiumSource === null ? null : placeVisiumView(visiumSource, {})
  const coordinates =
    resolvedCoordinates ??
    visiumPlacement?.coordinates ??
    (coordinateEmbedding === null ? [] : embeddingToCoordinates(coordinateEmbedding))
  const matrix = await readMatrix(file, cellIds.length, geneNames.length)

  return {
    url,
    cellIds,
    geneNames,
    geneAliases:
      varNames.indexNames === null
        ? new Map()
        : geneAliasesByName(geneNames, varNames.indexNames),
    coordinates,
    root: file,
    embeddingOptions,
    categoricalTracks: observationTracks.categoricalTracks,
    continuousTracks: observationTracks.continuousTracks,
    matrix,
    extent: bboxForPoints(coordinates),
    visium: visiumPlacement?.layout ?? null,
    visiumSource,
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
      const dataset = await hydrateZarrAnnDataDataset(location, childPath).catch(
        (error: unknown) => {
          // uns holds analysis results the viewer mostly ignores, such as
          // scanpy's rank_genes_groups record arrays, whose structured dtype
          // zarrita cannot open. Such arrays are left out rather than failing
          // the table.
          if (childPath.startsWith('uns/')) {
            return null
          }

          throw error
        },
      )

      if (dataset !== null) {
        children.set(childName, dataset)
      }
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

// ReferenceStore looks a key up by its request URL's pathname, which is
// percent-encoded, so a key with a space (an obs column such as
// "Cancer Epithelial") would never be found. Store each key in that form.
function h5adReferenceStoreSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const refs = objectRecord(spec.refs, 'refs')
  const storeRefs: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(refs)) {
    storeRefs[referenceStoreKey(key)] = value
  }

  return { ...spec, refs: storeRefs }
}

function referenceStoreKey(key: string): string {
  return new URL(key.replace(/^\/+/, ''), 'https://ref.invalid/').pathname.slice(1)
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
  return h5adSiblingUrl(url, '.json')
}

function h5adIcechunkUrl(url: string): string {
  return h5adSiblingUrl(url, '.icechunk')
}

// The H5AD URL's path plus `suffix`, keeping its query string.
function h5adSiblingUrl(url: string, suffix: string): string {
  try {
    const parsed = new URL(url)
    parsed.pathname = `${parsed.pathname}${suffix}`
    return parsed.toString()
  } catch {
    return `${url}${suffix}`
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
    const entity = group.get(key)

    if (isDataset(entity)) {
      return readStringArray(await readDatasetValue(entity), `/${label}/${key}`)
    }

    if (isNullableArrayGroup(entity)) {
      return readStringArray(
        await readNullableArray(entity, `/${label}/${key}`),
        `/${label}/${key}`,
      )
    }
  }

  throw new Error(`H5AD /${label} dataframe does not expose a readable index column.`)
}

// The first gene-name column with one value per gene and at least one
// non-empty value replaces the var index; `indexNames` is then the index,
// otherwise null. Categorical columns (CELLxGENE stores `feature_name` that
// way) are decoded, and missing codes become empty names, which `uniqueNames`
// replaces with `var-N`.
async function readGeneNames(varGroup: H5GroupLike): Promise<{
  readonly names: readonly string[]
  readonly indexNames: readonly string[] | null
}> {
  const indexNames = await readDataframeIndex(varGroup, 'var')

  for (const key of ['gene_symbols', 'gene_symbol', 'feature_name', 'name']) {
    const values = await readGeneNameColumn(varGroup, key)

    if (
      values !== null &&
      values.length === indexNames.length &&
      values.some((value) => value !== '')
    ) {
      return { names: values, indexNames }
    }
  }

  return { names: indexNames, indexNames: null }
}

async function readGeneNameColumn(
  varGroup: H5GroupLike,
  key: string,
): Promise<readonly string[] | null> {
  const entity = varGroup.get(key)

  if (isCategoricalGroup(entity)) {
    const { codes, categories } = await readCategoricalGroup(entity, `/var/${key}`)
    return Array.from(
      { length: codes.length },
      (_value, index) => categoricalLabel(codes, categories, index) ?? '',
    )
  }

  if (isNullableArrayGroup(entity)) {
    return readStringArray(await readNullableArray(entity, `/var/${key}`), `/var/${key}`)
  }

  if (!isDataset(entity)) {
    return null
  }

  const value = await readDatasetValue(entity)
  const categories = await readDataframeCategories(varGroup, key, 'var')

  if (categories !== null && isNumericArray(value)) {
    return Array.from(
      { length: value.length },
      (_item, index) => categoricalLabel(value, categories, index) ?? '',
    )
  }

  return readStringArray(value, `/var/${key}`)
}

// Var index names for the genes whose display name differs, so a gene listed
// by symbol can still be found by its Ensembl ID.
function geneAliasesByName(
  geneNames: readonly string[],
  indexNames: readonly string[],
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>()

  geneNames.forEach((name, index) => {
    const alias = indexNames[index]?.trim() ?? ''

    if (alias !== '' && alias !== name) {
      aliases.set(name, alias)
    }
  })

  return aliases
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
  onUnreadableColumn?: (key: string, error: ZarrChunkUnavailableError) => void,
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
    try {
      const entity = obs.get(key)

      if (entity === null || entity === undefined || key === indexKey) {
        continue
      }

      if (isCategoricalGroup(entity)) {
        const { codes, categories } = await readCategoricalGroup(entity, `/obs/${key}`)

        if (codes.length !== rowCount) {
          continue
        }

        categoricalTracks.push({
          id: key,
          label: key,
          categoryCount: categories.length,
          values: Array.from({ length: rowCount }, (_value, index) =>
            categoricalLabel(codes, categories, index),
          ),
        })
        continue
      }

      let entityValue: unknown

      if (isNullableArrayGroup(entity)) {
        const values = await readNullableArray(entity, `/obs/${key}`)

        if (values.length !== rowCount) {
          continue
        }

        entityValue = values
      } else {
        if (!isDataset(entity)) {
          continue
        }

        const shape = entity.shape

        if (shape === null || readShapeDimension(shape, 0, `/obs/${key}`) !== rowCount) {
          continue
        }

        const categories = await readDataframeCategories(obs, key)
        entityValue = await readDatasetValue(entity)

        if (categories !== null && isNumericArray(entityValue)) {
          const codes = readNumericArray(entityValue, `/obs/${key}`)

          categoricalTracks.push({
            id: key,
            label: key,
            categoryCount: categories.length,
            values: Array.from({ length: rowCount }, (_value, index) =>
              categoricalLabel(codes, categories, index),
            ),
          })
          continue
        }
      }

      if (isNumericArray(entityValue)) {
        const values = numericArrayToNumbers(readNumericArray(entityValue, `/obs/${key}`))
        // A loop, not Math.min(...values): spreading a column of more than
        // about 120,000 cells overflows the call stack.
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY

        for (const value of values) {
          if (Number.isFinite(value)) {
            min = Math.min(min, value)
            max = Math.max(max, value)
          }
        }

        if (min > max) {
          continue
        }

        continuousTracks.push({ id: key, label: key, values, min, max })
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
    } catch (error) {
      // Optional columns with unreadable chunks are skipped when the caller
      // can report them; other failures still fail the load.
      if (
        onUnreadableColumn === undefined ||
        !(error instanceof ZarrChunkUnavailableError)
      ) {
        throw error
      }

      onUnreadableColumn(key, error)
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
  dataframe: H5GroupLike,
  key: string,
  label: 'obs' | 'var' = 'obs',
): Promise<readonly string[] | null> {
  const categoryGroup = dataframe.get('__categories')

  if (!isGroup(categoryGroup)) {
    return null
  }

  const categoryDataset = categoryGroup.get(key)

  if (!isDataset(categoryDataset)) {
    return null
  }

  const categories = readCategoryLabels(
    await readDatasetValue(categoryDataset),
    `/${label}/__categories/${key}`,
  )
  return categories.length === 0 ? null : categories
}

// An AnnData categorical column: a group with integer `codes` and its
// `categories`.
async function readCategoricalGroup(
  group: H5GroupLike,
  path: string,
): Promise<{
  readonly codes: NumericArrayLike
  readonly categories: readonly string[]
}> {
  const codes = readNumericArray(
    await readDatasetValue(expectDataset(group.get('codes'), `${path}/codes`)),
    `${path}/codes`,
  )
  const categories = readCategoryLabels(
    await readDatasetValue(expectDataset(group.get('categories'), `${path}/categories`)),
    `${path}/categories`,
  )

  return { codes, categories }
}

// An AnnData nullable array: a group with `values` and a boolean `mask` that is
// true where a value is missing. anndata 0.13 with pandas 3 writes every string
// index and non-categorical string column this way. Masked entries read as the
// missing values of plain arrays, empty strings and NaN.
async function readNullableArray(
  group: H5GroupLike,
  path: string,
): Promise<readonly string[] | Float64Array> {
  const values = await readDatasetValue(
    expectDataset(group.get('values'), `${path}/values`),
  )
  const mask = readNumericArray(
    await readDatasetValue(expectDataset(group.get('mask'), `${path}/mask`)),
    `${path}/mask`,
  )
  const isMasked = (index: number) => numericValue(mask, index) !== 0

  if (isNumericArray(values)) {
    return Float64Array.from({ length: values.length }, (_value, index) =>
      isMasked(index) ? Number.NaN : numericValue(values, index),
    )
  }

  return readStringArray(values, `${path}/values`).map((value, index) =>
    isMasked(index) ? '' : value,
  )
}

// Negative codes mark missing values.
function categoricalLabel(
  codes: NumericArrayLike,
  categories: readonly string[],
  index: number,
): string | null {
  const code = Math.trunc(numericValue(codes, index))
  return code < 0 ? null : (categories[code] ?? null)
}

async function readObsColumnValues(
  obs: H5GroupLike,
  key: string,
  rowCount: number,
): Promise<readonly (string | number | null)[] | null> {
  const entity = obs.get(key)

  if (isCategoricalGroup(entity)) {
    const { codes, categories } = await readCategoricalGroup(entity, `/obs/${key}`)

    return codes.length === rowCount
      ? Array.from({ length: rowCount }, (_value, index) =>
          categoricalLabel(codes, categories, index),
        )
      : null
  }

  const value = isNullableArrayGroup(entity)
    ? await readNullableArray(entity, `/obs/${key}`)
    : isDataset(entity)
      ? await readDatasetValue(entity)
      : null

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

  if (
    matrix.kind === 'dense-zarr' &&
    !allGenesRequested &&
    rows.length > requestedCols.length
  ) {
    return denseZarrCellsFromColumns(
      matrix,
      rows,
      requestedCols,
      geneNames,
      includeZeroCounts,
    )
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

// Reads each requested column once, which touches every row chunk once
// instead of once per requested row.
async function denseZarrCellsFromColumns(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-zarr' }>,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  includeZeroCounts: boolean,
): Promise<ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }>> {
  const columns = new Map<number, NumericArrayLike>()

  for (const col of requestedCols) {
    columns.set(
      col,
      readNumericArray(
        zarrChunkValue(await zarr.get(matrix.values, [null, col])),
        matrix.values.path,
      ),
    )
  }

  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()

  for (const { id, row } of rows) {
    const countsByColumn = new Map<number, number>()

    for (const [col, values] of columns) {
      countsByColumn.set(col, numericValue(values, row))
    }

    cells.set(
      id,
      cellFromCountsByColumn(countsByColumn, requestedCols, geneNames, {
        includeZeroCounts,
      }),
    )
  }

  return cells
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

function h5adMetadataTrackId(track: H5adContinuousTrack): string {
  return `h5ad:${slug(track.id)}`
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
    const array = dataset.source.array
    return zarrChunkValue(
      array.shape.length >= 2
        ? await getWholeArray(array)
        : await zarr.get(array, fullArraySelection(array)),
    )
  }

  if (dataset.source?.kind === 'h5-worker') {
    return dataset.source.file.read(dataset.source.path)
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

// Zarr boolean arrays read as 0/1 bytes, as h5wasm returns them, so boolean
// columns load as numeric tracks on every backend.
function zarrChunkValue(value: unknown): unknown {
  const data =
    typeof value === 'object' && value !== null && 'data' in value
      ? (value as { readonly data?: unknown }).data
      : undefined

  if (data instanceof zarr.BoolArray) {
    return new Uint8Array(data.buffer, data.byteOffset, data.length)
  }

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
  readonly source: H5adZarrArraySource
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

function isNullableArrayGroup(value: unknown): value is H5GroupLike {
  if (!isGroup(value)) {
    return false
  }

  const encodingType = readStringAttribute(value, 'encoding-type')
  return (
    encodingType === 'nullable-string-array' ||
    encodingType === 'nullable-integer' ||
    encodingType === 'nullable-boolean'
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
