import type { CellFeatureMatrixReadOptions, GexResult } from '../../data/gexTypes'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { SpatialElement, SpatialElementId } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  visiumHdBarcodeMappingBinId,
  type VisiumHdBarcodeMapping,
} from '../../datasets/visiumHdBarcodeMappings'
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
    return dataset.barcodeMappingsForCell(cellId, { signal })
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

  for (const mapping of mappings) {
    if (mapping.cellId !== cellId || (!mapping.inCell && !mapping.inNucleus)) {
      continue
    }

    mappedBinIds.add(visiumHdBarcodeMappingBinId(mapping, binSizeMicrometers))
  }

  return [...mappedBinIds]
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
