import { asCellId } from '../data/cellid'
import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type { CellTranscriptZDistribution } from '../data/cellTranscripts'
import type {
  ArrowTableLike,
  CellFeatureMatrixReadOptions,
  GexResult,
  SelectedGeneMatrixRows,
} from '../data/gex'
import {
  betweenSql,
  selectionToSql,
  type Selection,
  type SqlParameter,
} from '../data/gexSelection'
import {
  normalizeRoiSelection,
  roiSelectionToSpatialSelection,
  type RoiSelectionInput,
} from '../data/roiSelection'
import type { TranscriptViewportResult } from '../data/transcriptOverlay'
import type { CellId } from '../data/cellid'
import type {
  CellOutlineRequest,
  ElementBatch,
  GeneExpressionBatch,
  GeneExpressionElement,
  GeneExpressionQueryOptions,
  SpatialElement,
  DatasetCell,
  DatasetTranscript,
} from './spatialDataset'
import {
  findNumericProperty,
  isRecord,
  normalizeGeneList,
  normalizeMinQv,
  normalizePositiveInteger,
  parseBoundaryRingRow,
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
  type CellTranscriptZDistributionQueryOptions,
  type TranscriptQueryOptions,
  type TranscriptViewportQueryOptions,
  type XeniumDuckDbConnection,
} from './xeniumDatasetRows'
import { throwIfAborted } from '../utils/abort'

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

export type XeniumSelectedGeneRowsReader = (
  url: string,
  genes: readonly string[],
  options?: CellFeatureMatrixReadOptions,
) => Promise<SelectedGeneMatrixRows | null>

const BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS = 150
const ROW_ALIGNMENT_SAMPLE_COUNT = 5
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
  const rows = await queryXeniumBoundaryRings(
    conn,
    urls.cells,
    urls.cellBoundaries,
    bbox,
    { labelIds: false },
  )

  return {
    elements: rows
      .map(parseBoundaryRingRow)
      .filter(({ points }) => points.length >= 3)
      .map(({ cellId, points }) => ({
        id: cellId,
        geometry: {
          kind: 'polygon',
          rings: [points],
        },
      })),
  }
}

// cell_boundaries.parquet keeps each cell's vertices together, in the order
// of cells.parquet, so a cell's vertices start near its row times the
// vertices per cell. On the Xenium demo (1,414,155 cells, 25 vertices each
// but for a few) the start was at most 27,352 rows short of that; this many
// rows either side covers a file whose cells vary more.
const OUTLINE_ROW_WINDOW_MIN = 30_000
const OUTLINE_ROW_WINDOW_FRACTION = 0.002

export interface XeniumBoundaryLayout {
  readonly cellRows: number
  readonly vertexRows: number
}

export async function readXeniumBoundaryLayout(
  conn: XeniumDuckDbConnection,
  urls: { readonly cells: string; readonly cellBoundaries: string },
): Promise<XeniumBoundaryLayout> {
  // Both counts come from the files' footers.
  const stmt = await conn.prepare(`
SELECT
  (SELECT count(*) FROM read_parquet( ? )) AS cell_rows,
  (SELECT count(*) FROM read_parquet( ? )) AS vertex_rows
`)
  const result = await stmt.query(urls.cells, urls.cellBoundaries)
  const row = result.toArray()[0] ?? {}

  return {
    cellRows: Number(row.cell_rows),
    vertexRows: Number(row.vertex_rows),
  }
}

// The outlines of given cells (plan 23-H), each read from the rows around
// where its vertices should start: DuckDB skips the row groups outside them,
// so a cell costs one row group rather than every group its box overlaps
// (27-83 ms against about 450 ms on the demo). A cell not found there is
// left out, for the caller to read by its box.
export async function readXeniumCellOutlines(
  conn: XeniumDuckDbConnection,
  url: string,
  cells: readonly CellOutlineRequest[],
  layout: XeniumBoundaryLayout,
): Promise<readonly SpatialElement[]> {
  if (cells.length === 0 || !(layout.cellRows > 0) || !(layout.vertexRows > 0)) {
    return []
  }

  const perCell = layout.vertexRows / layout.cellRows
  const window = Math.max(
    OUTLINE_ROW_WINDOW_MIN,
    Math.ceil(layout.vertexRows * OUTLINE_ROW_WINDOW_FRACTION),
  )
  const parameters: SqlParameter[] = []
  const branches = cells.map((cell) => {
    const start = Math.round(cell.overviewRow * perCell)
    parameters.push(url, Math.max(0, start - window), start + window, cell.id)
    // A number parameter binds as DOUBLE, and a cast column skips no row
    // groups (see betweenSql), so the bounds are cast to the column's type.
    return `SELECT cell_id, vertex_x AS x, vertex_y AS y, file_row_number
FROM read_parquet( ?, file_row_number = true )
WHERE file_row_number BETWEEN CAST(? AS BIGINT) AND CAST(? AS BIGINT)
  AND cell_id = ?`
  })
  const stmt = await conn.prepare(`
${branches.join('\nUNION ALL\n')}
ORDER BY cell_id, file_row_number
`)
  const result = await stmt.query(...parameters)
  const verticesByCell = new Map<CellId, DataPoint[]>()

  for (const row of result.toArray()) {
    const parsed = parseBoundaryRow(row)
    const vertices = verticesByCell.get(parsed.cellId) ?? []
    vertices.push(parsed.point)
    verticesByCell.set(parsed.cellId, vertices)
  }

  return [...verticesByCell.entries()]
    .filter(([, points]) => points.length >= 3)
    .map(([cellId, points]) => ({
      id: cellId,
      geometry: { kind: 'polygon', rings: [points] },
    }))
}

// Nuclei in the box, from nucleus_boundaries.parquet. A cell can have several
// nuclei, told apart by label_id: the first keeps the cell ID and later ones
// get `<cell_id>#nucleus-N`, as on Atera. Without label IDs (files that lack
// the column) each cell's vertices form one nucleus.
//
// Nuclei are picked by their own vertices, not by their cells' centroids, so
// the query reads nucleus_boundaries.parquet alone, not cells.parquet too.
export async function readXeniumNucleusBoundaryElements(
  conn: XeniumDuckDbConnection,
  urls: {
    readonly nucleusBoundaries: string
  },
  bbox: BBox,
  options: { readonly labelIds: boolean },
): Promise<readonly SpatialElement[]> {
  // A row per nucleus: by cell and label, in that order.
  const rows = await queryXeniumBoundaryRings(
    conn,
    null,
    urls.nucleusBoundaries,
    bbox,
    options,
  )
  const nucleusCountByCell = new Map<CellId, number>()
  const nuclei = rows.map((row) => {
    const parsed = parseBoundaryRingRow(row)
    const occurrence = (nucleusCountByCell.get(parsed.cellId) ?? 0) + 1
    nucleusCountByCell.set(parsed.cellId, occurrence)

    return {
      id: occurrence === 1 ? parsed.cellId : `${parsed.cellId}#nucleus-${occurrence}`,
      cellId: parsed.cellId,
      points: parsed.points,
    }
  })

  return nuclei
    .filter(({ points }) => points.length >= 3)
    .map(({ id, cellId, points }) => ({
      id,
      geometry: {
        kind: 'polygon',
        rings: [points],
      },
      metadata: { segmentation: { kind: 'nucleus', cellId } },
    }))
}

// DuckDB names the column in its error when a file lacks it.
export function isMissingParquetColumnError(error: unknown, column: string): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return message.includes('column') && message.includes(column.toLowerCase())
}

// The outlines in the box, from a cell_boundaries.parquet-shaped file: a row
// per cell (and label), its vertices gathered into lists in file order.
// DuckDB gathers them in its worker; a row per vertex, about a million for a
// view of 40,000 cells, took a second to turn into objects on the main thread
// (S4 in the optimization pass).
//
// With cellsUrl, the outlines are those of the cells whose centroids in that
// file fall in the box, padded. Without it, an outline is kept when the mean
// of its vertices does. Vertices are read at least 75 µm further out than
// that, so no outline kept is one cut short at the edge of the read.
//
// Each outline's vertices are gathered as {r, x, y} structs and sorted by
// file row, r. `list(vertex_x ORDER BY file_row_number)` gave the same lists,
// but as an ordered aggregate it took about 40 KB an outline of 25 vertices:
// 65,000 outlines fitted in DuckDB-WASM's 3.1 GiB, and 73,000 did not. The
// sorted lists need a tenth of that or less.
async function queryXeniumBoundaryRings(
  conn: XeniumDuckDbConnection,
  cellsUrl: string | null,
  boundariesUrl: string,
  bbox: BBox,
  options: { readonly labelIds: boolean },
): Promise<readonly Record<string, unknown>[]> {
  const margin = Math.max(
    (bbox.maxX - bbox.minX) * 0.05,
    BOUNDARY_VERTEX_FETCH_MARGIN_MICROMETERS,
  )
  const centroidBounds = [
    bbox.minX - BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS,
    bbox.maxX + BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS,
    bbox.minY - BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS,
    bbox.maxY + BOUNDARY_CENTROID_FETCH_MARGIN_MICROMETERS,
  ]
  const vertexBounds = [
    bbox.minX - margin,
    bbox.maxX + margin,
    bbox.minY - margin,
    bbox.maxY + margin,
  ]
  const label = options.labelIds ? ', label_id' : ''
  const labelColumn = options.labelIds ? ', b.label_id' : ''
  const viewportCells =
    cellsUrl === null
      ? ''
      : `WITH viewport_cells AS (
  SELECT cell_id FROM read_parquet( ? )
  WHERE x_centroid BETWEEN ? AND ?
    AND y_centroid BETWEEN ? AND ?
)
`
  const pick =
    cellsUrl === null
      ? `
  GROUP BY b.cell_id${labelColumn}
  HAVING avg(b.vertex_x) BETWEEN ? AND ?
    AND avg(b.vertex_y) BETWEEN ? AND ?`
      : `
    AND b.cell_id IN (SELECT cell_id FROM viewport_cells)
  GROUP BY b.cell_id${labelColumn}`
  // Vertices are FLOAT, so their bounds are cast for row-group pruning (see
  // betweenSql). Centroids and vertex means are DOUBLE.
  const stmt = await conn.prepare(`
${viewportCells}SELECT cell_id${label},
  list_transform(v, lambda p: p.x) AS x,
  list_transform(v, lambda p: p.y) AS y
FROM (
  SELECT b.cell_id${labelColumn},
    list_sort(list({'r': b.file_row_number, 'x': b.vertex_x, 'y': b.vertex_y})) AS v
  FROM read_parquet( ? ) AS b
  WHERE ${betweenSql('b.vertex_x', 'FLOAT')}
    AND ${betweenSql('b.vertex_y', 'FLOAT')}${pick}
)
ORDER BY cell_id${label}
`)
  const result = await stmt.query(
    ...(cellsUrl === null
      ? [boundariesUrl, ...vertexBounds, ...centroidBounds]
      : [cellsUrl, ...centroidBounds, boundariesUrl, ...vertexBounds]),
  )

  return result.toArray()
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
    AND ${betweenSql('x_location', 'FLOAT')}
    AND ${betweenSql('y_location', 'FLOAT')}`
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
WHERE ${betweenSql('x_location', 'FLOAT')}
  AND ${betweenSql('y_location', 'FLOAT')}
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

  const fragment = selectionToSql(spatialSelection, 'x_location', 'y_location', 'FLOAT')
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
  readonly selectedGeneRowsReader?: XeniumSelectedGeneRowsReader
  readonly queryOptions?: GeneExpressionQueryOptions
}): Promise<GeneExpressionBatch> {
  const { conn, cellsUrl, matrixUrl, bbox, genes, matrixReader } = options
  const queryOptions = options.queryOptions ?? {}
  const totalStartedAt = Date.now()
  const selectedGenes = normalizeGeneList(genes)

  if (selectedGenes.length === 0) {
    return {
      elements: [],
      genes: [],
      population: 'all',
      maxCount: 0,
    }
  }

  // Only cells with expression are returned, so `sampleStride` has nothing to
  // thin: every cell in the box is considered so that no expressing cell is
  // lost. Without a limit (whole-section previews), that is every cell.
  const limit = queryOptions.limit ?? null
  throwIfAborted(queryOptions.signal)

  if (options.selectedGeneRowsReader !== undefined) {
    const batch = await readXeniumGeneExpressionByMatrixRows({
      conn,
      cellsUrl,
      matrixUrl,
      bbox,
      genes: selectedGenes,
      limit,
      reader: options.selectedGeneRowsReader,
      queryOptions,
      totalStartedAt,
    })

    if (batch !== null) {
      return batch
    }
  }

  const viewportCellsStartedAt = Date.now()
  const viewportCells = await readXeniumCellsInBbox(conn, cellsUrl, bbox, limit)
  const viewportCellsMs = elapsedMs(viewportCellsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'viewport-cells',
    label: 'Viewport cell query',
    durationMs: viewportCellsMs,
    detail: `${viewportCells.length.toLocaleString()} cells, ${limitDetail(limit)}`,
  })
  throwIfAborted(queryOptions.signal)

  if (viewportCells.length === 0) {
    return {
      elements: [],
      genes: selectedGenes,
      population: 'all',
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
  const elements: GeneExpressionElement[] = []
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

    elements.push({
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
    detail: `${elements.length.toLocaleString()} positive cells`,
  })

  return {
    elements,
    genes: selectedGenes,
    population: 'expressing',
    cellCount: viewportCells.length,
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

// Reads the selected genes' expressing matrix rows first and joins them to the
// cells in the box by row, so the cost follows the expressing cells rather
// than every cell id. Returns null when the matrix cannot list rows this way
// or cells.parquet rows do not line up with matrix rows.
async function readXeniumGeneExpressionByMatrixRows(options: {
  readonly conn: XeniumDuckDbConnection
  readonly cellsUrl: string
  readonly matrixUrl: string
  readonly bbox: BBox
  readonly genes: readonly string[]
  readonly limit: number | null
  readonly reader: XeniumSelectedGeneRowsReader
  readonly queryOptions: GeneExpressionQueryOptions
  readonly totalStartedAt: number
}): Promise<GeneExpressionBatch | null> {
  const { conn, cellsUrl, matrixUrl, genes, queryOptions } = options
  const matrixReadStartedAt = Date.now()
  const matrixRows = await options.reader(matrixUrl, genes, {
    ...(queryOptions.signal === undefined ? {} : { signal: queryOptions.signal }),
    ...(queryOptions.onStageTiming === undefined
      ? {}
      : { onStageTiming: queryOptions.onStageTiming }),
  })
  const matrixReadMs = elapsedMs(matrixReadStartedAt)

  if (matrixRows === null) {
    return null
  }

  throwIfAborted(queryOptions.signal)
  const viewportCellsStartedAt = Date.now()
  const cells = await readXeniumCellColumnsInBbox(
    conn,
    cellsUrl,
    options.bbox,
    options.limit,
  )
  const viewportCellsMs = elapsedMs(viewportCellsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'viewport-cells',
    label: 'Viewport cell query',
    durationMs: viewportCellsMs,
    detail: `${cells.rows.length.toLocaleString()} cells, ${limitDetail(options.limit)}`,
  })
  throwIfAborted(queryOptions.signal)

  if (!(await cellRowsMatchMatrix(conn, cellsUrl, matrixUrl, matrixRows, cells.rows))) {
    return null
  }

  const scoreCellsStartedAt = Date.now()
  const { nCells } = matrixRows
  const inBox = new Uint8Array(nCells)

  for (let index = 0; index < cells.rows.length; index += 1) {
    const row = cells.rows[index] ?? -1

    if (row >= 0 && row < nCells) {
      inBox[row] = 1
    }
  }

  const countsByRow = new Float64Array(nCells)
  const geneCounts: { gene: string; count: number }[] = []

  for (const feature of matrixRows.features) {
    let total = 0

    for (let index = 0; index < feature.rows.length; index += 1) {
      const row = feature.rows[index] ?? nCells
      const count = feature.counts[index] ?? 0

      if (row < nCells && inBox[row] === 1) {
        countsByRow[row] = (countsByRow[row] ?? 0) + count
        total += count
      }
    }

    if (total > 0) {
      geneCounts.push({ gene: feature.gene, count: total })
    }
  }

  const elements: GeneExpressionElement[] = []
  let maxCount = 0

  for (let index = 0; index < cells.rows.length; index += 1) {
    const row = cells.rows[index] ?? -1
    const count = row >= 0 && row < nCells ? (countsByRow[row] ?? 0) : 0

    if (count <= 0) {
      continue
    }

    const cell: DatasetCell = {
      id: matrixRows.cellIdForRow(row),
      position: {
        x: micrometers(cells.x[index] ?? 0),
        y: micrometers(cells.y[index] ?? 0),
      },
      transcriptCount: cells.transcriptCounts[index] ?? 0,
      cellArea: cells.cellAreas[index] ?? 0,
      cellFeatureMatrixRow: row,
    }
    elements.push({ ...cell, count })
    maxCount = Math.max(maxCount, count)
  }

  const scoreCellsMs = elapsedMs(scoreCellsStartedAt)
  queryOptions.onStageTiming?.({
    stage: 'score-cells',
    label: 'Expression scoring',
    durationMs: scoreCellsMs,
    detail: `${elements.length.toLocaleString()} positive cells`,
  })

  return {
    elements,
    genes,
    population: 'expressing',
    cellCount: cells.rows.length,
    geneCounts: geneCounts.sort((left, right) => right.count - left.count),
    maxCount,
    timing: {
      viewportCellsMs,
      matrixReadMs,
      scoreCellsMs,
      totalMs: elapsedMs(options.totalStartedAt),
    },
  }
}

interface XeniumCellColumns {
  readonly rows: ArrayLike<number>
  readonly x: ArrayLike<number>
  readonly y: ArrayLike<number>
  readonly transcriptCounts: ArrayLike<number>
  readonly cellAreas: ArrayLike<number>
}

// Numeric columns only, read as Arrow vectors where available, so a
// whole-slide query does not build an object per cell.
async function readXeniumCellColumnsInBbox(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  bbox: BBox,
  limit: number | null,
): Promise<XeniumCellColumns> {
  const stmt = await conn.prepare(`
SELECT CAST(file_row_number AS INTEGER) AS cell_feature_matrix_row,
       CAST(x_centroid AS DOUBLE) AS x_centroid,
       CAST(y_centroid AS DOUBLE) AS y_centroid,
       CAST(transcript_counts AS DOUBLE) AS transcript_counts,
       CAST(cell_area AS DOUBLE) AS cell_area
FROM read_parquet( ? )
WHERE x_centroid BETWEEN ? AND ?
  AND y_centroid BETWEEN ? AND ?
ORDER BY file_row_number
${limit === null ? '' : 'LIMIT ?'}
`)
  const table = await stmt.query(
    cellsUrl,
    bbox.minX,
    bbox.maxX,
    bbox.minY,
    bbox.maxY,
    ...(limit === null ? [] : [limit]),
  )

  return {
    rows: numericColumn(table, 'cell_feature_matrix_row'),
    x: numericColumn(table, 'x_centroid'),
    y: numericColumn(table, 'y_centroid'),
    transcriptCounts: numericColumn(table, 'transcript_counts'),
    cellAreas: numericColumn(table, 'cell_area'),
  }
}

function numericColumn(table: ArrowTableLike, name: string): ArrayLike<number> {
  const column = table.getChild?.(name)?.toArray()

  if (column !== undefined && !(column instanceof BigInt64Array)) {
    return column as ArrayLike<number>
  }

  return Float64Array.from(table.toArray(), (row) => Number(row[name] ?? 0))
}

const cellRowAlignment = new Map<string, Promise<boolean>>()

// Expression rows are joined to cells.parquet by row number, which holds when
// both list cells in the same order. A few rows are checked by cell id once
// per dataset.
function cellRowsMatchMatrix(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  matrixUrl: string,
  matrixRows: SelectedGeneMatrixRows,
  candidateRows: ArrayLike<number>,
): Promise<boolean> {
  const key = `${cellsUrl}\n${matrixUrl}`
  const cached = cellRowAlignment.get(key)

  if (cached !== undefined) {
    return cached
  }

  const sampleRows = alignmentSampleRows(candidateRows, matrixRows.nCells)

  if (sampleRows.length === 0) {
    return Promise.resolve(true)
  }

  const check = (async () => {
    const stmt = await conn.prepare(`
SELECT CAST(file_row_number AS INTEGER) AS cell_feature_matrix_row, cell_id
FROM read_parquet( ? )
WHERE file_row_number IN (${sampleRows.map(() => '?').join(', ')})
`)
    const rows = (await stmt.query(cellsUrl, ...sampleRows)).toArray()

    return (
      rows.length === sampleRows.length &&
      rows.every(
        (row) =>
          String(row.cell_id) ===
          matrixRows.cellIdForRow(Number(row.cell_feature_matrix_row)),
      )
    )
  })()
  cellRowAlignment.set(key, check)
  check.catch(() => {
    if (cellRowAlignment.get(key) === check) {
      cellRowAlignment.delete(key)
    }
  })

  return check
}

function alignmentSampleRows(rows: ArrayLike<number>, nCells: number): number[] {
  const sample = new Set<number>()

  for (let index = 0; index < ROW_ALIGNMENT_SAMPLE_COUNT; index += 1) {
    const position = Math.round(
      (index * (rows.length - 1)) / Math.max(1, ROW_ALIGNMENT_SAMPLE_COUNT - 1),
    )
    const row = rows[position]

    if (row !== undefined && row >= 0 && row < nCells) {
      sample.add(row)
    }
  }

  return [...sample]
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

// Without a limit, every cell in the box.
async function readXeniumCellsInBbox(
  conn: XeniumDuckDbConnection,
  cellsUrl: string,
  bbox: BBox,
  limit: number | null,
): Promise<readonly DatasetCell[]> {
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
ORDER BY file_row_number
${limit === null ? '' : 'LIMIT ?'}
`)
  const result = await stmt.query(
    cellsUrl,
    bbox.minX,
    bbox.maxX,
    bbox.minY,
    bbox.maxY,
    ...(limit === null ? [] : [limit]),
  )

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

function limitDetail(limit: number | null): string {
  return limit === null ? 'no limit' : `limit ${limit.toLocaleString()}`
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}
