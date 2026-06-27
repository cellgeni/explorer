import { useCallback } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import type { BBox } from '../../data/coords'
import type { RoiSelectionInput } from '../../data/roiSelection'
import { normalizeRoiSelection } from '../../data/roiSelection'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import { cellExpressionSummaryFromGexCells } from '../cells/cellExpressionProfileModel'
import type {
  GeneExpressionLoader,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'
import {
  isVisiumHdExpressionProfileDataset,
  type VisiumHdExpressionProfileDataset,
} from '../app-shell/visiumHdAppController'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  MAGIC_LENS_CELL_LIMIT,
  filterExpressionBinsForCircle,
  summarizeMagicLensExpressionBins,
  summarizeMagicLensExpressionProfile,
  type MagicLensSummary,
} from './magicLensModel'
import type { MagicLensSummaryLoader } from './useMagicLensWorkflow'
import { selectVisiumHdGridCellsInRoi } from './visiumHdRoiModel'

interface UseVisiumHdMagicLensSummaryControls {
  readonly selectedBinSize: VisiumHdBinSizeMicrometers | undefined
}

interface UseVisiumHdMagicLensSummaryData {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly gridCells: readonly GridCellDatum[]
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly selectedGenes: readonly string[]
}

interface UseVisiumHdMagicLensSummaryLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadGeneExpression: GeneExpressionLoader
}

interface UseVisiumHdMagicLensSummaryOptions {
  readonly controls: UseVisiumHdMagicLensSummaryControls
  readonly data: UseVisiumHdMagicLensSummaryData
  readonly loaders: UseVisiumHdMagicLensSummaryLoaders
}

interface SummarizeVisiumHdMagicLensSelectionOptions {
  readonly baseUrl: string
  readonly controls: UseVisiumHdMagicLensSummaryControls
  readonly data: SummarizeVisiumHdMagicLensSelectionData
  readonly loaders: UseVisiumHdMagicLensSummaryLoaders
  readonly loaderOptions: Parameters<MagicLensSummaryLoader>[2]
  readonly selection: RoiSelectionInput
}

interface SummarizeVisiumHdMagicLensSelectionData {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly gridCells: readonly GridCellDatum[]
  readonly readyDatasetUrl: string | null
  readonly selectedGenes: readonly string[]
}

export function useVisiumHdMagicLensSummary({
  controls: { selectedBinSize },
  data: {
    currentViewportDetail,
    geneExpressionBatch,
    gridCells,
    loadState,
    selectedGenes,
  },
  loaders: { getSpatialDataset, loadGeneExpression },
}: UseVisiumHdMagicLensSummaryOptions): MagicLensSummaryLoader {
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  return useCallback<MagicLensSummaryLoader>(
    (baseUrl, selection, loaderOptions) =>
      summarizeVisiumHdMagicLensSelection({
        baseUrl,
        controls: { selectedBinSize },
        data: {
          currentViewportDetail,
          geneExpressionBatch,
          gridCells,
          readyDatasetUrl,
          selectedGenes,
        },
        loaders: {
          getSpatialDataset,
          loadGeneExpression,
        },
        loaderOptions,
        selection,
      }),
    [
      currentViewportDetail,
      geneExpressionBatch,
      getSpatialDataset,
      gridCells,
      loadGeneExpression,
      readyDatasetUrl,
      selectedBinSize,
      selectedGenes,
    ],
  )
}

export async function summarizeVisiumHdMagicLensSelection({
  baseUrl,
  controls: { selectedBinSize },
  data: {
    currentViewportDetail,
    geneExpressionBatch,
    gridCells,
    readyDatasetUrl,
    selectedGenes,
  },
  loaders: { getSpatialDataset, loadGeneExpression },
  loaderOptions,
  selection,
}: SummarizeVisiumHdMagicLensSelectionOptions): Promise<MagicLensSummary> {
  const normalizedSelection = normalizeRoiSelection(selection)
  const selectedBinsResult = selectVisiumHdGridCellsInRoi(
    gridCells,
    normalizedSelection,
    MAGIC_LENS_CELL_LIMIT,
  )
  const selectedBins =
    loaderOptions.circleFilter === null
      ? selectedBinsResult.bins
      : filterExpressionBinsForCircle(selectedBinsResult.bins, loaderOptions.circleFilter)

  if (selectedBins.length === 0) {
    return summarizeMagicLensExpressionBins(
      selectedBins.length,
      { cells: [], genes: selectedGenes },
      selectedGenes,
      { hitLimit: selectedBinsResult.hitBinLimit },
    )
  }

  const selectedBinIds = new Set(selectedBins.map((bin) => bin.barcode))
  const datasetUrl = readyDatasetUrl ?? baseUrl

  if (selectedGenes.length === 0) {
    const dataset = await getSpatialDataset(datasetUrl)

    if (!isVisiumHdExpressionProfileDataset(dataset)) {
      throw new Error('Loaded dataset does not expose Visium HD expression profiles.')
    }

    const profileDataset = dataset as VisiumHdExpressionProfileDataset
    const selectedBinBarcodes = selectedBins.map((bin) => bin.barcode)
    const matrix = await profileDataset.matrix(selectedBinBarcodes, selectedBinSize, {
      signal: loaderOptions.signal,
    })
    const expression = cellExpressionSummaryFromGexCells(matrix, selectedBinBarcodes)

    return summarizeMagicLensExpressionProfile(
      selectedBins.length,
      expression,
      selectedGenes,
      {
        hitLimit: selectedBinsResult.hitBinLimit || expression.hitGeneLimit,
      },
    )
  }

  const reusableExpressionBatch =
    loaderOptions.scope === 'viewport' &&
    geneExpressionBatch !== null &&
    currentViewportDetail !== null &&
    sameBbox(normalizedSelection.bbox, currentViewportDetail.bbox) &&
    sameGeneSet(geneExpressionBatch.genes, selectedGenes)
      ? geneExpressionBatch
      : null
  const expressionBatch =
    reusableExpressionBatch ??
    (await loadGeneExpression(datasetUrl, normalizedSelection.bbox, selectedGenes, {
      limit: MAGIC_LENS_CELL_LIMIT,
      signal: loaderOptions.signal,
    }))
  const filteredExpressionElements = expressionBatch.cells.filter((cell) =>
    selectedBinIds.has(cell.id),
  )
  const filteredMaxCount = filteredExpressionElements.reduce(
    (maxCount, cell) => Math.max(maxCount, cell.count),
    0,
  )
  const filteredExpressionBatch =
    filteredExpressionElements.length === expressionBatch.cells.length
      ? {
          ...expressionBatch,
          cells: filteredExpressionElements,
          maxCount: filteredMaxCount,
        }
      : {
          cells: filteredExpressionElements,
          genes: expressionBatch.genes,
          maxCount: filteredMaxCount,
        }

  return summarizeMagicLensExpressionBins(
    selectedBins.length,
    filteredExpressionBatch,
    selectedGenes,
    { hitLimit: selectedBinsResult.hitBinLimit },
  )
}

function sameBbox(left: BBox, right: BBox): boolean {
  return (
    left.minX === right.minX &&
    left.maxX === right.maxX &&
    left.minY === right.minY &&
    left.maxY === right.maxY
  )
}

function sameGeneSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  const rightKeys = new Set(right.map((gene) => gene.toLocaleLowerCase()))

  for (const gene of left) {
    if (!rightKeys.has(gene.toLocaleLowerCase())) {
      return false
    }
  }

  return true
}
