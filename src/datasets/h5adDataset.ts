import { H5AD_MAX_FILE_BYTES } from './h5adFormat'
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
import {
  micrometers,
  micrometersPerPixelY,
  type BBox,
  type DataPoint,
} from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import {
  normalizeRoiSelection,
  roiSelectionContains,
  type RoiSelection,
  type RoiSelectionInput,
} from '../data/roiSelection'
import {
  openH5WorkerFile,
  openH5WorkerFileFromUrl,
  type H5WorkerFactory,
  type H5WorkerFile,
} from '../data/h5WorkerFile'
import { createAsyncLimiter } from '../utils/asyncLimiter'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import { slug } from '../utils/slug'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../data/customAnnotations'
import type { CellMetadata } from '../data/cellMetadata'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import { fetchHead } from '../data/hostResponses'
import {
  columnSlicesReadBytes,
  csrReadBytes,
  denseChunksReadBytes,
  geneValuesFromColumnSlices,
  geneValuesFromCsc,
  geneValuesFromCsr,
  geneValuesFromCsrBatches,
  geneValuesFromDense,
  geneValuesFromDenseChunks,
  type ChunkReadDenseMatrix,
  type GeneValuesRead,
  type GeneValuesReadEstimate,
  type RangeReadSparseMatrix,
} from '../data/geneValues'
import {
  H5_RANGE_UNSUPPORTED_ERROR,
  type H5FileRangeStats,
  type H5TreeGroup,
} from '../workers/h5FileMessages'
import {
  imagePlaneKey,
  type ImagePyramidLoader,
  type ImagePyramidOpener,
  type ImagePyramidPlane,
} from '../data/imagePyramid'
import type { DatasetImageCoordinates } from './datasetManifest'
import type { LabelLevelGeometry, LabelOutlineReader } from './spatialDataLabels'
import {
  AnnDataLabelPolygons,
  matchPolygonCells,
  polygonPlacementWarning,
  type PolygonCellCandidate,
} from './annDataLabelPolygons'
import {
  attachedLabelsFormat,
  isLabelSegmentationFormat,
  type LabelSegmentationFormat,
  type SegmentationFormat,
} from './segmentationSource'
import { instanceIdString, type SpatialDataShapes } from './spatialDataShapes'
import type { VectorSegmentationReader } from './vectorSegmentationWorker'
import { LABEL_OUTLINE_MAX_PIXELS } from './spatialDataLabelTrace'
import {
  analysisEmbeddingLabel,
  type AnalysisEmbedding,
  type AnalysisEmbeddingKind,
  type AnalysisEmbeddingOption,
} from '../data/analysisEmbeddings'
import type { NumericArrayLike } from '../data/numericArray'
import type {
  AnnDataMemoryColumn,
  AnnDataMemoryTable,
  AnnDataMemoryUns,
} from './annDataMemory'
import type {
  DatasetMeta,
  ElementBatch,
  ElementReadOptions,
  GeneExpressionBatch,
  GeneExpressionElement,
  ImageSource,
  SpatialDataset,
  SpatialElement,
  SpatialElementId,
  DatasetCell,
} from './spatialDataset'
import { normalizeSampleStride } from './xeniumDatasetRows'
import {
  isSectionColumnName,
  SECTION_COLUMN_NAMES,
  type AnnDataSectionColumn,
} from './annDataSections'
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
import { throwIfAborted } from '../utils/abort'
import {
  isIdLikeAnnotationGroup,
  type Annotation,
  type AnnotationGroupOption,
  type LoadDatasetAnnotationsOptions,
} from '../data/annotation'
import { fetchWithRetry } from '../data/fetchRetry'

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
  // `url` is a Zarr store holding AnnData, as `adata.write_zarr` writes it,
  // instead of an .h5ad file.
  readonly zarr?: boolean
  // Visium tissue images hosted as files next to the table. They replace
  // `uns/spatial/<library>/images`.
  readonly visiumImageUrls?: Readonly<Partial<Record<VisiumImageKind, string>>>
  // The most decoded chunk bytes one cell's all-gene profile may read from a
  // dense Zarr /X. Defaults to DENSE_ZARR_CELL_PROFILE_MAX_BYTES.
  readonly denseCellProfileMaxBytes?: number
  // An image shown under the cells, such as one a dataset collection pairs
  // with the table. Not used for a Visium table, which has its own image.
  readonly image?: AnnDataAttachedImage
  // Opens `image`; defaults to the generic image opener.
  readonly openImage?: ImagePyramidOpener
  // Opens `image.labelsUrl` when it is a label mask; defaults to the OME-Zarr
  // or TIFF label reader.
  readonly openLabels?: AnnDataLabelsOpener
  // Reads `image.labelsUrl` when it is polygons; defaults to the imported
  // segmentation reader, in a worker.
  readonly readLabelPolygons?: VectorSegmentationReader
  // Starts the H5 file worker that reads an .h5ad by range; for tests.
  readonly h5WorkerFactory?: H5WorkerFactory
  // An .h5ad read by range reads /X whole at load up to this many decoded
  // bytes, and slices it per request above. Defaults to whole for a file
  // within the 300 MiB limit, else H5AD_RANGE_MATRIX_MAX_BYTES.
  readonly rangeMatrixMaxBytes?: number
  // Opens one section of a file holding several, rather than the whole file:
  // `url` is the file's.
  readonly section?: AnnDataSectionSource
  // The Visium library shown, and whether spots off the tissue are placed;
  // by default the first library without them.
  readonly visiumView?: AnnDataVisiumView
}

// One section of an AnnData file holding several, such as registered serial
// sections combined in one: the rows whose obs `column` holds `value`. Its
// sections share one read of the file, by the file's own dataset.
export interface AnnDataSectionSource {
  readonly column: string
  readonly value: string
  // Opens the file's dataset and keeps it until `release` is called.
  readonly holdFile: () => AnnDataSectionFileHold
}

export interface AnnDataSectionFileHold {
  readonly dataset: Promise<unknown>
  readonly release: () => void
}

// A value of an obs column that splits a file into sections.
export interface AnnDataSection {
  readonly value: string
  readonly cellCount: number
  // The section's depth, when all its cells share one: a numeric obs column
  // named `z` or `z_…` (`z_um`), else a third obsm `spatial` column. In the
  // units of the obsm coordinates.
  readonly z?: number
}

// What cell boundaries need from a label image's reader. Outlines come back
// in its level-0 pixels.
export type AnnDataLabelsReader = Pick<
  LabelOutlineReader<LabelLevelGeometry>,
  'levels' | 'outlines'
> &
  Partial<Pick<LabelOutlineReader<LabelLevelGeometry>, 'followsPlanes' | 'planeNotice'>>

export type AnnDataLabelsOpener = (
  url: string,
  format: LabelSegmentationFormat,
) => Promise<AnnDataLabelsReader>

export interface AnnDataAttachedImage {
  // OME-Zarr, OME-TIFF or another image the generic opener reads.
  readonly url: string
  // With 'image-pixels', the obsm coordinates are the image's full-resolution
  // pixels and are scaled to micrometres by its pixel size.
  readonly coordinates: DatasetImageCoordinates
  // A segmentation drawn as cell boundaries: a label mask covering the image
  // (OME-Zarr or TIFF), or polygons (Parquet, GeoJSON, WKT).
  readonly labelsUrl?: string
  // The labels' format; by default as the name tells, else OME-Zarr.
  readonly labelsFormat?: SegmentationFormat
  // What polygon coordinates are in; `coordinates` by default. A mask is
  // placed over the image whatever its size.
  readonly labelsCoordinates?: DatasetImageCoordinates
  // The obs column holding each cell's label value, or its polygon's ID.
  // Without it, the SpatialData instance key in `uns/spatialdata_attrs`, else
  // the obs names: label 12 outlines the cell named "12". Polygons take
  // whichever of these, or of the columns named like IDs, names most of them.
  readonly labelColumn?: string
}

// Label value -> cell id, or why a named label column gives none.
interface H5adLabelCells {
  readonly byLabel: ReadonlyMap<number, string>
  readonly error?: string
}

export type H5adLoadProgressReporter = (message: string) => void

export interface AnnDataMemorySource {
  readonly label: string
  load(onProgress?: H5adLoadProgressReporter): Promise<AnnDataMemoryTable>
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
  // As readObsColumn, but a 64-bit integer column keeps exact bigints, which
  // numbers would round above 2^53: for joining on an instance key.
  readObsInstanceIds(
    key: string,
  ): Promise<readonly (string | number | bigint | null)[] | null>
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
  // Each row's z, in the units of its coordinates, from a third column of
  // obsm `spatial`; null for cells in a plane.
  readonly depths: Float32Array | null
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
  // Ends the H5 file worker the arrays are read from, for a file read in one.
  readonly close?: (() => void) | undefined
  // For a section (see withSection): which of the file's rows are its rows.
  // The matrix and obsm are the file's, so they are read by the file's rows.
  readonly section?: H5adSectionRows
}

interface H5adSectionRows {
  // The file's row of each of the section's rows, ascending.
  readonly rows: Uint32Array
  // The file's cell IDs, by which obsm is read.
  readonly fileCellIds: readonly string[]
}

interface H5adCoordinateEmbedding {
  readonly embedding: AnalysisEmbedding
  // The third column of a spatial matrix; see obsmDepths.
  readonly depths: Float32Array | null
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
  // For a plain string column, counted only up to DISTINCT_LABEL_COUNT_LIMIT.
  readonly categoryCount: number
  readonly values: H5adLabels
}

// A label column as it was read, read by row with `labelAt`: a categorical
// column's codes and categories, or a plain string column's strings. Neither
// is expanded into a label per row up front.
type H5adLabels =
  | {
      readonly kind: 'codes'
      readonly codes: NumericArrayLike
      readonly categories: readonly string[]
      // One `#rrggbb` per category, when the store keeps them.
      readonly colors?: readonly string[]
    }
  | { readonly kind: 'strings'; readonly strings: readonly string[] }

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
      readonly kind: 'dense-h5'
      readonly values: H5adWorkerArraySource
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csr-lazy'
      readonly data: H5adVectorReader
      readonly indices: H5adVectorReader
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csc-lazy'
      readonly data: H5adVectorReader
      readonly indices: H5adVectorReader
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }

// A 1-D numeric array read in slices when asked: a Zarr array, or a dataset of
// an .h5ad file read by range in an H5 file worker.
interface H5adVectorReader {
  // Bytes per decoded element.
  readonly itemSize: number
  slice(start: number, end: number, signal?: AbortSignal): Promise<NumericArrayLike>
}

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
  // Bytes per decoded element.
  readonly itemSize: number | null
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

// The coordinate matrices whose third column, when there is one, places
// cells in 3D. A third UMAP or PCA column is not a depth.
const H5AD_SPATIAL_KEYS: ReadonlySet<string> = new Set(['X_spatial', 'spatial'])

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

// The groups an .h5ad file's tree walk visits. Layers, raw, the pairwise
// matrices and uns other than the Visium layout and a SpatialData table's
// instance key are never read, and in a file read by range each object visited
// can cost a request.
const H5AD_TREE_PATHS = [
  'X',
  'obs',
  'var',
  'obsm',
  'uns/spatial',
  'uns/spatialdata_attrs',
]
// Files up to this size are downloaded whole. Reading one by range takes about
// 15 to 25 round trips, mostly to object headers spread through the file: from
// the UK the 14 MB and 48 MB gallery files would load slower by range, while
// the 226 MB Visium heart is ready in 8.8 s, against 16 to 27 s to download.
const H5AD_RANGE_MIN_FILE_BYTES = 64 * 1024 * 1024
// A file over the size limit read by range reads its /X whole at load only up
// to this many decoded bytes, and otherwise slices it per request.
const H5AD_RANGE_MATRIX_MAX_BYTES = 300 * 1024 * 1024
const H5AD_REFERENCE_FETCH_CONCURRENCY = 6
const CSR_LAZY_BATCH_MAX_VALUES = 4_000_000
const CSR_LAZY_BATCH_MAX_GAP_VALUES = 262_144
// The most decoded bytes of a dense /X one worker read returns.
const DENSE_H5_READ_MAX_BYTES = 16 * 1024 * 1024
// zarr's default chunks for a 125,955 x 12,963 float32 /X are 1,969 x 406, so
// one cell's genes are in 32 chunks holding 98 MiB of values. Chunked by gene
// as 125,955 x 10, one cell's genes are in all 1,297 chunks: 6.1 GiB.
const DENSE_ZARR_CELL_PROFILE_MAX_BYTES = 256 * 1024 * 1024
// String obs columns with more distinct values than this are counted as this
// plus one. The annotation list sets apart columns of more than 500.
const DISTINCT_LABEL_COUNT_LIMIT = 10_000

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
      `H5AD CSC matrices read lazily (by range or through a reference) cannot load all genes for selected cells without scanning the whole expression matrix (${rowCount.toLocaleString()} cells x ${geneCount.toLocaleString()} genes).`,
    )
    this.name = 'H5adAllGeneCscMatrixUnsupportedError'
    this.rowCount = rowCount
    this.geneCount = geneCount
  }
}

// An all-gene read (selected-cell profile, ROI gene stats) of a dense Zarr /X
// whose chunks put one cell's genes in more bytes than the budget, such as /X
// chunked by gene: chunks of every cell by a few genes.
export class H5adDenseCellProfileOverBudgetError extends Error {
  readonly rowCount: number
  readonly geneCount: number
  readonly chunkShape: readonly [number, number]
  // The chunks one cell's genes are in, and their decoded bytes.
  readonly chunkCount: number
  readonly byteLength: number
  readonly maxBytes: number
  // More chunks across the genes than across the cells.
  readonly chunkedByGene: boolean

  constructor(options: {
    readonly rowCount: number
    readonly geneCount: number
    readonly chunkShape: readonly [number, number]
    readonly chunkCount: number
    readonly byteLength: number
    readonly maxBytes: number
  }) {
    const [chunkRows, chunkCols] = options.chunkShape
    const chunkedByGene =
      Math.ceil(options.geneCount / chunkCols) > Math.ceil(options.rowCount / chunkRows)
    super(
      `AnnData dense /X is ${chunkedByGene ? 'chunked by gene, in' : 'stored in'} chunks of ${countLabel(
        chunkRows,
        'cell',
      )} x ${countLabel(chunkCols, 'gene')}, so one cell's profile would read ${countLabel(
        options.chunkCount,
        'chunk',
      )} holding ${formatByteCount(options.byteLength)} of values, over the ${formatByteCount(
        options.maxBytes,
      )} limit.`,
    )
    this.name = 'H5adDenseCellProfileOverBudgetError'
    this.rowCount = options.rowCount
    this.geneCount = options.geneCount
    this.chunkShape = options.chunkShape
    this.chunkCount = options.chunkCount
    this.byteLength = options.byteLength
    this.maxBytes = options.maxBytes
    this.chunkedByGene = chunkedByGene
  }
}

export class AnnDataH5adDataset implements SpatialDataset<SpatialElementId> {
  readonly url: string
  private readonly options: AnnDataH5adDatasetOptions
  private readonly fetcher: typeof fetch
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly zarrSource: AnnDataZarrSource | undefined
  private readonly memorySource: AnnDataMemorySource | undefined
  // The fetcher passed in, which detection opened the repository or store
  // with too; undefined for the global fetch.
  private readonly storeFetcher: typeof fetch | undefined
  private readonly icechunk: boolean
  private readonly zarrStore: boolean
  private readonly visiumImageUrls: Readonly<Partial<Record<VisiumImageKind, string>>>
  private readonly denseCellProfileMaxBytes: number
  private readonly h5WorkerFactory: H5WorkerFactory | undefined
  private readonly rangeMatrixMaxBytes: number | undefined
  private readonly section: AnnDataSectionSource | undefined
  // While this section's base is read from, or held: ends its hold on the
  // file's dataset.
  private releaseSectionFile: (() => void) | null = null
  private baseCachePromise: Promise<H5adCache> | null = null
  // The base cache placed for `visiumView`.
  private cachePromise: Promise<H5adCache> | null = null
  private readonly visiumView: AnnDataVisiumView
  // The dataset that reads the file, for one showing another Visium view of
  // it; null for that dataset itself.
  private viewOf: AnnDataH5adDataset | null = null
  // The datasets showing other Visium views of this file, by view key.
  private readonly visiumViews = new Map<string, AnnDataH5adDataset>()
  private spotElementsPromise: Promise<readonly VisiumSpotEntry[]> | null = null
  // The overview built from a cache, kept while that cache is current:
  // building it again for every caller cost 0.6–1.4 s each on a 598,222-cell
  // table.
  private overviewPoints: {
    readonly cache: H5adCache
    readonly points: readonly CellOverviewPoint[]
  } | null = null
  // Per library and image kind.
  private readonly tissueImageUrls = new Map<string, Promise<string>>()
  readonly attachedImage: AnnDataAttachedImage | undefined
  private readonly openImage: ImagePyramidOpener | undefined
  private attachedImageLoaderPromise: Promise<ImagePyramidLoader> | null = null
  private readonly openLabels: AnnDataLabelsOpener | undefined
  private labelsReaderPromise: Promise<AnnDataLabelsReader> | null = null
  private readonly readLabelPolygons: VectorSegmentationReader | undefined
  // Polygon labels, read once, and matched to cells per placed cache.
  private labelShapesPromise: Promise<SpatialDataShapes> | null = null
  private readonly labelPolygonsByCache = new WeakMap<
    H5adCache,
    Promise<AnnDataLabelPolygons>
  >()
  // Label value -> cell id, per placed cache.
  private readonly labelCellIds = new WeakMap<H5adCache, Promise<H5adLabelCells>>()
  // Cell elements for cached label rings, so unchanged cells keep the same
  // objects across viewport requests.
  private readonly labelElementsByRing = new WeakMap<
    Float64Array,
    SpatialElement<SpatialElementId>
  >()

  constructor(options: AnnDataH5adDatasetOptions) {
    this.url = options.url
    this.options = options
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.zarrSource = options.zarrSource
    this.memorySource = options.memorySource
    this.icechunk = options.icechunk === true
    this.zarrStore = options.zarr === true
    this.storeFetcher = options.fetcher
    this.visiumImageUrls = options.visiumImageUrls ?? {}
    this.denseCellProfileMaxBytes =
      options.denseCellProfileMaxBytes ?? DENSE_ZARR_CELL_PROFILE_MAX_BYTES
    this.h5WorkerFactory = options.h5WorkerFactory
    this.rangeMatrixMaxBytes = options.rangeMatrixMaxBytes
    this.section = options.section
    this.attachedImage = options.image
    this.openImage = options.openImage
    this.openLabels = options.openLabels
    this.readLabelPolygons = options.readLabelPolygons
    this.visiumView = options.visiumView ?? {}
  }

  async meta(): Promise<DatasetMeta> {
    const cache = await this.cache()
    const visium = cache.visium?.summary
    const imageLoader =
      visium === undefined ? await this.attachedImageLoaderOrNull() : null
    const labelsFormat = this.labelsFormat()

    return {
      platform: visium === undefined ? 'h5ad' : 'visium',
      units:
        visium !== undefined
          ? {
              ...DEFAULT_H5AD_UNITS,
              micrometersPerPixel: micrometers(visium.units.micrometersPerPixel),
            }
          : (imageLoader?.units ?? DEFAULT_H5AD_UNITS),
      extent: cache.extent,
      capabilities: {
        transcripts: false,
        // A label column that gives no cells is reported when boundaries
        // load, so it is not mistaken for a table without labels. Polygons
        // are matched to cells once read, when boundaries first load.
        cellBoundaries:
          visium !== undefined ||
          (labelsFormat !== undefined &&
            (!isLabelSegmentationFormat(labelsFormat) ||
              (await this.labelCellsFor(cache).then(
                ({ byLabel, error }) => byLabel.size > 0 || error !== undefined,
              )))),
        pyramidImage: imageLoader !== null,
        multiChannel: (imageLoader?.channels.length ?? 0) > 1,
      },
    }
  }

  // Visium spot outlines, or outlines from the attached labels, traced from a
  // mask or read as polygons; other AnnData has no element geometry.
  async elements(
    bbox?: BBox,
    options: ElementReadOptions = {},
  ): Promise<ElementBatch<SpatialElementId>> {
    const cache = await this.cache()

    if (cache.visium === null) {
      const format = this.labelsFormat()

      if (bbox === undefined || format === undefined) {
        return { elements: [] }
      }

      return isLabelSegmentationFormat(format)
        ? this.labelElements(cache, bbox, options.plane ?? {}, format)
        : { elements: (await this.labelPolygonsFor(cache)).elements(bbox) }
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

  // The dataset showing a Visium library, and off-tissue spots or not: this
  // one for its own view, else one kept per view. Each places the spots of
  // one read of the file, this dataset's, so a view never changes in place
  // and the file is not read again.
  visiumViewDataset(view: AnnDataVisiumView): AnnDataH5adDataset {
    if (this.viewOf !== null) {
      return this.viewOf.visiumViewDataset(view)
    }

    const key = visiumViewKey(view)

    if (key === visiumViewKey(this.visiumView)) {
      return this
    }

    const known = this.visiumViews.get(key)

    if (known !== undefined) {
      return known
    }

    const dataset = new AnnDataH5adDataset({ ...this.options, visiumView: view })
    dataset.viewOf = this
    this.visiumViews.set(key, dataset)
    return dataset
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

    if (this.overviewPoints?.cache === cache) {
      return this.overviewPoints.points
    }

    const spotArea = visiumSpotArea(cache)
    const points: CellOverviewPoint[] = []

    cache.cellIds.forEach((cellId, index) => {
      const position = cache.coordinates[index]

      if (position === undefined || !isFinitePoint(position)) {
        return
      }

      const z = cache.depths?.[index]

      points.push({
        cellId: cellId as never,
        position,
        ...(z === undefined ? {} : { z }),
        transcriptCount: 0,
        ...(spotArea === undefined ? {} : { cellArea: spotArea }),
        // Read from the obs columns when shown: an object per cell holding
        // every column took seconds on large tables.
        readMetadata: () => h5adCellMetadata(cache, index),
      })
    })

    this.overviewPoints = { cache, points }
    return points
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    const cache = await this.cache()
    return h5adMatrixForCells(cache, ids, cache.geneNames, this.denseCellProfileMaxBytes)
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
    const selectedCells = h5adCellsInSelection(
      cache,
      { kind: 'box', bbox },
      options.limit,
    )
    const matrix = await h5adMatrixForCells(
      cache,
      selectedCells.map((cell) => cell.id),
      genes,
      this.denseCellProfileMaxBytes,
      options.signal,
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
      population: sampleStride > 1 ? 'sampled' : 'all',
      cellCount: selectedCells.length,
      maxCount,
    }
  }

  // Each matrix row's cell ID, for the Plots panel's groups (plan 22-B).
  async geneValuesRowIds(): Promise<readonly string[]> {
    return (await this.cache()).cellIds
  }

  // What reading genes would fetch (22-D7): nothing for a matrix held in
  // memory; for one read over HTTP, the values the layout makes a read take.
  async estimateGeneValuesRead(
    genes: readonly string[],
  ): Promise<GeneValuesReadEstimate> {
    const { matrix, geneNames } = await this.cache()
    return h5adGeneValuesEstimate(matrix, geneColumns(geneNames, genes).cols)
  }

  // Each gene's value in every cell (22-A). One scan of a CSR matrix reads
  // every gene asked for.
  async geneValues(
    genes: readonly string[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly GeneValuesRead[]> {
    const { matrix, geneNames, section } = await this.cache()
    throwIfAborted(options.signal)
    const { found, cols } = geneColumns(geneNames, genes)
    const columns =
      found.length === 0 ? [] : await h5adGeneValues(matrix, cols, options.signal)
    const byGene = new Map(found.map((gene, index) => [gene, columns[index]]))

    return genes.map((gene) => {
      const column = byGene.get(gene)
      return column === undefined
        ? { gene, error: `${gene} is not in the expression matrix.` }
        : {
            gene,
            ...(section === undefined ? column : sectionGeneValues(column, section)),
          }
    })
  }

  async annotationGroups(): Promise<readonly AnnotationGroupOption[]> {
    const cache = await this.cache()

    const ids = h5adAnnotationGroupIds(cache.categoricalTracks)

    return cache.categoricalTracks.map((track, index) => ({
      id: ids[index] ?? '',
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
    const groupIds = h5adAnnotationGroupIds(cache.categoricalTracks)
    const annotations: Annotation<SpatialElementId>[] = []

    for (const [trackIndex, track] of cache.categoricalTracks.entries()) {
      const groupId = groupIds[trackIndex] ?? ''

      if (
        options.groupId !== undefined &&
        options.groupId !== 'all' &&
        groupId !== options.groupId
      ) {
        continue
      }

      // "All" leaves out the columns that name cells, which the set picker
      // lists apart: each would be one class per cell (a Census file's
      // observation_joinid). Picked by name, one still loads.
      if (
        (options.groupId === undefined || options.groupId === 'all') &&
        isIdLikeAnnotationGroup({ label: track.label, groupCount: track.categoryCount })
      ) {
        continue
      }

      // A categorical column's classes come in its categories' order, as
      // scanpy colours them, so they keep their colours in every dataset with
      // the same categories. Classes without cells are left out below.
      const cellIdsByLabel = new Map<string, string[]>(
        track.values.kind === 'codes'
          ? track.values.categories.map((category) => [category, []])
          : [],
      )
      const colorByLabel = new Map<string, string>()

      if (track.values.kind === 'codes' && track.values.colors !== undefined) {
        const { categories, colors } = track.values
        categories.forEach((category, index) => {
          const color = colors[index]
          if (color !== undefined) colorByLabel.set(category, color)
        })
      }

      for (let index = 0; index < cache.cellIds.length; index += 1) {
        const label = labelAt(track.values, index)
        const cellId = cache.cellIds[index]

        if (label === null || cellId === undefined) {
          continue
        }

        const cellIds = cellIdsByLabel.get(label) ?? []
        cellIds.push(cellId)
        cellIdsByLabel.set(label, cellIds)
      }

      const labels = [...cellIdsByLabel.keys()]
      const classIds = uniqueSlugIds(labels.map((label) => `${groupId}:${slug(label)}`))

      for (const [labelIndex, label] of labels.entries()) {
        const cellIds = cellIdsByLabel.get(label) ?? []
        if (cellIds.length === 0) continue
        const color = colorByLabel.get(label)
        annotations.push({
          id: classIds[labelIndex] ?? '',
          label: `${track.label}: ${label}`,
          cellIds,
          ...(color === undefined ? {} : { color }),
        })
      }
    }

    return annotations
  }

  // Values stay `null` here: one object per cell per column is too much to build
  // for every column at load. `metadataTrackValues` builds one column on demand.
  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    const cache = await this.cache()
    const ids = h5adMetadataTrackIds(cache.continuousTracks)

    return cache.continuousTracks.map((track, index) => ({
      id: ids[index] ?? '',
      label: track.label,
      values: null,
      ...(cache.visium === null
        ? { cellCount: track.values.length, min: track.min, max: track.max }
        : placedTrackSummary(cache, track)),
    }))
  }

  async metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly ContinuousCellMetadataValue[]> {
    throwIfAborted(options.signal)
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const track =
      cache.continuousTracks[
        h5adMetadataTrackIds(cache.continuousTracks).indexOf(trackId)
      ]

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
      const { section } = cache
      const embedding = await readObsmEmbeddingFromRoot(
        cache.root,
        embeddingOption.kind,
        section?.fileCellIds ?? cache.cellIds,
      )
      embeddings.push(
        section === undefined
          ? embedding
          : { ...embedding, points: pickRows(embedding.points, section.rows) },
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

  // A numeric obs column by row, or null when the table has none by that
  // name.
  async numericObsColumn(key: string): Promise<readonly number[] | null> {
    const cache = await this.cache()
    return cache.continuousTracks.find((track) => track.id === key)?.values ?? null
  }

  // The obs columns that split the table into sections, with how many each
  // gives, the likeliest first (see SECTION_COLUMN_NAMES): label columns with
  // from 2 to MAX_SECTIONS values, and number columns named like a section
  // column with as many distinct finite values, as anndata stores whole-number
  // IDs (EXP-041). None for a Visium table, whose sections are its libraries.
  async sectionColumns(): Promise<readonly AnnDataSectionColumn[]> {
    const base = await this.baseCache()
    if (base.visiumSource !== null) return []

    const labels = base.categoricalTracks.map((track) => ({
      column: track.id,
      sectionCount: usedLabelCount(track, MAX_SECTIONS),
    }))
    const numbers = base.continuousTracks
      .filter((track) => isSectionColumnName(track.id))
      .map((track) => ({
        column: track.id,
        sectionCount: distinctFiniteCount(track.values, MAX_SECTIONS),
      }))
    const rank = (column: string) => {
      const index = SECTION_COLUMN_NAMES.indexOf(column.toLowerCase())
      return index === -1 ? SECTION_COLUMN_NAMES.length : index
    }

    return [...labels, ...numbers]
      .filter(({ sectionCount }) => sectionCount >= 2 && sectionCount <= MAX_SECTIONS)
      .sort((first, second) => rank(first.column) - rank(second.column))
  }

  // The sections an obs column splits the table into, in the column's order:
  // a categorical's categories, numbers ascending, else as first seen.
  async sections(column: string): Promise<readonly AnnDataSection[]> {
    const base = await this.baseCache()
    const groups = sectionGroups(base, column)

    if (groups === null) {
      throw new Error(`obs has no column "${column}" to split into sections.`)
    }

    if (groups.length > MAX_SECTIONS) {
      throw new Error(
        `obs column "${column}" has ${groups.length.toLocaleString()} values; a table splits into up to ${MAX_SECTIONS.toLocaleString()} sections.`,
      )
    }

    return groups.map(({ value, rows }) => {
      const z = sectionDepth(base, rows)

      return { value, cellCount: rows.length, ...(z === undefined ? {} : { z }) }
    })
  }

  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const cache = await this.cache()

    return h5adCellsInSelection(cache, normalizeRoiSelection(selection), options.limit)
  }

  // The Visium tissue image, high-res when present, else low-res; otherwise
  // the attached image.
  async image(): Promise<ImageSource | null> {
    const visium = (await this.cache()).visium

    if (visium === null) {
      return this.attachedImage === undefined
        ? null
        : { kind: 'pyramid', loader: await this.attachedImageLoader() }
    }

    const kind = this.visiumImageKinds(visium)[0]
    return kind === undefined ? null : this.tissueImage(kind)
  }

  // Opened once; a failed open is tried again by the next caller.
  private attachedImageLoader(): Promise<ImagePyramidLoader> {
    const image = this.attachedImage

    if (image === undefined) {
      return Promise.reject(new Error('This AnnData dataset has no attached image.'))
    }

    if (this.attachedImageLoaderPromise === null) {
      const promise = (async () => {
        const openImage =
          this.openImage ?? (await import('../data/morphologyImage')).openImagePyramid
        return openImage(image.url)
      })()
      this.attachedImageLoaderPromise = promise
      promise.catch(() => {
        if (this.attachedImageLoaderPromise === promise) {
          this.attachedImageLoaderPromise = null
        }
      })
    }

    return this.attachedImageLoaderPromise
  }

  private async attachedImageLoaderOrNull(): Promise<ImagePyramidLoader | null> {
    if (this.attachedImage === undefined) {
      return null
    }

    try {
      return await this.attachedImageLoader()
    } catch {
      return null
    }
  }

  // The attached labels' format, or undefined without labels.
  private labelsFormat(): SegmentationFormat | undefined {
    const image = this.attachedImage

    return image?.labelsUrl === undefined
      ? undefined
      : attachedLabelsFormat(image.labelsUrl, image.labelsFormat)
  }

  private labelsReader(format: LabelSegmentationFormat): Promise<AnnDataLabelsReader> {
    const url = this.attachedImage?.labelsUrl

    if (url === undefined) {
      return Promise.reject(new Error('This AnnData dataset has no attached labels.'))
    }

    if (this.labelsReaderPromise === null) {
      const open = this.openLabels ?? openAttachedLabelMask
      const promise = (async () => open(url, format))()
      this.labelsReaderPromise = promise
      promise.catch(() => {
        if (this.labelsReaderPromise === promise) {
          this.labelsReaderPromise = null
        }
      })
    }

    return this.labelsReaderPromise
  }

  // Each cell's label value comes from `labelColumn`. Without it, as for a
  // SpatialData table: the instance key the table records, else the shortest
  // obs column named like `cell_labels`, whichever holds whole numbers for
  // most rows; else the obs names, as in Vitessce. A SpatialData Xenium table
  // can name its rows 0, 1, ..., keep labels 1, 2, ... in `cell_labels`, and
  // have the cell barcode as its instance key.
  private labelCellsFor(cache: H5adCache): Promise<H5adLabelCells> {
    let cells = this.labelCellIds.get(cache)

    if (cells === undefined) {
      cells = this.resolveLabelCells(cache)
      this.labelCellIds.set(cache, cells)
    }

    return cells
  }

  private async resolveLabelCells(cache: H5adCache): Promise<H5adLabelCells> {
    const named = this.attachedImage?.labelColumn

    if (named !== undefined) {
      const values = obsLabelValues(cache, named)

      if (values === null) {
        return { byLabel: new Map(), error: `obs has no column "${named}"` }
      }

      const byLabel = cellIdsByLabel(cache, values)

      return byLabel.size === 0
        ? { byLabel, error: `obs column "${named}" holds no whole-number labels` }
        : { byLabel }
    }

    const instanceKey = await readSpatialDataInstanceKey(cache.root)
    const candidates = [
      ...(instanceKey === undefined ? [] : [instanceKey]),
      ...[...cache.continuousTracks, ...cache.categoricalTracks]
        .map((track) => track.id)
        .filter((name) => name !== instanceKey && LABEL_COLUMN_PATTERN.test(name))
        .sort((left, right) => left.length - right.length),
    ]

    for (const column of candidates) {
      const values = obsLabelValues(cache, column)

      if (
        values !== null &&
        values.filter((value) => value !== null).length > values.length / 2
      ) {
        this.onProgress?.(
          `Attached labels matched by obs column ${column}${
            column === instanceKey ? ", the table's SpatialData instance key" : ''
          }`,
        )
        return { byLabel: cellIdsByLabel(cache, values) }
      }
    }

    const byLabel = cellIdsByLabel(cache, cache.cellIds.map(wholeNumberOrNull))

    if (byLabel.size === 0) {
      this.onProgress?.(
        'Attached labels not used: no obs names are label numbers, so no cell matches a label; name the obs column that holds them',
      )
    }

    return { byLabel }
  }

  // Outlines of the labelled cells in `bbox`. The label image covers the
  // attached image, so its pixels are scaled to the image's extent.
  private async labelElements(
    cache: H5adCache,
    bbox: BBox,
    plane: ImagePyramidPlane,
    format: LabelSegmentationFormat,
  ): Promise<ElementBatch<SpatialElementId>> {
    const { byLabel: cellIds, error } = await this.labelCellsFor(cache)

    if (error !== undefined) {
      throw new Error(`The attached labels match no cells: ${error}.`)
    }

    if (cellIds.size === 0) {
      return { elements: [] }
    }

    const [reader, image] = await Promise.all([
      this.labelsReader(format),
      this.attachedImageLoader(),
    ])
    const labels = reader.levels[0]

    if (labels === undefined || labels.width === 0 || labels.height === 0) {
      return { elements: [] }
    }

    const scaleX = (image.units.micrometersPerPixel * image.imageWidth) / labels.width
    const scaleY = (micrometersPerPixelY(image.units) * image.imageHeight) / labels.height
    const outlines = await reader.outlines(
      {
        minX: bbox.minX / scaleX,
        maxX: bbox.maxX / scaleX,
        minY: bbox.minY / scaleY,
        maxY: bbox.maxY / scaleY,
      },
      {
        maxPixels: LABEL_OUTLINE_MAX_PIXELS,
        include: (label) => cellIds.has(label),
        plane,
      },
    )
    const notice = reader.followsPlanes === true ? reader.planeNotice?.(plane) : undefined
    const elements = outlines.flatMap((outline) => {
      const cached = this.labelElementsByRing.get(outline.ring)

      if (cached !== undefined) {
        return [cached]
      }

      const cellId = cellIds.get(outline.label)

      if (cellId === undefined) {
        return []
      }

      const ring: DataPoint[] = []

      for (let index = 0; index < outline.ring.length; index += 2) {
        ring.push({
          x: micrometers((outline.ring[index] ?? 0) * scaleX),
          y: micrometers((outline.ring[index + 1] ?? 0) * scaleY),
        })
      }

      const element: SpatialElement<SpatialElementId> = {
        id: cellId as SpatialElementId,
        geometry: { kind: 'polygon', rings: [ring] },
      }
      this.labelElementsByRing.set(outline.ring, element)
      return [element]
    })

    return {
      elements,
      ...(reader.followsPlanes === true ? { plane: imagePlaneKey(plane) } : {}),
      ...(notice === undefined ? {} : { planeNotice: notice }),
    }
  }

  // The attached polygons with their cells, once read. A failed read or a
  // file that matches no cells is tried again at the next boundary load.
  private labelPolygonsFor(cache: H5adCache): Promise<AnnDataLabelPolygons> {
    let polygons = this.labelPolygonsByCache.get(cache)

    if (polygons === undefined) {
      const promise = this.resolveLabelPolygons(cache)
      this.labelPolygonsByCache.set(cache, promise)
      promise.catch(() => {
        if (this.labelPolygonsByCache.get(cache) === promise) {
          this.labelPolygonsByCache.delete(cache)
        }
      })
      polygons = promise
    }

    return polygons
  }

  // Each polygon outlines the cell its ID names: by `labelColumn`, else by
  // whichever of the obs names, the SpatialData instance key and the columns
  // named like labels or IDs names the most polygons.
  private async resolveLabelPolygons(cache: H5adCache): Promise<AnnDataLabelPolygons> {
    const named = this.attachedImage?.labelColumn
    let candidates: PolygonCellCandidate[]

    if (named === undefined) {
      const instanceKey = await readSpatialDataInstanceKey(cache.root)
      const columns = [
        ...(instanceKey === undefined ? [] : [instanceKey]),
        ...[...cache.continuousTracks, ...cache.categoricalTracks]
          .map((track) => track.id)
          .filter(
            (name) =>
              name !== instanceKey &&
              (LABEL_COLUMN_PATTERN.test(name) ||
                POLYGON_ID_COLUMN_NAMES.has(name.toLowerCase())),
          ),
      ]
      candidates = [
        { values: cache.cellIds },
        ...columns.flatMap((column) => {
          const values = obsIdValues(cache, column)
          return values === null ? [] : [{ column, values }]
        }),
      ]
    } else {
      const values = obsIdValues(cache, named)

      if (values === null) {
        throw new Error(
          `The attached labels match no cells: obs has no column "${named}".`,
        )
      }

      candidates = [{ column: named, values }]
    }

    const shapes = await this.labelShapes()
    const match = matchPolygonCells(shapes, cache.cellIds, candidates)

    if (match === null) {
      const example = shapes.ids[0]

      throw new Error(
        `The attached labels match no cells: ${
          example === undefined
            ? 'the file holds no polygons'
            : named === undefined
              ? `neither the obs names nor an obs column named like labels or IDs holds the polygon IDs, such as ${JSON.stringify(example)}; name the obs column that does in labelColumn`
              : `obs column "${named}" holds none of the polygon IDs, such as ${JSON.stringify(example)}`
        }.`,
      )
    }

    const { column } = match.candidate
    this.onProgress?.(
      `Attached labels: ${match.count.toLocaleString()} of ${shapes.ids.length.toLocaleString()} polygons matched to cells by ${
        column === undefined ? 'obs names' : `obs column ${column}`
      }`,
    )
    return new AnnDataLabelPolygons(shapes, match.cellIds)
  }

  // The attached polygons in micrometres, read once: in the image's pixels,
  // they are scaled by its pixel size.
  private labelShapes(): Promise<SpatialDataShapes> {
    if (this.labelShapesPromise === null) {
      const promise = this.readLabelShapes()
      this.labelShapesPromise = promise
      promise.catch(() => {
        if (this.labelShapesPromise === promise) {
          this.labelShapesPromise = null
        }
      })
    }

    return this.labelShapesPromise
  }

  private async readLabelShapes(): Promise<SpatialDataShapes> {
    const image = this.attachedImage
    const format = this.labelsFormat()

    if (
      image?.labelsUrl === undefined ||
      format === undefined ||
      isLabelSegmentationFormat(format)
    ) {
      throw new Error('This AnnData dataset has no attached label polygons.')
    }

    const loader = await this.attachedImageLoader()
    const inPixels = (image.labelsCoordinates ?? image.coordinates) === 'image-pixels'
    const read =
      this.readLabelPolygons ??
      (await import('./vectorSegmentationWorker')).readVectorSegmentationInWorker
    const shapes = await read({
      file: { kind: 'url', url: image.labelsUrl },
      format,
      micrometersPerUnit: inPixels ? loader.units.micrometersPerPixel : 1,
      ...(inPixels ? { yMicrometersPerUnit: micrometersPerPixelY(loader.units) } : {}),
    })
    const warning = polygonPlacementWarning(
      shapes,
      {
        width: loader.imageWidth * loader.units.micrometersPerPixel,
        height: loader.imageHeight * micrometersPerPixelY(loader.units),
      },
      inPixels,
    )

    if (warning !== undefined) {
      this.onProgress?.(warning)
    }

    return shapes
  }

  // Micrometres per coordinate unit along x and y: the attached image's pixel
  // width and height when the coordinates are its pixels, else 1. An image
  // that cannot be opened leaves the coordinates as they are; image() reports
  // the failure.
  private async coordinateScale(): Promise<CoordinateScale> {
    if (this.attachedImage?.coordinates !== 'image-pixels') {
      return UNIT_COORDINATE_SCALE
    }

    const loader = await this.attachedImageLoaderOrNull()

    if (loader === null) {
      this.onProgress?.(
        'Attached image could not be opened, so cell coordinates are read as micrometres',
      )
      return UNIT_COORDINATE_SCALE
    }

    return { x: loader.units.micrometersPerPixel, y: micrometersPerPixelY(loader.units) }
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

  // Object URLs are made once per image, shared by every Visium view of the
  // file, and revoked when the dataset that reads the file is disposed.
  private cachedImageUrl(
    libraryId: string,
    kind: VisiumImageKind,
    create: () => Promise<string>,
  ): Promise<string> {
    if (this.viewOf !== null) {
      return this.viewOf.cachedImageUrl(libraryId, kind, create)
    }

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

  // Ends the H5 file worker and drops the arrays read; a later read opens
  // the file again. A dataset showing another Visium view drops its
  // placement only, as the file is read by the dataset it views.
  dispose(): void {
    for (const view of this.visiumViews.values()) {
      view.dispose()
    }

    for (const url of this.tissueImageUrls.values()) {
      void url.then(revokeBlobUrl, () => undefined)
    }

    this.tissueImageUrls.clear()

    const base = this.baseCachePromise
    this.baseCachePromise = null
    this.cachePromise = null
    this.spotElementsPromise = null
    this.overviewPoints = null
    // A section's arrays are the file's, which its own dataset closes.
    this.releaseSectionFile?.()
    this.releaseSectionFile = null
    void base?.then((cache) => cache.close?.()).catch(() => undefined)
  }

  private cache(): Promise<H5adCache> {
    if (this.cachePromise === null) {
      const view = this.visiumView
      const promise = this.baseCache().then(async (base) =>
        base.visiumSource === null
          ? withCoordinateScale(base, await this.coordinateScale())
          : withVisiumView(base, view),
      )
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
    if (this.viewOf !== null) {
      return this.viewOf.baseCache()
    }

    if (this.baseCachePromise === null && this.section !== undefined) {
      this.baseCachePromise = this.sectionBaseCache(this.section)
    }

    if (this.baseCachePromise === null) {
      this.baseCachePromise = (
        this.memorySource !== undefined
          ? readAnnDataMemory(this.url, this.memorySource, this.onProgress)
          : this.icechunk
            ? readAnnDataIcechunk(this.url, this.storeFetcher, this.onProgress)
            : this.zarrStore
              ? readAnnDataZarrStore(this.url, this.storeFetcher, this.onProgress)
              : this.zarrSource === undefined
                ? readH5ad(this.url, {
                    fetcher: this.fetcher,
                    // A custom fetcher, as tests pass, keeps the download on
                    // this thread.
                    byRange: this.storeFetcher === undefined,
                    ...(this.h5WorkerFactory === undefined
                      ? {}
                      : { workerFactory: this.h5WorkerFactory }),
                    ...(this.rangeMatrixMaxBytes === undefined
                      ? {}
                      : { rangeMatrixMaxBytes: this.rangeMatrixMaxBytes }),
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

  // The section's rows of the file's base, read by the file's dataset, which
  // is held until this section is disposed.
  private sectionBaseCache(section: AnnDataSectionSource): Promise<H5adCache> {
    const hold = section.holdFile()
    this.releaseSectionFile?.()
    this.releaseSectionFile = hold.release

    const promise = hold.dataset.then(async (dataset) => {
      if (!(dataset instanceof AnnDataH5adDataset)) {
        throw new Error(
          `${this.url} is not AnnData, so it has no obs column "${section.column}" to take a section from.`,
        )
      }

      return withSection(await dataset.baseCache(), section.column, section.value)
    })
    promise.catch(() => {
      if (this.baseCachePromise !== promise) return

      this.baseCachePromise = null
      this.releaseSectionFile?.()
      this.releaseSectionFile = null
    })
    return promise
  }
}

// A column's label values by row: whole numbers, else null. Null when obs
// has no such column.
function obsLabelValues(
  cache: H5adCache,
  column: string,
): readonly (number | null)[] | null {
  const numeric = cache.continuousTracks.find((track) => track.id === column)

  if (numeric !== undefined) {
    return numeric.values.map((value) =>
      Number.isInteger(value) && value >= 0 ? value : null,
    )
  }

  const text = cache.categoricalTracks.find((track) => track.id === column)

  return text === undefined
    ? null
    : cache.cellIds.map((_cellId, row) => wholeNumberOrNull(labelAt(text.values, row)))
}

function cellIdsByLabel(
  cache: H5adCache,
  labels: readonly (number | null)[],
): ReadonlyMap<number, string> {
  const byLabel = new Map<number, string>()

  labels.forEach((label, row) => {
    const cellId = cache.cellIds[row]

    if (label !== null && cellId !== undefined) {
      byLabel.set(label, cellId)
    }
  })

  return byLabel
}

function wholeNumberOrNull(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? Number(value) : null
}

// A column's values by row as polygon IDs: text as it is, and numbers as the
// polygon readers write numeric IDs. Null when obs has no such column.
function obsIdValues(
  cache: H5adCache,
  column: string,
): readonly (string | null)[] | null {
  const numeric = cache.continuousTracks.find((track) => track.id === column)

  if (numeric !== undefined) {
    return numeric.values.map(instanceIdString)
  }

  const text = cache.categoricalTracks.find((track) => track.id === column)

  return text === undefined
    ? null
    : cache.cellIds.map((_cellId, row) => labelAt(text.values, row))
}

// A label mask: OME-Zarr (including a bioformats2raw store) or TIFF, read in
// its own pixels.
async function openAttachedLabelMask(
  url: string,
  format: LabelSegmentationFormat,
): Promise<AnnDataLabelsReader> {
  if (format === 'label-tiff') {
    const [{ openTiffLabelLoader, tiffLabelOutlineReader }, { IDENTITY_AFFINE }] =
      await Promise.all([import('./tiffLabels'), import('./spatialDataTransforms')])
    return tiffLabelOutlineReader(await openTiffLabelLoader(url), IDENTITY_AFFINE)
  }

  return (await import('./spatialDataLabels')).openOmeZarrLabels(url)
}

// Obs columns SpatialData tables commonly keep label values in.
const LABEL_COLUMN_PATTERN = /label/i
// Obs columns that may hold the polygon IDs of attached polygon labels, as
// the polygon readers find IDs (lower case).
const POLYGON_ID_COLUMN_NAMES = new Set([
  'cell_id',
  'cellid',
  'cell',
  'entityid',
  'id',
  'object_id',
  'objectid',
  'instance_id',
  'barcode',
])

// The obs column a SpatialData table links to its elements: `instance_key` in
// the table's attributes (spatialdata 0.2 and later), or in
// `uns/spatialdata_attrs` (earlier).
async function readSpatialDataInstanceKey(
  root: H5GroupLike,
): Promise<string | undefined> {
  const fromAttributes = readStringAttribute(root, 'instance_key')

  if (fromAttributes !== undefined && fromAttributes !== '') {
    return fromAttributes
  }

  try {
    const attrs = root.get('/uns/spatialdata_attrs')

    if (!isGroup(attrs)) {
      return undefined
    }

    const key = (await readScalarRecord(attrs)).instance_key
    return typeof key === 'string' && key !== '' ? key : undefined
  } catch {
    return undefined
  }
}

interface CoordinateScale {
  readonly x: number
  readonly y: number
}

const UNIT_COORDINATE_SCALE: CoordinateScale = { x: 1, y: 1 }

// Depths in image pixels are scaled by the pixel width.
function withCoordinateScale(base: H5adCache, scale: CoordinateScale): H5adCache {
  if (scale.x === 1 && scale.y === 1) {
    return base
  }

  const coordinates = base.coordinates.map((point) =>
    isFinitePoint(point)
      ? { x: micrometers(point.x * scale.x), y: micrometers(point.y * scale.y) }
      : point,
  )
  const depths = base.depths?.map((z) => z * scale.x) ?? null

  return { ...base, coordinates, depths, extent: bboxForPoints(coordinates) }
}

function visiumViewKey(view: AnnDataVisiumView): string {
  return `${view.libraryId ?? ''}\n${view.showOffTissue === true ? 'off-tissue' : ''}`
}

function withVisiumView(base: H5adCache, view: AnnDataVisiumView): H5adCache {
  if (base.visiumSource === null) {
    return base
  }

  const { layout, coordinates } = placeVisiumView(base.visiumSource, view)
  return { ...base, coordinates, extent: bboxForPoints(coordinates), visium: layout }
}

// A table splits into at most as many sections as a collection lists
// (MAX_COLLECTION_DATASETS).
const MAX_SECTIONS = 500
// A numeric obs column holding each cell's section depth: `z`, `z_um`,
// `z_position`.
const SECTION_DEPTH_COLUMN = /^z(?:_|$)/i

interface H5adSectionGroup {
  readonly value: string
  // Ascending.
  readonly rows: Uint32Array
}

// The rows of one section of a table holding several: those whose obs
// `column` holds `value`. obsm and the matrix stay the file's, read by the
// file's rows (`section.rows`); the H5 file worker is the file's to close.
function withSection(base: H5adCache, column: string, value: string): H5adCache {
  if (base.visiumSource !== null) {
    throw new Error(
      'A Visium table is split into sections by its libraries: open the file itself and choose one under Image.',
    )
  }

  const groups = sectionGroups(base, column)

  if (groups === null) {
    throw new Error(`obs has no column "${column}" to take a section from.`)
  }

  const rows = groups.find((group) => group.value === value)?.rows

  if (rows === undefined) {
    throw new Error(`obs column "${column}" has no cells with the value "${value}".`)
  }

  const coordinates = pickRows(base.coordinates, rows)

  return {
    ...base,
    cellIds: pickRows(base.cellIds, rows),
    coordinates,
    depths: sectionDepths(base.depths, rows, sectionDepth(base, rows)),
    categoricalTracks: base.categoricalTracks.map((track) => {
      const values = pickLabels(track.values, rows)
      return { ...track, values, categoryCount: distinctLabelCount(values, rows.length) }
    }),
    continuousTracks: base.continuousTracks.map((track) => {
      const values = pickRows(track.values, rows)
      return { ...track, values, ...finiteRange(values) }
    }),
    extent: bboxForPoints(coordinates),
    close: undefined,
    section: { rows, fileCellIds: base.cellIds },
  }
}

// The rows of each value of an obs label or number column, in the column's
// order: a categorical's categories, numbers ascending, else as first seen.
// Null when obs has no such column.
// Distinct finite values, counted up to one past `limit`.
function distinctFiniteCount(values: readonly number[], limit: number): number {
  const seen = new Set<number>()

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    seen.add(value)
    if (seen.size > limit) break
  }

  return seen.size
}

function sectionGroups(
  cache: H5adCache,
  column: string,
): readonly H5adSectionGroup[] | null {
  const labels = cache.categoricalTracks.find((track) => track.id === column)?.values
  const numbers =
    labels === undefined
      ? cache.continuousTracks.find((track) => track.id === column)?.values
      : undefined

  if (labels === undefined && numbers === undefined) {
    return null
  }

  const rowsByValue = new Map<string, number[]>()

  for (let row = 0; row < cache.cellIds.length; row += 1) {
    const number = numbers?.[row]
    const value =
      labels !== undefined
        ? labelAt(labels, row)
        : number === undefined || !Number.isFinite(number)
          ? null
          : String(number)

    if (value === null) continue

    const rows = rowsByValue.get(value)

    if (rows === undefined) {
      rowsByValue.set(value, [row])
    } else {
      rows.push(row)
    }
  }

  const groups = [...rowsByValue].map(([value, rows]) => ({
    value,
    rows: Uint32Array.from(rows),
  }))

  if (labels?.kind === 'codes') {
    const order = new Map(labels.categories.map((category, index) => [category, index]))
    groups.sort(
      (first, second) => (order.get(first.value) ?? 0) - (order.get(second.value) ?? 0),
    )
  } else if (numbers !== undefined) {
    groups.sort((first, second) => Number(first.value) - Number(second.value))
  }

  return groups
}

function pickRows<T>(values: ArrayLike<T>, rows: Uint32Array): T[] {
  return Array.from(rows, (row) => values[row] as T)
}

function pickLabels(labels: H5adLabels, rows: Uint32Array): H5adLabels {
  return labels.kind === 'codes'
    ? {
        ...labels,
        codes: Int32Array.from(rows, (row) =>
          Math.trunc(numericValue(labels.codes, row)),
        ),
      }
    : { kind: 'strings', strings: pickRows(labels.strings, rows) }
}

function distinctLabelCount(labels: H5adLabels, rowCount: number): number {
  const seen = new Set<string>()

  for (let row = 0; row < rowCount && seen.size < DISTINCT_LABEL_COUNT_LIMIT; row += 1) {
    const label = labelAt(labels, row)
    if (label !== null) seen.add(label)
  }

  return seen.size
}

function finiteRange(values: readonly number[]): {
  readonly min: number
  readonly max: number
} {
  let min = Infinity
  let max = -Infinity

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  return min <= max ? { min, max } : { min: 0, max: 0 }
}

// A section's depth: the value its rows share in a numeric obs column named
// `z` or `z_…`, else in the table's third obsm column. Undefined when they
// share neither.
function sectionDepth(base: H5adCache, rows: Uint32Array): number | undefined {
  const depthTrack = base.continuousTracks.find((track) =>
    SECTION_DEPTH_COLUMN.test(track.id),
  )

  return (
    (depthTrack === undefined ? undefined : sharedValue(depthTrack.values, rows)) ??
    (base.depths === null ? undefined : sharedValue(base.depths, rows))
  )
}

// A section's own depths, or null when its cells share one: a section of
// registered serial sections lies in a plane, at the depth the collection
// gives it. Cells with depths of their own keep them relative to the
// section's depth (`sectionZ`), which the stack adds back, so a cell is drawn
// at the z it has in the table.
function sectionDepths(
  depths: Float32Array | null,
  rows: Uint32Array,
  sectionZ: number | undefined,
): Float32Array | null {
  if (depths === null || sharedValue(depths, rows) !== undefined) return null

  const offset = sectionZ ?? 0

  return Float32Array.from(rows, (row) => (depths[row] ?? Number.NaN) - offset)
}

// The value every row holds, if they hold one.
function sharedValue(values: ArrayLike<number>, rows: Uint32Array): number | undefined {
  const first = rows.length === 0 ? undefined : values[rows[0] ?? 0]

  if (first === undefined || !Number.isFinite(first)) {
    return undefined
  }

  for (const row of rows) {
    if (values[row] !== first) return undefined
  }

  return first
}

// A section's gene values, from the file's: its rows by the section's own
// numbering.
function sectionGeneValues<
  Values extends { readonly rows: Uint32Array; readonly values: Float32Array },
>(column: Values, section: H5adSectionRows): Values {
  const sectionRow = sectionRowIndex(section)
  let count = 0

  for (const row of column.rows) {
    if ((sectionRow[row] ?? -1) >= 0) count += 1
  }

  const rows = new Uint32Array(count)
  const values = new Float32Array(count)
  let next = 0

  column.rows.forEach((row, index) => {
    const own = sectionRow[row] ?? -1
    if (own < 0) return

    rows[next] = own
    values[next] = column.values[index] ?? 0
    next += 1
  })

  return { ...column, rows, values }
}

const sectionRowIndexes = new WeakMap<H5adSectionRows, Int32Array>()

// The section's row of each of the file's rows, or -1.
function sectionRowIndex(section: H5adSectionRows): Int32Array {
  let index = sectionRowIndexes.get(section)

  if (index === undefined) {
    const rowIndex = new Int32Array(section.fileCellIds.length).fill(-1)
    section.rows.forEach((row, own) => {
      rowIndex[row] = own
    })
    index = rowIndex
    sectionRowIndexes.set(section, index)
  }

  return index
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

// Tissue images are hosted URLs or object URLs this reader made.
function revokeBlobUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

// Distinct labels the rows use, up to `limit + 1`: a categorical column can
// declare categories that no row holds after a subset.
function usedLabelCount(track: H5adCategoricalTrack, limit: number): number {
  if (track.values.kind !== 'codes') {
    return track.categoryCount
  }

  const { codes, categories } = track.values
  const seen = new Uint8Array(categories.length)
  let count = 0

  for (let row = 0; row < codes.length && count < categories.length; row += 1) {
    const code = Number(codes[row])

    if (code >= 0 && code < categories.length && seen[code] === 0) {
      seen[code] = 1
      count += 1

      if (count > limit) {
        break
      }
    }
  }

  return count
}

function visiumSpotArea(cache: H5adCache): number | undefined {
  const diameter = cache.visium?.summary.spotDiameterMicrometers

  return diameter === undefined
    ? undefined
    : diameter === VISIUM_SPOT_DIAMETER_MICROMETERS
      ? VISIUM_SPOT_AREA_SQUARE_MICROMETERS
      : Math.PI * (diameter / 2) ** 2
}

interface ReadH5adOptions {
  readonly fetcher: typeof fetch
  // Read the file by range in an H5 file worker when its host answers range
  // requests, rather than download it whole.
  readonly byRange: boolean
  readonly workerFactory?: H5WorkerFactory
  readonly rangeMatrixMaxBytes?: number
  readonly onProgress?: H5adLoadProgressReporter
}

// Small files are downloaded whole, and larger ones read by range. A companion
// reference is used only for a file over the size limit that cannot be read by
// range: its host does not answer range requests, or this is a custom fetcher.
// Below the limit, such a file is downloaded whole.
async function readH5ad(url: string, options: ReadH5adOptions): Promise<H5adCache> {
  const { fetcher, onProgress } = options
  reportH5adProgress(onProgress, 'H5AD size check started')
  const headResponse = await fetchH5adHead(url, fetcher).catch(() => null)
  const declaredByteLength =
    headResponse?.ok === true ? readContentLength(headResponse.headers) : null
  const overSizeLimit =
    declaredByteLength !== null && declaredByteLength > H5AD_MAX_FILE_BYTES

  if (
    options.byRange &&
    (declaredByteLength === null || declaredByteLength > H5AD_RANGE_MIN_FILE_BYTES)
  ) {
    reportH5adProgress(
      onProgress,
      declaredByteLength === null
        ? 'H5AD size check unavailable; reading by range'
        : `H5AD file is ${formatByteCount(declaredByteLength)}; reading by range`,
    )
    const cache = await readH5adByRange(url, options)

    if (cache !== null) {
      return cache
    }

    reportH5adProgress(
      onProgress,
      overSizeLimit
        ? 'H5AD host does not answer range requests'
        : 'H5AD host does not answer range requests; downloading the whole file',
    )
  }

  if (overSizeLimit) {
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
      // The host ignored range requests, or this is a custom fetcher.
      return readH5adReferenceOrThrow(url, fetcher, error.byteLength, onProgress)
    }

    throw error
  }

  reportH5adProgress(onProgress, 'H5AD file loaded; opening AnnData arrays')

  // The worker stays open for reads after load (embeddings, tissue images)
  // and ends when the dataset is disposed or no longer referenced.
  const file = await openH5WorkerFile(bytes, {
    tree: true,
    treePaths: H5AD_TREE_PATHS,
    ...(options.workerFactory === undefined
      ? {}
      : { workerFactory: options.workerFactory }),
  })

  try {
    return {
      ...(await readH5adCacheFromGroup(url, hydrateH5WorkerGroup(file))),
      close: () => file.close(),
    }
  } catch (error) {
    file.close()
    throw error
  }
}

// Opens the file in an H5 file worker that reads it by range, so only the
// groups the viewer reads are fetched, not tissue images, raw or layers. /X is
// read whole at load, as from a downloaded file, unless the file is over the
// size limit and /X decodes to more than H5AD_RANGE_MATRIX_MAX_BYTES; then it
// is sliced per request. Null when the host does not answer range requests.
async function readH5adByRange(
  url: string,
  options: ReadH5adOptions,
): Promise<H5adCache | null> {
  const { onProgress } = options
  let file: H5WorkerFile

  try {
    file = await openH5WorkerFileFromUrl(url, 'H5AD file', {
      tree: true,
      treePaths: H5AD_TREE_PATHS,
      rangeOnly: true,
      ...(options.workerFactory === undefined
        ? {}
        : { workerFactory: options.workerFactory }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === H5_RANGE_UNSUPPORTED_ERROR) {
      return null
    }

    throw error
  }

  try {
    reportH5adProgress(
      onProgress,
      `H5AD file opened by range (${rangeReadLabel(file.range)}); reading AnnData arrays`,
    )
    const size = file.range?.size ?? 0
    const lazyMatrixAboveBytes =
      options.rangeMatrixMaxBytes ??
      (size > H5AD_MAX_FILE_BYTES ? H5AD_RANGE_MATRIX_MAX_BYTES : undefined)
    const cache = await readH5adCacheFromGroup(
      url,
      hydrateH5WorkerGroup(file),
      undefined,
      undefined,
      lazyMatrixAboveBytes === undefined ? {} : { lazyMatrixAboveBytes },
    )
    reportH5adProgress(
      onProgress,
      `H5AD arrays read by range (${rangeReadLabel(await file.rangeStats())})${
        isMatrixInMemory(cache.matrix) ? '' : '; /X is read by range when needed'
      }`,
    )
    return { ...cache, close: () => file.close() }
  } catch (error) {
    file.close()
    throw error
  }
}

// A file within the first range request is read whole in it.
function rangeReadLabel(stats: H5FileRangeStats | null): string {
  return stats === null
    ? 'all in the first request'
    : `${formatByteCount(stats.fetchedBytes)} of ${formatByteCount(
        stats.size,
      )} in ${countLabel(stats.requests, 'range request')}`
}

function isMatrixInMemory(matrix: H5adMatrix): boolean {
  return matrix.kind === 'dense' || matrix.kind === 'csr' || matrix.kind === 'csc'
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
      source: { kind: 'h5-worker', file, path: childPath, itemSize: node.itemSize },
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

async function readAnnDataZarrStore(
  url: string,
  fetcher: typeof fetch | undefined,
  onProgress: H5adLoadProgressReporter | undefined,
): Promise<H5adCache> {
  reportH5adProgress(onProgress, `Opening AnnData Zarr store ${url}`)
  const { openAnnDataZarrStore } = await import('./annDataZarrStore')
  const opened = await openAnnDataZarrStore(url, {
    ...(fetcher === undefined ? {} : { fetcher }),
    obsmKeys: Array.from(
      new Set([...H5AD_COORDINATE_KEYS, ...H5AD_EMBEDDING_DISPLAY_KEYS]),
    ),
  })
  const nodes = opened.store.contents()
  reportH5adProgress(
    onProgress,
    opened.metadata === 'consolidated'
      ? `AnnData Zarr store opened from consolidated metadata: ${nodes.length.toLocaleString()} groups and arrays`
      : `AnnData Zarr store has no consolidated metadata; read ${nodes.length.toLocaleString()} groups and arrays ${
          opened.listing === null
            ? `(no folder listing, so only obsm ${H5AD_COORDINATE_KEYS.join(', ')} were looked for)`
            : `(obsm named by the ${opened.listing})`
        }`,
  )
  const root = await hydrateZarrAnnDataGroup(
    { store: opened.store, zarrFormat: opened.zarrFormat, rootPath: '' },
    annDataIndexFromNodes(nodes, ''),
    '',
  )
  const cache = await readH5adCacheFromGroup(url, root)
  reportH5adProgress(
    onProgress,
    `AnnData Zarr store ready: ${cache.cellIds.length.toLocaleString()} cells, ${cache.geneNames.length.toLocaleString()} genes`,
  )
  return cache
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
  const libraryLabels =
    libraryIds.length > 1
      ? tracks.categoricalTracks
          .filter((track) => VISIUM_LIBRARY_COLUMNS.includes(track.id))
          .map((track) => labelsByRow(track.values))
          .find((labels) =>
            labels.some((value) => value !== null && libraryIds.includes(value)),
          )
      : undefined
  const continuous = (id: string) =>
    tracks.continuousTracks.find((track) => track.id === id)?.values ?? null
  const inTissue = continuous('in_tissue')

  return {
    libraries,
    defaultLibraryId:
      libraryIds.find(
        (id) => libraryLabels === undefined || libraryLabels.includes(id),
      ) ?? libraryIds[0]!,
    pixels: embedding.points,
    rowLibraries: libraryLabels ?? null,
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
  options: {
    readonly visiumLayout?: boolean
    // See `readMatrix`.
    readonly lazyMatrixAboveBytes?: number
  } = {},
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
          readObsInstanceIds: (key) =>
            readObsColumnValues(obs, key, cellIds.length, { exactIntegers: true }),
          readObsmPoints: async () => {
            const coordinates = await readOverviewCoordinateEmbedding(
              file,
              embeddingOptions,
              cellIds,
            ).catch(() => null)
            return coordinates?.embedding.points ?? null
          },
        })
  const obsmCoordinates =
    resolvedCoordinates === null
      ? await readOverviewCoordinateEmbedding(file, embeddingOptions, cellIds)
      : null
  const coordinateEmbedding = obsmCoordinates?.embedding ?? null
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
  const matrix = await readMatrix(file, cellIds.length, geneNames.length, {
    ...(options.lazyMatrixAboveBytes === undefined
      ? {}
      : { lazyAboveBytes: options.lazyMatrixAboveBytes }),
  })

  return {
    url,
    cellIds,
    geneNames,
    geneAliases:
      varNames.indexNames === null
        ? new Map()
        : geneAliasesByName(geneNames, varNames.indexNames),
    coordinates,
    // Visium spots are placed on their slide, in 2D.
    depths: visiumPlacement === null ? (obsmCoordinates?.depths ?? null) : null,
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
  // resolve() parses the path as a URL, which trims the trailing spaces of a
  // name such as the obs column 'Norm. Sample Stage  '. Percent-encoded
  // segments survive and are decoded back to their names.
  return fullPath === ''
    ? zarr.root(location.store)
    : zarr
        .root(location.store)
        .resolve(fullPath.split('/').map(encodeURIComponent).join('/'))
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
      return fetchWithRetry(resolvedRequest, undefined, { fetcher })
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

// AnnData names embeddings `X_<name>` (scanpy, CELLxGENE); other writers use
// bare `spatial`, `umap`, `tsne` or `pca`. Other obsm matrices hold per-cell
// values, such as cell2location's cell-type abundances, not coordinates.
function isObsmEmbeddingDataset(
  key: string,
  dataset: H5DatasetLike,
  cellCount: number,
): boolean {
  if (!/^X_/i.test(key) && !/^(?:spatial|umap|tsne|pca)$/i.test(key)) {
    return false
  }

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
  return (await readObsmCoordinates(key, dataset, cellIds)).embedding
}

// An obsm matrix's first two columns as an embedding and, for a spatial one
// with a third column, each cell's z: cells placed in 3D.
async function readObsmCoordinates(
  key: string,
  dataset: H5DatasetLike,
  cellIds: readonly string[],
): Promise<H5adCoordinateEmbedding> {
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
    embedding: {
      kind: key,
      label: analysisEmbeddingLabel(key),
      sourcePath: `/obsm/${key}`,
      points,
    },
    depths:
      cols >= 3 && H5AD_SPATIAL_KEYS.has(key) ? obsmDepths(values, rows, cols) : null,
  }
}

// The third column, or null when any value is not finite or all are the
// same, as when a writer pads 2D coordinates with a column of zeros.
function obsmDepths(
  values: NumericArrayLike,
  rows: number,
  cols: number,
): Float32Array | null {
  const depths = new Float32Array(rows)
  let min = Infinity
  let max = -Infinity

  for (let row = 0; row < rows; row += 1) {
    const z = numericValue(values, row * cols + 2)
    if (!Number.isFinite(z)) return null

    depths[row] = z
    min = Math.min(min, z)
    max = Math.max(max, z)
  }

  return max > min ? depths : null
}

async function readOverviewCoordinateEmbedding(
  file: H5GroupLike,
  embeddings: readonly AnalysisEmbeddingOption[],
  cellIds: readonly string[],
): Promise<H5adCoordinateEmbedding> {
  for (const key of H5AD_COORDINATE_KEYS) {
    const embedding = embeddings.find((candidate) => candidate.kind === key)

    if (embedding !== undefined) {
      return readObsmCoordinates(
        embedding.kind,
        expectDataset(file.get(`/obsm/${embedding.kind}`), `/obsm/${embedding.kind}`),
        cellIds,
      )
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

        const colors = await readCategoryColors(entity, `/obs/${key}`, categories.length)
        categoricalTracks.push({
          id: key,
          label: key,
          categoryCount: categories.length,
          values: {
            kind: 'codes',
            codes,
            categories,
            ...(colors === null ? {} : { colors }),
          },
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
            values: { kind: 'codes', codes, categories },
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
          values: { kind: 'strings', strings: labels },
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

// The file's size, its whole bytes, and its reference file are read through
// fetchWithRetry (O7): an attempt ends after 30 s with no bytes, its body
// included, and is tried again, three attempts in all.
async function fetchH5adHead(url: string, fetcher: typeof fetch): Promise<Response> {
  return fetchWithRetry(
    url,
    {},
    { fetcher: (input, init) => fetchHead(fetcher, String(input), init) },
  )
}

async function fetchH5adFile(url: string, fetcher: typeof fetch): Promise<Response> {
  return fetchWithRetry(url, {}, { fetcher })
}

async function fetchH5adReferenceFile(
  url: string,
  fetcher: typeof fetch,
): Promise<Response> {
  return fetchWithRetry(url, {}, { fetcher })
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

function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
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

// Atera stores each category's colour beside a categorical column's codes, in
// `color`, as 0xRRGGBBAA integers (int32). Alpha is dropped. Null when the
// column has no colours, or not one per category.
async function readCategoryColors(
  group: H5GroupLike,
  path: string,
  categoryCount: number,
): Promise<readonly string[] | null> {
  const entity = group.get('color')

  if (
    !isDataset(entity) ||
    entity.shape === null ||
    entity.shape.length !== 1 ||
    readShapeDimension(entity.shape, 0, `${path}/color`) !== categoryCount
  ) {
    return null
  }

  const value = await readDatasetValue(entity)

  if (!isNumericArray(value)) {
    return null
  }

  const colors = readNumericArray(value, `${path}/color`)

  return Array.from(
    { length: categoryCount },
    (_value, index) =>
      `#${((numericValue(colors, index) >>> 8) & 0xffffff).toString(16).padStart(6, '0')}`,
  )
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

// A row's label, or null where it is missing: a negative code, or an empty
// string.
function labelAt(labels: H5adLabels, row: number): string | null {
  if (labels.kind === 'codes') {
    return categoricalLabel(labels.codes, labels.categories, row)
  }

  const label = labels.strings[row]
  return label === undefined || label.length === 0 ? null : label
}

// Every row's label, for the few readers that need the whole column.
function labelsByRow(labels: H5adLabels): readonly (string | null)[] {
  const rowCount = labels.kind === 'codes' ? labels.codes.length : labels.strings.length
  return Array.from({ length: rowCount }, (_value, row) => labelAt(labels, row))
}

async function readObsColumnValues(
  obs: H5GroupLike,
  key: string,
  rowCount: number,
): Promise<readonly (string | number | null)[] | null>
async function readObsColumnValues(
  obs: H5GroupLike,
  key: string,
  rowCount: number,
  options: { readonly exactIntegers: true },
): Promise<readonly (string | number | bigint | null)[] | null>
async function readObsColumnValues(
  obs: H5GroupLike,
  key: string,
  rowCount: number,
  options: { readonly exactIntegers?: boolean } = {},
): Promise<readonly (string | number | bigint | null)[] | null> {
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

  if (
    options.exactIntegers === true &&
    (value instanceof BigInt64Array || value instanceof BigUint64Array)
  ) {
    return value.length === rowCount ? Array.from(value) : null
  }

  if (isNumericArray(value)) {
    return value.length === rowCount ? numericArrayToNumbers(value) : null
  }

  if (isStringArrayLike(value)) {
    const strings = Array.from(value)
    return strings.length === rowCount ? strings : null
  }

  return null
}

// A Zarr /X (reference, Icechunk, AnnData Zarr) is sliced per request. One in
// an H5 file worker is read whole, unless its arrays decode to more than
// `lazyAboveBytes`; then it too is sliced per request.
async function readMatrix(
  file: H5GroupLike,
  rows: number,
  cols: number,
  options: { readonly lazyAboveBytes?: number } = {},
): Promise<H5adMatrix> {
  const x = file.get('/X')
  const readLazily = (...datasets: readonly H5DatasetLike[]) => {
    const { lazyAboveBytes } = options
    let bytes = 0

    for (const dataset of datasets) {
      const datasetBytes = h5WorkerDatasetBytes(dataset)

      if (datasetBytes === null) {
        return false
      }

      bytes += datasetBytes
    }

    return lazyAboveBytes !== undefined && bytes > lazyAboveBytes
  }

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

    if (x.source?.kind === 'h5-worker' && readLazily(x)) {
      return { kind: 'dense-h5', values: x.source, rows, cols }
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
      data: zarrVectorReader(data.source.array),
      indices: zarrVectorReader(indices.source.array),
      indptr,
      rows,
      cols,
    }

    return encodingType === 'csc_matrix'
      ? { kind: 'csc-lazy', ...matrix }
      : { kind: 'csr-lazy', ...matrix }
  }

  if (
    data.source?.kind === 'h5-worker' &&
    indices.source?.kind === 'h5-worker' &&
    readLazily(data, indices)
  ) {
    const matrix = {
      data: h5WorkerVectorReader(data.source, '/X/data'),
      indices: h5WorkerVectorReader(indices.source, '/X/indices'),
      indptr,
      rows,
      cols,
    }

    return encodingType === 'csc_matrix'
      ? { kind: 'csc-lazy', ...matrix }
      : { kind: 'csr-lazy', ...matrix }
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

// The matrix columns of the genes found, by first match.
function geneColumns(
  geneNames: readonly string[],
  genes: readonly string[],
): { readonly found: readonly string[]; readonly cols: readonly number[] } {
  const colByGene = new Map<string, number>()
  geneNames.forEach((gene, col) => {
    if (!colByGene.has(gene)) colByGene.set(gene, col)
  })
  const found = genes.filter((gene) => colByGene.has(gene))

  return { found, cols: found.map((gene) => colByGene.get(gene) ?? -1) }
}

function h5adGeneValues(
  matrix: H5adMatrix,
  cols: readonly number[],
  signal: AbortSignal | undefined,
) {
  const options = { signal }

  switch (matrix.kind) {
    case 'csr':
      return geneValuesFromCsr(matrix, cols, options)
    case 'csc':
      return geneValuesFromCsc(matrix, cols, options)
    case 'dense':
      return geneValuesFromDense(matrix, cols, options)
    case 'csr-lazy':
      return geneValuesFromCsrBatches(rangeReadMatrix(matrix, signal), cols, options)
    case 'csc-lazy':
      return geneValuesFromColumnSlices(rangeReadMatrix(matrix, signal), cols, {
        ...options,
        concurrency: H5AD_REFERENCE_FETCH_CONCURRENCY,
      })
    case 'dense-h5':
      // The worker answers one read at a time.
      return geneValuesFromDenseChunks(denseH5RowBands(matrix, signal), cols, {
        ...options,
        concurrency: 1,
      })
    case 'dense-zarr':
      return geneValuesFromDenseChunks(
        {
          rows: matrix.rows,
          cols: matrix.cols,
          chunkShape: denseZarrChunkShape(matrix),
          readChunk: async (rowChunk, colChunk) => {
            const chunk = await matrix.values.getChunk([rowChunk, colChunk])
            return {
              values: readNumericArray(zarrChunkValue(chunk), matrix.values.path),
              stride: chunk.stride,
            }
          },
        },
        cols,
        { ...options, concurrency: H5AD_REFERENCE_FETCH_CONCURRENCY },
      )
  }
}

function h5adGeneValuesEstimate(
  matrix: H5adMatrix,
  cols: readonly number[],
): GeneValuesReadEstimate {
  switch (matrix.kind) {
    case 'csr':
    case 'csc':
    case 'dense':
      return { kind: 'read', bytes: 0 }
    case 'csr-lazy':
      return {
        kind: 'read',
        bytes: cols.length === 0 ? 0 : csrReadBytes(matrix, sparseValueBytes(matrix)),
        detail: 'The matrix is stored by cell (CSR), so any gene reads all of it.',
      }
    case 'dense-h5':
      // Every band, whole; the last is not padded as a Zarr edge chunk is.
      return {
        kind: 'read',
        bytes: cols.some((col) => col >= 0 && col < matrix.cols)
          ? matrix.rows * matrix.cols * (matrix.values.itemSize ?? 8)
          : 0,
        detail:
          'The matrix is dense and read in bands of whole cells, so any gene reads all of it.',
      }
    case 'csc-lazy':
      return {
        kind: 'read',
        bytes: columnSlicesReadBytes(matrix, cols, sparseValueBytes(matrix)),
        detail: 'The matrix is stored by gene (CSC), so each gene is one slice.',
      }
    case 'dense-zarr': {
      const chunkShape = denseZarrChunkShape(matrix)
      return {
        kind: 'read',
        bytes: denseChunksReadBytes(
          { rows: matrix.rows, cols: matrix.cols, chunkShape },
          cols,
          zarrDataTypeByteSize(matrix.values.dtype),
        ),
        detail: `The matrix is dense, in chunks of ${chunkShape[0].toLocaleString()} cells by ${chunkShape[1].toLocaleString()} genes: each gene reads every chunk that holds it.`,
      }
    }
  }
}

function rangeReadMatrix(
  matrix: Extract<H5adMatrix, { readonly kind: 'csr-lazy' | 'csc-lazy' }>,
  signal: AbortSignal | undefined,
): RangeReadSparseMatrix {
  return {
    indptr: matrix.indptr,
    rows: matrix.rows,
    cols: matrix.cols,
    readValues: async (start, end) => {
      const [indices, data] = await Promise.all([
        matrix.indices.slice(start, end, signal),
        matrix.data.slice(start, end, signal),
      ])
      return { indices, data }
    },
  }
}

// A stored value's bytes and its index's.
function sparseValueBytes(
  matrix: Extract<H5adMatrix, { readonly kind: 'csr-lazy' | 'csc-lazy' }>,
): number {
  return matrix.data.itemSize + matrix.indices.itemSize
}

// A dense /X read by range as bands of whole rows, each up to
// DENSE_H5_READ_MAX_BYTES. Its chunking is not known, and a row-major
// matrix keeps a gene's values one row apart, so reading a gene's column would
// fetch about as much.
function denseH5RowBands(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-h5' }>,
  signal: AbortSignal | undefined,
): ChunkReadDenseMatrix {
  const rowBytes = matrix.cols * (matrix.values.itemSize ?? 8)
  const bandRows = Math.max(1, Math.floor(DENSE_H5_READ_MAX_BYTES / rowBytes))

  return {
    rows: matrix.rows,
    cols: matrix.cols,
    chunkShape: [bandRows, matrix.cols],
    readChunk: async (rowChunk) => {
      const firstRow = rowChunk * bandRows
      const values = await matrix.values.file.read(matrix.values.path, {
        slice: [[firstRow, Math.min(firstRow + bandRows, matrix.rows)], null],
        ...(signal === undefined ? {} : { signal }),
      })
      return { values: readNumericArray(values, '/X'), stride: [matrix.cols, 1] }
    },
  }
}

async function h5adMatrixForCells(
  cache: H5adCache,
  ids: readonly SpatialElementId[],
  genes: readonly string[],
  denseCellProfileMaxBytes: number,
  signal?: AbortSignal,
): Promise<GexResult<SpatialElementId>> {
  const rowByCellId = new Map<string, number>()
  const colByGeneName = new Map<string, number>()

  cache.cellIds.forEach((cellId, row) => {
    rowByCellId.set(cellId, cache.section?.rows[row] ?? row)
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
    denseCellProfileMaxBytes,
    signal,
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
  denseCellProfileMaxBytes: number,
  signal: AbortSignal | undefined,
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
    if (allGenesRequested) {
      throwIfDenseCellProfileOverBudget(matrix, denseCellProfileMaxBytes)
    }

    return denseZarrCellsFromChunks(matrix, rows, requestedCols, geneNames, {
      allGenesRequested,
      includeZeroCounts,
    })
  }

  if (matrix.kind === 'dense-h5') {
    return denseH5CellsFromRows(matrix, rows, requestedCols, geneNames, {
      includeZeroCounts,
      signal,
    })
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

  if (matrix.kind === 'csr-lazy') {
    for (const batch of csrLazyRowBatches(matrix.indptr, rows)) {
      throwIfAborted(signal)
      const [indices, data] =
        batch.end > batch.start
          ? await Promise.all([
              matrix.indices.slice(batch.start, batch.end, signal),
              matrix.data.slice(batch.start, batch.end, signal),
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

  if (matrix.kind === 'csc-lazy' && allGenesRequested) {
    throw new H5adAllGeneCscMatrixUnsupportedError(matrix.rows, matrix.cols)
  }

  return h5adMatrixCellsFromColumns(
    matrix,
    rows,
    requestedCols,
    geneNames,
    includeZeroCounts,
    signal,
  )
}

interface CsrLazyRowBatch {
  readonly start: number
  readonly end: number
  readonly rows: readonly {
    readonly id: SpatialElementId
    readonly start: number
    readonly end: number
  }[]
}

// Groups CSR rows into contiguous value ranges so nearby rows share one read
// instead of re-reading the same chunks row by row.
function csrLazyRowBatches(
  indptr: NumericArrayLike,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
): readonly CsrLazyRowBatch[] {
  const spans = rows
    .map(({ id, row }) => ({
      id,
      start: Math.trunc(numericValue(indptr, row)),
      end: Math.trunc(numericValue(indptr, row + 1)),
    }))
    .sort((left, right) => left.start - right.start)
  const batches: CsrLazyRowBatch[] = []
  let current: {
    start: number
    end: number
    rows: { id: SpatialElementId; start: number; end: number }[]
  } | null = null

  for (const span of spans) {
    if (
      current !== null &&
      span.start - current.end <= CSR_LAZY_BATCH_MAX_GAP_VALUES &&
      Math.max(current.end, span.end) - current.start <= CSR_LAZY_BATCH_MAX_VALUES
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

// Refuses an all-gene read when the chunks that hold one cell's genes decode
// to more than `maxBytes`.
function throwIfDenseCellProfileOverBudget(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-zarr' }>,
  maxBytes: number,
): void {
  const chunkShape = denseZarrChunkShape(matrix)
  const [chunkRows, chunkCols] = chunkShape
  const chunkCount = Math.ceil(matrix.cols / chunkCols)
  const byteLength =
    chunkCount * chunkRows * chunkCols * zarrDataTypeByteSize(matrix.values.dtype)

  if (byteLength > maxBytes) {
    throw new H5adDenseCellProfileOverBudgetError({
      rowCount: matrix.rows,
      geneCount: matrix.cols,
      chunkShape,
      chunkCount,
      byteLength,
      maxBytes,
    })
  }
}

function denseZarrChunkShape(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-zarr' }>,
): [number, number] {
  const [chunkRows = matrix.rows, chunkCols = matrix.cols] = matrix.values.chunks
  return [Math.max(1, chunkRows), Math.max(1, chunkCols)]
}

// Bytes per value: 'float32' is 4, 'bool' and 'uint8' are 1.
export function zarrDataTypeByteSize(dataType: string): number {
  const bits = /(\d+)$/.exec(dataType)?.[1]
  return bits === undefined
    ? dataType === 'bool'
      ? 1
      : 8
    : Math.max(1, Number(bits) / 8)
}

// Reads each chunk that holds a requested row and column once, for all the
// requested rows together, and keeps only their values: rows that share a
// chunk share its read, and only the chunks being read are held decoded.
async function denseZarrCellsFromChunks(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-zarr' }>,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  options: { readonly allGenesRequested: boolean; readonly includeZeroCounts: boolean },
): Promise<ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }>> {
  const array = matrix.values
  const [chunkRows, chunkCols] = denseZarrChunkShape(matrix)
  // Non-zero values by column, so a cell's all-gene profile keeps only its
  // detected genes.
  const countsByCell = new Map<SpatialElementId, Map<number, number>>()
  const targets = rows.map(({ id, row }) => {
    const counts = countsByCell.get(id) ?? new Map<number, number>()
    countsByCell.set(id, counts)
    return { row, counts }
  })
  const rowsByChunk = groupByChunk(targets, ({ row }) => row, chunkRows)
  const colsByChunk = groupByChunk(requestedCols, (col) => col, chunkCols)
  const chunkReads = Array.from(rowsByChunk).flatMap(([rowChunk, chunkRowTargets]) =>
    Array.from(colsByChunk, ([colChunk, chunkColTargets]) => ({
      rowChunk,
      colChunk,
      chunkRowTargets,
      chunkColTargets,
    })),
  )

  await mapWithConcurrency(
    chunkReads,
    H5AD_REFERENCE_FETCH_CONCURRENCY,
    async ({ rowChunk, colChunk, chunkRowTargets, chunkColTargets }) => {
      const chunk = await array.getChunk([rowChunk, colChunk])
      const values = readNumericArray(zarrChunkValue(chunk), array.path)
      const [rowStride = chunkCols, colStride = 1] = chunk.stride

      for (const { row, counts } of chunkRowTargets) {
        const rowOffset = (row - rowChunk * chunkRows) * rowStride

        for (const col of chunkColTargets) {
          const value = numericValue(
            values,
            rowOffset + (col - colChunk * chunkCols) * colStride,
          )

          if (value !== 0) {
            counts.set(col, value)
          }
        }
      }
    },
  )

  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()

  for (const [id, counts] of countsByCell) {
    // A cell's detected genes, in column order, rather than every gene.
    const outputCols =
      options.allGenesRequested && !options.includeZeroCounts
        ? Array.from(counts.keys()).sort((left, right) => left - right)
        : requestedCols
    cells.set(
      id,
      cellFromCountsByColumn(counts, outputCols, geneNames, {
        includeZeroCounts: options.includeZeroCounts,
      }),
    )
  }

  return cells
}

// Items by the index of the chunk that holds them.
function groupByChunk<Item>(
  items: readonly Item[],
  index: (item: Item) => number,
  chunkSize: number,
): ReadonlyMap<number, readonly Item[]> {
  const groups = new Map<number, Item[]>()

  for (const item of items) {
    const chunk = Math.floor(index(item) / chunkSize)
    const group = groups.get(chunk)

    if (group === undefined) {
      groups.set(chunk, [item])
    } else {
      group.push(item)
    }
  }

  return groups
}

async function h5adMatrixCellsFromColumns(
  matrix: Extract<H5adMatrix, { readonly kind: 'csc' | 'csc-lazy' }>,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  includeZeroCounts: boolean,
  signal: AbortSignal | undefined,
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

    throwIfAborted(signal)
    const [indices, data] =
      matrix.kind === 'csc-lazy'
        ? await Promise.all([
            matrix.indices.slice(start, end, signal),
            matrix.data.slice(start, end, signal),
          ])
        : [matrix.indices, matrix.data]
    const offset = matrix.kind === 'csc-lazy' ? 0 : start

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

// Rows of a dense /X read by range, as hyperslabs across the requested genes'
// columns. Each read takes the sorted rows that fit in DENSE_H5_READ_MAX_BYTES
// from its first, rows between them included, so nearby rows share a read.
async function denseH5CellsFromRows(
  matrix: Extract<H5adMatrix, { readonly kind: 'dense-h5' }>,
  rows: readonly { readonly id: SpatialElementId; readonly row: number }[],
  requestedCols: readonly number[],
  geneNames: readonly string[],
  options: {
    readonly includeZeroCounts: boolean
    readonly signal: AbortSignal | undefined
  },
): Promise<ReadonlyMap<SpatialElementId, { geneNames: string[]; counts: number[] }>> {
  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()
  let firstCol = matrix.cols
  let lastCol = -1

  for (const col of requestedCols) {
    firstCol = Math.min(firstCol, col)
    lastCol = Math.max(lastCol, col)
  }

  const width = lastCol + 1 - firstCol
  const rowBytes = width * (matrix.values.itemSize ?? 8)
  const rowsPerRead = Math.max(1, Math.floor(DENSE_H5_READ_MAX_BYTES / rowBytes))
  const sorted = [...rows].sort((left, right) => left.row - right.row)
  let index = 0

  while (index < sorted.length) {
    throwIfAborted(options.signal)
    const firstRow = sorted[index]?.row ?? 0
    let end = index + 1

    while (end < sorted.length && (sorted[end]?.row ?? 0) - firstRow < rowsPerRead) {
      end += 1
    }

    const lastRow = sorted[end - 1]?.row ?? firstRow
    const values = readNumericArray(
      await matrix.values.file.read(matrix.values.path, {
        slice: [
          [firstRow, lastRow + 1],
          [firstCol, lastCol + 1],
        ],
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
      '/X',
    )

    for (const { id, row } of sorted.slice(index, end)) {
      const countsByColumn = new Map<number, number>()
      const rowStart = (row - firstRow) * width - firstCol

      for (const col of requestedCols) {
        countsByColumn.set(col, numericValue(values, rowStart + col))
      }

      cells.set(
        id,
        cellFromCountsByColumn(countsByColumn, requestedCols, geneNames, options),
      )
    }

    index = end
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

    // Scaled or centred matrices store negative values, which count too.
    if (count === 0 && !options.includeZeroCounts) {
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

// The limit counts cells inside the selection, so a lasso is tested before a
// cell counts towards it.
function h5adCellsInSelection(
  cache: H5adCache,
  selection: RoiSelection,
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

    if (!roiSelectionContains(selection, position)) {
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

function h5adCellMetadata(cache: H5adCache, row: number): CellMetadata {
  const metadata: Record<string, string | number | boolean> = {}

  for (const track of cache.categoricalTracks) {
    const value = labelAt(track.values, row)

    if (value !== null) {
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

// Set, class and track IDs are slugs of their names, which share links and
// collections keep. Names that slug alike (`Cell Type` and `cell_type`,
// `CD4+ T` and `CD4- T`, or any two in a script other than Latin) are told
// apart by a `-2`, `-3`, … on the later ones; the first keeps the plain slug.
export function uniqueSlugIds(bases: readonly string[]): string[] {
  const names = new Set(bases)
  const used = new Set<string>()

  return bases.map((base) => {
    let id = base

    // A suffixed ID that is another name's own slug is left for that name.
    for (let suffix = 2; used.has(id) || (id !== base && names.has(id)); suffix += 1) {
      id = `${base}-${suffix.toString()}`
    }

    used.add(id)
    return id
  })
}

const groupIdsByTracks = new WeakMap<readonly H5adCategoricalTrack[], readonly string[]>()
const trackIdsByTracks = new WeakMap<readonly H5adContinuousTrack[], readonly string[]>()

function h5adAnnotationGroupIds(
  tracks: readonly H5adCategoricalTrack[],
): readonly string[] {
  let ids = groupIdsByTracks.get(tracks)

  if (ids === undefined) {
    ids = uniqueSlugIds(tracks.map((track) => `analysis:${slug(track.label)}`))
    groupIdsByTracks.set(tracks, ids)
  }

  return ids
}

function h5adMetadataTrackIds(tracks: readonly H5adContinuousTrack[]): readonly string[] {
  let ids = trackIdsByTracks.get(tracks)

  if (ids === undefined) {
    ids = uniqueSlugIds(tracks.map((track) => `h5ad:${slug(track.id)}`))
    trackIdsByTracks.set(tracks, ids)
  }

  return ids
}

// A Visium track's count and range over the spots on the map. Spots off the
// tissue, while hidden, and other libraries' spots are not placed, and label
// counts leave them out too; a Census file has 4,992 rows for 370 placed
// spots. A track with no placed values keeps the whole column's range.
function placedTrackSummary(
  cache: H5adCache,
  track: H5adContinuousTrack,
): { readonly cellCount: number; readonly min: number; readonly max: number } {
  let cellCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  track.values.forEach((value, index) => {
    const position = cache.coordinates[index]

    if (!Number.isFinite(value) || position === undefined || !isFinitePoint(position)) {
      return
    }

    cellCount += 1
    min = Math.min(min, value)
    max = Math.max(max, value)
  })

  return cellCount === 0
    ? { cellCount, min: track.min, max: track.max }
    : { cellCount, min, max }
}

// Distinct non-empty labels, counted up to `limit`; a column with more
// reports limit + 1. Counting stops there because such a column identifies
// cells (cell IDs, barcodes) rather than grouping them, and a Set of every
// value cost 1.7 s for 598,222 cell IDs during a load.
function countUniqueLabels(
  labels: readonly string[],
  limit = DISTINCT_LABEL_COUNT_LIMIT,
): number {
  const values = new Set<string>()

  for (const label of labels) {
    if (label.length > 0) {
      values.add(label)

      if (values.size > limit) {
        break
      }
    }
  }

  return values.size
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
  const bases = names.map((name, index) =>
    name.trim() === '' ? `${fallbackPrefix}-${index}` : name.trim(),
  )
  // A suffix skips names stored elsewhere in the list, so c0, c0, c0-2 gives
  // c0, c0-3, c0-2 rather than two c0-2s.
  const stored = new Set(bases)
  const used = new Set<string>()
  const nextSuffix = new Map<string, number>()

  return bases.map((base) => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }

    let suffix = nextSuffix.get(base) ?? 2
    while (stored.has(`${base}-${suffix}`) || used.has(`${base}-${suffix}`)) {
      suffix += 1
    }
    nextSuffix.set(base, suffix + 1)
    const name = `${base}-${suffix}`
    used.add(name)

    return name
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

function zarrVectorReader(array: H5adZarrArray): H5adVectorReader {
  return {
    itemSize: zarrDataTypeByteSize(array.dtype),
    slice: (start, end) => zarrNumericVector(array, start, end),
  }
}

function h5WorkerVectorReader(
  source: H5adWorkerArraySource,
  label: string,
): H5adVectorReader {
  return {
    itemSize: source.itemSize ?? 8,
    async slice(start, end, signal) {
      if (start >= end) {
        return []
      }

      const value = await source.file.read(source.path, {
        slice: [[start, end]],
        ...(signal === undefined ? {} : { signal }),
      })
      return readNumericArray(value, label)
    },
  }
}

// The decoded size of a dataset in an H5 file worker; null for other datasets.
function h5WorkerDatasetBytes(dataset: H5DatasetLike): number | null {
  if (dataset.source?.kind !== 'h5-worker' || dataset.shape === null) {
    return null
  }

  return (
    dataset.shape.reduce((product, size) => product * size, 1) *
    (dataset.source.itemSize ?? 8)
  )
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
