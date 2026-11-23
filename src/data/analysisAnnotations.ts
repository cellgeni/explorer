import type { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { xeniumCellIdText } from './cellid'
import type { CellId } from './cellid'
import type { Annotation, AnnotationGroupOption } from './annotation'
import { cellFeatureMatrixRowIds } from './gex'
import { cachedZipFileStoreFromUrl } from '../zarr/cachedZipStore'

export interface AnalysisGroupingArrays {
  readonly groupingIndex?: number
  readonly groupingName: string
  readonly groupNames: readonly string[]
  readonly indptr: NumericIndexArray
  readonly indices: NumericIndexArray
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
): Promise<readonly AnnotationGroupOption[]> {
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
): readonly AnnotationGroupOption[] {
  const options: AnnotationGroupOption[] = []

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
  const groupingIndexes = Array.from(
    { length: metadata.groupingCount },
    (_, groupingIndex) => groupingIndex,
  ).filter(
    (groupingIndex) =>
      selectedGroupingIndexes === null || selectedGroupingIndexes.has(groupingIndex),
  )

  // Each grouping is several requests in a row, so they are read together:
  // "All" on a Xenium run is ten.
  return Promise.all(
    groupingIndexes.map(async (groupingIndex): Promise<AnalysisGroupingArrays> => {
      const group = await zarr.open(metadata.cellGroups.resolve(String(groupingIndex)), {
        kind: 'group',
      })
      const read = async (name: 'indptr' | 'indices') => {
        const array = await zarr.open(group.resolve(name), { kind: 'array' })
        return expectNumericIndexArray(
          (await zarr.get(array, [null])).data,
          `cell_groups/${groupingIndex}/${name}`,
        )
      }
      const [indptr, indices] = await Promise.all([read('indptr'), read('indices')])

      return {
        groupingIndex,
        groupingName:
          metadata.groupingNames[groupingIndex] ?? `Grouping ${groupingIndex + 1}`,
        groupNames: metadata.groupNames[groupingIndex] ?? [],
        indptr,
        indices,
      }
    }),
  )
}

async function readAnalysisGroupingMetadata(analysisUrl: string): Promise<{
  readonly cellGroups: zarr.Group<ZipFileStore>
  readonly groupingNames: readonly string[]
  readonly groupNames: readonly (readonly string[])[]
  readonly groupingCount: number
}> {
  // As the matrix is read: HEAD falls back to a one-byte GET on hosts that
  // allow GET only, and ranges go through the persistent byte-range cache.
  const store = cachedZipFileStoreFromUrl(analysisUrl)
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

// The matrix's cell ID per row, from the cell IDs the gene reads keep for
// the matrix, built from character codes: intToCellId took about 0.85 s for
// the demo's 1.4 million cells on every set load.
async function readCellIdsByMatrixRow(matrixUrl: string): Promise<readonly CellId[]> {
  const rowIds = await cellFeatureMatrixRowIds(matrixUrl)

  if (Array.isArray(rowIds)) {
    return rowIds as readonly CellId[]
  }

  const { pairs, stride, count } = rowIds as Exclude<typeof rowIds, readonly string[]>
  const cellIds = new Array<CellId>(count)

  for (let row = 0; row < count; row += 1) {
    const prefix = pairs[row * stride]
    const suffix = pairs[row * stride + 1]

    if (prefix === undefined || suffix === undefined) {
      throw new Error(`cell_features/cell_id row ${row} is incomplete.`)
    }

    cellIds[row] = xeniumCellIdText(prefix, suffix) as CellId
  }

  return cellIds
}

// Space Ranger's clustering names as the sets list them: `graphclust`,
// `kmeans 10`.
export function formatGroupingName(name: string): string {
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
