import { isGeneFeature } from './geneFeatures'
import type { CellFeatureMatrixReadOptions, GexCell, GexResult } from './gexTypes'
import { throwIfAborted } from '../utils/abort'

// Reading Visium HD feature_slice.h5 from an open h5wasm file. Kept apart from
// visiumFeatureSlice.ts, which starts workers, so the H5 file worker can
// import it.

type NumericArrayLike =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array

export interface H5FileLike {
  get(path: string): unknown
  get_attribute(name: string, jsonCompatible: false): unknown
}

interface H5GroupLike {
  get(path: string): unknown
}

interface H5DatasetLike {
  readonly value: unknown
}

export interface VisiumFeatureSliceCache {
  readonly file: H5FileLike
  readonly metadata: VisiumFeatureSliceMetadata
  readonly featureNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly geneFeaturesByKey: ReadonlyMap<string, VisiumFeatureSliceFeature>
}

interface VisiumFeatureSliceFeature {
  readonly index: number
  readonly name: string
}

export interface VisiumFeatureSliceMetadata {
  readonly nrows: number
  readonly ncols: number
  readonly spotPitchMicrometers: number
  // `transform_matrices.spot_colrow_to_microscope_colrow`: the 3×3 projective
  // transform, row-major, from a spot's (col, row, 1) to its full-resolution
  // pixel (col, row, w). Space Ranger computes every bin position from it.
  readonly spotToFullresTransform?: VisiumFeatureSliceTransform
}

export type VisiumFeatureSliceTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface VisiumFeatureSliceTarget<ElementId extends string = string> {
  readonly id: ElementId
  readonly row: number
  readonly col: number
}

export interface VisiumFeatureSliceH5FileReadOptions {
  readonly binSizeMicrometers: number
  readonly signal?: AbortSignal
  readonly onStageTiming?: CellFeatureMatrixReadOptions['onStageTiming']
}

const METADATA_JSON_ATTR_NAME = 'metadata_json'

const FEATURE_SLICES_GROUP_NAME = '/feature_slices'

const FEATURE_NAME_DATASET = '/features/name'

const FEATURE_TYPE_DATASET = '/features/feature_type'

export function gexFromVisiumFeatureSliceLoadedH5<ElementId extends string>(
  matrix: VisiumFeatureSliceCache,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  selectedGenes: readonly string[],
  options: VisiumFeatureSliceH5FileReadOptions,
): GexResult<ElementId> {
  const binningScale = featureSliceBinningScale(
    options.binSizeMicrometers,
    matrix.metadata.spotPitchMicrometers,
  )
  const targetIdsByBinnedPosition = targetIdsByPosition(targets)
  const cells = emptyMutableCellsFor(targets)
  const readStartedAt = Date.now()
  let matchedFeatureCount = 0

  for (const selectedGene of selectedGenes) {
    const feature = matrix.geneFeaturesByKey.get(selectedGene.toLowerCase())

    if (feature === undefined) {
      continue
    }

    const group = readOptionalH5Group(
      matrix.file,
      `${FEATURE_SLICES_GROUP_NAME}/${feature.index}`,
    )

    if (group === null) {
      continue
    }

    matchedFeatureCount += 1
    accumulateFeatureSliceGroup({
      group,
      gene: feature.name,
      binningScale,
      targetIdsByBinnedPosition,
      cells,
    })
    throwIfAborted(options.signal)
  }

  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 selected genes',
    durationMs: elapsedMs(readStartedAt),
    detail: `${matchedFeatureCount.toLocaleString()} genes, ${targets.length.toLocaleString()} bins`,
  })

  return {
    geneNames: selectedGenes,
    cells,
  }
}

export function parseVisiumFeatureSliceMetadata(
  value: unknown,
): VisiumFeatureSliceMetadata {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Expected feature_slice.h5 metadata_json to be an object.')
  }

  const source = parsed as Record<string, unknown>
  const spotToFullresTransform = readTransformMatrix(
    source.transform_matrices,
    'spot_colrow_to_microscope_colrow',
  )

  return {
    nrows: readFiniteNumber(source, 'nrows'),
    ncols: readFiniteNumber(source, 'ncols'),
    spotPitchMicrometers: readFiniteNumber(source, 'spot_pitch'),
    ...(spotToFullresTransform === undefined ? {} : { spotToFullresTransform }),
  }
}

// The file's metadata alone, without its feature names.
export function readVisiumFeatureSliceMetadata(
  file: H5FileLike,
): VisiumFeatureSliceMetadata {
  return parseVisiumFeatureSliceMetadata(
    file.get_attribute(METADATA_JSON_ATTR_NAME, false),
  )
}

// A 3×3 matrix stored as three rows of three numbers, else undefined: the
// transforms are optional, and older files may not have them.
function readTransformMatrix(
  transforms: unknown,
  key: string,
): VisiumFeatureSliceTransform | undefined {
  if (transforms === null || typeof transforms !== 'object') {
    return undefined
  }

  const rows = (transforms as Record<string, unknown>)[key]

  if (!Array.isArray(rows) || rows.length !== 3) {
    return undefined
  }

  const values = rows.flatMap((row: unknown) =>
    Array.isArray(row) && row.length === 3 ? (row as unknown[]) : [Number.NaN],
  )

  return values.length === 9 &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? (values as unknown as VisiumFeatureSliceTransform)
    : undefined
}

export function featureSliceBinningScale(
  binSizeMicrometers: number,
  spotPitchMicrometers: number,
): number {
  if (!Number.isFinite(binSizeMicrometers) || binSizeMicrometers <= 0) {
    throw new RangeError('Feature Slice bin size must be a positive finite number.')
  }

  if (!Number.isFinite(spotPitchMicrometers) || spotPitchMicrometers <= 0) {
    throw new RangeError('Feature Slice spot pitch must be a positive finite number.')
  }

  const scale = binSizeMicrometers / spotPitchMicrometers
  const roundedScale = Math.round(scale)

  if (Math.abs(scale - roundedScale) > 1e-6 || roundedScale < 1) {
    throw new RangeError(
      `Feature Slice bin size ${binSizeMicrometers} cannot be represented as an integer multiple of the ${spotPitchMicrometers} µm source pitch.`,
    )
  }

  return roundedScale
}

function accumulateFeatureSliceGroup<ElementId extends string>({
  group,
  gene,
  binningScale,
  targetIdsByBinnedPosition,
  cells,
}: {
  readonly group: H5GroupLike
  readonly gene: string
  readonly binningScale: number
  readonly targetIdsByBinnedPosition: ReadonlyMap<string, ElementId>
  readonly cells: Map<ElementId, { geneNames: string[]; counts: number[] }>
}): void {
  const rows = readNumericDataset(group, 'row')
  const cols = readNumericDataset(group, 'col')
  const data = readNumericDataset(group, 'data')
  const length = Math.min(rows.length, cols.length, data.length)

  for (let index = 0; index < length; index += 1) {
    const sourceRow = readNumericArrayValue(rows, index)
    const sourceCol = readNumericArrayValue(cols, index)
    const count = readNumericArrayValue(data, index)

    if (count <= 0) {
      continue
    }

    const binnedRow = Math.floor(sourceRow / binningScale)
    const binnedCol = Math.floor(sourceCol / binningScale)
    const targetId = targetIdsByBinnedPosition.get(positionKey(binnedRow, binnedCol))

    if (targetId === undefined) {
      continue
    }

    appendGeneCount(cells.get(targetId), gene, count)
  }
}

function appendGeneCount(
  cell: { geneNames: string[]; counts: number[] } | undefined,
  gene: string,
  count: number,
): void {
  if (cell === undefined) {
    return
  }

  const existingIndex = cell.geneNames.indexOf(gene)

  if (existingIndex >= 0) {
    cell.counts[existingIndex] = (cell.counts[existingIndex] ?? 0) + count
    return
  }

  cell.geneNames.push(gene)
  cell.counts.push(count)
}

export function createVisiumFeatureSliceCache(file: H5FileLike): VisiumFeatureSliceCache {
  const metadata = readVisiumFeatureSliceMetadata(file)
  const featureNames = expectStringArray(
    readH5Dataset(file, FEATURE_NAME_DATASET).value,
    FEATURE_NAME_DATASET,
  )
  const featureTypes = expectStringArray(
    readH5Dataset(file, FEATURE_TYPE_DATASET).value,
    FEATURE_TYPE_DATASET,
  )

  return {
    file,
    metadata,
    featureNames,
    featureTypes,
    geneFeaturesByKey: geneFeaturesByKey(featureNames, featureTypes),
  }
}

function geneFeaturesByKey(
  featureNames: readonly string[],
  featureTypes: readonly string[],
): ReadonlyMap<string, VisiumFeatureSliceFeature> {
  const features = new Map<string, VisiumFeatureSliceFeature>()

  for (let index = 0; index < featureNames.length; index += 1) {
    const name = featureNames[index]

    if (name === undefined || !isGeneFeature(name, featureTypes[index])) {
      continue
    }

    const key = name.toLowerCase()

    if (!features.has(key)) {
      features.set(key, { index, name })
    }
  }

  return features
}

function targetIdsByPosition<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): ReadonlyMap<string, ElementId> {
  const ids = new Map<string, ElementId>()

  for (const target of targets) {
    ids.set(positionKey(target.row, target.col), target.id)
  }

  return ids
}

function positionKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function emptyCellsFor<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): ReadonlyMap<ElementId, GexCell> {
  return emptyMutableCellsFor(targets)
}

function emptyMutableCellsFor<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): Map<ElementId, { geneNames: string[]; counts: number[] }> {
  return new Map(targets.map((target) => [target.id, { geneNames: [], counts: [] }]))
}

export function normalizeSelectedGeneList(genes: readonly string[]): readonly string[] {
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

function readNumericDataset(group: H5GroupLike, name: string): NumericArrayLike {
  return expectNumericArrayLike(readH5Dataset(group, name).value, name)
}

function readH5Dataset(group: H5GroupLike, path: string): H5DatasetLike {
  return expectH5Dataset(group.get(path), path)
}

function readOptionalH5Group(group: H5GroupLike, path: string): H5GroupLike | null {
  const value = group.get(path)

  if (value === null || value === undefined) {
    return null
  }

  return expectH5Group(value, path)
}

function expectH5Group(value: unknown, path: string): H5GroupLike {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function'
  ) {
    return value as H5GroupLike
  }

  throw new Error(`Expected ${path} to be an HDF5 group.`)
}

function expectH5Dataset(value: unknown, path: string): H5DatasetLike {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return value as H5DatasetLike
  }

  throw new Error(`Expected ${path} to be an HDF5 dataset.`)
}

function expectStringArray(value: unknown, path: string): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }

  throw new Error(`Expected ${path} to be a string dataset.`)
}

function expectNumericArrayLike(value: unknown, path: string): NumericArrayLike {
  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  ) {
    return value
  }

  throw new Error(`Expected ${path} to be a numeric typed-array dataset.`)
}

function readNumericArrayValue(array: NumericArrayLike, index: number): number {
  const value = array[index]

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return value ?? 0
}

function readFiniteNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw new Error(`Expected feature_slice.h5 metadata_json ${key} to be a number.`)
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}
