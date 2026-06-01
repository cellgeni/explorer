import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { asCellId, intToCellId } from './cellid'
import type { CellId } from './cellid'
import type { DataPoint, Micrometers } from './coords'

export type TranscriptScope = 'spatial' | 'cells-only'

export interface CircleSelection {
  readonly kind: 'circle'
  readonly cx: Micrometers
  readonly cy: Micrometers
  readonly radius: Micrometers
}

export interface PolygonSelection {
  readonly kind: 'polygon'
  readonly points: readonly DataPoint[]
}

export type Selection = CircleSelection | PolygonSelection

export interface GexCell {
  readonly geneNames: readonly string[]
  readonly counts: readonly number[]
}

export interface GexResult {
  readonly geneNames: readonly string[]
  readonly cells: ReadonlyMap<CellId, GexCell>
}

export interface AggregatedGene {
  readonly gene: string
  readonly count: number
}

export type SqlParameter = string | number | readonly string[]

export interface SqlFragment {
  readonly sql: string
  readonly params: readonly SqlParameter[]
}

export interface ArrowTableLike {
  toArray(): readonly Record<string, unknown>[]
}

export interface DuckDbPreparedStatementLike {
  query(...params: SqlParameter[]): Promise<ArrowTableLike>
}

export interface TranscriptDuckDbConnection {
  prepare(sql: string): Promise<DuckDbPreparedStatementLike>
}

const NON_GENE_PATTERNS = [
  /^Total transcripts$/i,
  /NegControlProbe/i,
  /NegControlCodeword/i,
  /^BLANK/i,
  /UnassignedCodeword/i,
  /antisense/i,
  /Deprecated/i,
] as const

export function aggregateGex(
  cells: ReadonlyMap<CellId, GexCell>,
): readonly AggregatedGene[] {
  const totals = new Map<string, number>()

  for (const cell of cells.values()) {
    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const gene = cell.geneNames[index]
      const count = cell.counts[index]

      if (gene === undefined || count === undefined) {
        continue
      }

      totals.set(gene, (totals.get(gene) ?? 0) + count)
    }
  }

  return [...totals.entries()]
    .map(([gene, count]) => ({ gene, count }))
    .sort((a, b) => b.count - a.count)
}

export function isGeneFeature(name: string, featureType?: string): boolean {
  if (NON_GENE_PATTERNS.some((pattern) => pattern.test(name))) {
    return false
  }

  if (featureType === undefined) {
    return true
  }

  const normalizedType = featureType.trim().toLowerCase()
  return normalizedType === 'gene' || normalizedType === 'gene expression'
}

export function createGeneFeatureIndex(
  geneNames: readonly string[],
  featureTypes: readonly string[],
): ReadonlySet<number> {
  const indices = new Set<number>()

  for (let index = 0; index < geneNames.length; index += 1) {
    const geneName = geneNames[index]

    if (geneName !== undefined && isGeneFeature(geneName, featureTypes[index])) {
      indices.add(index)
    }
  }

  return indices
}

export function selectionToSql(
  selection: Selection,
  xCol: string,
  yCol: string,
): SqlFragment {
  if (selection.kind === 'circle') {
    const { cx, cy, radius } = selection

    return {
      sql: `${xCol} BETWEEN ? AND ?
AND ${yCol} BETWEEN ? AND ?
AND (${xCol}-?)*(${xCol}-?) + (${yCol}-?)*(${yCol}-?) <= ?`,
      params: [
        cx - radius,
        cx + radius,
        cy - radius,
        cy + radius,
        cx,
        cx,
        cy,
        cy,
        radius * radius,
      ],
    }
  }

  const firstPoint = selection.points[0]

  if (firstPoint === undefined) {
    throw new Error('Polygon selection requires at least one point.')
  }

  const xs = selection.points.map((point) => point.x)
  const ys = selection.points.map((point) => point.y)
  const ring = selection.points.map((point) => `${point.x} ${point.y}`).join(', ')
  const wkt = `POLYGON((${ring}, ${firstPoint.x} ${firstPoint.y}))`

  return {
    sql: `${xCol} BETWEEN ? AND ?
AND ${yCol} BETWEEN ? AND ?
AND ST_Within(ST_Point(${xCol}, ${yCol}), ST_GeomFromText(?))`,
    params: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), wkt],
  }
}

export async function gexFromTranscriptsParquet(
  conn: TranscriptDuckDbConnection,
  url: string,
  selection: Selection,
  scope: TranscriptScope = 'spatial',
  cellIds: readonly CellId[] = [],
  minQv = 20,
): Promise<GexResult> {
  const where =
    scope === 'cells-only'
      ? {
          sql: 'cell_id IN (SELECT * FROM UNNEST( ? ))',
          params: [
            cellIds.map((cellId) => String(cellId)),
          ] satisfies readonly SqlParameter[],
        }
      : selectionToSql(selection, 'x_location', 'y_location')

  const stmt = await conn.prepare(`
SELECT cell_id,
       feature_name AS gene,
       COUNT(*) AS count
FROM read_parquet( ? )
WHERE ${where.sql}
  AND qv >= ?
  AND is_gene = true
GROUP BY cell_id, feature_name
ORDER BY cell_id, count DESC
`)
  const result = await stmt.query(url, ...where.params, minQv)
  const rows = result.toArray().map(parseTranscriptRow)
  const cells = new Map<CellId, { geneNames: string[]; counts: number[] }>()

  for (const row of rows) {
    if (row.cellId === null) {
      continue
    }

    const existing = cells.get(row.cellId) ?? { geneNames: [], counts: [] }
    existing.geneNames.push(row.gene)
    existing.counts.push(row.count)
    cells.set(row.cellId, existing)
  }

  return {
    geneNames: [...new Set(rows.map((row) => row.gene))].sort(),
    cells,
  }
}

export async function gexFromCellFeatureMatrixZarr(
  url: string,
  cellIds: readonly CellId[],
): Promise<GexResult> {
  const store = ZipFileStore.fromUrl(url)
  const root = await zarr.open(store, { kind: 'group' })
  const cellFeatures = await zarr.open(root.resolve('cell_features'), { kind: 'group' })
  const attrs = cellFeatures.attrs
  const geneNames = readStringArrayAttribute(attrs, 'feature_keys')
  const featureTypes = readStringArrayAttribute(attrs, 'feature_types')
  const geneFeatureIndices = createGeneFeatureIndex(geneNames, featureTypes)
  const filteredGeneNames = geneNames.filter((_, index) => geneFeatureIndices.has(index))
  const cellIdArray = await zarr.open(cellFeatures.resolve('cell_id'), { kind: 'array' })
  const cellIdChunk = await zarr.get(cellIdArray, [null, null])
  const cellIdData = expectUint32Array(cellIdChunk.data, 'cell_features/cell_id')
  const nCells = expectShapeDimension(cellIdArray.shape, 0, 'cell_features/cell_id')
  const stride = cellIdArray.shape[1] ?? 2
  const cellIdToRow = new Map<CellId, number>()

  for (let row = 0; row < nCells; row += 1) {
    const prefix = cellIdData[row * stride]
    const suffix = cellIdData[row * stride + 1]

    if (prefix === undefined || suffix === undefined) {
      throw new Error(`cell_features/cell_id row ${row} is incomplete.`)
    }

    cellIdToRow.set(intToCellId(prefix, suffix), row)
  }

  const targets = cellIds
    .map((cellId) => ({ id: cellId, row: cellIdToRow.get(cellId) ?? -1 }))
    .filter((target) => target.row >= 0)
    .sort((a, b) => a.row - b.row)

  if (targets.length === 0) {
    return {
      geneNames: filteredGeneNames,
      cells: emptyCellsFor(cellIds),
    }
  }

  const indptrArray = await zarr.open(cellFeatures.resolve('csc/indptr'), {
    kind: 'array',
  })
  const indicesArray = await zarr.open(cellFeatures.resolve('csc/indices'), {
    kind: 'array',
  })
  const dataArray = await zarr.open(cellFeatures.resolve('csc/data'), { kind: 'array' })
  const firstTarget = targets[0]
  const lastTarget = targets[targets.length - 1]

  if (firstTarget === undefined || lastTarget === undefined) {
    throw new Error('Expected at least one cell feature matrix target.')
  }

  const indptrChunk = await zarr.get(indptrArray, [
    zarr.slice(firstTarget.row, lastTarget.row + 2),
  ])
  const indptr = expectUint32Array(indptrChunk.data, 'cell_features/csc/indptr')
  const globalStart = Number(indptr[0] ?? 0)
  const globalEnd = Number(indptr[indptr.length - 1] ?? 0)
  const indices =
    globalEnd > globalStart
      ? expectUint16Array(
          (await zarr.get(indicesArray, [zarr.slice(globalStart, globalEnd)])).data,
          'cell_features/csc/indices',
        )
      : new Uint16Array(0)
  const data =
    globalEnd > globalStart
      ? expectUint32Array(
          (await zarr.get(dataArray, [zarr.slice(globalStart, globalEnd)])).data,
          'cell_features/csc/data',
        )
      : new Uint32Array(0)
  const cells = new Map<CellId, { geneNames: string[]; counts: number[] }>()

  for (const target of targets) {
    const localIndex = target.row - firstTarget.row
    const start = Number(indptr[localIndex] ?? 0) - globalStart
    const end = Number(indptr[localIndex + 1] ?? 0) - globalStart
    const sparseGenes: string[] = []
    const sparseCounts: number[] = []

    for (let cursor = start; cursor < end; cursor += 1) {
      const featureIndex = indices[cursor]
      const count = data[cursor]

      if (
        featureIndex === undefined ||
        count === undefined ||
        !geneFeatureIndices.has(featureIndex)
      ) {
        continue
      }

      sparseGenes.push(geneNames[featureIndex] ?? `feature_${featureIndex}`)
      sparseCounts.push(Number(count))
    }

    cells.set(target.id, { geneNames: sparseGenes, counts: sparseCounts })
  }

  for (const cellId of cellIds) {
    if (!cells.has(cellId)) {
      cells.set(cellId, { geneNames: [], counts: [] })
    }
  }

  return {
    geneNames: filteredGeneNames,
    cells,
  }
}

interface TranscriptRow {
  readonly cellId: CellId | null
  readonly gene: string
  readonly count: number
}

function parseTranscriptRow(row: Record<string, unknown>): TranscriptRow {
  const cellId = row.cell_id
  const gene = row.gene
  const count = row.count

  if (cellId !== null && typeof cellId !== 'string') {
    throw new Error(`Expected transcript row cell_id to be a string or null.`)
  }

  if (typeof gene !== 'string') {
    throw new Error(`Expected transcript row gene to be a string.`)
  }

  if (typeof count !== 'number' && typeof count !== 'bigint') {
    throw new Error(`Expected transcript row count to be numeric.`)
  }

  return {
    cellId: cellId === null ? null : asCellId(cellId),
    gene,
    count: Number(count),
  }
}

function emptyCellsFor(cellIds: readonly CellId[]): ReadonlyMap<CellId, GexCell> {
  return new Map(cellIds.map((cellId) => [cellId, { geneNames: [], counts: [] }]))
}

function readStringArrayAttribute(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = attrs[key]

  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Expected Zarr attribute ${key} to be a string array.`)
  }

  return value
}

function expectShapeDimension(
  shape: readonly number[],
  index: number,
  label: string,
): number {
  const value = shape[index]

  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${label} shape[${index}] to be a non-negative integer.`)
  }

  return value
}

function expectUint16Array(value: unknown, label: string): Uint16Array {
  if (!(value instanceof Uint16Array)) {
    throw new Error(`Expected ${label} to be a Uint16Array.`)
  }

  return value
}

function expectUint32Array(value: unknown, label: string): Uint32Array {
  if (!(value instanceof Uint32Array)) {
    throw new Error(`Expected ${label} to be a Uint32Array.`)
  }

  return value
}
