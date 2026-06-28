import { asCellId } from '../data/cellid'
import type { BBox, DataPoint } from '../data/coords'
import type { CellTranscriptZDistribution } from '../data/cellTranscripts'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import { selectionToSql, type Selection, type SqlParameter } from '../data/gexSelection'
import {
  normalizeRoiSelection,
  roiSelectionToSpatialSelection,
  type RoiSelectionInput,
} from '../data/roiSelection'
import type { TranscriptViewportResult } from '../data/transcriptOverlay'
import type { CellId } from '../data/cellid'
import type { ElementBatch } from './spatialDataset'
import type {
  CellTranscriptZDistributionQueryOptions,
  DatasetCell,
  DatasetTranscript,
  GeneExpressionBatch,
  GeneExpressionElement,
  GeneExpressionQueryOptions,
  TranscriptQueryOptions,
  TranscriptViewportQueryOptions,
  XeniumDuckDbConnection,
} from './xeniumDataset'
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

export type XeniumMatrixReader = (
  url: string,
  ids: readonly CellId[],
) => Promise<GexResult>

export type XeniumGeneExpressionMatrixReader = (
  url: string,
  ids: readonly CellId[],
  genes: readonly string[],
  options?: CellFeatureMatrixReadOptions,
) => Promise<GexResult>

const BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS = 150
const BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS = 75
const DEFAULT_TRANSCRIPT_QUERY_LIMIT = 100_000
const DEFAULT_TRANSCRIPT_Z_DISTRIBUTION_BIN_COUNT = 16

export async function readXeniumBoundaryElements(
  conn: XeniumDuckDbConnection,
  urls: {
    readonly cells: string
    readonly cellBoundaries: string
  },
  bbox: BBox,
): Promise<ElementBatch<CellId>> {
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
    urls.cells,
    centroidX0,
    centroidX1,
    centroidY0,
    centroidY1,
    urls.cellBoundaries,
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

export async function readXeniumMatrixForCells(
  cells: readonly DatasetCell[],
  matrixUrl: string,
  matrixReader: XeniumMatrixReader,
): Promise<GexResult> {
  const targets = cells.flatMap((cell) =>
    cell.cellFeatureMatrixRow === undefined
      ? []
      : [{ id: cell.id, row: cell.cellFeatureMatrixRow }],
  )

  if (targets.length !== cells.length) {
    return matrixReader(
      matrixUrl,
      cells.map((cell) => cell.id),
    )
  }

  const { gexFromCellFeatureMatrixZarrRows } = await import('../data/gex')
  return gexFromCellFeatureMatrixZarrRows(matrixUrl, targets)
}

export async function readXeniumTranscriptsForCellId(
  conn: XeniumDuckDbConnection,
  transcriptUrl: string,
  cellId: CellId,
  options: TranscriptQueryOptions = {},
): Promise<readonly DatasetTranscript[]> {
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
    transcriptUrl,
    cellId,
    options.minQv ?? 20,
    options.limit ?? 100_000,
  )

  return result.toArray().map(parseTranscriptExportRow)
}

export async function readXeniumCellTranscriptZDistributionForCellId(
  conn: XeniumDuckDbConnection,
  transcriptUrl: string,
  cellId: CellId,
  options: CellTranscriptZDistributionQueryOptions = {},
): Promise<CellTranscriptZDistribution> {
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
    transcriptUrl,
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

export async function readXeniumCellsForSelection(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  selectionInput: RoiSelectionInput,
  options: { readonly limit?: number } = {},
): Promise<readonly DatasetCell[]> {
  const selection = normalizeRoiSelection(selectionInput)
  const limit = options.limit ?? 50_000
  const spatialSelection = roiSelectionToSpatialSelection(selection)

  return spatialSelection === null
    ? readXeniumCellsInBbox(conn, cellsUrl, selection.bbox, limit)
    : readXeniumCellsInSpatialSelection(conn, cellsUrl, spatialSelection, limit)
}

export async function readXeniumTranscriptsInBbox(
  conn: XeniumDuckDbConnection,
  transcriptUrl: string,
  bbox: BBox,
  options: TranscriptQueryOptions = {},
): Promise<readonly DatasetTranscript[]> {
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
    transcriptUrl,
    bbox.minX,
    bbox.maxX,
    bbox.minY,
    bbox.maxY,
    options.minQv ?? 20,
    options.limit ?? 100_000,
  )

  return result.toArray().map(parseTranscriptExportRow)
}

export async function readXeniumTranscriptsForSelection(
  conn: XeniumDuckDbConnection,
  transcriptUrl: string,
  selectionInput: RoiSelectionInput,
  options: TranscriptQueryOptions = {},
): Promise<readonly DatasetTranscript[]> {
  const selection = normalizeRoiSelection(selectionInput)
  const spatialSelection = roiSelectionToSpatialSelection(selection)

  if (spatialSelection === null) {
    return readXeniumTranscriptsInBbox(conn, transcriptUrl, selection.bbox, options)
  }

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
    transcriptUrl,
    ...fragment.params,
    options.minQv ?? 20,
    options.limit ?? 100_000,
  )

  return result.toArray().map(parseTranscriptExportRow)
}

export async function readXeniumTranscriptsForViewport(
  conn: XeniumDuckDbConnection,
  transcriptUrl: string,
  bbox: BBox,
  options: TranscriptViewportQueryOptions = {},
): Promise<TranscriptViewportResult> {
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
    .query(transcriptUrl, ...filter.params, pointLimit + 1)
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
    .query(transcriptUrl, ...filter.params, groupLimit)
    .then((result) => result.toArray())

  return {
    points: pointRows.slice(0, pointLimit).map(parseTranscriptPointRow),
    groups: groupRows.map(parseTranscriptGroupRow),
    hitPointLimit: pointRows.length > pointLimit,
  }
}

export async function readXeniumGeneExpression(options: {
  readonly conn: XeniumDuckDbConnection
  readonly cellsUrl: string
  readonly matrixUrl: string
  readonly bbox: BBox
  readonly genes: readonly string[]
  readonly matrixReader: XeniumGeneExpressionMatrixReader
  readonly queryOptions?: GeneExpressionQueryOptions
}): Promise<GeneExpressionBatch> {
  const { conn, cellsUrl, matrixUrl, bbox, genes, matrixReader } = options
  const queryOptions = options.queryOptions ?? {}
  const totalStartedAt = Date.now()
  const selectedGenes = normalizeGeneList(genes)

  if (selectedGenes.length === 0) {
    return {
      cells: [],
      genes: [],
      maxCount: 0,
    }
  }

  const limit = queryOptions.limit ?? 5_000
  const sampleStride = normalizeSampleStride(queryOptions.sampleStride)
  throwIfAborted(queryOptions.signal)
  const viewportCellsStartedAt = Date.now()
  const viewportCells = await readXeniumCellsInBbox(
    conn,
    cellsUrl,
    bbox,
    limit,
    sampleStride,
  )
  const viewportCellsMs = elapsedMs(viewportCellsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'viewport-cells',
    label: 'Viewport cell query',
    durationMs: viewportCellsMs,
    detail: `${viewportCells.length.toLocaleString()} cells, limit ${limit.toLocaleString()}, stride ${sampleStride.toLocaleString()}`,
  })
  throwIfAborted(queryOptions.signal)

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
  const matrix = await matrixReader(
    matrixUrl,
    viewportCells.map((cell) => cell.id),
    selectedGenes,
    {
      ...(queryOptions.signal === undefined ? {} : { signal: queryOptions.signal }),
      ...(queryOptions.onStageTiming === undefined
        ? {}
        : { onStageTiming: queryOptions.onStageTiming }),
    },
  )
  const matrixReadMs = elapsedMs(matrixReadStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Expression matrix read',
    durationMs: matrixReadMs,
    detail: `${selectedGenes.length.toLocaleString()} genes, ${viewportCells.length.toLocaleString()} cells`,
  })
  throwIfAborted(queryOptions.signal)
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
  queryOptions.onStageTiming?.({
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

export async function readXeniumExperimentMetadata(
  fetcher: typeof fetch,
  experimentUrl: string,
): Promise<{ readonly pixelSizeMicrometers?: number }> {
  const response = await fetcher(experimentUrl)

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

export async function readXeniumExtent(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
): Promise<BBox> {
  const stmt = await conn.prepare(`
SELECT min(x_centroid) AS minX,
       max(x_centroid) AS maxX,
       min(y_centroid) AS minY,
       max(y_centroid) AS maxY
FROM read_parquet( ? )
`)
  const result = await stmt.query(cellsUrl)
  const first = result.toArray()[0]

  if (first === undefined) {
    throw new Error('Unable to read Xenium cells.parquet extent.')
  }

  return parseExtentRow(first)
}

export async function readXeniumCellIdsForSelection(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  selection: Selection,
): Promise<readonly CellId[]> {
  const fragment = selectionToSql(selection, 'x_centroid', 'y_centroid')
  const stmt = await conn.prepare(`
SELECT cell_id
FROM read_parquet( ? )
WHERE ${fragment.sql}
ORDER BY file_row_number
`)
  const result = await stmt.query(cellsUrl, ...fragment.params)

  return result.toArray().map((row) => {
    const value = row.cell_id

    if (typeof value !== 'string') {
      throw new Error('Expected selected cell_id to be a string.')
    }

    return asCellId(value)
  })
}

async function readXeniumCellsInBbox(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  bbox: BBox,
  limit: number,
  sampleStride = 1,
): Promise<readonly DatasetCell[]> {
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
          cellsUrl,
          bbox.minX,
          bbox.maxX,
          bbox.minY,
          bbox.maxY,
          sampleStride,
          limit,
        )
      : await stmt.query(cellsUrl, bbox.minX, bbox.maxX, bbox.minY, bbox.maxY, limit)

  return result.toArray().map(parseViewportCellRow)
}

async function readXeniumCellsInSpatialSelection(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  selection: Selection,
  limit: number,
): Promise<readonly DatasetCell[]> {
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
  const result = await stmt.query(cellsUrl, ...fragment.params, limit)

  return result.toArray().map(parseViewportCellRow)
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
