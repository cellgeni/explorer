import { asCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  gexFromCellFeatureMatrixZarr,
  gexFromCellFeatureMatrixZarrRows,
  gexFromCellFeatureMatrixZarrSelectedGenes,
  gexFromTranscriptsParquet,
  selectionToSql,
} from '../data/gex'
import { createDuckDbClient } from '../data/duckdb'
import { readAnalysisZarrAnnotations } from '../data/analysisAnnotations'
import { readCellsOverview } from '../data/hyparquetCells'
import { loadMorphologyImage } from '../data/morphologyImage'
import { openTiff } from '../tiff/loader'
import {
  normalizeRoiSelection,
  roiSelectionToSpatialSelection,
} from '../data/roiSelection'
import type { CellId } from '../data/cellid'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { RoiSelectionInput } from '../data/roiSelection'
import type { AnalysisAnnotationQueryOptions } from '../data/analysisAnnotations'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  DuckDbPreparedStatementLike,
  GexCell,
  GexResult,
  Selection,
  SqlFragment,
  SqlParameter,
  TranscriptDuckDbConnection,
  TranscriptScope,
} from '../data/gex'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
} from './spatialDataset'
import type {
  TranscriptGroupSummary,
  TranscriptPoint,
  TranscriptViewportResult,
} from '../data/transcriptOverlay'

export interface XeniumDatasetOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly duckDbClient?: DuckDbClientLike | Promise<DuckDbClientLike>
  readonly createDuckDbClient?: () => Promise<DuckDbClientLike>
  readonly openTiff?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly matrixReader?: (url: string, ids: readonly CellId[]) => Promise<GexResult>
  readonly geneExpressionMatrixReader?: (
    url: string,
    ids: readonly CellId[],
    genes: readonly string[],
  ) => Promise<GexResult>
  readonly transcriptReader?: typeof gexFromTranscriptsParquet
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

export interface GeneExpressionCell {
  readonly id: CellId
  readonly position: DataPoint
  readonly count: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
}

export interface GeneExpressionBatch {
  readonly cells: readonly GeneExpressionCell[]
  readonly genes: readonly string[]
  readonly maxCount: number
}

export interface GeneExpressionQueryOptions {
  readonly limit?: number
  readonly sampleStride?: number
  readonly signal?: AbortSignal
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

const BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS = 150
const BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS = 75

export class XeniumDataset implements SpatialDataset {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly duckFactory: () => Promise<DuckDbClientLike>
  private readonly tiffOpener: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<TiffPyramidLoader>
  private readonly matrixReader: (
    url: string,
    ids: readonly CellId[],
  ) => Promise<GexResult>
  private readonly geneExpressionMatrixReader: (
    url: string,
    ids: readonly CellId[],
    genes: readonly string[],
  ) => Promise<GexResult>
  private readonly transcriptReader: typeof gexFromTranscriptsParquet
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
    this.tiffOpener = options.openTiff ?? openTiff
    this.matrixReader = options.matrixReader ?? gexFromCellFeatureMatrixZarr
    this.geneExpressionMatrixReader =
      options.geneExpressionMatrixReader ??
      (options.matrixReader === undefined
        ? gexFromCellFeatureMatrixZarrSelectedGenes
        : (url, ids) => this.matrixReader(url, ids))
    this.transcriptReader = options.transcriptReader ?? gexFromTranscriptsParquet
    this.overviewReader =
      options.overviewReader ??
      ((url, limit) =>
        readCellsOverview({
          url,
          fetcher: this.fetcher,
          ...(limit === undefined ? {} : { limit }),
        }))
    this.analysisAnnotationReader =
      options.analysisAnnotationReader ?? readAnalysisZarrAnnotations
    this.duckFactory =
      options.createDuckDbClient ??
      (() => {
        if (options.duckDbClient !== undefined) {
          return Promise.resolve(options.duckDbClient)
        }

        return createDuckDbClient()
      })
  }

  meta(): Promise<DatasetMeta> {
    this.metaPromise ??= this.loadMeta()
    return this.metaPromise
  }

  async warm(): Promise<void> {
    await this.conn()
  }

  async elements(bbox: BBox): Promise<ElementBatch> {
    const conn = await this.conn()
    const margin = Math.max(
      (bbox.maxX - bbox.minX) * 0.05,
      BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS,
    )
    const centroidX0 = bbox.minX - BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS
    const centroidX1 = bbox.maxX + BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS
    const centroidY0 = bbox.minY - BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS
    const centroidY1 = bbox.maxY + BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS
    const vertexX0 = bbox.minX - margin
    const vertexX1 = bbox.maxX + margin
    const vertexY0 = bbox.minY - margin
    const vertexY1 = bbox.maxY + margin
    const stmt = await conn.prepare(`
WITH viewport_cells AS (
  SELECT cell_id FROM read_parquet( ? )
  WHERE x_centroid BETWEEN ? AND ?
    AND y_centroid BETWEEN ? AND ?
)
SELECT b.cell_id, b.vertex_x AS x, b.vertex_y AS y
FROM read_parquet( ? ) AS b
WHERE b.vertex_x BETWEEN ? AND ?
  AND b.vertex_y BETWEEN ? AND ?
  AND b.cell_id IN (SELECT cell_id FROM viewport_cells)
ORDER BY b.cell_id, b.file_row_number
`)
    const result = await stmt.query(
      this.urlFor('cells.parquet'),
      centroidX0,
      centroidX1,
      centroidY0,
      centroidY1,
      this.urlFor('cell_boundaries.parquet'),
      vertexX0,
      vertexX1,
      vertexY0,
      vertexY1,
    )
    const verticesByCell = new Map<CellId, DataPoint[]>()

    for (const row of result.toArray()) {
      const parsed = parseBoundaryRow(row)
      const vertices = verticesByCell.get(parsed.cellId) ?? []
      vertices.push(parsed.point)
      verticesByCell.set(parsed.cellId, vertices)
    }

    return {
      elements: [...verticesByCell.entries()]
        .filter(([, points]) => points.length >= 3)
        .map(([cellId, points]) => ({
          id: cellId,
          geometry: {
            kind: 'polygon',
            rings: [points],
          },
        })),
    }
  }

  matrix(ids: readonly CellId[]): Promise<GexResult> {
    return this.matrixReader(this.urlFor('cell_feature_matrix.zarr.zip'), ids)
  }

  matrixForCells(cells: readonly DatasetCell[]): Promise<GexResult> {
    const targets = cells.flatMap((cell) =>
      cell.cellFeatureMatrixRow === undefined
        ? []
        : [{ id: cell.id, row: cell.cellFeatureMatrixRow }],
    )

    if (targets.length !== cells.length) {
      return this.matrix(cells.map((cell) => cell.id))
    }

    return gexFromCellFeatureMatrixZarrRows(
      this.urlFor('cell_feature_matrix.zarr.zip'),
      targets,
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
    const stmt = await conn.prepare(`
SELECT cell_id,
       feature_name,
       x_location,
       y_location,
       z_location,
       qv,
       overlaps_nucleus,
       is_gene
FROM read_parquet( ? )
WHERE cell_id = ?
  AND qv >= ?
ORDER BY z_location, feature_name
LIMIT ?
`)
    const result = await stmt.query(
      this.urlFor('transcripts.parquet'),
      cellId,
      options.minQv ?? 20,
      options.limit ?? 100_000,
    )

    return result.toArray().map(parseTranscriptExportRow)
  }

  overviewCells(limit?: number): Promise<readonly CellOverviewPoint[]> {
    return this.overviewReader(this.urlFor('cells.parquet'), limit)
  }

  cells(
    selectionInput: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const selection = normalizeRoiSelection(selectionInput)
    const limit = options.limit ?? 50_000
    const spatialSelection = roiSelectionToSpatialSelection(selection)

    return spatialSelection === null
      ? this.cellsForBbox(selection.bbox, limit)
      : this.cellsForSpatialSelection(spatialSelection, limit)
  }

  async transcriptsInBbox(
    bbox: BBox,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const conn = await this.conn()
    const stmt = await conn.prepare(`
SELECT cell_id,
       feature_name,
       x_location,
       y_location,
       z_location,
       qv,
       overlaps_nucleus,
       is_gene
FROM read_parquet( ? )
WHERE x_location BETWEEN ? AND ?
  AND y_location BETWEEN ? AND ?
  AND qv >= ?
ORDER BY cell_id, feature_name
LIMIT ?
`)
    const result = await stmt.query(
      this.urlFor('transcripts.parquet'),
      bbox.minX,
      bbox.maxX,
      bbox.minY,
      bbox.maxY,
      options.minQv ?? 20,
      options.limit ?? 100_000,
    )

    return result.toArray().map(parseTranscriptExportRow)
  }

  async transcriptsForSelection(
    selectionInput: RoiSelectionInput,
    options: TranscriptQueryOptions = {},
  ): Promise<readonly DatasetTranscript[]> {
    const selection = normalizeRoiSelection(selectionInput)
    const spatialSelection = roiSelectionToSpatialSelection(selection)

    if (spatialSelection === null) {
      return this.transcriptsInBbox(selection.bbox, options)
    }

    const conn = await this.conn()
    const fragment = selectionToSql(spatialSelection, 'x_location', 'y_location')
    const stmt = await conn.prepare(`
SELECT cell_id,
       feature_name,
       x_location,
       y_location,
       z_location,
       qv,
       overlaps_nucleus,
       is_gene
FROM read_parquet( ? )
WHERE ${fragment.sql}
  AND qv >= ?
ORDER BY cell_id, feature_name
LIMIT ?
`)
    const result = await stmt.query(
      this.urlFor('transcripts.parquet'),
      ...fragment.params,
      options.minQv ?? 20,
      options.limit ?? 100_000,
    )

    return result.toArray().map(parseTranscriptExportRow)
  }

  async transcriptsForViewport(
    bbox: BBox,
    options: TranscriptViewportQueryOptions = {},
  ): Promise<TranscriptViewportResult> {
    const conn = await this.conn()
    const pointLimit = Math.max(1, Math.floor(options.pointLimit ?? 50_000))
    const groupLimit = Math.max(1, Math.floor(options.groupLimit ?? 18))
    const filter = transcriptViewportFilterSql(bbox, options)
    const pointStmt = await conn.prepare(`
SELECT transcript_id,
       cell_id,
       feature_name,
       x_location,
       y_location,
       z_location,
       qv,
       fov_name,
       overlaps_nucleus,
       nucleus_distance,
       is_gene
FROM read_parquet( ? )
WHERE ${filter.sql}
LIMIT ?
`)
    const pointRows = await pointStmt
      .query(this.urlFor('transcripts.parquet'), ...filter.params, pointLimit + 1)
      .then((result) => result.toArray())
    const groupStmt = await conn.prepare(`
SELECT feature_name,
       fov_name,
       COUNT(*) AS count,
       AVG(qv) AS mean_qv
FROM read_parquet( ? )
WHERE ${filter.sql}
GROUP BY feature_name, fov_name
ORDER BY count DESC
LIMIT ?
`)
    const groupRows = await groupStmt
      .query(this.urlFor('transcripts.parquet'), ...filter.params, groupLimit)
      .then((result) => result.toArray())

    return {
      points: pointRows.slice(0, pointLimit).map(parseTranscriptPointRow),
      groups: groupRows.map(parseTranscriptGroupRow),
      hitPointLimit: pointRows.length > pointLimit,
    }
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: GeneExpressionQueryOptions = {},
  ): Promise<GeneExpressionBatch> {
    const selectedGenes = normalizeGeneList(genes)

    if (selectedGenes.length === 0) {
      return {
        cells: [],
        genes: [],
        maxCount: 0,
      }
    }

    const limit = options.limit ?? 5_000
    const sampleStride = normalizeSampleStride(options.sampleStride)
    throwIfAborted(options.signal)
    const viewportCells = await this.cellsForBbox(bbox, limit, sampleStride)
    throwIfAborted(options.signal)

    if (viewportCells.length === 0) {
      return {
        cells: [],
        genes: selectedGenes,
        maxCount: 0,
      }
    }

    const matrix = await this.geneExpressionMatrixReader(
      this.urlFor('cell_feature_matrix.zarr.zip'),
      viewportCells.map((cell) => cell.id),
      selectedGenes,
    )
    throwIfAborted(options.signal)
    const selectedGeneSet = new Set(selectedGenes)
    const cells: GeneExpressionCell[] = []
    let maxCount = 0

    for (const cell of viewportCells) {
      const expression = matrix.cells.get(cell.id)

      if (expression === undefined) {
        continue
      }

      const count = selectedGeneCount(expression, selectedGeneSet)

      if (count <= 0) {
        continue
      }

      cells.push({
        ...cell,
        count,
      })
      maxCount = Math.max(maxCount, count)
    }

    return {
      cells,
      genes: selectedGenes,
      maxCount,
    }
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
      scope === 'cells-only' ? await this.cellIdsForSelection(selection) : []

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
    const [experiment, extent] = await Promise.all([
      this.readExperimentMetadata(),
      this.loadExtent(),
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

  private async readExperimentMetadata(): Promise<{ pixelSizeMicrometers?: number }> {
    const response = await this.fetcher(this.urlFor('experiment.xenium'))

    if (!response.ok) {
      return {}
    }

    const json = (await response.json()) as unknown
    const payload = readObjectProperty(json, 'payload') ?? json

    if (!isRecord(payload)) {
      return {}
    }

    const pixelSize = findNumericProperty(payload, [
      'pixel_size',
      'pixel_size_um',
      'pixel_size_microns',
      'microns_per_pixel',
      'micrometers_per_pixel',
    ])

    return pixelSize === undefined ? {} : { pixelSizeMicrometers: pixelSize }
  }

  private async loadExtent(): Promise<BBox> {
    const conn = await this.conn()
    const stmt = await conn.prepare(`
SELECT min(x_centroid) AS minX,
       max(x_centroid) AS maxX,
       min(y_centroid) AS minY,
       max(y_centroid) AS maxY
FROM read_parquet( ? )
`)
    const result = await stmt.query(this.urlFor('cells.parquet'))
    const first = result.toArray()[0]

    if (first === undefined) {
      throw new Error('Unable to read Xenium cells.parquet extent.')
    }

    return parseExtentRow(first)
  }

  private async cellIdsForSelection(selection: Selection): Promise<readonly CellId[]> {
    const conn = await this.conn()
    const fragment = selectionToSql(selection, 'x_centroid', 'y_centroid')
    const stmt = await conn.prepare(`
SELECT cell_id
FROM read_parquet( ? )
WHERE ${fragment.sql}
ORDER BY file_row_number
`)
    const result = await stmt.query(this.urlFor('cells.parquet'), ...fragment.params)

    return result.toArray().map((row) => {
      const value = row.cell_id

      if (typeof value !== 'string') {
        throw new Error('Expected selected cell_id to be a string.')
      }

      return asCellId(value)
    })
  }

  private async cellsForBbox(
    bbox: BBox,
    limit: number,
    sampleStride = 1,
  ): Promise<readonly DatasetCell[]> {
    const conn = await this.conn()
    const samplePredicate =
      sampleStride > 1
        ? `
  AND hash(cell_id) % ? = 0`
        : ''
    const stmt = await conn.prepare(`
SELECT cell_id,
       file_row_number AS cell_feature_matrix_row,
       x_centroid,
       y_centroid,
       transcript_counts,
       cell_area
FROM read_parquet( ? )
WHERE x_centroid BETWEEN ? AND ?
  AND y_centroid BETWEEN ? AND ?
${samplePredicate}
ORDER BY file_row_number
LIMIT ?
`)
    const result =
      sampleStride > 1
        ? await stmt.query(
            this.urlFor('cells.parquet'),
            bbox.minX,
            bbox.maxX,
            bbox.minY,
            bbox.maxY,
            sampleStride,
            limit,
          )
        : await stmt.query(
            this.urlFor('cells.parquet'),
            bbox.minX,
            bbox.maxX,
            bbox.minY,
            bbox.maxY,
            limit,
          )

    return result.toArray().map(parseViewportCellRow)
  }

  private async cellsForSpatialSelection(
    selection: Selection,
    limit: number,
  ): Promise<readonly DatasetCell[]> {
    const conn = await this.conn()
    const fragment = selectionToSql(selection, 'x_centroid', 'y_centroid')
    const stmt = await conn.prepare(`
SELECT cell_id,
       file_row_number AS cell_feature_matrix_row,
       x_centroid,
       y_centroid,
       transcript_counts,
       cell_area
FROM read_parquet( ? )
WHERE ${fragment.sql}
ORDER BY file_row_number
LIMIT ?
`)
    const result = await stmt.query(
      this.urlFor('cells.parquet'),
      ...fragment.params,
      limit,
    )

    return result.toArray().map(parseViewportCellRow)
  }

  private async conn(): Promise<XeniumDuckDbConnection> {
    this.duckClientPromise ??= this.duckFactory()
    return (await this.duckClientPromise).conn
  }

  private urlFor(path: string): string {
    return `${this.baseUrl}/${path}`
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Xenium dataset request aborted.')
  error.name = 'AbortError'
  return error
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function normalizeSampleStride(sampleStride: number | undefined): number {
  if (sampleStride === undefined || !Number.isFinite(sampleStride)) {
    return 1
  }

  return Math.max(1, Math.floor(sampleStride))
}

function parseExtentRow(row: Record<string, unknown>): BBox {
  return {
    minX: micrometers(readNumericRowValue(row, 'minX')),
    maxX: micrometers(readNumericRowValue(row, 'maxX')),
    minY: micrometers(readNumericRowValue(row, 'minY')),
    maxY: micrometers(readNumericRowValue(row, 'maxY')),
  }
}

function parseBoundaryRow(row: Record<string, unknown>): {
  readonly cellId: CellId
  readonly point: DataPoint
} {
  const cellId = row.cell_id

  if (typeof cellId !== 'string') {
    throw new Error('Expected boundary row cell_id to be a string.')
  }

  return {
    cellId: asCellId(cellId),
    point: {
      x: micrometers(readNumericRowValue(row, 'x')),
      y: micrometers(readNumericRowValue(row, 'y')),
    },
  }
}

function parseViewportCellRow(row: Record<string, unknown>): DatasetCell {
  const cellId = row.cell_id
  const cellFeatureMatrixRow = readOptionalIntegerRowValue(row, 'cell_feature_matrix_row')

  if (typeof cellId !== 'string') {
    throw new Error('Expected viewport cell row cell_id to be a string.')
  }

  return {
    id: asCellId(cellId),
    position: {
      x: micrometers(readNumericRowValue(row, 'x_centroid')),
      y: micrometers(readNumericRowValue(row, 'y_centroid')),
    },
    transcriptCount: readNumericRowValue(row, 'transcript_counts'),
    cellArea: readNumericRowValue(row, 'cell_area'),
    ...readOptionalDatasetCellNumericProperty(row, 'nucleus_count'),
    ...readOptionalDatasetCellStringProperty(row, 'segmentation_method'),
    ...(cellFeatureMatrixRow === undefined ? {} : { cellFeatureMatrixRow }),
  }
}

function readOptionalDatasetCellNumericProperty(
  row: Record<string, unknown>,
  rowKey: string,
): Pick<DatasetCell, 'nucleusCount'> | Record<string, never> {
  const value = readOptionalNumericRowValue(row, rowKey)

  return value === undefined ? {} : { nucleusCount: value }
}

function readOptionalDatasetCellStringProperty(
  row: Record<string, unknown>,
  rowKey: string,
): Pick<DatasetCell, 'segmentationMethod'> | Record<string, never> {
  const value = row[rowKey]

  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value === 'string') {
    return { segmentationMethod: value }
  }

  throw new Error(`Expected row.${rowKey} to be a string.`)
}

function parseTranscriptExportRow(row: Record<string, unknown>): DatasetTranscript {
  const cellId = row.cell_id
  const featureName = row.feature_name

  if (cellId !== null && cellId !== undefined && typeof cellId !== 'string') {
    throw new Error('Expected transcript row cell_id to be a string or null.')
  }

  if (typeof featureName !== 'string') {
    throw new Error('Expected transcript row feature_name to be a string.')
  }

  return {
    cellId: cellId === null || cellId === undefined ? null : asCellId(cellId),
    featureName,
    position: {
      x: micrometers(readNumericRowValue(row, 'x_location')),
      y: micrometers(readNumericRowValue(row, 'y_location')),
    },
    zLocation: readOptionalNumericRowValue(row, 'z_location'),
    qv: readNumericRowValue(row, 'qv'),
    overlapsNucleus: readOptionalBooleanRowValue(row, 'overlaps_nucleus'),
    isGene: readOptionalBooleanRowValue(row, 'is_gene'),
  }
}

function parseTranscriptPointRow(row: Record<string, unknown>): TranscriptPoint {
  const transcriptId = row.transcript_id
  const cellId = row.cell_id
  const featureName = row.feature_name
  const fovName = row.fov_name

  if (
    typeof transcriptId !== 'string' &&
    typeof transcriptId !== 'number' &&
    typeof transcriptId !== 'bigint'
  ) {
    throw new Error('Expected transcript point row transcript_id to be scalar.')
  }

  if (cellId !== null && cellId !== undefined && typeof cellId !== 'string') {
    throw new Error('Expected transcript point row cell_id to be a string or null.')
  }

  if (typeof featureName !== 'string') {
    throw new Error('Expected transcript point row feature_name to be a string.')
  }

  if (fovName !== null && fovName !== undefined && typeof fovName !== 'string') {
    throw new Error('Expected transcript point row fov_name to be a string or null.')
  }

  return {
    id: String(transcriptId),
    transcriptId: String(transcriptId),
    cellId: cellId === null || cellId === undefined ? null : asCellId(cellId),
    cellAssignment: cellId === null || cellId === undefined ? 'unassigned' : 'known',
    featureName,
    fovName: fovName ?? null,
    position: {
      x: micrometers(readNumericRowValue(row, 'x_location')),
      y: micrometers(readNumericRowValue(row, 'y_location')),
    },
    qv: readNumericRowValue(row, 'qv'),
    ...optionalTranscriptNumber(
      'zLocation',
      readOptionalNumericRowValue(row, 'z_location'),
    ),
    ...optionalTranscriptBoolean(
      'overlapsNucleus',
      readOptionalBooleanRowValue(row, 'overlaps_nucleus'),
    ),
    ...optionalTranscriptNumber(
      'nucleusDistance',
      readOptionalNumericRowValue(row, 'nucleus_distance'),
    ),
    ...optionalTranscriptBoolean('isGene', readOptionalBooleanRowValue(row, 'is_gene')),
  }
}

function parseTranscriptGroupRow(row: Record<string, unknown>): TranscriptGroupSummary {
  const featureName = row.feature_name
  const fovName = row.fov_name

  if (typeof featureName !== 'string') {
    throw new Error('Expected transcript group row feature_name to be a string.')
  }

  if (fovName !== null && fovName !== undefined && typeof fovName !== 'string') {
    throw new Error('Expected transcript group row fov_name to be a string or null.')
  }

  return {
    featureName,
    fovName: fovName ?? null,
    count: readNumericRowValue(row, 'count'),
    ...optionalTranscriptGroupNumber(
      'meanQv',
      readOptionalNumericRowValue(row, 'mean_qv'),
    ),
  }
}

function transcriptViewportFilterSql(
  bbox: BBox,
  options: TranscriptViewportQueryOptions,
): SqlFragment {
  const clauses = ['x_location BETWEEN ? AND ?', 'y_location BETWEEN ? AND ?', 'qv >= ?']
  const params: SqlParameter[] = [
    bbox.minX,
    bbox.maxX,
    bbox.minY,
    bbox.maxY,
    options.minQv ?? 20,
  ]

  if (options.geneOnly ?? true) {
    clauses.push('is_gene = true')
  }

  const featureNames = normalizeGeneList(options.featureNames ?? [])

  if (featureNames.length > 0) {
    clauses.push(`feature_name IN (${featureNames.map(() => '?').join(', ')})`)
    params.push(...featureNames)
  }

  return {
    sql: clauses.join('\n  AND '),
    params,
  }
}

function optionalTranscriptNumber(
  key: 'zLocation' | 'nucleusDistance',
  value: number | undefined,
): Pick<TranscriptPoint, typeof key> | Record<string, never> {
  return value === undefined ? {} : { [key]: value }
}

function optionalTranscriptBoolean(
  key: 'overlapsNucleus' | 'isGene',
  value: boolean | undefined,
): Pick<TranscriptPoint, typeof key> | Record<string, never> {
  return value === undefined ? {} : { [key]: value }
}

function optionalTranscriptGroupNumber(
  key: 'meanQv',
  value: number | undefined,
): Pick<TranscriptGroupSummary, typeof key> | Record<string, never> {
  return value === undefined ? {} : { [key]: value }
}

function selectedGeneCount(cell: GexCell, selectedGeneSet: ReadonlySet<string>): number {
  let count = 0

  for (let index = 0; index < cell.geneNames.length; index += 1) {
    const gene = cell.geneNames[index]
    const geneCount = cell.counts[index]

    if (gene !== undefined && geneCount !== undefined && selectedGeneSet.has(gene)) {
      count += geneCount
    }
  }

  return count
}

function normalizeGeneList(genes: readonly string[]): readonly string[] {
  const uniqueGenes = new Set<string>()

  for (const gene of genes) {
    const normalized = gene.trim()

    if (normalized.length > 0) {
      uniqueGenes.add(normalized)
    }
  }

  return [...uniqueGenes].sort((a, b) => a.localeCompare(b))
}

function readNumericRowValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  throw new Error(`Expected row.${key} to be numeric.`)
}

function readOptionalNumericRowValue(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key]

  if (value === null || value === undefined) {
    return undefined
  }

  return readNumericRowValue(row, key)
}

function readOptionalIntegerRowValue(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = readOptionalNumericRowValue(row, key)

  return value === undefined ? undefined : Math.floor(value)
}

function readOptionalBooleanRowValue(
  row: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = row[key]

  if (value === null || value === undefined) {
    return undefined
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'bigint') {
    return value !== 0n
  }

  throw new Error(`Expected row.${key} to be boolean.`)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function readObjectProperty(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return isRecord(property) ? property : undefined
}

function findNumericProperty(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const property = value[key]

    if (typeof property === 'number') {
      return property
    }

    if (isRecord(property)) {
      const nested = findNumericProperty(property, keys)

      if (nested !== undefined) {
        return nested
      }
    }
  }

  for (const property of Object.values(value)) {
    if (!isRecord(property)) {
      continue
    }

    const nested = findNumericProperty(property, keys)

    if (nested !== undefined) {
      return nested
    }
  }

  return undefined
}
