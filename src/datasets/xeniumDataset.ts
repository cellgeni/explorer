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
import {
  findNumericProperty,
  isRecord,
  normalizeGeneList,
  normalizeMinQv,
  normalizePositiveInteger,
  normalizeSampleStride,
  parseBoundaryRow,
  parseCellTranscriptZDistributionRows,
  parseExtentRow,
  parseTranscriptExportRow,
  parseTranscriptGroupRow,
  parseTranscriptPointRow,
  parseViewportCellRow,
  readObjectProperty,
  selectedGeneCount,
  selectedGeneCounts,
  transcriptViewportFilterSql,
} from './xeniumDatasetRows'
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
  Selection,
  SqlParameter,
  TranscriptDuckDbConnection,
  TranscriptScope,
} from '../data/gex'
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
import type {
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
    options?: CellFeatureMatrixReadOptions,
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

export interface GeneExpressionElement {
  readonly id: string
  readonly position: DataPoint
  readonly count: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
}

export type GeneExpressionCell = GeneExpressionElement

export interface GeneExpressionGeneCount {
  readonly gene: string
  readonly count: number
}

export interface GeneExpressionBatch {
  readonly cells: readonly GeneExpressionElement[]
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

const BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS = 150
const BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS = 75
const DEFAULT_TRANSCRIPT_QUERY_LIMIT = 100_000
const DEFAULT_TRANSCRIPT_Z_DISTRIBUTION_BIN_COUNT = 16

export class XeniumDataset implements SpatialDataset<CellId> {
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
    options?: CellFeatureMatrixReadOptions,
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

  async elements(bbox: BBox): Promise<ElementBatch<CellId>> {
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

  async cellTranscriptZDistributionForCellId(
    cellId: CellId,
    options: CellTranscriptZDistributionQueryOptions = {},
  ): Promise<CellTranscriptZDistribution> {
    const conn = await this.conn()
    const limit = normalizePositiveInteger(options.limit, DEFAULT_TRANSCRIPT_QUERY_LIMIT)
    const minQv = normalizeMinQv(options.minQv)
    const binCount = normalizePositiveInteger(
      options.binCount,
      DEFAULT_TRANSCRIPT_Z_DISTRIBUTION_BIN_COUNT,
    )
    const bboxFilter =
      options.bbox === undefined
        ? ''
        : `
    AND x_location BETWEEN ? AND ?
    AND y_location BETWEEN ? AND ?`
    const bboxParams: SqlParameter[] =
      options.bbox === undefined
        ? []
        : [options.bbox.minX, options.bbox.maxX, options.bbox.minY, options.bbox.maxY]
    const stmt = await conn.prepare(`
WITH selected AS (
  SELECT z_location
  FROM read_parquet( ? )
  WHERE cell_id = ?
    AND qv >= ?
${bboxFilter}
  LIMIT ?
),
stats AS (
  SELECT COUNT(*) AS transcript_count,
         COUNT(z_location) AS z_count,
         COUNT(*) - COUNT(z_location) AS missing_z_count,
         MIN(z_location) AS min_z,
         MAX(z_location) AS max_z
  FROM selected
),
binned AS (
  SELECT CASE
           WHEN stats.min_z = stats.max_z THEN 0
           ELSE LEAST(
             ? - 1,
             GREATEST(
               0,
               CAST(
                 FLOOR(
                   ((selected.z_location - stats.min_z) * ?) /
                   NULLIF(stats.max_z - stats.min_z, 0)
                 ) AS INTEGER
               )
             )
           )
         END AS bin_index,
         COUNT(*) AS bin_count
  FROM selected
  CROSS JOIN stats
  WHERE selected.z_location IS NOT NULL
    AND stats.z_count > 0
  GROUP BY bin_index
)
SELECT stats.transcript_count,
       stats.z_count,
       stats.missing_z_count,
       stats.min_z,
       stats.max_z,
       binned.bin_index,
       binned.bin_count
FROM stats
LEFT JOIN binned ON true
ORDER BY binned.bin_index
`)
    const result = await stmt.query(
      this.urlFor('transcripts.parquet'),
      cellId,
      minQv,
      ...bboxParams,
      limit,
      binCount,
      binCount,
    )

    return parseCellTranscriptZDistributionRows(result.toArray(), {
      limit,
      minQv,
      binCount,
    })
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
    const totalStartedAt = Date.now()
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
    const viewportCellsStartedAt = Date.now()
    const viewportCells = await this.cellsForBbox(bbox, limit, sampleStride)
    const viewportCellsMs = elapsedMs(viewportCellsStartedAt)
    options.onStageTiming?.({
      stage: 'viewport-cells',
      label: 'Viewport cell query',
      durationMs: viewportCellsMs,
      detail: `${viewportCells.length.toLocaleString()} cells, limit ${limit.toLocaleString()}, stride ${sampleStride.toLocaleString()}`,
    })
    throwIfAborted(options.signal)

    if (viewportCells.length === 0) {
      return {
        cells: [],
        genes: selectedGenes,
        maxCount: 0,
        timing: {
          viewportCellsMs,
          matrixReadMs: 0,
          scoreCellsMs: 0,
          totalMs: elapsedMs(totalStartedAt),
        },
      }
    }

    const matrixReadStartedAt = Date.now()
    const matrix = await this.geneExpressionMatrixReader(
      this.urlFor('cell_feature_matrix.zarr.zip'),
      viewportCells.map((cell) => cell.id),
      selectedGenes,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onStageTiming === undefined
          ? {}
          : { onStageTiming: options.onStageTiming }),
      },
    )
    const matrixReadMs = elapsedMs(matrixReadStartedAt)
    options.onStageTiming?.({
      stage: 'matrix-read',
      label: 'Expression matrix read',
      durationMs: matrixReadMs,
      detail: `${selectedGenes.length.toLocaleString()} genes, ${viewportCells.length.toLocaleString()} cells`,
    })
    throwIfAborted(options.signal)
    const scoreCellsStartedAt = Date.now()
    const selectedGeneSet = new Set(selectedGenes)
    const geneCounts = selectedGeneCounts(matrix, selectedGenes)
    const cells: GeneExpressionElement[] = []
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
    const scoreCellsMs = elapsedMs(scoreCellsStartedAt)
    options.onStageTiming?.({
      stage: 'score-cells',
      label: 'Expression scoring',
      durationMs: scoreCellsMs,
      detail: `${cells.length.toLocaleString()} positive cells`,
    })

    return {
      cells,
      genes: selectedGenes,
      geneCounts,
      maxCount,
      timing: {
        viewportCellsMs,
        matrixReadMs,
        scoreCellsMs,
        totalMs: elapsedMs(totalStartedAt),
      },
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

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
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
