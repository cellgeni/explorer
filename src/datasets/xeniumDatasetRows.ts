import { asCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import type { CellId } from '../data/cellid'
import type { BBox, DataPoint } from '../data/coords'
import type { CellTranscriptZBin, CellTranscriptZDistribution } from '../data/cellTranscripts'
import type { GexCell, GexResult, SqlFragment, SqlParameter } from '../data/gex'
import type { TranscriptGroupSummary, TranscriptPoint } from '../data/transcriptOverlay'
import type {
  DatasetCell,
  DatasetTranscript,
  GeneExpressionGeneCount,
  TranscriptViewportQueryOptions,
} from './xeniumDataset'

const DEFAULT_TRANSCRIPT_MIN_QV = 20

export function normalizeSampleStride(sampleStride: number | undefined): number {
  if (sampleStride === undefined || !Number.isFinite(sampleStride)) {
    return 1
  }

  return Math.max(1, Math.floor(sampleStride))
}

export function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

export function normalizeMinQv(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_TRANSCRIPT_MIN_QV
  }

  return value
}

export function parseExtentRow(row: Record<string, unknown>): BBox {
  return {
    minX: micrometers(readNumericRowValue(row, 'minX')),
    maxX: micrometers(readNumericRowValue(row, 'maxX')),
    minY: micrometers(readNumericRowValue(row, 'minY')),
    maxY: micrometers(readNumericRowValue(row, 'maxY')),
  }
}

export function parseBoundaryRow(row: Record<string, unknown>): {
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

export function parseViewportCellRow(row: Record<string, unknown>): DatasetCell {
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

export function parseTranscriptExportRow(row: Record<string, unknown>): DatasetTranscript {
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

export function parseCellTranscriptZDistributionRows(
  rows: readonly Record<string, unknown>[],
  options: {
    readonly limit: number
    readonly minQv: number
    readonly binCount: number
  },
): CellTranscriptZDistribution {
  const first = rows[0]

  if (first === undefined) {
    return {
      bins: [],
      transcriptCount: 0,
      zCount: 0,
      missingZCount: 0,
      maxBinCount: 0,
      hitTranscriptLimit: false,
      minQv: options.minQv,
    }
  }

  const transcriptCount = readNumericRowValue(first, 'transcript_count')
  const zCount = readNumericRowValue(first, 'z_count')
  const missingZCount = readNumericRowValue(first, 'missing_z_count')
  const minZ = readOptionalNumericRowValue(first, 'min_z')
  const maxZ = readOptionalNumericRowValue(first, 'max_z')

  if (zCount <= 0 || minZ === undefined || maxZ === undefined) {
    return {
      bins: [],
      transcriptCount,
      zCount,
      missingZCount,
      maxBinCount: 0,
      hitTranscriptLimit: transcriptCount >= options.limit,
      minQv: options.minQv,
    }
  }

  if (minZ === maxZ) {
    const count = distributionRowCount(rows[0]) ?? zCount

    return {
      bins: [
        {
          minZ,
          maxZ,
          count,
          percent: 100,
        },
      ],
      transcriptCount,
      zCount,
      missingZCount,
      minZ,
      maxZ,
      maxBinCount: count,
      hitTranscriptLimit: transcriptCount >= options.limit,
      minQv: options.minQv,
    }
  }

  const counts = Array.from({ length: options.binCount }, () => 0)

  for (const row of rows) {
    const binIndex = readOptionalIntegerRowValue(row, 'bin_index')
    const count = distributionRowCount(row)

    if (
      binIndex === undefined ||
      count === undefined ||
      binIndex < 0 ||
      binIndex >= counts.length
    ) {
      continue
    }

    counts[binIndex] = count
  }

  const binSize = (maxZ - minZ) / options.binCount
  let maxBinCount = 0
  const bins = counts.map((count, index): CellTranscriptZBin => {
    maxBinCount = Math.max(maxBinCount, count)
    return {
      minZ: minZ + binSize * index,
      maxZ: index === options.binCount - 1 ? maxZ : minZ + binSize * (index + 1),
      count,
      percent: (count / zCount) * 100,
    }
  })

  return {
    bins,
    transcriptCount,
    zCount,
    missingZCount,
    minZ,
    maxZ,
    maxBinCount,
    hitTranscriptLimit: transcriptCount >= options.limit,
    minQv: options.minQv,
  }
}

function distributionRowCount(
  row: Record<string, unknown> | undefined,
): number | undefined {
  return row === undefined ? undefined : readOptionalNumericRowValue(row, 'bin_count')
}

export function parseTranscriptPointRow(row: Record<string, unknown>): TranscriptPoint {
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

export function parseTranscriptGroupRow(row: Record<string, unknown>): TranscriptGroupSummary {
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

export function transcriptViewportFilterSql(
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

export function selectedGeneCount(cell: GexCell, selectedGeneSet: ReadonlySet<string>): number {
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

export function selectedGeneCounts(
  matrix: GexResult,
  selectedGenes: readonly string[],
): readonly GeneExpressionGeneCount[] {
  const selectedGeneSet = new Set(selectedGenes)
  const countsByGene = new Map<string, number>()

  for (const cell of matrix.cells.values()) {
    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const gene = cell.geneNames[index]
      const count = cell.counts[index]

      if (
        gene === undefined ||
        count === undefined ||
        count <= 0 ||
        !selectedGeneSet.has(gene)
      ) {
        continue
      }

      countsByGene.set(gene, (countsByGene.get(gene) ?? 0) + count)
    }
  }

  return selectedGenes
    .map((gene) => ({ gene, count: countsByGene.get(gene) ?? 0 }))
    .filter((gene) => gene.count > 0)
    .sort((left, right) => right.count - left.count)
}

export function normalizeGeneList(genes: readonly string[]): readonly string[] {
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

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

export function readObjectProperty(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return isRecord(property) ? property : undefined
}

export function findNumericProperty(
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
