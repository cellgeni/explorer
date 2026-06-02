import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { intToCellId } from './cellid'
import type { CellId } from './cellid'
import type { Annotation } from '../datasets/spatialDataset'

export interface AnalysisGroupingArrays {
  readonly groupingName: string
  readonly groupNames: readonly string[]
  readonly indptr: NumericIndexArray
  readonly indices: NumericIndexArray
}

interface NumericIndexArray {
  readonly length: number
  readonly [index: number]: number | bigint | undefined
}

export async function readAnalysisZarrAnnotations(
  analysisUrl: string,
  matrixUrl: string,
): Promise<readonly Annotation[]> {
  const [groupings, cellIdsByRow] = await Promise.all([
    readAnalysisGroupings(analysisUrl),
    readCellIdsByMatrixRow(matrixUrl),
  ])

  return annotationsFromAnalysisGroups(groupings, cellIdsByRow)
}

export function annotationsFromAnalysisGroups(
  groupings: readonly AnalysisGroupingArrays[],
  cellIdsByRow: readonly CellId[],
): readonly Annotation[] {
  const annotations: Annotation[] = []

  for (let groupingIndex = 0; groupingIndex < groupings.length; groupingIndex += 1) {
    const grouping = groupings[groupingIndex]

    if (grouping === undefined || grouping.indptr.length < 2) {
      continue
    }

    for (let groupIndex = 0; groupIndex < grouping.indptr.length - 1; groupIndex += 1) {
      const start = readNumericIndex(grouping.indptr, groupIndex)
      const end = readNumericIndex(grouping.indptr, groupIndex + 1)
      const cellIds: CellId[] = []

      for (let cursor = start; cursor < end; cursor += 1) {
        const cellRow = readNumericIndex(grouping.indices, cursor)
        const cellId = cellIdsByRow[cellRow]

        if (cellId !== undefined) {
          cellIds.push(cellId)
        }
      }

      annotations.push({
        id: `analysis:${groupingIndex}:${groupIndex}`,
        label: `${formatGroupingName(grouping.groupingName)}: ${
          grouping.groupNames[groupIndex] ?? `Group ${groupIndex + 1}`
        }`,
        cellIds,
      })
    }
  }

  return annotations
}

async function readAnalysisGroupings(
  analysisUrl: string,
): Promise<readonly AnalysisGroupingArrays[]> {
  const store = ZipFileStore.fromUrl(analysisUrl)
  const root = await zarr.open(store, { kind: 'group' })
  const cellGroups = await zarr.open(root.resolve('cell_groups'), { kind: 'group' })
  const groupingNames = readStringArrayAttribute(cellGroups.attrs, 'grouping_names')
  const groupNames = readNestedStringArrayAttribute(cellGroups.attrs, 'group_names')
  const groupingCount = readNumberAttribute(
    cellGroups.attrs,
    'number_groupings',
    groupingNames.length,
  )
  const groupings: AnalysisGroupingArrays[] = []

  for (let groupingIndex = 0; groupingIndex < groupingCount; groupingIndex += 1) {
    const group = await zarr.open(cellGroups.resolve(String(groupingIndex)), {
      kind: 'group',
    })
    const indptrArray = await zarr.open(group.resolve('indptr'), { kind: 'array' })
    const indicesArray = await zarr.open(group.resolve('indices'), { kind: 'array' })
    const indptr = expectNumericIndexArray(
      (await zarr.get(indptrArray, [null])).data,
      `cell_groups/${groupingIndex}/indptr`,
    )
    const indices = expectNumericIndexArray(
      (await zarr.get(indicesArray, [null])).data,
      `cell_groups/${groupingIndex}/indices`,
    )

    groupings.push({
      groupingName: groupingNames[groupingIndex] ?? `Grouping ${groupingIndex + 1}`,
      groupNames: groupNames[groupingIndex] ?? [],
      indptr,
      indices,
    })
  }

  return groupings
}

async function readCellIdsByMatrixRow(matrixUrl: string): Promise<readonly CellId[]> {
  const store = ZipFileStore.fromUrl(matrixUrl)
  const root = await zarr.open(store, { kind: 'group' })
  const cellFeatures = await zarr.open(root.resolve('cell_features'), { kind: 'group' })
  const cellIdArray = await zarr.open(cellFeatures.resolve('cell_id'), {
    kind: 'array',
  })
  const cellIdChunk = await zarr.get(cellIdArray, [null, null])
  const cellIdData = expectUint32Array(cellIdChunk.data, 'cell_features/cell_id')
  const rowCount = readShapeDimension(cellIdArray.shape, 0, 'cell_features/cell_id')
  const stride = cellIdArray.shape[1] ?? 2
  const cellIds: CellId[] = []

  for (let row = 0; row < rowCount; row += 1) {
    const prefix = cellIdData[row * stride]
    const suffix = cellIdData[row * stride + 1]

    if (prefix === undefined || suffix === undefined) {
      throw new Error(`cell_features/cell_id row ${row} is incomplete.`)
    }

    cellIds.push(intToCellId(prefix, suffix))
  }

  return cellIds
}

function formatGroupingName(name: string): string {
  return name.replace(/^gene_expression_/, '').replaceAll('_', ' ')
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
    throw new Error(`Expected analysis.zarr attribute ${key} to be a string array.`)
  }

  return value
}

function readNestedStringArrayAttribute(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): readonly (readonly string[])[] {
  const value = attrs[key]

  if (value === undefined) {
    return []
  }

  if (
    !Array.isArray(value) ||
    !value.every(
      (group) => Array.isArray(group) && group.every((item) => typeof item === 'string'),
    )
  ) {
    throw new Error(
      `Expected analysis.zarr attribute ${key} to be a nested string array.`,
    )
  }

  return value
}

function readNumberAttribute(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = attrs[key]

  if (value === undefined) {
    return fallback
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected analysis.zarr attribute ${key} to be a count.`)
  }

  return value
}

function readShapeDimension(
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

function expectUint32Array(value: unknown, label: string): Uint32Array {
  if (!(value instanceof Uint32Array)) {
    throw new Error(`Expected ${label} to be a Uint32Array.`)
  }

  return value
}

function expectNumericIndexArray(value: unknown, label: string): NumericIndexArray {
  if (!ArrayBuffer.isView(value) || !('length' in value)) {
    throw new Error(`Expected ${label} to be a typed numeric array.`)
  }

  return value as unknown as NumericIndexArray
}

function readNumericIndex(values: NumericIndexArray, index: number): number {
  const value = values[index]

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected numeric array index ${index} to contain a number.`)
  }

  return value
}
