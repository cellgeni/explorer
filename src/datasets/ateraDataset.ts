import * as zarr from 'zarrita'
import {
  micrometers,
  type BBox,
  type DataPoint,
  type UnitsDescriptor,
} from '../data/coords'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
  AnalysisEmbeddingOption,
} from '../data/analysisEmbeddings'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../data/customAnnotations'
import type {
  AnnotationGroupOption,
  LoadDatasetAnnotationsOptions,
} from '../data/datasetAnnotations'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { FallbackNotifier } from '../data/fallbackNotice'
import type { ImagePyramidLoader, ImagePyramidOpener } from '../data/imagePyramid'
import { openImagePyramid, openImagePyramidOptions } from '../data/morphologyImage'
import type { RoiSelectionInput } from '../data/roiSelection'
import type {
  TranscriptAggregateResult,
  TranscriptCapabilities,
  TranscriptViewportResult,
} from '../data/transcriptOverlay'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import { cachedZipFileStoreWithEntries } from '../zarr/cachedZipStore'
import { consolidatedZarrStore } from '../zarr/zarrStores'
import {
  ATERA_FILE_DEFAULTS,
  ATERA_GENE_FEATURE_TYPE,
  ateraMaxPolygonExtent,
  ateraPolygonGridLevelForBbox,
  ateraPolygonGridTilesForBbox,
  bboxesIntersect,
  decodeAteraGriddedPolygons,
  parseAteraExperiment,
  parseAteraPolygonGridAttrs,
  type AteraExperiment,
  type AteraFileRole,
  type AteraManifestFileKey,
  type AteraPolygonGrid,
  type AteraPolygonGridTile,
} from './ateraFormat'
import {
  AteraTranscripts,
  type AteraTranscriptAggregateOptions,
  type AteraTranscriptViewportOptions,
} from './ateraTranscripts'
import {
  AnnDataH5adDataset,
  type AnnDataObsAccess,
  type H5adLoadProgressReporter,
} from './h5adDataset'
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

export interface AteraDatasetOptions {
  // Folder that relative file paths resolve against: the dataset folder, or a
  // dataset manifest's root.
  readonly baseUrl: string
  // Absolute URLs from a dataset manifest; they win over experiment.spatial.
  readonly files?: Readonly<Partial<Record<AteraManifestFileKey, string>>>
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
  // Opens a zipped Zarr store and lists its entries; replaced in tests.
  readonly openZipStore?: (url: string) => Promise<AteraZipStore>
  readonly openImage?: ImagePyramidOpener
}

export interface AteraZipStore {
  readonly store: zarr.AsyncReadable
  // Entry paths without a leading slash.
  readonly entryNames: readonly string[]
}

export type AteraSegmentationKind = 'cell' | 'nucleus'

type ZarrStore = zarr.Readable

interface AteraTable {
  readonly table: AnnDataH5adDataset
  readonly store: ZarrStore
}

interface AteraOverview {
  readonly points: readonly CellOverviewPoint[]
  // Matrix row → cell barcode and position. Rows without coordinates are
  // absent from `points` but keep their slot here.
  readonly ids: readonly string[]
  readonly positions: readonly (DataPoint | undefined)[]
  readonly pointByRow: readonly (CellOverviewPoint | undefined)[]
  readonly rowById: ReadonlyMap<string, number>
}

interface AteraGenes {
  // Every matrix feature, in matrix column order.
  readonly featureNames: readonly string[]
  readonly columnByName: ReadonlyMap<string, number>
  readonly geneNames: readonly string[]
}

interface AteraCscMatrix {
  readonly indptr: readonly number[]
  readonly indices: zarr.Array<zarr.DataType, ZarrStore>
  readonly data: zarr.Array<zarr.DataType, ZarrStore>
}

interface AteraGeneColumn {
  readonly rows: Int32Array
  readonly counts: Float64Array
}

interface AteraCellsStore {
  readonly store: zarr.AsyncReadable
  readonly bboxes: Float32Array
  readonly maxExtent: number
  readonly grids: Readonly<Record<AteraSegmentationKind, AteraPolygonGrid | null>>
  readonly segmentationMethods: readonly string[]
}

interface AteraTileElement {
  readonly bbox: BBox
  readonly element: SpatialElement
}

const ATERA_UNITS_DEFAULT_MICROMETERS_PER_PIXEL = 0.2125
// Matrix var columns the viewer reads; the hundreds of differential
// expression columns are left closed.
const TABLE_VAR_COLUMNS = new Set(['feature_name', 'feature_id', 'feature_type'])
const TABLE_TOP_LEVEL_GROUPS = new Set(['X', 'obs', 'obsm'])
// obs columns that are identifiers or coordinates, not useful colour tracks.
const HIDDEN_METADATA_COLUMNS = new Set(['cell_id', 'centroid_column', 'centroid_row'])
const METADATA_FETCH_CONCURRENCY = 16
const GENE_COLUMN_CACHE_LIMIT = 64
const POLYGON_TILE_CACHE_LIMIT = 256
const POLYGON_SET_INDEX: Readonly<Record<AteraSegmentationKind, number>> = {
  nucleus: 0,
  cell: 1,
}

export class AteraDataset implements SpatialDataset<SpatialElementId> {
  readonly baseUrl: string
  private readonly files: Readonly<Partial<Record<AteraManifestFileKey, string>>>
  private readonly fetcher: typeof fetch
  private readonly onProgress: H5adLoadProgressReporter | undefined
  private readonly openZipStore: (url: string) => Promise<AteraZipStore>
  private readonly openImage: ImagePyramidOpener
  private experimentPromise: Promise<AteraExperiment> | null = null
  // experiment.spatial is optional with a manifest, so its file paths are read
  // once and a missing file means standard names, without refetching it on
  // every lookup.
  private experimentFilesPromise: Promise<AteraExperiment['files'] | null> | null = null
  private tablePromise: Promise<AteraTable> | null = null
  private overviewPromise: Promise<AteraOverview> | null = null
  private genesPromise: Promise<AteraGenes> | null = null
  private cscPromise: Promise<AteraCscMatrix> | null = null
  private cellsPromise: Promise<AteraCellsStore> | null = null
  private imagePromise: Promise<ImagePyramidLoader | null> | null = null
  private transcriptReader: AteraTranscripts | null = null
  private readonly geneColumns = new Map<string, Promise<AteraGeneColumn>>()
  private readonly polygonTiles = new Map<string, Promise<readonly AteraTileElement[]>>()

  constructor(options: AteraDatasetOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.files = options.files ?? {}
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.onProgress = options.onProgress
    this.openZipStore = options.openZipStore ?? cachedZipFileStoreWithEntries
    this.openImage = options.openImage ?? openImagePyramid
  }

  async meta(): Promise<DatasetMeta> {
    const [experiment, { table }] = await Promise.all([this.experiment(), this.table()])
    const tableMeta = await table.meta()

    return {
      platform: 'atera',
      units: ateraUnits(experiment),
      extent: tableMeta.extent,
      capabilities: {
        transcripts: true,
        cellBoundaries: true,
        pyramidImage: (await this.morphologyUrl()) !== null,
        multiChannel: true,
      },
      segmentations: [
        {
          id: 'cell',
          kind: 'cell',
          label: 'Cell boundaries',
          sourceKind: 'zarr',
          path: await this.fileLabel('cells'),
        },
        {
          id: 'nucleus',
          kind: 'nucleus',
          label: 'Nucleus boundaries',
          sourceKind: 'zarr',
          path: await this.fileLabel('cells'),
        },
      ],
    }
  }

  async experiment(): Promise<AteraExperiment> {
    if (this.experimentPromise === null) {
      this.experimentPromise = this.readExperiment().catch((error: unknown) => {
        this.experimentPromise = null
        throw error
      })
    }

    return this.experimentPromise
  }

  async elements(bbox: BBox): Promise<ElementBatch<SpatialElementId>> {
    return { elements: await this.segmentationElements('cell', bbox) }
  }

  async segmentationElements(
    kind: AteraSegmentationKind,
    bbox: BBox,
  ): Promise<readonly SpatialElement[]> {
    const [cells, overview] = await Promise.all([this.cellsStore(), this.overviewIndex()])
    const grid = cells.grids[kind]

    if (grid === null) {
      return []
    }

    const levelIndex = ateraPolygonGridLevelForBbox(grid, bbox)
    const level = grid.levels[levelIndex]

    if (level === undefined) {
      return []
    }

    const tiles = ateraPolygonGridTilesForBbox(level, bbox, cells.maxExtent)
    const tileElements = await Promise.all(
      tiles.map((tile) => this.polygonTile(kind, levelIndex, tile, cells, overview)),
    )
    const elements: SpatialElement[] = []

    for (const tile of tileElements) {
      for (const entry of tile) {
        if (bboxesIntersect(entry.bbox, bbox)) {
          elements.push(entry.element)
        }
      }
    }

    return elements
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    return (await this.overviewIndex()).points
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    return (await this.table()).table.matrix(ids)
  }

  // Selected genes are read as whole columns from the CSC matrix, so a gene
  // costs the same at every zoom and later viewports reuse the column.
  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: CellFeatureMatrixReadOptions & {
      readonly limit?: number
      readonly sampleStride?: number
    } = {},
  ): Promise<GeneExpressionBatch> {
    throwIfAborted(options.signal)
    const [overview, columns] = await Promise.all([
      this.overviewIndex(),
      Promise.all(genes.map((gene) => this.geneColumn(gene))),
    ])
    throwIfAborted(options.signal)
    const counts = new Float64Array(overview.ids.length)

    for (const column of columns) {
      for (let index = 0; index < column.rows.length; index += 1) {
        const row = column.rows[index] ?? -1

        if (row >= 0 && row < counts.length) {
          counts[row] = (counts[row] ?? 0) + (column.counts[index] ?? 0)
        }
      }
    }

    // A sample keeps every cell with expression and every Nth cell without.
    const sampleStride = normalizeSampleStride(options.sampleStride)
    const limit = options.limit ?? Number.POSITIVE_INFINITY
    const elements: GeneExpressionElement[] = []
    let cellsInBbox = 0
    let zeroCellIndex = 0
    let maxCount = 0

    for (let row = 0; row < overview.ids.length && cellsInBbox < limit; row += 1) {
      const position = overview.positions[row]
      const id = overview.ids[row]

      if (position === undefined || id === undefined || !pointInBbox(position, bbox)) {
        continue
      }

      cellsInBbox += 1
      const count = counts[row] ?? 0

      if (count === 0) {
        zeroCellIndex += 1

        if ((zeroCellIndex - 1) % sampleStride !== 0) {
          continue
        }
      }

      const point = overview.pointByRow[row]
      maxCount = Math.max(maxCount, count)
      elements.push({
        id,
        position,
        count,
        ...(point === undefined ? {} : { transcriptCount: point.transcriptCount }),
        ...(point?.cellArea === undefined ? {} : { cellArea: point.cellArea }),
        ...(point?.nucleusCount === undefined
          ? {}
          : { nucleusCount: point.nucleusCount }),
        ...(point?.segmentationMethod === undefined
          ? {}
          : { segmentationMethod: point.segmentationMethod }),
      })
    }

    return { elements, genes, maxCount }
  }

  async annotationGroups(): Promise<readonly AnnotationGroupOption[]> {
    return (await this.table()).table.annotationGroups()
  }

  async annotations(
    options: LoadDatasetAnnotationsOptions = {},
  ): Promise<readonly Annotation<SpatialElementId>[]> {
    return (await this.table()).table.annotations(options)
  }

  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    const tracks = await (await this.table()).table.metadataTracks()
    return tracks.filter((track) => !HIDDEN_METADATA_COLUMNS.has(track.label))
  }

  async metadataTrackValues(
    trackId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly ContinuousCellMetadataValue[]> {
    return (await this.table()).table.metadataTrackValues(trackId, options)
  }

  async embeddings(
    options: {
      readonly kind?: AnalysisEmbeddingKind
      readonly signal?: AbortSignal
    } = {},
  ): Promise<readonly AnalysisEmbedding[]> {
    return (await this.table()).table.embeddings(options)
  }

  async embeddingOptions(): Promise<readonly AnalysisEmbeddingOption[]> {
    return (await this.table()).table.embeddingOptions()
  }

  // Gene features only; control probes and codewords stay readable through
  // the matrix but are not offered in the gene list.
  async genePanel(): Promise<readonly string[]> {
    return (await this.genes()).geneNames
  }

  // ROI cells, with the counts and areas the ROI summary averages.
  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const [{ table }, overview] = await Promise.all([this.table(), this.overviewIndex()])
    const cells = await table.cells(selection, options)

    return cells.map((cell) => {
      const row = overview.rowById.get(cell.id)
      const point = row === undefined ? undefined : overview.pointByRow[row]

      return point === undefined
        ? cell
        : {
            ...cell,
            transcriptCount: point.transcriptCount,
            ...(point.cellArea === undefined ? {} : { cellArea: point.cellArea }),
            ...(point.nucleusCount === undefined
              ? {}
              : { nucleusCount: point.nucleusCount }),
            ...(point.segmentationMethod === undefined
              ? {}
              : { segmentationMethod: point.segmentationMethod }),
            ...(row === undefined ? {} : { cellFeatureMatrixRow: row }),
          }
    })
  }

  // Transcripts are read per selected gene; see AteraTranscripts.
  async transcriptCapabilities(): Promise<TranscriptCapabilities> {
    return this.transcriptsReader().capabilities()
  }

  async transcriptAggregates(
    bbox: BBox,
    options: AteraTranscriptAggregateOptions,
  ): Promise<TranscriptAggregateResult> {
    return this.transcriptsReader().aggregates(bbox, options)
  }

  async transcriptViewport(
    bbox: BBox,
    options: AteraTranscriptViewportOptions,
  ): Promise<TranscriptViewportResult> {
    return this.transcriptsReader().viewport(bbox, options)
  }

  async image(): Promise<ImageSource | null> {
    const loader = await this.imageLoader()

    return loader === null
      ? null
      : {
          kind: 'pyramid',
          loader,
          openChannelLoader: (url, signal, onFallback) =>
            this.openMorphologyImage(url, signal, onFallback),
        }
  }

  async morphologyUrl(): Promise<string | null> {
    const manifestImage = this.files.morphology

    if (manifestImage !== undefined) {
      return manifestImage
    }

    const { morphologyPath } = await this.experiment()
    return morphologyPath === undefined ? null : this.resolve(morphologyPath)
  }

  async fileUrl(role: AteraFileRole): Promise<string> {
    const manifestFile = this.files[role]

    if (manifestFile !== undefined) {
      return manifestFile
    }

    if (role === 'experiment') {
      return this.resolve(ATERA_FILE_DEFAULTS.experiment)
    }

    this.experimentFilesPromise ??= this.experiment().then(
      (experiment) => experiment.files,
      () => null,
    )
    const files = await this.experimentFilesPromise
    return this.resolve(files?.[role] ?? ATERA_FILE_DEFAULTS[role])
  }

  private async fileLabel(role: AteraFileRole): Promise<string> {
    const url = await this.fileUrl(role)
    return url.startsWith(`${this.baseUrl}/`) ? url.slice(this.baseUrl.length + 1) : url
  }

  private resolve(path: string): string {
    return /^[a-z][a-z\d+.-]*:/i.test(path)
      ? path
      : `${this.baseUrl}/${path.replace(/^\/+/, '')}`
  }

  private async readExperiment(): Promise<AteraExperiment> {
    const url = await this.fileUrl('experiment')
    const response = await this.fetcher(url)

    if (!response.ok) {
      throw new Error(
        `Unable to load ${await this.fileLabel('experiment')}: HTTP ${response.status}.`,
      )
    }

    return parseAteraExperiment(await response.json())
  }

  private table(): Promise<AteraTable> {
    if (this.tablePromise === null) {
      this.tablePromise = this.readTable().catch((error: unknown) => {
        this.tablePromise = null
        throw error
      })
    }

    return this.tablePromise
  }

  // The matrix is an AnnData Zarr store in a zip without consolidated
  // metadata. Reading each node's metadata in turn would cost hundreds of
  // sequential range requests, so the needed nodes' metadata is fetched in
  // parallel and served from memory.
  private async readTable(): Promise<AteraTable> {
    const url = await this.fileUrl('cellFeatureMatrix')
    const label = await this.fileLabel('cellFeatureMatrix')
    this.onProgress?.(`Atera ${label} opening`)
    const { store: zipStore, entryNames } = await this.openZipStore(url)
    const metadataKeys = entryNames.filter(isAteraTableMetadataKey)

    if (!metadataKeys.includes('X/.zattrs') || !metadataKeys.includes('obs/.zattrs')) {
      throw new Error(`${label} is not an AnnData Zarr store (no /X or /obs).`)
    }

    const knownMetadata = new Map<string, unknown>(
      await mapWithConcurrency(metadataKeys, METADATA_FETCH_CONCURRENCY, async (key) => {
        const bytes = await zipStore.get(`/${key}`)

        if (bytes === undefined) {
          throw new Error(`${label} is missing ${key}.`)
        }

        return [`/${key}`, JSON.parse(new TextDecoder().decode(bytes))] as const
      }),
    )
    const store = consolidatedZarrStore(zipStore, knownMetadata)
    const table = new AnnDataH5adDataset({
      url,
      fetcher: this.fetcher,
      ...(this.onProgress === undefined ? {} : { onProgress: this.onProgress }),
      zarrSource: {
        store,
        zarrFormat: 2,
        path: '',
        nodes: zarrNodesFromMetadataKeys(metadataKeys),
        label: `Atera ${label}`,
        resolveCoordinates: (obs) => ateraCellCoordinates(obs, label),
      },
    })

    return { table, store }
  }

  private overviewIndex(): Promise<AteraOverview> {
    if (this.overviewPromise === null) {
      this.overviewPromise = this.readOverview().catch((error: unknown) => {
        this.overviewPromise = null
        throw error
      })
    }

    return this.overviewPromise
  }

  // Matrix obs gives positions, counts, and areas. Nucleus counts and
  // segmentation methods come from cells.zarr.zip when it can be read.
  private async readOverview(): Promise<AteraOverview> {
    const { table } = await this.table()
    const [tablePoints, cellIds, transcriptCounts, cellAreas, cellDetails] =
      await Promise.all([
        table.overview(),
        table.cellIds(),
        table.numericObsColumn('transcript_counts'),
        table.numericObsColumn('cell_area'),
        this.cellDetails().catch((error: unknown) => {
          this.onProgress?.(
            `Atera cell details unavailable: ${error instanceof Error ? error.message : String(error)}`,
          )
          return null
        }),
      ])
    const rowById = new Map<string, number>()

    cellIds.forEach((id, row) => {
      rowById.set(id, row)
    })

    const positions: (DataPoint | undefined)[] = new Array(cellIds.length)
    const pointByRow: (CellOverviewPoint | undefined)[] = new Array(cellIds.length)
    const points = tablePoints.map((point) => {
      const row = point.cellId === undefined ? undefined : rowById.get(point.cellId)
      const transcriptCount =
        finiteNumber(row === undefined ? undefined : transcriptCounts?.[row]) ?? 0
      const cellArea = finiteNumber(row === undefined ? undefined : cellAreas?.[row])
      const nucleusCount = row === undefined ? undefined : cellDetails?.nucleusCounts[row]
      const segmentationMethod =
        row === undefined ? undefined : cellDetails?.segmentationMethods[row]
      const enriched: CellOverviewPoint = {
        ...point,
        transcriptCount,
        ...(cellArea === undefined ? {} : { cellArea }),
        ...(nucleusCount === undefined ? {} : { nucleusCount }),
        ...(segmentationMethod === undefined ? {} : { segmentationMethod }),
      }

      if (row !== undefined) {
        positions[row] = point.position
        pointByRow[row] = enriched
      }

      return enriched
    })

    return { points, ids: cellIds, positions, pointByRow, rowById }
  }

  private genes(): Promise<AteraGenes> {
    if (this.genesPromise === null) {
      this.genesPromise = this.readGenes().catch((error: unknown) => {
        this.genesPromise = null
        throw error
      })
    }

    return this.genesPromise
  }

  private async readGenes(): Promise<AteraGenes> {
    const { table, store } = await this.table()
    const featureNames = await table.genePanel()
    // Without feature types every feature is offered; read failures still fail.
    const featureTypes = await readCategoricalColumn(store, 'var/feature_type').catch(
      (error: unknown) => {
        if (zarr.isZarritaError(error, 'NotFoundError')) {
          return null
        }

        throw error
      },
    )
    const columnByName = new Map<string, number>()

    featureNames.forEach((name, column) => {
      columnByName.set(name, column)
    })

    const geneNames =
      featureTypes === null || featureTypes.length !== featureNames.length
        ? featureNames
        : featureNames.filter(
            (_name, column) => featureTypes[column] === ATERA_GENE_FEATURE_TYPE,
          )

    return { featureNames, columnByName, geneNames }
  }

  private csc(): Promise<AteraCscMatrix> {
    if (this.cscPromise === null) {
      this.cscPromise = this.readCsc().catch((error: unknown) => {
        this.cscPromise = null
        throw error
      })
    }

    return this.cscPromise
  }

  private async readCsc(): Promise<AteraCscMatrix> {
    const url = await this.fileUrl('cscCellFeatureMatrix')
    const label = await this.fileLabel('cscCellFeatureMatrix')
    const [{ store }, genes] = await Promise.all([this.openZipStore(url), this.genes()])
    const root = zarr.root(store)
    const [indptrArray, indices, data, encoding] = await Promise.all([
      zarr.open.v2(root.resolve('X/indptr'), { kind: 'array' }),
      zarr.open.v2(root.resolve('X/indices'), { kind: 'array' }),
      zarr.open.v2(root.resolve('X/data'), { kind: 'array' }),
      zarr.open.v2(root.resolve('X'), { kind: 'group' }),
    ])

    if (encoding.attrs['encoding-type'] !== 'csc_matrix') {
      throw new Error(`${label} does not hold a CSC matrix.`)
    }

    const indptr = numbersFromChunk(await zarr.get(indptrArray, [null]))

    if (indptr.length !== genes.featureNames.length + 1) {
      throw new Error(
        `${label} has ${Math.max(indptr.length - 1, 0).toLocaleString()} features; the cell-feature matrix has ${genes.featureNames.length.toLocaleString()}.`,
      )
    }

    return { indptr, indices, data }
  }

  private geneColumn(gene: string): Promise<AteraGeneColumn> {
    const cached = this.geneColumns.get(gene)

    if (cached !== undefined) {
      this.geneColumns.delete(gene)
      this.geneColumns.set(gene, cached)
      return cached
    }

    const promise = this.readGeneColumn(gene).catch((error: unknown) => {
      this.geneColumns.delete(gene)
      throw error
    })
    this.geneColumns.set(gene, promise)
    evictOldest(this.geneColumns, GENE_COLUMN_CACHE_LIMIT)
    return promise
  }

  private async readGeneColumn(gene: string): Promise<AteraGeneColumn> {
    const [genes, csc] = await Promise.all([this.genes(), this.csc()])
    const column = genes.columnByName.get(gene)

    if (column === undefined) {
      return { rows: new Int32Array(0), counts: new Float64Array(0) }
    }

    const start = csc.indptr[column] ?? 0
    const end = csc.indptr[column + 1] ?? start

    if (end <= start) {
      return { rows: new Int32Array(0), counts: new Float64Array(0) }
    }

    const [rows, counts] = await Promise.all([
      zarr.get(csc.indices, [zarr.slice(start, end)]),
      zarr.get(csc.data, [zarr.slice(start, end)]),
    ])

    return {
      rows: Int32Array.from(numbersFromChunk(rows)),
      counts: Float64Array.from(numbersFromChunk(counts)),
    }
  }

  private cellsStore(): Promise<AteraCellsStore> {
    if (this.cellsPromise === null) {
      this.cellsPromise = this.readCells().catch((error: unknown) => {
        this.cellsPromise = null
        throw error
      })
    }

    return this.cellsPromise
  }

  private async readCells(): Promise<AteraCellsStore> {
    const url = await this.fileUrl('cells')
    const label = await this.fileLabel('cells')
    const { store } = await this.openZipStore(url)
    const root = zarr.root(store)
    const [rootGroup, bboxesArray] = await Promise.all([
      zarr.open.v2(root, { kind: 'group' }),
      zarr.open.v2(root.resolve('bboxes'), { kind: 'array' }),
    ])
    const grids = await Promise.all(
      (['nucleus', 'cell'] as const).map(async (kind) => {
        try {
          const group = await zarr.open.v2(
            root.resolve(`gridded_polygon_sets/${POLYGON_SET_INDEX[kind]}`),
            { kind: 'group' },
          )
          return parseAteraPolygonGridAttrs(group.attrs)
        } catch {
          return null
        }
      }),
    )

    const [nucleusGrid = null, cellGrid = null] = grids

    if (cellGrid === null) {
      throw new Error(`${label} has no gridded cell polygons.`)
    }

    const bboxes = Float32Array.from(
      numbersFromChunk(await zarr.get(bboxesArray, [null])),
    )
    const methods = rootGroup.attrs.segmentation_methods

    return {
      store,
      bboxes,
      maxExtent: ateraMaxPolygonExtent(bboxes),
      grids: { nucleus: nucleusGrid, cell: cellGrid },
      segmentationMethods: Array.isArray(methods)
        ? methods.map((method) => String(method))
        : [],
    }
  }

  // Per-row nucleus count (cell_summary column 7) and cell segmentation
  // method (polygon_sets/1/method), each one small chunk read.
  private async cellDetails(): Promise<{
    readonly nucleusCounts: readonly number[]
    readonly segmentationMethods: readonly (string | undefined)[]
  }> {
    const cells = await this.cellsStore()
    const root = zarr.root(cells.store)
    const summary = await zarr.open.v2(root.resolve('cell_summary'), { kind: 'array' })
    const columns = summary.attrs.column_names
    const nucleusColumn = Array.isArray(columns) ? columns.indexOf('nucleus_count') : -1
    const methodArray = await zarr.open
      .v2(root.resolve('polygon_sets/1/method'), { kind: 'array' })
      .catch(() => null)
    const [nucleusCounts, methods] = await Promise.all([
      nucleusColumn < 0
        ? Promise.resolve<readonly number[]>([])
        : zarr.get(summary, [null, nucleusColumn]).then(numbersFromChunk),
      methodArray === null
        ? Promise.resolve<readonly number[]>([])
        : zarr.get(methodArray, [null]).then(numbersFromChunk),
    ])

    return {
      nucleusCounts,
      segmentationMethods: methods.map((method) => cells.segmentationMethods[method]),
    }
  }

  private polygonTile(
    kind: AteraSegmentationKind,
    level: number,
    tile: AteraPolygonGridTile,
    cells: AteraCellsStore,
    overview: AteraOverview,
  ): Promise<readonly AteraTileElement[]> {
    const key = `${kind}/${level}/${tile.key}`
    const cached = this.polygonTiles.get(key)

    if (cached !== undefined) {
      return cached
    }

    const promise = this.readPolygonTile(kind, level, tile, cells, overview).catch(
      (error: unknown) => {
        this.polygonTiles.delete(key)
        throw error
      },
    )
    this.polygonTiles.set(key, promise)
    evictOldest(this.polygonTiles, POLYGON_TILE_CACHE_LIMIT)
    return promise
  }

  private async readPolygonTile(
    kind: AteraSegmentationKind,
    level: number,
    tile: AteraPolygonGridTile,
    cells: AteraCellsStore,
    overview: AteraOverview,
  ): Promise<readonly AteraTileElement[]> {
    const root = zarr.root(cells.store)
    const path = `gridded_polygon_sets/${POLYGON_SET_INDEX[kind]}/${level}/${tile.key}`
    const [cellIndex, numVertices, relativeVertices] = await Promise.all(
      ['cell_index', 'num_vertices', 'relative_vertices'].map(async (name) =>
        numbersFromChunk(
          await zarr.get(
            await zarr.open.v2(root.resolve(`${path}/${name}`), { kind: 'array' }),
            [null],
          ),
        ),
      ),
    )
    const polygons = decodeAteraGriddedPolygons({
      cellIndex: cellIndex ?? [],
      numVertices: numVertices ?? [],
      relativeVertices: relativeVertices ?? [],
      bboxes: cells.bboxes,
    })
    const seen = new Map<number, number>()
    const elements: AteraTileElement[] = []

    for (const polygon of polygons) {
      const cellId = overview.ids[polygon.cellIndex]

      if (cellId === undefined) {
        continue
      }

      // A cell can have several nuclei; later ones get a numbered id.
      const occurrence = (seen.get(polygon.cellIndex) ?? 0) + 1
      seen.set(polygon.cellIndex, occurrence)
      const id = occurrence === 1 ? cellId : `${cellId}#nucleus-${occurrence}`
      elements.push({
        bbox: ringBbox(polygon.ring),
        element: {
          id,
          geometry: { kind: 'polygon', rings: [polygon.ring] },
          metadata: { segmentation: { kind } },
        },
      })
    }

    return elements
  }

  private transcriptsReader(): AteraTranscripts {
    this.transcriptReader ??= new AteraTranscripts({
      binned: async () => ({
        url: await this.fileUrl('binnedTranscripts'),
        label: await this.fileLabel('binnedTranscripts'),
      }),
      transcripts: async () => ({
        url: await this.fileUrl('transcripts'),
        label: await this.fileLabel('transcripts'),
      }),
      openZipStore: this.openZipStore,
    })

    return this.transcriptReader
  }

  private imageLoader(): Promise<ImagePyramidLoader | null> {
    if (this.imagePromise === null) {
      this.imagePromise = this.morphologyUrl()
        .then((url) => (url === null ? null : this.openMorphologyImage(url)))
        .catch((error: unknown) => {
          this.imagePromise = null
          throw error
        })
    }

    return this.imagePromise
  }

  // Every morphology_2d channel file opens with the manifest's sidecar, which
  // covers all of them.
  private openMorphologyImage(
    url: string,
    signal?: AbortSignal,
    onFallback?: FallbackNotifier,
  ): Promise<ImagePyramidLoader> {
    return this.openImage(
      url,
      signal,
      onFallback,
      openImagePyramidOptions(this.files.morphologyZchunkstore),
    )
  }
}

export function isAteraTableMetadataKey(key: string): boolean {
  const match = /^(?:(.*)\/)?\.z(?:array|group|attrs)$/.exec(key)

  if (match === null) {
    return false
  }

  const [top, column] = (match[1] ?? '').split('/')

  if (top === undefined || top === '') {
    return true
  }

  if (TABLE_TOP_LEVEL_GROUPS.has(top)) {
    return true
  }

  return top === 'var' && (column === undefined || TABLE_VAR_COLUMNS.has(column))
}

export function zarrNodesFromMetadataKeys(
  keys: readonly string[],
): readonly { readonly path: string; readonly kind: 'array' | 'group' }[] {
  const nodes: { path: string; kind: 'array' | 'group' }[] = []

  for (const key of keys) {
    const match = /^(?:(.*)\/)?\.z(array|group)$/.exec(key)

    if (match !== null) {
      nodes.push({ path: match[1] ?? '', kind: match[2] === 'array' ? 'array' : 'group' })
    }
  }

  return nodes
}

async function ateraCellCoordinates(
  obs: AnnDataObsAccess,
  label: string,
): Promise<readonly DataPoint[]> {
  const [xs, ys] = await Promise.all([
    obs.readObsColumn('centroid_column'),
    obs.readObsColumn('centroid_row'),
  ])

  if (xs === null || ys === null) {
    throw new Error(`${label} obs has no centroid_column/centroid_row cell centroids.`)
  }

  return xs.map((x, index) => ({
    x: micrometers(typeof x === 'number' ? x : Number.NaN),
    y: micrometers(typeof ys[index] === 'number' ? (ys[index] as number) : Number.NaN),
  }))
}

async function readCategoricalColumn(
  store: ZarrStore,
  path: string,
): Promise<readonly (string | null)[]> {
  const root = zarr.root(store)
  const [codesArray, categoriesArray] = await Promise.all([
    zarr.open.v2(root.resolve(`${path}/codes`), { kind: 'array' }),
    zarr.open.v2(root.resolve(`${path}/categories`), { kind: 'array' }),
  ])
  const [codes, categories] = await Promise.all([
    zarr.get(codesArray, [null]).then(numbersFromChunk),
    zarr.get(categoriesArray, [null]),
  ])
  const labels = Array.from(categories.data as Iterable<unknown>, (value) =>
    String(value),
  )

  return codes.map((code) => (code < 0 ? null : (labels[code] ?? null)))
}

function ateraUnits(experiment: AteraExperiment): UnitsDescriptor {
  return {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(
      experiment.micrometersPerPixel ?? ATERA_UNITS_DEFAULT_MICROMETERS_PER_PIXEL,
    ),
    origin: 'top-left',
    imageYAxis: 'down',
  }
}

function numbersFromChunk(chunk: { readonly data: unknown }): number[] {
  const data = chunk.data

  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return Array.from(data, (value) => Number(value))
  }

  if (ArrayBuffer.isView(data) || Array.isArray(data)) {
    return Array.from(data as ArrayLike<number>, (value) => Number(value))
  }

  throw new Error('Expected a numeric Zarr array.')
}

function ringBbox(ring: readonly DataPoint[]): BBox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of ring) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

function pointInBbox(point: DataPoint, bbox: BBox): boolean {
  return (
    point.x >= bbox.minX &&
    point.x <= bbox.maxX &&
    point.y >= bbox.minY &&
    point.y <= bbox.maxY
  )
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function evictOldest<Key, Value>(cache: Map<Key, Value>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next()

    if (oldest.done === true) {
      return
    }

    cache.delete(oldest.value)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('Gene expression request aborted.'), {
          name: 'AbortError',
        })
  }
}
