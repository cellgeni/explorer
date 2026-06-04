import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { asCellId, cellIdToInt, intToCellId } from './cellid'
import {
  defaultPersistentByteRangeCache,
  fetchByteRangeWithCache,
  ZARR_ZIP_CACHE_NAMESPACE,
} from './persistentByteRangeCache'
import type { CellId } from './cellid'
import type { DataPoint, Micrometers } from './coords'
import type { PersistentByteRangeCache } from './persistentByteRangeCache'
import type { Array as ZarrArray, DataType, Group as ZarrGroup } from 'zarrita'

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

export interface CellFeatureMatrixReadOptions {
  readonly signal?: AbortSignal
}

export interface AggregatedGene {
  readonly gene: string
  readonly count: number
}

export type SqlParameter = string | number

type NumericArrayLike =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array

interface SliceableNumericDataset {
  slice(ranges: readonly (readonly (number | null)[])[]): unknown
}

interface H5MatrixCache {
  readonly file: unknown
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly cellIdRows: ReadonlyMap<CellId, number>
  readonly indptr: NumericArrayLike
  readonly indicesDataset: SliceableNumericDataset
  readonly dataDataset: SliceableNumericDataset
}

interface ZarrMatrixCache {
  readonly cellFeatures: ZarrGroup<ZipFileStore>
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly geneFeatureIndices: ReadonlySet<number>
  readonly filteredGeneNames: readonly string[]
  readonly cellIdArray: ZarrArray<DataType, ZipFileStore>
  readonly nCells: number
  readonly cellIdStride: number
  readonly cscIndptrArray?: ZarrArray<DataType, ZipFileStore>
  readonly cscIndicesArray?: ZarrArray<DataType, ZipFileStore>
  readonly cscDataArray?: ZarrArray<DataType, ZipFileStore>
}

interface ZarrMatrixCellIdCache extends ZarrMatrixCache {
  readonly cellIdRows: ReadonlyMap<CellId, number>
}

export interface CellFeatureMatrixRowTarget {
  readonly id: CellId
  readonly row: number
}

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

const CELL_MAJOR_RANGE_COALESCE_GAP = 4_096
const CELL_MAJOR_RANGE_MAX_SPAN = 500_000
const CELL_MAJOR_RANGE_FETCH_CONCURRENCY = 8
const CELL_MAJOR_INDPTR_COALESCE_GAP = 4_096
const CELL_MAJOR_INDPTR_MAX_SPAN = 100_000
const h5MatrixCache = new Map<string, Promise<H5MatrixCache>>()
const zarrMatrixCache = new Map<string, Promise<ZarrMatrixCache>>()
const zarrMatrixCellIdCache = new Map<string, Promise<ZarrMatrixCellIdCache>>()

export async function warmCellFeatureMatrixZarr(url: string): Promise<void> {
  await loadZarrMatrixMetadata(url)
}

export async function warmCellFeatureMatrixZarrCellIdIndex(
  url: string,
): Promise<void> {
  await loadZarrMatrixWithCellIds(url)
}

export function clearCellFeatureMatrixZarrCache(retainUrl?: string): void {
  for (const url of zarrMatrixCache.keys()) {
    if (url !== retainUrl) {
      zarrMatrixCache.delete(url)
    }
  }

  for (const url of zarrMatrixCellIdCache.keys()) {
    if (url !== retainUrl) {
      zarrMatrixCellIdCache.delete(url)
    }
  }
}

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
  if (scope === 'cells-only' && cellIds.length === 0) {
    return {
      geneNames: [],
      cells: emptyCellsFor(cellIds),
    }
  }

  const where =
    scope === 'cells-only'
      ? cellIdWhereClause(cellIds)
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

function cellIdWhereClause(cellIds: readonly CellId[]): SqlFragment {
  return {
    sql: `cell_id IN (${cellIds.map(() => '?').join(', ')})`,
    params: cellIds.map((cellId) => String(cellId)),
  }
}

export async function gexFromCellFeatureMatrixZarr(
  url: string,
  cellIds: readonly CellId[],
): Promise<GexResult> {
  const matrix = await loadZarrMatrixWithCellIds(url)

  const targets = cellIds
    .map((cellId) => ({ id: cellId, row: matrix.cellIdRows.get(cellId) ?? -1 }))
    .filter((target) => target.row >= 0)
    .sort((a, b) => a.row - b.row)

  return gexFromCellFeatureMatrixZarrTargets(matrix, targets, cellIds)
}

export async function gexFromCellFeatureMatrixZarrRows(
  url: string,
  targets: readonly CellFeatureMatrixRowTarget[],
): Promise<GexResult> {
  const matrix = await loadZarrMatrixMetadata(url)
  const rowTargets = targets
    .filter((target) => target.row >= 0 && target.row < matrix.nCells)
    .sort((a, b) => a.row - b.row)

  return gexFromCellFeatureMatrixZarrTargets(
    matrix,
    rowTargets,
    targets.map((target) => target.id),
  )
}

async function gexFromCellFeatureMatrixZarrTargets(
  matrix: ZarrMatrixCache,
  targets: readonly CellFeatureMatrixRowTarget[],
  cellIds: readonly CellId[],
): Promise<GexResult> {
  if (targets.length === 0) {
    return {
      geneNames: matrix.filteredGeneNames,
      cells: emptyCellsFor(cellIds),
    }
  }

  if (matrix.cscIndptrArray === undefined) {
    throw new Error(
      'cell_feature_matrix.zarr.zip does not expose a cell-major csc/indptr array.',
    )
  }

  const indicesArray =
    matrix.cscIndicesArray ??
    (await zarr.open(matrix.cellFeatures.resolve('csc/indices'), {
      kind: 'array',
    }))
  const dataArray =
    matrix.cscDataArray ??
    (await zarr.open(matrix.cellFeatures.resolve('csc/data'), {
      kind: 'array',
    }))
  const cells = new Map<CellId, { geneNames: string[]; counts: number[] }>()
  const ranges = await zarrCellMajorSparseRanges(matrix.cscIndptrArray, targets, cells)

  await mapWithConcurrency(
    coalesceCellMajorRanges(ranges),
    CELL_MAJOR_RANGE_FETCH_CONCURRENCY,
    async (rangeGroup) => {
      const [indicesChunk, dataChunk] = await Promise.all([
        zarr.get(indicesArray, [zarr.slice(rangeGroup.start, rangeGroup.end)]),
        zarr.get(dataArray, [zarr.slice(rangeGroup.start, rangeGroup.end)]),
      ])
      const indices = expectUint16Array(
        indicesChunk.data,
        'cell_features/csc/indices',
      )
      const data = expectUint32Array(dataChunk.data, 'cell_features/csc/data')

      for (const target of rangeGroup.targets) {
        const start = target.start - rangeGroup.start
        const end = target.end - rangeGroup.start
        const sparseGenes: string[] = []
        const sparseCounts: number[] = []

        for (let cursor = start; cursor < end; cursor += 1) {
          const featureIndex = indices[cursor]
          const count = data[cursor]

          if (
            featureIndex === undefined ||
            count === undefined ||
            !matrix.geneFeatureIndices.has(featureIndex)
          ) {
            continue
          }

          sparseGenes.push(matrix.geneNames[featureIndex] ?? `feature_${featureIndex}`)
          sparseCounts.push(Number(count))
        }

        cells.set(target.id, { geneNames: sparseGenes, counts: sparseCounts })
      }
    },
  )

  for (const cellId of cellIds) {
    if (!cells.has(cellId)) {
      cells.set(cellId, { geneNames: [], counts: [] })
    }
  }

  return {
    geneNames: matrix.filteredGeneNames,
    cells,
  }
}

export async function gexFromCellFeatureMatrixH5(
  url: string,
  cellIds: readonly CellId[],
  options: CellFeatureMatrixReadOptions = {},
): Promise<GexResult> {
  if (cellIds.length === 0) {
    return {
      geneNames: [],
      cells: emptyCellsFor(cellIds),
    }
  }

  const matrix = await loadH5Matrix(url, options)
  throwIfAborted(options.signal)

  return gexFromCellMajorSparseArrays({
    cellIds,
    geneNames: matrix.geneNames,
    featureTypes: matrix.featureTypes,
    cellIdRows: matrix.cellIdRows,
    indptr: matrix.indptr,
    indicesDataset: matrix.indicesDataset,
    dataDataset: matrix.dataDataset,
  })
}

export function gexFromCellMajorSparseArrays(options: {
  readonly cellIds: readonly CellId[]
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly cellIdRows: ReadonlyMap<CellId, number>
  readonly indptr: NumericArrayLike
  readonly indicesDataset: SliceableNumericDataset
  readonly dataDataset: SliceableNumericDataset
}): GexResult {
  const geneFeatureIndices = createGeneFeatureIndex(
    options.geneNames,
    options.featureTypes,
  )
  const filteredGeneNames = options.geneNames.filter((_, index) =>
    geneFeatureIndices.has(index),
  )
  const targets = options.cellIds
    .map((cellId) => ({ id: cellId, row: options.cellIdRows.get(cellId) ?? -1 }))
    .filter((target) => target.row >= 0)
    .sort((a, b) => a.row - b.row)

  if (targets.length === 0) {
    return {
      geneNames: filteredGeneNames,
      cells: emptyCellsFor(options.cellIds),
    }
  }

  const cells = new Map<CellId, { geneNames: string[]; counts: number[] }>()
  const ranges: {
    readonly id: CellId
    readonly start: number
    readonly end: number
  }[] = []

  for (const target of targets) {
    const start = readNumericArrayValue(options.indptr, target.row)
    const end = readNumericArrayValue(options.indptr, target.row + 1)

    if (end <= start) {
      cells.set(target.id, { geneNames: [], counts: [] })
      continue
    }

    ranges.push({ id: target.id, start, end })
  }

  if (ranges.length === 0) {
    return {
      geneNames: filteredGeneNames,
      cells: emptyCellsFor(options.cellIds),
    }
  }

  for (const rangeGroup of coalesceCellMajorRanges(ranges)) {
    const indices = expectNumericArrayLike(
      options.indicesDataset.slice([[rangeGroup.start, rangeGroup.end]]),
      'cell feature matrix indices',
    )
    const data = expectNumericArrayLike(
      options.dataDataset.slice([[rangeGroup.start, rangeGroup.end]]),
      'cell feature matrix data',
    )

    for (const target of rangeGroup.targets) {
      const start = target.start - rangeGroup.start
      const end = target.end - rangeGroup.start
      const sparseGenes: string[] = []
      const sparseCounts: number[] = []

      for (let cursor = start; cursor < end; cursor += 1) {
        const featureIndex = readNumericArrayValue(indices, cursor)

        if (!geneFeatureIndices.has(featureIndex)) {
          continue
        }

        sparseGenes.push(options.geneNames[featureIndex] ?? `feature_${featureIndex}`)
        sparseCounts.push(readNumericArrayValue(data, cursor))
      }

      cells.set(target.id, { geneNames: sparseGenes, counts: sparseCounts })
    }
  }

  for (const cellId of options.cellIds) {
    if (!cells.has(cellId)) {
      cells.set(cellId, { geneNames: [], counts: [] })
    }
  }

  return {
    geneNames: filteredGeneNames,
    cells,
  }
}

export async function gexFromCellFeatureMatrixZarrSelectedGenes(
  url: string,
  cellIds: readonly CellId[],
  genes: readonly string[],
): Promise<GexResult> {
  const selectedGenes = normalizeSelectedGeneList(genes)

  if (cellIds.length === 0 || selectedGenes.length === 0) {
    return {
      geneNames: selectedGenes,
      cells: emptyCellsFor(cellIds),
    }
  }

  const matrix = await loadZarrMatrixWithCellIds(url)

  if (matrix.cscIndptrArray !== undefined) {
    return gexFromCellFeatureMatrixZarr(url, cellIds)
  }

  return gexFromFeatureMajorCellFeatureMatrix(matrix, cellIds, selectedGenes)
}

export function gexFromFeatureMajorSparseArrays(options: {
  readonly cellIds: readonly CellId[]
  readonly selectedGenes: readonly string[]
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly cellIdData: Uint32Array
  readonly cellIdStride: number
  readonly indptr: Uint32Array
  readonly indices: Uint32Array
  readonly data: Uint32Array
}): GexResult {
  const geneFeatureIndices = createGeneFeatureIndex(
    options.geneNames,
    options.featureTypes,
  )
  const selectedFeatures = selectedFeatureRows(
    options.geneNames,
    geneFeatureIndices,
    options.selectedGenes,
  )
  const cells = emptyMutableCellsFor(options.cellIds)

  if (selectedFeatures.length === 0) {
    return {
      geneNames: [],
      cells,
    }
  }

  const targetRows = targetRowsByCellId(
    options.cellIds,
    options.cellIdData,
    options.cellIdStride,
  )

  for (const feature of selectedFeatures) {
    const start = Number(options.indptr[feature.index] ?? 0)
    const end = Number(options.indptr[feature.index + 1] ?? start)

    for (let cursor = start; cursor < end; cursor += 1) {
      const cellRow = options.indices[cursor]
      const count = options.data[cursor]

      if (cellRow === undefined || count === undefined) {
        continue
      }

      const cellId = targetRows.get(cellRow)

      if (cellId === undefined) {
        continue
      }

      const cell = cells.get(cellId)

      if (cell === undefined) {
        continue
      }

      cell.geneNames.push(feature.gene)
      cell.counts.push(Number(count))
    }
  }

  return {
    geneNames: selectedFeatures.map((feature) => feature.gene),
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

function emptyMutableCellsFor(
  cellIds: readonly CellId[],
): Map<CellId, { geneNames: string[]; counts: number[] }> {
  return new Map(cellIds.map((cellId) => [cellId, { geneNames: [], counts: [] }]))
}

function loadZarrMatrixMetadata(url: string): Promise<ZarrMatrixCache> {
  const cached = zarrMatrixCache.get(url)

  if (cached !== undefined) {
    return cached
  }

  const promise = loadZarrMatrixUncached(url).catch((error: unknown) => {
    if (zarrMatrixCache.get(url) === promise) {
      zarrMatrixCache.delete(url)
    }

    throw error
  })

  zarrMatrixCache.set(url, promise)
  return promise
}

async function loadZarrMatrixUncached(url: string): Promise<ZarrMatrixCache> {
  const store = cachedZipFileStoreFromUrl(url)
  const root = await zarr.open(store, { kind: 'group' })
  const cellFeatures = await zarr.open(root.resolve('cell_features'), { kind: 'group' })
  const attrs = cellFeatures.attrs
  const geneNames = readStringArrayAttribute(attrs, 'feature_keys')
  const featureTypes = readStringArrayAttribute(attrs, 'feature_types')
  const geneFeatureIndices = createGeneFeatureIndex(geneNames, featureTypes)
  const filteredGeneNames = geneNames.filter((_, index) => geneFeatureIndices.has(index))
  const cellIdArray = await zarr.open(cellFeatures.resolve('cell_id'), { kind: 'array' })
  const nCells = expectShapeDimension(cellIdArray.shape, 0, 'cell_features/cell_id')
  const cellIdStride = cellIdArray.shape[1] ?? 2
  const cscIndptrArray = await openZarrArrayOrNull(cellFeatures, 'csc/indptr')
  const [cscIndicesArray, cscDataArray] =
    cscIndptrArray === null
      ? [null, null]
      : await Promise.all([
          openZarrArrayOrNull(cellFeatures, 'csc/indices'),
          openZarrArrayOrNull(cellFeatures, 'csc/data'),
        ])

  return {
    cellFeatures,
    geneNames,
    featureTypes,
    geneFeatureIndices,
    filteredGeneNames,
    cellIdArray,
    nCells,
    cellIdStride,
    ...(cscIndptrArray === null ? {} : { cscIndptrArray }),
    ...(cscIndicesArray === null ? {} : { cscIndicesArray }),
    ...(cscDataArray === null ? {} : { cscDataArray }),
  }
}

function loadZarrMatrixWithCellIds(url: string): Promise<ZarrMatrixCellIdCache> {
  const cached = zarrMatrixCellIdCache.get(url)

  if (cached !== undefined) {
    return cached
  }

  const promise = loadZarrMatrixWithCellIdsUncached(url).catch((error: unknown) => {
    if (zarrMatrixCellIdCache.get(url) === promise) {
      zarrMatrixCellIdCache.delete(url)
    }

    throw error
  })

  zarrMatrixCellIdCache.set(url, promise)
  return promise
}

async function loadZarrMatrixWithCellIdsUncached(
  url: string,
): Promise<ZarrMatrixCellIdCache> {
  const matrix = await loadZarrMatrixMetadata(url)
  const cellIdChunk = await zarr.get(matrix.cellIdArray, [null, null])
  const cellIdData = expectUint32Array(cellIdChunk.data, 'cell_features/cell_id')
  const cellIdRows = cellIdRowsFromCellIdData(
    cellIdData,
    matrix.nCells,
    matrix.cellIdStride,
  )

  return {
    ...matrix,
    cellIdRows,
  }
}

function cachedZipFileStoreFromUrl(url: string): ZipFileStore {
  return new ZipFileStore(
    new CachedHttpRangeReader(url, defaultPersistentByteRangeCache()),
  )
}

class CachedHttpRangeReader {
  private byteLength: number | undefined

  constructor(
    readonly url: string,
    private readonly cache: PersistentByteRangeCache | null,
  ) {}

  async getLength(): Promise<number> {
    if (this.byteLength !== undefined) {
      return this.byteLength
    }

    const response = await fetch(this.url, { method: 'HEAD' })

    if (!response.ok) {
      throw new Error(
        `failed http request ${this.url}, status: ${response.status}: ${response.statusText}`,
      )
    }

    const byteLength = Number(response.headers.get('content-length'))

    if (!Number.isFinite(byteLength)) {
      throw new Error('could not get length')
    }

    this.byteLength = byteLength
    return byteLength
  }

  async read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
    if (size === 0) {
      return new Uint8Array(0)
    }

    const bytes = await fetchByteRangeWithCache({
      cache: this.cache,
      namespace: ZARR_ZIP_CACHE_NAMESPACE,
      url: this.url,
      start: offset,
      end: offset + size,
      fetchRange: async () => {
        const response = await fetch(this.url, {
          headers: {
            Range: `bytes=${offset}-${offset + size - 1}`,
          },
        })

        if (!response.ok) {
          throw new Error(
            `failed http request ${this.url}, status: ${response.status} offset: ${offset} size: ${size}: ${response.statusText}`,
          )
        }

        return new Uint8Array(await response.arrayBuffer())
      },
    })

    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy
  }
}

async function gexFromFeatureMajorCellFeatureMatrix(
  matrix: ZarrMatrixCellIdCache,
  cellIds: readonly CellId[],
  selectedGenes: readonly string[],
): Promise<GexResult> {
  const selectedFeatures = selectedFeatureRows(
    matrix.geneNames,
    matrix.geneFeatureIndices,
    selectedGenes,
  )

  if (selectedFeatures.length === 0) {
    return {
      geneNames: [],
      cells: emptyCellsFor(cellIds),
    }
  }

  const targetRows = targetRowsFromCellIdRows(cellIds, matrix.cellIdRows)
  const cells = emptyMutableCellsFor(cellIds)

  if (targetRows.size === 0) {
    return {
      geneNames: selectedFeatures.map((feature) => feature.gene),
      cells,
    }
  }

  const indptrArray = await zarr.open(matrix.cellFeatures.resolve('indptr'), {
    kind: 'array',
  })
  const indicesArray = await zarr.open(matrix.cellFeatures.resolve('indices'), {
    kind: 'array',
  })
  const dataArray = await zarr.open(matrix.cellFeatures.resolve('data'), {
    kind: 'array',
  })

  for (const feature of selectedFeatures) {
    const indptrChunk = await zarr.get(indptrArray, [
      zarr.slice(feature.index, feature.index + 2),
    ])
    const indptr = expectUint32Array(
      indptrChunk.data,
      `cell_features/indptr feature ${feature.index}`,
    )
    const start = Number(indptr[0] ?? 0)
    const end = Number(indptr[1] ?? start)

    if (end <= start) {
      continue
    }

    const indices = expectUint32Array(
      (await zarr.get(indicesArray, [zarr.slice(start, end)])).data,
      `cell_features/indices feature ${feature.index}`,
    )
    const data = expectUint32Array(
      (await zarr.get(dataArray, [zarr.slice(start, end)])).data,
      `cell_features/data feature ${feature.index}`,
    )

    appendFeatureMajorCounts(cells, targetRows, feature.gene, indices, data)
  }

  return {
    geneNames: selectedFeatures.map((feature) => feature.gene),
    cells,
  }
}

async function openZarrArrayOrNull(
  group: ZarrGroup<ZipFileStore>,
  path: string,
): Promise<ZarrArray<DataType, ZipFileStore> | null> {
  try {
    return await zarr.open(group.resolve(path), { kind: 'array' })
  } catch (error) {
    if (isZarrNotFoundError(error)) {
      return null
    }

    throw error
  }
}

function appendFeatureMajorCounts(
  cells: Map<CellId, { geneNames: string[]; counts: number[] }>,
  targetRows: ReadonlyMap<number, CellId>,
  gene: string,
  indices: Uint32Array,
  data: Uint32Array,
): void {
  for (let cursor = 0; cursor < indices.length; cursor += 1) {
    const cellRow = indices[cursor]
    const count = data[cursor]

    if (cellRow === undefined || count === undefined) {
      continue
    }

    const cellId = targetRows.get(cellRow)

    if (cellId === undefined) {
      continue
    }

    const cell = cells.get(cellId)

    if (cell === undefined) {
      continue
    }

    cell.geneNames.push(gene)
    cell.counts.push(Number(count))
  }
}

function targetRowsByCellId(
  cellIds: readonly CellId[],
  cellIdData: Uint32Array,
  stride: number,
): ReadonlyMap<number, CellId> {
  const requestedCellRows = new Map<string, CellId>()

  for (const cellId of cellIds) {
    const { prefix, suffix } = cellIdToInt(cellId)
    requestedCellRows.set(`${prefix}:${suffix}`, cellId)
  }

  const targetRows = new Map<number, CellId>()
  const cellCount = Math.floor(cellIdData.length / stride)

  for (let row = 0; row < cellCount; row += 1) {
    const prefix = cellIdData[row * stride]
    const suffix = cellIdData[row * stride + 1]

    if (prefix === undefined || suffix === undefined) {
      continue
    }

    const cellId = requestedCellRows.get(`${prefix}:${suffix}`)

    if (cellId !== undefined) {
      targetRows.set(row, cellId)
    }
  }

  return targetRows
}

function cellIdRowsFromCellIdData(
  cellIdData: Uint32Array,
  nCells: number,
  stride: number,
): ReadonlyMap<CellId, number> {
  const cellIdRows = new Map<CellId, number>()

  for (let row = 0; row < nCells; row += 1) {
    const prefix = cellIdData[row * stride]
    const suffix = cellIdData[row * stride + 1]

    if (prefix === undefined || suffix === undefined) {
      throw new Error(`cell_features/cell_id row ${row} is incomplete.`)
    }

    cellIdRows.set(intToCellId(prefix, suffix), row)
  }

  return cellIdRows
}

function targetRowsFromCellIdRows(
  cellIds: readonly CellId[],
  cellIdRows: ReadonlyMap<CellId, number>,
): ReadonlyMap<number, CellId> {
  const targetRows = new Map<number, CellId>()

  for (const cellId of cellIds) {
    const row = cellIdRows.get(cellId)

    if (row !== undefined) {
      targetRows.set(row, cellId)
    }
  }

  return targetRows
}

function selectedFeatureRows(
  geneNames: readonly string[],
  geneFeatureIndices: ReadonlySet<number>,
  selectedGenes: readonly string[],
): readonly { readonly gene: string; readonly index: number }[] {
  const geneNameToIndex = new Map<string, { gene: string; index: number }>()

  for (let index = 0; index < geneNames.length; index += 1) {
    const gene = geneNames[index]

    if (gene !== undefined && geneFeatureIndices.has(index)) {
      geneNameToIndex.set(gene.toLowerCase(), { gene, index })
    }
  }

  const selectedFeatures: { gene: string; index: number }[] = []
  const seenFeatureIndices = new Set<number>()

  for (const gene of selectedGenes) {
    const feature = geneNameToIndex.get(gene.toLowerCase())

    if (feature === undefined || seenFeatureIndices.has(feature.index)) {
      continue
    }

    selectedFeatures.push(feature)
    seenFeatureIndices.add(feature.index)
  }

  return selectedFeatures
}

function normalizeSelectedGeneList(genes: readonly string[]): readonly string[] {
  const selectedGenes: string[] = []
  const seenGenes = new Set<string>()

  for (const gene of genes) {
    const normalizedGene = gene.trim()
    const key = normalizedGene.toLowerCase()

    if (normalizedGene.length === 0 || seenGenes.has(key)) {
      continue
    }

    selectedGenes.push(normalizedGene)
    seenGenes.add(key)
  }

  return selectedGenes
}

function loadH5Matrix(
  url: string,
  options: CellFeatureMatrixReadOptions,
): Promise<H5MatrixCache> {
  const cached = h5MatrixCache.get(url)

  if (cached !== undefined) {
    return cached
  }

  const promise = loadH5MatrixUncached(url, options).catch((error: unknown) => {
    if (h5MatrixCache.get(url) === promise) {
      h5MatrixCache.delete(url)
    }

    throw error
  })

  h5MatrixCache.set(url, promise)
  return promise
}

async function zarrCellMajorSparseRanges(
  indptrArray: ZarrArray<DataType, ZipFileStore>,
  targets: readonly CellFeatureMatrixRowTarget[],
  cells: Map<CellId, { geneNames: string[]; counts: number[] }>,
): Promise<
  readonly {
    readonly id: CellId
    readonly start: number
    readonly end: number
  }[]
> {
  const ranges: {
    readonly id: CellId
    readonly start: number
    readonly end: number
  }[] = []

  for (const group of coalesceIndptrTargetRanges(targets)) {
    const indptr = expectUint32Array(
      (await zarr.get(indptrArray, [zarr.slice(group.start, group.end)])).data,
      'cell_features/csc/indptr',
    )

    for (const target of group.targets) {
      const localRow = target.row - group.start
      const start = Number(indptr[localRow] ?? 0)
      const end = Number(indptr[localRow + 1] ?? start)

      if (end <= start) {
        cells.set(target.id, { geneNames: [], counts: [] })
        continue
      }

      ranges.push({ id: target.id, start, end })
    }
  }

  return ranges
}

function coalesceIndptrTargetRanges(
  targets: readonly CellFeatureMatrixRowTarget[],
): readonly {
  readonly start: number
  readonly end: number
  readonly targets: readonly CellFeatureMatrixRowTarget[]
}[] {
  const groups: {
    start: number
    end: number
    targets: CellFeatureMatrixRowTarget[]
  }[] = []

  for (const target of targets) {
    const start = target.row
    const end = target.row + 2
    const current = groups[groups.length - 1]

    if (
      current !== undefined &&
      start <= current.end + CELL_MAJOR_INDPTR_COALESCE_GAP &&
      end - current.start <= CELL_MAJOR_INDPTR_MAX_SPAN
    ) {
      current.end = Math.max(current.end, end)
      current.targets.push(target)
      continue
    }

    groups.push({
      start,
      end,
      targets: [target],
    })
  }

  return groups
}

function coalesceCellMajorRanges(
  ranges: readonly {
    readonly id: CellId
    readonly start: number
    readonly end: number
  }[],
): readonly {
  readonly start: number
  readonly end: number
  readonly targets: readonly {
    readonly id: CellId
    readonly start: number
    readonly end: number
  }[]
}[] {
  const groups: {
    start: number
    end: number
    targets: {
      readonly id: CellId
      readonly start: number
      readonly end: number
    }[]
  }[] = []

  for (const range of ranges) {
    const current = groups[groups.length - 1]

    if (
      current !== undefined &&
      range.start <= current.end + CELL_MAJOR_RANGE_COALESCE_GAP &&
      range.end - current.start <= CELL_MAJOR_RANGE_MAX_SPAN
    ) {
      current.end = Math.max(current.end, range.end)
      current.targets.push(range)
      continue
    }

    groups.push({
      start: range.start,
      end: range.end,
      targets: [range],
    })
  }

  return groups
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor += 1

        if (item !== undefined) {
          await mapper(item)
        }
      }
    }),
  )
}

async function loadH5MatrixUncached(
  url: string,
  options: CellFeatureMatrixReadOptions,
): Promise<H5MatrixCache> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  throwIfAborted(options.signal)

  const response = await fetch(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(`cell_feature_matrix.h5 returned HTTP ${response.status}.`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  throwIfAborted(options.signal)

  const fileName = `/cell-feature-matrix-${hashString(url)}.h5`
  try {
    FS.unlink(fileName)
  } catch {
    // The file is only present when this URL was loaded in a previous app session.
  }

  FS.writeFile(fileName, bytes)

  try {
    const file = new h5wasm.File(fileName, 'r')
    const barcodeDataset = expectH5Dataset(
      file.get('/matrix/barcodes'),
      '/matrix/barcodes',
    )
    const geneNameDataset = expectH5Dataset(
      file.get('/matrix/features/name'),
      '/matrix/features/name',
    )
    const featureTypeDataset = expectH5Dataset(
      file.get('/matrix/features/feature_type'),
      '/matrix/features/feature_type',
    )
    const indptrDataset = expectH5Dataset(file.get('/matrix/indptr'), '/matrix/indptr')
    const indicesDataset = expectH5Dataset(file.get('/matrix/indices'), '/matrix/indices')
    const dataDataset = expectH5Dataset(file.get('/matrix/data'), '/matrix/data')

    return {
      file,
      geneNames: expectStringArray(geneNameDataset.value, '/matrix/features/name'),
      featureTypes: expectStringArray(
        featureTypeDataset.value,
        '/matrix/features/feature_type',
      ),
      cellIdRows: h5CellIdRows(
        expectStringArray(barcodeDataset.value, '/matrix/barcodes'),
      ),
      indptr: expectNumericArrayLike(indptrDataset.value, '/matrix/indptr'),
      indicesDataset,
      dataDataset,
    }
  } catch (error) {
    try {
      FS.unlink(fileName)
    } catch {
      // Best-effort cleanup; the original error is more useful.
    }

    throw error
  }
}

function expectH5Dataset(
  value: unknown,
  label: string,
): SliceableNumericDataset & {
  readonly value: unknown
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('slice' in value) ||
    typeof value.slice !== 'function' ||
    !('value' in value)
  ) {
    throw new Error(`Expected ${label} to be an HDF5 dataset.`)
  }

  return value as SliceableNumericDataset & { readonly value: unknown }
}

function h5CellIdRows(barcodes: readonly string[]): ReadonlyMap<CellId, number> {
  const rows = new Map<CellId, number>()

  for (let row = 0; row < barcodes.length; row += 1) {
    const barcode = barcodes[row]

    if (barcode === undefined) {
      continue
    }

    rows.set(asCellId(barcode), row)
  }

  return rows
}

function expectStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Expected ${label} to be a string array.`)
  }

  return value
}

function expectNumericArrayLike(value: unknown, label: string): NumericArrayLike {
  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  ) {
    return value
  }

  throw new Error(`Expected ${label} to be a numeric typed array.`)
}

function readNumericArrayValue(array: NumericArrayLike, index: number): number {
  const value = array[index]

  if (value === undefined) {
    throw new Error(`Sparse matrix index ${index} is out of bounds.`)
  }

  return typeof value === 'bigint' ? Number(value) : value
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

  const error = new Error('Cell feature matrix request aborted.')
  error.name = 'AbortError'
  return error
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

function isZarrNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.name === 'NotFoundError' || error.message.toLowerCase().includes('not found')
  )
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
