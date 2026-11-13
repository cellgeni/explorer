import { createGeneFeatureIndex } from './geneFeatures'
import type { GexCell, GexResult } from './gexTypes'

// Reading a 10x feature-barcode matrix from an open h5wasm file. Kept apart
// from gex.ts, which starts workers, so the H5 workers can import it.

const CELL_MAJOR_RANGE_COALESCE_GAP = 4_096
const CELL_MAJOR_RANGE_MAX_SPAN = 500_000

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

export interface H5FileLike {
  get(path: string): unknown
}

interface H5MatrixCache {
  readonly file: H5FileLike
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly barcodeRows: ReadonlyMap<string, number>
  readonly indptr: NumericArrayLike
  readonly indicesDataset: SliceableNumericDataset
  readonly dataDataset: SliceableNumericDataset
}

export function gexFromFeatureBarcodeMatrixH5File<ElementId extends string>(
  file: H5FileLike,
  elementIds: readonly ElementId[],
): GexResult<ElementId> {
  if (elementIds.length === 0) {
    return {
      geneNames: [],
      cells: emptyCellsFor(elementIds),
    }
  }

  return gexFromLoadedH5Matrix(createH5MatrixCache(file), elementIds)
}

// Reads rows of one open matrix file, reading its barcodes and features once.
// The H5 file worker keeps one per file.
export function featureBarcodeMatrixH5Reader(
  file: H5FileLike,
): <ElementId extends string>(elementIds: readonly ElementId[]) => GexResult<ElementId> {
  const matrix = createH5MatrixCache(file)

  return (elementIds) => gexFromLoadedH5Matrix(matrix, elementIds)
}

function gexFromLoadedH5Matrix<ElementId extends string>(
  matrix: H5MatrixCache,
  elementIds: readonly ElementId[],
): GexResult<ElementId> {
  return gexFromCellMajorSparseArrays({
    cellIds: elementIds,
    geneNames: matrix.geneNames,
    featureTypes: matrix.featureTypes,
    cellIdRows: matrix.barcodeRows,
    indptr: matrix.indptr,
    indicesDataset: matrix.indicesDataset,
    dataDataset: matrix.dataDataset,
  })
}

export function gexFromCellMajorSparseArrays<ElementId extends string>(options: {
  readonly cellIds: readonly ElementId[]
  readonly geneNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly cellIdRows: ReadonlyMap<string, number>
  readonly indptr: NumericArrayLike
  readonly indicesDataset: SliceableNumericDataset
  readonly dataDataset: SliceableNumericDataset
}): GexResult<ElementId> {
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

  const cells = new Map<ElementId, { geneNames: string[]; counts: number[] }>()
  const ranges: {
    readonly id: ElementId
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

export function emptyCellsFor<ElementId extends string>(
  cellIds: readonly ElementId[],
): ReadonlyMap<ElementId, GexCell> {
  return new Map(cellIds.map((cellId) => [cellId, { geneNames: [], counts: [] }]))
}

export function coalesceCellMajorRanges<ElementId extends string>(
  ranges: readonly {
    readonly id: ElementId
    readonly start: number
    readonly end: number
  }[],
): readonly {
  readonly start: number
  readonly end: number
  readonly targets: readonly {
    readonly id: ElementId
    readonly start: number
    readonly end: number
  }[]
}[] {
  const groups: {
    start: number
    end: number
    targets: {
      readonly id: ElementId
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

function createH5MatrixCache(file: H5FileLike): H5MatrixCache {
  const barcodeDataset = expectH5Dataset(file.get('/matrix/barcodes'), '/matrix/barcodes')
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
    barcodeRows: h5BarcodeRows(
      expectStringArray(barcodeDataset.value, '/matrix/barcodes'),
    ),
    indptr: expectNumericArrayLike(indptrDataset.value, '/matrix/indptr'),
    indicesDataset,
    dataDataset,
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

function h5BarcodeRows(barcodes: readonly string[]): ReadonlyMap<string, number> {
  const rows = new Map<string, number>()

  for (let row = 0; row < barcodes.length; row += 1) {
    const barcode = barcodes[row]

    if (barcode === undefined) {
      continue
    }

    rows.set(barcode, row)
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
