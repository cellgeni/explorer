import { micrometers } from '../data/coords'
import {
  readXeniumBoundaryElements,
  readXeniumCellIdsForSelection,
  readXeniumCellTranscriptZDistributionForCellId,
  readXeniumCellsForSelection,
  readXeniumExperimentMetadata,
  readXeniumExtent,
  readXeniumGeneExpression,
  readXeniumMatrixForCells,
  readXeniumTranscriptsForCellId,
  readXeniumTranscriptsForSelection,
  readXeniumTranscriptsForViewport,
  readXeniumTranscriptsInBbox,
} from './xeniumDatasetReaders'
import type { CellId } from '../data/cellid'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { RoiSelectionInput } from '../data/roiSelection'
import type { AnalysisAnnotationQueryOptions } from '../data/analysisAnnotations'
import type { CellTranscriptZDistribution } from '../data/cellTranscripts'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  CellFeatureMatrixReadOptions,
  DuckDbPreparedStatementLike,
  GexResult,
  TranscriptDuckDbConnection,
} from '../data/gex'
import type { Selection, TranscriptScope } from '../data/gexSelection'
import type {
  GeneExpressionStageTiming,
  GeneExpressionStageTimingHandler,
} from '../data/geneExpressionTiming'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
} from './spatialDataset'
import type { TranscriptViewportResult } from '../data/transcriptOverlay'

type MatrixReader = (url: string, ids: readonly CellId[]) => Promise<GexResult>
type GeneExpressionMatrixReader = (
  url: string,
  ids: readonly CellId[],
  genes: readonly string[],
  options?: CellFeatureMatrixReadOptions,
) => Promise<GexResult>
type TranscriptReader = (
  conn: TranscriptDuckDbConnection,
  url: string,
  selection: Selection,
  scope?: TranscriptScope,
  cellIds?: readonly CellId[],
  minQv?: number,
) => Promise<GexResult>

export interface XeniumDatasetOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly duckDbClient?: DuckDbClientLike | Promise<DuckDbClientLike>
  readonly createDuckDbClient?: () => Promise<DuckDbClientLike>
  readonly openTiff?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly matrixReader?: MatrixReader
  readonly geneExpressionMatrixReader?: GeneExpressionMatrixReader
  readonly transcriptReader?: TranscriptReader
  readonly overviewReader?: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
  readonly analysisAnnotationReader?: (
    analysisUrl: string,
    matrixUrl: string,
    options?: AnalysisAnnotationQueryOptions,
  ) => Promise<readonly Annotation[]>
}

export interface DuckDbClientLike {
  readonly conn: XeniumDuckDbConnection
  close?(): Promise<void>
}

export interface XeniumDuckDbConnection extends TranscriptDuckDbConnection {
  prepare(sql: string): Promise<DuckDbPreparedStatementLike>
}

export interface GeneExpressionElement {
  readonly id: string
  readonly position: DataPoint
  readonly count: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly binSizeMicrometers?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
}

export interface GeneExpressionGeneCount {
  readonly gene: string
  readonly count: number
}

export interface GeneExpressionBatch {
  readonly elements: readonly GeneExpressionElement[]
  readonly genes: readonly string[]
  readonly geneCounts?: readonly GeneExpressionGeneCount[]
  readonly maxCount: number
  readonly timing?: GeneExpressionBatchTiming
}

export interface GeneExpressionBatchTiming {
  readonly viewportCellsMs: number
  readonly matrixReadMs: number
  readonly scoreCellsMs: number
  readonly totalMs: number
  readonly stageTimings?: readonly GeneExpressionStageTiming[]
  readonly stageSummary?: string
}

export interface GeneExpressionQueryOptions {
  readonly limit?: number
  readonly sampleStride?: number
  readonly signal?: AbortSignal
  readonly onStageTiming?: GeneExpressionStageTimingHandler
}

export interface DatasetCell {
  readonly id: CellId
  readonly position: DataPoint
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
  readonly cellFeatureMatrixRow?: number
}

export interface DatasetTranscript {
  readonly cellId: CellId | null
  readonly featureName: string
  readonly position: DataPoint
  readonly zLocation: number | undefined
  readonly qv: number
  readonly overlapsNucleus: boolean | undefined
  readonly isGene: boolean | undefined
}

export interface TranscriptQueryOptions {
  readonly limit?: number
  readonly minQv?: number
}

export interface CellTranscriptZDistributionQueryOptions extends TranscriptQueryOptions {
  readonly binCount?: number
  readonly bbox?: BBox
}

export interface TranscriptViewportQueryOptions {
  readonly pointLimit?: number
  readonly groupLimit?: number
  readonly minQv?: number
  readonly geneOnly?: boolean
  readonly featureNames?: readonly string[]
}

const DEFAULT_XENIUM_UNITS: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(0.2125),
  origin: 'top-left',
  imageYAxis: 'down',
}

const openTiffLazy = async (
  url: string,
  signal?: AbortSignal,
): Promise<TiffPyramidLoader> => {
  const { openTiff } = await import('../tiff/loader')
  return openTiff(url, signal)
}

const gexFromCellFeatureMatrixZarrLazy: MatrixReader = async (url, ids) => {
  const { gexFromCellFeatureMatrixZarr } = await import('../data/gex')
  return gexFromCellFeatureMatrixZarr(url, ids)
}

const gexFromCellFeatureMatrixZarrSelectedGenesLazy: GeneExpressionMatrixReader = async (
  url,
  ids,
  genes,
  options,
) => {
  const { gexFromCellFeatureMatrixZarrSelectedGenes } = await import('../data/gex')
  return gexFromCellFeatureMatrixZarrSelectedGenes(url, ids, genes, options)
}

const gexFromTranscriptsParquetLazy: TranscriptReader = async (
  conn,
  url,
  selection,
  scope,
  cellIds,
  minQv,
) => {
  const { gexFromTranscriptsParquet } = await import('../data/gex')
  return gexFromTranscriptsParquet(conn, url, selection, scope, cellIds, minQv)
}

export class XeniumDataset implements SpatialDataset<CellId> {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly duckFactory: () => Promise<DuckDbClientLike>
  private readonly tiffOpener: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<TiffPyramidLoader>
  private readonly matrixReader: MatrixReader
  private readonly geneExpressionMatrixReader: GeneExpressionMatrixReader
  private readonly transcriptReader: TranscriptReader
  private readonly overviewReader: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
  private readonly analysisAnnotationReader: (
    analysisUrl: string,
    matrixUrl: string,
    options?: AnalysisAnnotationQueryOptions,
  ) => Promise<readonly Annotation[]>
  private duckClientPromise: Promise<DuckDbClientLike> | null = null
  private metaPromise: Promise<DatasetMeta> | null = null

  constructor(options: XeniumDatasetOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.tiffOpener = options.openTiff ?? openTiffLazy
    this.matrixReader = options.matrixReader ?? gexFromCellFeatureMatrixZarrLazy
    this.geneExpressionMatrixReader =
      options.geneExpressionMatrixReader ??
      (options.matrixReader === undefined
        ? gexFromCellFeatureMatrixZarrSelectedGenesLazy
        : (url, ids) => this.matrixReader(url, ids))
    this.transcriptReader = options.transcriptReader ?? gexFromTranscriptsParquetLazy
    this.overviewReader =
      options.overviewReader ??
      (async (url, limit) => {
        const { readCellsOverview } = await import('../data/hyparquetCells')
        return readCellsOverview({
          url,
          fetcher: this.fetcher,
          ...(limit === undefined ? {} : { limit }),
        })
      })
    this.analysisAnnotationReader =
      options.analysisAnnotationReader ??
      (async (analysisUrl, matrixUrl, annotationOptions) => {
        const { readAnalysisZarrAnnotations } =
          await import('../data/analysisAnnotations')
        return readAnalysisZarrAnnotations(analysisUrl, matrixUrl, annotationOptions)
      })
    this.duckFactory =
      options.createDuckDbClient ??
      (() => {
        if (options.duckDbClient !== undefined) {
          return Promise.resolve(options.duckDbClient)
        }

        const createDuckDbClientPromise = import('../data/duckdb').then(
          (module) => module.createDuckDbClient,
        )
        return createDuckDbClientPromise.then((createDuckDbClient) =>
          createDuckDbClient(),
        )
      })
  }

  meta(): Promise<DatasetMeta> {
    this.metaPromise ??= this.loadMeta()
    return this.metaPromise
  }

  async warm(): Promise<void> {
    await this.conn()
  }

  async elements(bbox: BBox): Promise<ElementBatch<CellId>> {
    const conn = await this.conn()
    return readXeniumBoundaryElements(
      conn,
      {
        cells: this.urlFor('cells.parquet'),
        cellBoundaries: this.urlFor('cell_boundaries.parquet'),
      },
      bbox,
    )
  }

  matrix(ids: readonly CellId[]): Promise<GexResult> {
    return this.matrixReader(this.urlFor('cell_feature_matrix.zarr.zip'), ids)
  }

  async matrixForCells(cells: readonly DatasetCell[]): Promise<GexResult> {
    return readXeniumMatrixForCells(
      cells,
      this.urlFor('cell_feature_matrix.zarr.zip'),
      this.matrixReader,
    )
  }

  async transcriptsForCellIds(
    cellIds: readonly CellId[],
    minQv = 20,
  ): Promise<GexResult> {
    const conn = await this.conn()

    return this.transcriptReader(
      conn,
      this.urlFor('transcripts.parquet'),
      {
        kind: 'circle',
        cx: micrometers(0),
        cy: micrometers(0),
        radius: micrometers(0),
      },
      'cells-only',
      cellIds,
      minQv,
    )
  }

  async transcriptsForCellId(
    cellId: CellId,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.conn()
    return readXeniumTranscriptsForCellId(
      conn,
      this.urlFor('transcripts.parquet'),
      cellId,
      options,
    )
  }

  async cellTranscriptZDistributionForCellId(
    cellId: CellId,
    options: CellTranscriptZDistributionQueryOptions = {},
  ): Promise<CellTranscriptZDistribution> {
    const conn = await this.conn()
    return readXeniumCellTranscriptZDistributionForCellId(
      conn,
      this.urlFor('transcripts.parquet'),
      cellId,
      options,
    )
  }

  overviewCells(limit?: number): Promise<readonly CellOverviewPoint[]> {
    return this.overviewReader(this.urlFor('cells.parquet'), limit)
  }

  cells(
    selectionInput: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    return this.conn().then((conn) =>
      readXeniumCellsForSelection(
        conn,
        this.urlFor('cells.parquet'),
        selectionInput,
        options,
      ),
    )
  }

  async transcriptsInBbox(
    bbox: BBox,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.conn()
    return readXeniumTranscriptsInBbox(
      conn,
      this.urlFor('transcripts.parquet'),
      bbox,
      options,
    )
  }

  async transcriptsForSelection(
    selectionInput: RoiSelectionInput,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.conn()
    return readXeniumTranscriptsForSelection(
      conn,
      this.urlFor('transcripts.parquet'),
      selectionInput,
      options,
    )
  }

  async transcriptsForViewport(
    bbox: BBox,
    options: TranscriptViewportQueryOptions = {},
  ): Promise<TranscriptViewportResult> {
    const conn = await this.conn()
    return readXeniumTranscriptsForViewport(
      conn,
      this.urlFor('transcripts.parquet'),
      bbox,
      options,
    )
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: GeneExpressionQueryOptions = {},
  ): Promise<GeneExpressionBatch> {
    const conn = await this.conn()
    return readXeniumGeneExpression({
      conn,
      cellsUrl: this.urlFor('cells.parquet'),
      matrixUrl: this.urlFor('cell_feature_matrix.zarr.zip'),
      bbox,
      genes,
      matrixReader: this.geneExpressionMatrixReader,
      queryOptions: options,
    })
  }

  annotations(
    options: AnalysisAnnotationQueryOptions = {},
  ): Promise<readonly Annotation[]> {
    return this.analysisAnnotationReader(
      this.urlFor('analysis.zarr.zip'),
      this.urlFor('cell_feature_matrix.zarr.zip'),
      options,
    )
  }

  async image(): Promise<ImageSource | null> {
    const { loadMorphologyImage } = await import('../data/morphologyImage')
    const image = await loadMorphologyImage(this.baseUrl, {
      fetcher: this.fetcher,
      openImage: this.tiffOpener,
    })

    return {
      kind: 'pyramid',
      loader: image.loader,
    }
  }

  async transcripts(
    selection: Selection,
    scope: TranscriptScope,
    minQv: number,
  ): Promise<GexResult> {
    const conn = await this.conn()
    const cellIds =
      scope === 'cells-only'
        ? await readXeniumCellIdsForSelection(
            conn,
            this.urlFor('cells.parquet'),
            selection,
          )
        : []

    return this.transcriptReader(
      conn,
      this.urlFor('transcripts.parquet'),
      selection,
      scope,
      cellIds,
      minQv,
    )
  }

  private async loadMeta(): Promise<DatasetMeta> {
    const conn = await this.conn()
    const [experiment, extent] = await Promise.all([
      readXeniumExperimentMetadata(this.fetcher, this.urlFor('experiment.xenium')),
      readXeniumExtent(conn, this.urlFor('cells.parquet')),
    ])

    return {
      platform: 'xenium',
      units: {
        ...DEFAULT_XENIUM_UNITS,
        micrometersPerPixel: micrometers(
          experiment.pixelSizeMicrometers ?? DEFAULT_XENIUM_UNITS.micrometersPerPixel,
        ),
      },
      extent,
      capabilities: {
        transcripts: true,
        cellBoundaries: true,
        pyramidImage: true,
        multiChannel: false,
      },
    }
  }

  private async conn(): Promise<XeniumDuckDbConnection> {
    this.duckClientPromise ??= this.duckFactory()
    return (await this.duckClientPromise).conn
  }

  private urlFor(path: string): string {
    return `${this.baseUrl}/${path}`
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}
