import type {
  CellFeatureMatrixReadOptions,
  GexCell,
  GexResult,
} from '../../data/gexTypes'
import type {
  GeneExpressionBatch,
  SpatialElement,
  SpatialElementId,
} from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  visiumHdBarcodeMappingBinId,
  type VisiumHdBarcodeMapping,
} from '../../datasets/visiumHdBarcodeMappings'
import { visiumHdSegmentationCellId } from '../../datasets/visiumHdSegmentationIndex'
import type {
  VisiumHdBinBarcodeShares,
  VisiumHdExpressionCellAssignment,
} from '../genes/visiumHdExpressionProjection'
import type { BBox } from '../../data/coords'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { GeneExpressionLoader } from './appDependencies'

export interface SpatialGeneExpressionDataset {
  readonly geneExpression: (
    bbox: Parameters<GeneExpressionLoader>[1],
    genes: readonly string[],
    options?: Parameters<GeneExpressionLoader>[3] & {
      readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
    },
  ) => Promise<GeneExpressionBatch>
}

export interface VisiumHdExpressionProfileDataset {
  readonly matrix: (
    ids: readonly SpatialElementId[],
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: CellFeatureMatrixReadOptions,
  ) => Promise<GexResult<SpatialElementId>>
}

export interface VisiumHdBarcodeMappingsDataset extends VisiumHdExpressionProfileDataset {
  readonly barcodeMappings: (options: {
    readonly maxRows?: number
    readonly signal?: AbortSignal
  }) => Promise<readonly VisiumHdBarcodeMapping[]>
}

export interface VisiumHdCellBarcodeMappingsDataset extends VisiumHdExpressionProfileDataset {
  readonly barcodeMappingsForCell: (
    cellId: SpatialElementId,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdBarcodeMapping[]>
}

export interface VisiumHdBarcodeAssignmentsDataset {
  readonly barcodeMappingAssignments: (
    binSizeMicrometers: VisiumHdBinSizeMicrometers,
    binIds: readonly SpatialElementId[],
    options: { readonly maxRows?: number; readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdExpressionCellAssignment[]>
}

export interface SpatialSegmentationDataset {
  segmentationElements(
    kind: 'cell' | 'nucleus',
    bbox: BBox,
    binSizeMicrometers?: number,
  ): Promise<readonly SpatialElement<SpatialElementId>[]>
}

export function isSpatialGeneExpressionDataset(
  dataset: unknown,
): dataset is SpatialGeneExpressionDataset {
  return hasFunction(dataset, 'geneExpression')
}

export function isVisiumHdExpressionProfileDataset(
  dataset: unknown,
): dataset is VisiumHdExpressionProfileDataset {
  return hasFunction(dataset, 'matrix')
}

export function isVisiumHdBarcodeMappingsDataset(
  dataset: unknown,
): dataset is VisiumHdBarcodeMappingsDataset {
  return (
    isVisiumHdExpressionProfileDataset(dataset) && hasFunction(dataset, 'barcodeMappings')
  )
}

export function isVisiumHdCellBarcodeMappingsDataset(
  dataset: unknown,
): dataset is VisiumHdCellBarcodeMappingsDataset {
  return (
    isVisiumHdExpressionProfileDataset(dataset) &&
    hasFunction(dataset, 'barcodeMappingsForCell')
  )
}

export function isVisiumHdBarcodeAssignmentsDataset(
  dataset: unknown,
): dataset is VisiumHdBarcodeAssignmentsDataset {
  return hasFunction(dataset, 'barcodeMappingAssignments')
}

export function isSpatialSegmentationDataset(
  dataset: unknown,
): dataset is SpatialSegmentationDataset {
  return hasFunction(dataset, 'segmentationElements')
}

export async function selectedVisiumHdCellMappings(
  dataset: unknown,
  cellId: SpatialElementId,
  rowBudget: number | undefined,
  signal: AbortSignal,
): Promise<readonly VisiumHdBarcodeMapping[]> {
  if (isVisiumHdCellBarcodeMappingsDataset(dataset)) {
    return dataset.barcodeMappingsForCell(visiumHdSegmentationCellId(cellId), { signal })
  }

  if (!isVisiumHdBarcodeMappingsDataset(dataset)) {
    throw new Error('Loaded dataset does not expose Visium HD barcode mappings.')
  }

  return dataset.barcodeMappings({
    ...(rowBudget === undefined ? {} : { maxRows: rowBudget }),
    signal,
  })
}

export function selectedVisiumHdProfileBinSize(
  activeBinSize: VisiumHdBinSizeMicrometers | undefined,
  selectedGridCell: GridCellDatum | null,
): VisiumHdBinSizeMicrometers | undefined {
  if (activeBinSize !== undefined) {
    return activeBinSize
  }

  return isVisiumHdBinSizeMicrometers(selectedGridCell?.binSizeMicrometers)
    ? selectedGridCell.binSizeMicrometers
    : undefined
}

export function selectedVisiumHdCellMappedBinIds(
  mappings: readonly VisiumHdBarcodeMapping[],
  cellId: SpatialElementId,
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
): readonly SpatialElementId[] {
  const mappedBinIds = new Set<SpatialElementId>()
  // Every part of a MultiPolygon cell maps to the cell's bins (EXP-220).
  const mappedCellId = visiumHdSegmentationCellId(cellId)

  for (const mapping of mappings) {
    if (mapping.cellId !== mappedCellId || (!mapping.inCell && !mapping.inNucleus)) {
      continue
    }

    mappedBinIds.add(visiumHdBarcodeMappingBinId(mapping, binSizeMicrometers))
  }

  return [...mappedBinIds]
}

// A segmented cell's part of its bins' counts: each bin's counts times the
// cell's share of the bin's 2 µm barcodes, as its selected-gene score is
// shared (visiumHdBinBarcodeShares). An 8 or 16 µm bin's counts also hold
// other cells' and unassigned barcodes.
export function visiumHdCellShareOfBins(
  matrix: GexResult<SpatialElementId>,
  shares: ReadonlyMap<SpatialElementId, VisiumHdBinBarcodeShares>,
  cellId: SpatialElementId,
): GexResult<SpatialElementId> {
  const mappedCellId = visiumHdSegmentationCellId(cellId)
  const cells = new Map<SpatialElementId, GexCell>()

  for (const [binId, cell] of matrix.cells) {
    const binShares = shares.get(binId)
    const share =
      binShares === undefined || binShares.barcodeCount === 0
        ? 0
        : (binShares.cells.get(mappedCellId) ?? 0) / binShares.barcodeCount

    cells.set(binId, {
      geneNames: cell.geneNames,
      counts: cell.counts.map((count) => count * share),
    })
  }

  return { geneNames: matrix.geneNames, cells }
}

export function isVisiumHdBinSizeMicrometers(
  value: number | undefined,
): value is VisiumHdBinSizeMicrometers {
  return value === 2 || value === 8 || value === 16
}

export function formatMappingRowsScope(rowBudget: number | undefined): string {
  return rowBudget === undefined
    ? 'all available mapping rows'
    : `up to ${rowBudget.toLocaleString()} mapping rows`
}

function hasFunction<T extends string>(
  value: unknown,
  property: T,
): value is Record<T, (...args: never[]) => unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    property in value &&
    typeof value[property as keyof typeof value] === 'function'
  )
}
