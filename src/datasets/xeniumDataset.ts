import { micrometers } from '../data/coords'
import { datasetFileLabelFor, datasetFileUrlFor } from '../data/datasetFiles'
import { assertHttpRangeSupport } from '../data/rangeSupport'
import {
  normalizeRoiSelection,
  roiSelectionToSpatialSelection,
  type RoiSelectionInput,
} from '../data/roiSelection'
import {
  isMissingParquetColumnError,
  readXeniumBoundaryElements,
  readXeniumBoundaryLayout,
  readXeniumCellIdsForSelection,
  readXeniumCellOutlines,
  readXeniumCellTranscriptZDistributionForCellId,
  readXeniumCellsForSelection,
  readXeniumExperimentMetadata,
  readXeniumExtent,
  readXeniumGeneExpression,
  readXeniumMatrixForCells,
  readXeniumNucleusBoundaryElements,
  readXeniumTranscriptsForCellId,
  readXeniumTranscriptsForSelection,
  readXeniumTranscriptsForViewport,
  readXeniumTranscriptsInBbox,
  type XeniumBoundaryLayout,
  type XeniumSelectedGeneRowsReader,
} from './xeniumDatasetReaders'
import type { CellId } from '../data/cellid'
import type { DatasetFileRole } from './datasetManifest'
import type { BBox, UnitsDescriptor } from '../data/coords'
import type { AnalysisAnnotationQueryOptions } from '../data/analysisAnnotations'
import type { CellTranscriptZDistribution } from '../data/cellTranscripts'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { ImagePyramidOpener } from '../data/imagePyramid'
import type {
  CellFeatureMatrixReadOptions,
  GexResult,
  TranscriptDuckDbConnection,
} from '../data/gex'
import type { Selection, TranscriptScope } from '../data/gexSelection'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { DatasetRangeValidator } from '../data/datasetOverview'
import {
  noGeneValuesLayerMessage,
  type GeneValuesRead,
  type GeneValuesReadEstimate,
  type GeneValuesRowIds,
} from '../data/geneValues'
import type {
  CellOutlineDataset,
  CellOutlineRequest,
  DatasetCell,
  DatasetMeta,
  DatasetTranscript,
  ElementBatch,
  GeneExpressionBatch,
  GeneExpressionQueryOptions,
  ImageSource,
  SegmentationInfo,
  SpatialDataset,
  SpatialElement,
} from './spatialDataset'
import type {
  CellTranscriptZDistributionQueryOptions,
  TranscriptQueryOptions,
  TranscriptViewportQueryOptions,
  XeniumDuckDbConnection,
} from './xeniumDatasetRows'
import type { TranscriptViewportResult } from '../data/transcriptOverlay'
import { throwIfAborted } from '../utils/abort'
import type { Annotation } from '../data/annotation'

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

// The Plots panel's reads of cell_feature_matrix.zarr.zip (plan 22-A).
export interface XeniumGeneValuesReader {
  rowIds(url: string): Promise<GeneValuesRowIds>
  estimate(url: string, genes: readonly string[]): Promise<GeneValuesReadEstimate>
  values(
    url: string,
    genes: readonly string[],
    options: { readonly signal?: AbortSignal },
  ): Promise<readonly GeneValuesRead[]>
}

export interface XeniumDatasetOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly duckDbClient?: DuckDbClientLike | Promise<DuckDbClientLike>
  readonly createDuckDbClient?: () => Promise<DuckDbClientLike>
  readonly openTiff?: ImagePyramidOpener<TiffPyramidLoader>
  readonly matrixReader?: MatrixReader
  readonly geneExpressionMatrixReader?: GeneExpressionMatrixReader
  // Lists the cells expressing the selected genes; null keeps reading the
  // matrix for every cell in the box.
  readonly selectedGeneRowsReader?: XeniumSelectedGeneRowsReader | null
  readonly transcriptReader?: TranscriptReader
  readonly geneValuesReader?: XeniumGeneValuesReader
  readonly overviewReader?: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
  readonly analysisAnnotationReader?: (
    analysisUrl: string,
    matrixUrl: string,
    options?: AnalysisAnnotationQueryOptions,
  ) => Promise<readonly Annotation[]>
  // Checks nucleus_boundaries.parquet answers Range requests before it is
  // queried, so a missing file is named in the error.
  readonly validateRangeSupport?: DatasetRangeValidator
}

export interface DuckDbClientLike {
  readonly conn: XeniumDuckDbConnection
  loadSpatial(): Promise<void>
  close?(): Promise<void>
}

const DEFAULT_XENIUM_UNITS: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(0.2125),
  origin: 'top-left',
  imageYAxis: 'down',
}

const openTiffLazy: ImagePyramidOpener<TiffPyramidLoader> = async (
  url,
  signal,
  onFallback,
  options,
) => {
  const { openTiff } = await import('../tiff/loader')
  return openTiff(url, signal, onFallback, options)
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

const selectedGeneRowsFromCellFeatureMatrixZarrLazy: XeniumSelectedGeneRowsReader =
  async (url, genes, options) => {
    const { selectedGeneRowsFromCellFeatureMatrixZarr } = await import('../data/gex')
    return selectedGeneRowsFromCellFeatureMatrixZarr(url, genes, options)
  }

const geneValuesReaderLazy: XeniumGeneValuesReader = {
  rowIds: async (url) => (await import('../data/gex')).cellFeatureMatrixRowIds(url),
  estimate: async (url, genes) =>
    (await import('../data/gex')).estimateCellFeatureMatrixGeneValues(url, genes),
  values: async (url, genes, options) =>
    (await import('../data/gex')).geneValuesFromCellFeatureMatrixZarr(
      url,
      genes,
      options,
    ),
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

export class XeniumDataset implements SpatialDataset<CellId>, CellOutlineDataset {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly duckFactory: () => Promise<DuckDbClientLike>
  private readonly tiffOpener: ImagePyramidOpener<TiffPyramidLoader>
  private readonly matrixReader: MatrixReader
  private readonly geneExpressionMatrixReader: GeneExpressionMatrixReader
  private readonly selectedGeneRowsReader: XeniumSelectedGeneRowsReader | null
  private readonly transcriptReader: TranscriptReader
  private readonly geneValuesReader: XeniumGeneValuesReader
  private readonly overviewReader: (
    url: string,
    limit?: number,
  ) => Promise<readonly CellOverviewPoint[]>
  private readonly analysisAnnotationReader: (
    analysisUrl: string,
    matrixUrl: string,
    options?: AnalysisAnnotationQueryOptions,
  ) => Promise<readonly Annotation[]>
  private readonly validateRangeSupport: DatasetRangeValidator
  private readonly ownsDuckClient: boolean
  private duckClientPromise: Promise<DuckDbClientLike> | null = null
  private metaPromise: Promise<DatasetMeta> | null = null
  // Cleared when nucleus_boundaries.parquet has no label_id column.
  private nucleusLabelIds = true
  private boundaryLayoutPromise: Promise<XeniumBoundaryLayout> | null = null

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
    // Injected matrix readers stay in charge of expression unless a rows
    // reader is injected too.
    this.selectedGeneRowsReader =
      options.selectedGeneRowsReader !== undefined
        ? options.selectedGeneRowsReader
        : options.matrixReader === undefined &&
            options.geneExpressionMatrixReader === undefined
          ? selectedGeneRowsFromCellFeatureMatrixZarrLazy
          : null
    this.transcriptReader = options.transcriptReader ?? gexFromTranscriptsParquetLazy
    this.geneValuesReader = options.geneValuesReader ?? geneValuesReaderLazy
    this.validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport
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
    this.ownsDuckClient =
      options.createDuckDbClient !== undefined || options.duckDbClient === undefined
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

  // A failed read is not kept, so the next call reads again.
  meta(): Promise<DatasetMeta> {
    if (this.metaPromise === null) {
      const promise = this.loadMeta()
      this.metaPromise = promise
      promise.catch(() => {
        if (this.metaPromise === promise) {
          this.metaPromise = null
        }
      })
    }

    return this.metaPromise
  }

  // Closes the DuckDB client this dataset started, ending its worker. A
  // client passed in belongs to the caller. A later query starts another.
  dispose(): void {
    const client = this.ownsDuckClient ? this.duckClientPromise : null
    this.duckClientPromise = null
    void client?.then((started) => started.close?.()).catch(() => undefined)
  }

  async warm(): Promise<void> {
    await this.conn()
  }

  async elements(bbox: BBox): Promise<ElementBatch<CellId>> {
    const conn = await this.conn()
    return readXeniumBoundaryElements(
      conn,
      {
        cells: this.urlFor('cells'),
        cellBoundaries: this.urlFor('cellBoundaries'),
      },
      bbox,
    )
  }

  // The Cell Query pictures' outlines (plan 23-H): one query for a page of
  // cells by where cell_boundaries.parquet keeps them, and a box query for
  // each it does not find there.
  async cellOutlines(
    cells: readonly CellOutlineRequest[],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly SpatialElement[]> {
    const urls = {
      cells: this.urlFor('cells'),
      cellBoundaries: this.urlFor('cellBoundaries'),
    }
    await this.validateRangeSupport(urls.cellBoundaries, {
      label: datasetFileLabelFor(this.baseUrl, 'cellBoundaries'),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const conn = await this.conn()
    this.boundaryLayoutPromise ??= readXeniumBoundaryLayout(conn, urls).catch(
      (error: unknown) => {
        this.boundaryLayoutPromise = null
        throw error
      },
    )
    const layout = await this.boundaryLayoutPromise
    throwIfAborted(options.signal)
    const found = await readXeniumCellOutlines(conn, urls.cellBoundaries, cells, layout)
    const foundIds = new Set<string>(found.map((element) => element.id))
    const outlines: SpatialElement[] = [...found]

    for (const cell of cells) {
      if (foundIds.has(cell.id)) continue
      throwIfAborted(options.signal)
      const around = await this.elements(cell.bbox)
      const element = around.elements.find((candidate) => candidate.id === cell.id)
      if (element !== undefined) outlines.push(element)
    }

    return outlines
  }

  async segmentationElements(
    kind: 'cell' | 'nucleus',
    bbox: BBox,
  ): Promise<readonly SpatialElement[]> {
    if (kind === 'cell') {
      return (await this.elements(bbox)).elements
    }

    await this.validateRangeSupport(this.urlFor('nucleusBoundaries'), {
      label: datasetFileLabelFor(this.baseUrl, 'nucleusBoundaries'),
    })
    const conn = await this.conn()
    const urls = { nucleusBoundaries: this.urlFor('nucleusBoundaries') }

    // Queries run while an earlier one finds the column missing still ask
    // for it, so each retries on the setting it was read with.
    const labelIds = this.nucleusLabelIds

    try {
      return await readXeniumNucleusBoundaryElements(conn, urls, bbox, { labelIds })
    } catch (error) {
      if (!labelIds || !isMissingParquetColumnError(error, 'label_id')) {
        throw error
      }

      this.nucleusLabelIds = false
      return readXeniumNucleusBoundaryElements(conn, urls, bbox, { labelIds: false })
    }
  }

  matrix(ids: readonly CellId[]): Promise<GexResult> {
    return this.matrixReader(this.urlFor('cellFeatureMatrix'), ids)
  }

  async matrixForCells(cells: readonly DatasetCell[]): Promise<GexResult> {
    return readXeniumMatrixForCells(
      cells,
      this.urlFor('cellFeatureMatrix'),
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
      this.urlFor('transcripts'),
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
      this.urlFor('transcripts'),
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
      this.urlFor('transcripts'),
      cellId,
      options,
    )
  }

  overviewCells(limit?: number): Promise<readonly CellOverviewPoint[]> {
    return this.overviewReader(this.urlFor('cells'), limit)
  }

  cells(
    selectionInput: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    return this.connFor(spatialSelectionFor(selectionInput)).then((conn) =>
      readXeniumCellsForSelection(conn, this.urlFor('cells'), selectionInput, options),
    )
  }

  async transcriptsInBbox(
    bbox: BBox,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.conn()
    return readXeniumTranscriptsInBbox(conn, this.urlFor('transcripts'), bbox, options)
  }

  async transcriptsForSelection(
    selectionInput: RoiSelectionInput,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.connFor(spatialSelectionFor(selectionInput))
    return readXeniumTranscriptsForSelection(
      conn,
      this.urlFor('transcripts'),
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
      this.urlFor('transcripts'),
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
      cellsUrl: this.urlFor('cells'),
      matrixUrl: this.urlFor('cellFeatureMatrix'),
      bbox,
      genes,
      matrixReader: this.geneExpressionMatrixReader,
      ...(this.selectedGeneRowsReader === null
        ? {}
        : { selectedGeneRowsReader: this.selectedGeneRowsReader }),
      queryOptions: options,
    })
  }

  // The Plots panel reads each gene's slice of the feature-major matrix in
  // cell_feature_matrix.zarr.zip (plan 22-A). Without that file, the panel
  // says why.
  async geneValuesRowIds(): Promise<GeneValuesRowIds> {
    return this.readGeneValues(() =>
      this.geneValuesReader.rowIds(this.urlFor('cellFeatureMatrix')),
    )
  }

  async estimateGeneValuesRead(
    genes: readonly string[],
    options: { readonly layer?: string | undefined } = {},
  ): Promise<GeneValuesReadEstimate> {
    if (options.layer !== undefined) {
      return { kind: 'unavailable', reason: xeniumNoLayer(options.layer) }
    }

    return this.readGeneValues(() =>
      this.geneValuesReader.estimate(this.urlFor('cellFeatureMatrix'), genes),
    )
  }

  async geneValues(
    genes: readonly string[],
    options: {
      readonly signal?: AbortSignal | undefined
      readonly layer?: string | undefined
    } = {},
  ): Promise<readonly GeneValuesRead[]> {
    const { layer, signal } = options

    if (layer !== undefined) {
      return genes.map((gene) => ({ gene, error: xeniumNoLayer(layer) }))
    }

    return this.readGeneValues(() =>
      this.geneValuesReader.values(
        this.urlFor('cellFeatureMatrix'),
        genes,
        signal === undefined ? {} : { signal },
      ),
    )
  }

  annotations(
    options: AnalysisAnnotationQueryOptions = {},
  ): Promise<readonly Annotation[]> {
    return this.analysisAnnotationReader(
      this.urlFor('analysis'),
      this.urlFor('cellFeatureMatrix'),
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
    const conn = await this.connFor(selection)
    const cellIds =
      scope === 'cells-only'
        ? await readXeniumCellIdsForSelection(conn, this.urlFor('cells'), selection)
        : []

    return this.transcriptReader(
      conn,
      this.urlFor('transcripts'),
      selection,
      scope,
      cellIds,
      minQv,
    )
  }

  private async loadMeta(): Promise<DatasetMeta> {
    const conn = await this.conn()
    const [experiment, extent] = await Promise.all([
      readXeniumExperimentMetadata(this.fetcher, this.urlFor('experiment')),
      readXeniumExtent(conn, this.urlFor('cells')),
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
      segmentations: this.segmentations(),
    }
  }

  private segmentations(): readonly SegmentationInfo[] {
    return [
      {
        id: 'cell',
        kind: 'cell',
        label: 'Cell boundaries',
        sourceKind: 'parquet',
        path: datasetFileLabelFor(this.baseUrl, 'cellBoundaries'),
      },
      {
        id: 'nucleus',
        kind: 'nucleus',
        label: 'Nucleus boundaries',
        sourceKind: 'parquet',
        path: datasetFileLabelFor(this.baseUrl, 'nucleusBoundaries'),
      },
    ]
  }

  private async conn(): Promise<XeniumDuckDbConnection> {
    return (await this.duckClient()).conn
  }

  // Polygon queries use ST_Within, from DuckDB's spatial extension, which is
  // loaded on the first one.
  private async connFor(selection: Selection | null): Promise<XeniumDuckDbConnection> {
    const client = await this.duckClient()

    if (selection?.kind === 'polygon') {
      await client.loadSpatial()
    }

    return client.conn
  }

  // Concurrent callers share one start. A start that fails is forgotten, so
  // the next query tries again rather than repeating the failure.
  private duckClient(): Promise<DuckDbClientLike> {
    if (this.duckClientPromise === null) {
      const starting = this.duckFactory()
      this.duckClientPromise = starting
      starting.catch(() => {
        if (this.duckClientPromise === starting) this.duckClientPromise = null
      })
    }

    return this.duckClientPromise
  }

  private urlFor(role: DatasetFileRole): string {
    return datasetFileUrlFor(this.baseUrl, role)
  }

  // Names the file in a failed read, as the panel shows it.
  private async readGeneValues<Result>(read: () => Promise<Result>): Promise<Result> {
    try {
      return await read()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error

      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${datasetFileLabelFor(this.baseUrl, 'cellFeatureMatrix')} could not be read: ${message}`,
        { cause: error },
      )
    }
  }
}

function spatialSelectionFor(selectionInput: RoiSelectionInput): Selection | null {
  return roiSelectionToSpatialSelection(normalizeRoiSelection(selectionInput))
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function xeniumNoLayer(layer: string): string {
  return noGeneValuesLayerMessage('Xenium', 'cell_feature_matrix', layer)
}
