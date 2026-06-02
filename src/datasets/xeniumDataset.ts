import { asCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import {
  gexFromCellFeatureMatrixZarr,
  gexFromCellFeatureMatrixZarrSelectedGenes,
  gexFromTranscriptsParquet,
  selectionToSql,
} from '../data/gex'
import { createDuckDbClient } from '../data/duckdb'
import { readAnalysisZarrAnnotations } from '../data/analysisAnnotations'
import { readCellsOverview } from '../data/hyparquetCells'
import { loadMorphologyImage } from '../data/morphologyImage'
import { openTiff } from '../tiff/loader'
import type { CellId } from '../data/cellid'
import type { BBox, DataPoint, UnitsDescriptor } from '../data/coords'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  DuckDbPreparedStatementLike,
  GexCell,
  GexResult,
  Selection,
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

interface ViewportCell {
  readonly id: CellId
  readonly position: DataPoint
  readonly transcriptCount?: number
  readonly cellArea?: number
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

  overviewCells(limit?: number): Promise<readonly CellOverviewPoint[]> {
    return this.overviewReader(this.urlFor('cells.parquet'), limit)
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

  annotations(): Promise<readonly Annotation[]> {
    return this.analysisAnnotationReader(
      this.urlFor('analysis.zarr.zip'),
      this.urlFor('cell_feature_matrix.zarr.zip'),
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
  ): Promise<readonly ViewportCell[]> {
    const conn = await this.conn()
    const samplePredicate =
      sampleStride > 1
        ? `
  AND hash(cell_id) % ? = 0`
        : ''
    const stmt = await conn.prepare(`
SELECT cell_id,
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

function parseViewportCellRow(row: Record<string, unknown>): ViewportCell {
  const cellId = row.cell_id

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
  }
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
