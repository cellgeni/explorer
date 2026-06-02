import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { intToCellId } from './cellid'
import type { CellId } from './cellid'
import type { Annotation } from '../datasets/spatialDataset'

export interface AnalysisGroupingArrays {
  readonly groupingIndex?: number
  readonly groupingName: string
  readonly groupNames: readonly string[]
  readonly indptr: NumericIndexArray
  readonly indices: NumericIndexArray
}

export interface AnalysisAnnotationGroupOption {
  readonly id: string
  readonly label: string
  readonly groupingName: string
  readonly groupCount: number
}

export interface AnalysisAnnotationQueryOptions {
  readonly groupId?: string
}

interface NumericIndexArray {
  readonly length: number
  readonly [index: number]: number | bigint | undefined
}

export async function readAnalysisZarrAnnotations(
  analysisUrl: string,
  matrixUrl: string,
  options: AnalysisAnnotationQueryOptions = {},
): Promise<readonly Annotation[]> {
  const [groupings, cellIdsByRow] = await Promise.all([
    readAnalysisGroupings(analysisUrl, options),
    readCellIdsByMatrixRow(matrixUrl),
  ])

  return annotationsFromAnalysisGroups(groupings, cellIdsByRow)
}

export async function readAnalysisZarrAnnotationGroupOptions(
  analysisUrl: string,
): Promise<readonly AnalysisAnnotationGroupOption[]> {
  const metadata = await readAnalysisGroupingMetadata(analysisUrl)

  return analysisAnnotationGroupOptionsFromMetadata(
    metadata.groupingNames,
    metadata.groupNames,
    metadata.groupingCount,
  )
}

export function analysisAnnotationGroupOptionsFromMetadata(
  groupingNames: readonly string[],
  groupNames: readonly (readonly string[])[],
  groupingCount = groupingNames.length,
): readonly AnalysisAnnotationGroupOption[] {
  const options: AnalysisAnnotationGroupOption[] = []

  for (let groupingIndex = 0; groupingIndex < groupingCount; groupingIndex += 1) {
    const groupingName = groupingNames[groupingIndex] ?? `Grouping ${groupingIndex + 1}`
    const groups = groupNames[groupingIndex] ?? []

    options.push({
      id: analysisAnnotationGroupId(groupingIndex),
      label: formatGroupingName(groupingName),
      groupingName,
      groupCount: groups.length,
    })
  }

  return options
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
        id: `analysis:${grouping.groupingIndex ?? groupingIndex}:${groupIndex}`,
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
  options: AnalysisAnnotationQueryOptions,
): Promise<readonly AnalysisGroupingArrays[]> {
  const metadata = await readAnalysisGroupingMetadata(analysisUrl)
  const selectedGroupingIndexes = selectedAnalysisGroupingIndexes(
    options.groupId,
    metadata.groupingCount,
  )
  const groupings: AnalysisGroupingArrays[] = []

  for (
    let groupingIndex = 0;
    groupingIndex < metadata.groupingCount;
    groupingIndex += 1
  ) {
    if (selectedGroupingIndexes !== null && !selectedGroupingIndexes.has(groupingIndex)) {
      continue
    }

    const group = await zarr.open(metadata.cellGroups.resolve(String(groupingIndex)), {
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
      groupingIndex,
      groupingName:
        metadata.groupingNames[groupingIndex] ?? `Grouping ${groupingIndex + 1}`,
      groupNames: metadata.groupNames[groupingIndex] ?? [],
      indptr,
      indices,
    })
  }

  return groupings
}

async function readAnalysisGroupingMetadata(analysisUrl: string): Promise<{
  readonly cellGroups: zarr.Group<ZipFileStore>
  readonly groupingNames: readonly string[]
  readonly groupNames: readonly (readonly string[])[]
  readonly groupingCount: number
}> {
  const store = ZipFileStore.fromUrl(analysisUrl)
  const root = await zarr.open(store, { kind: 'group' })
  const cellGroups = await zarr.open(root.resolve('cell_groups'), { kind: 'group' })
  const groupingNames = readStringArrayAttribute(cellGroups.attrs, 'grouping_names')
  const groupNames = readNestedStringArrayAttribute(cellGroups.attrs, 'group_names')

  return {
    cellGroups,
    groupingNames,
    groupNames,
    groupingCount: readNumberAttribute(
      cellGroups.attrs,
      'number_groupings',
      groupingNames.length,
    ),
  }
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
  return name
    .replace(/^gene_expression_/, '')
    .replace(/_clusters$/, '')
    .replaceAll('_', ' ')
}

function analysisAnnotationGroupId(groupingIndex: number): string {
  return `analysis:${groupingIndex}`
}

function selectedAnalysisGroupingIndexes(
  groupId: string | undefined,
  groupingCount: number,
): ReadonlySet<number> | null {
  if (groupId === undefined) {
    return null
  }

  const match = /^analysis:(\d+)$/.exec(groupId)

  if (match === null) {
    throw new Error(`Unknown annotation grouping "${groupId}".`)
  }

  const groupingIndex = Number.parseInt(match[1] ?? '', 10)

  if (
    !Number.isInteger(groupingIndex) ||
    groupingIndex < 0 ||
    groupingIndex >= groupingCount
  ) {
    throw new Error(`Annotation grouping "${groupId}" is not available.`)
  }

  return new Set([groupingIndex])
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
