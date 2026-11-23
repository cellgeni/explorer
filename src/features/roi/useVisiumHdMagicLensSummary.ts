import { useCallback } from 'react'
import type { BBox } from '../../data/coords'
import type { RoiSelectionInput } from '../../data/roiSelection'
import { normalizeRoiSelection } from '../../data/roiSelection'
import type {
  GeneExpressionBatch,
  GeneExpressionGeneCount,
} from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellColumns } from '../../rendering/gridCellColumns'
import { cellExpressionSummaryFromGexCells } from '../cells/cellExpressionProfileModel'
import type {
  GeneExpressionLoader,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'
import {
  isVisiumHdExpressionProfileDataset,
  type VisiumHdExpressionProfileDataset,
} from '../app-shell/visiumHdAppController'
import { visiumHdDrawnBinSize } from '../app-shell/visiumHdGridLayerData'
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
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly gridCells: GridCellColumns
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
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly gridCells: GridCellColumns
  readonly readyDatasetUrl: string | null
  readonly selectedGenes: readonly string[]
}

export function useVisiumHdMagicLensSummary({
  controls: { selectedBinSize },
  data: { geneExpressionBatch, gridCells, loadState, selectedGenes },
  loaders: { getSpatialDataset, loadGeneExpression },
}: UseVisiumHdMagicLensSummaryOptions): MagicLensSummaryLoader {
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  return useCallback<MagicLensSummaryLoader>(
    (baseUrl, selection, loaderOptions) =>
      summarizeVisiumHdMagicLensSelection({
        baseUrl,
        controls: { selectedBinSize },
        data: {
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
  data: { geneExpressionBatch, gridCells, readyDatasetUrl, selectedGenes },
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
      { elements: [], genes: selectedGenes },
      selectedGenes,
      { hitLimit: selectedBinsResult.hitBinLimit },
    )
  }

  const selectedBinIds = new Set(selectedBins.map((bin) => bin.barcode))
  const datasetUrl = readyDatasetUrl ?? baseUrl
  // The bins under the lens are the drawn tier's, which is not the selected
  // size zoomed out with 2 µm selected or while a switch loads.
  const binSize = visiumHdDrawnBinSize(gridCells, selectedBinSize)

  if (selectedGenes.length === 0) {
    const dataset = await getSpatialDataset(datasetUrl)

    if (!isVisiumHdExpressionProfileDataset(dataset)) {
      throw new Error('Loaded dataset does not expose Visium HD expression profiles.')
    }

    const profileDataset = dataset as VisiumHdExpressionProfileDataset
    const selectedBinBarcodes = selectedBins.map((bin) => bin.barcode)
    const matrix = await profileDataset.matrix(selectedBinBarcodes, binSize, {
      signal: loaderOptions.signal,
    })
    // Every gene, so the card can count them; it lists the top ones.
    const expression = cellExpressionSummaryFromGexCells(
      matrix,
      selectedBinBarcodes,
      Number.MAX_SAFE_INTEGER,
    )

    return summarizeMagicLensExpressionProfile(
      selectedBins.length,
      expression,
      selectedGenes,
      {
        hitLimit: selectedBinsResult.hitBinLimit || expression.hitGeneLimit,
      },
    )
  }

  // The app's batch stands for the view only when it was read for a box
  // holding the view and for the bins drawn: zoomed out with 8 µm selected it
  // holds 16 µm bins, and just after a pan it holds the old view's.
  const reusableExpressionBatch =
    loaderOptions.scope === 'viewport' &&
    geneExpressionBatch !== null &&
    sameGeneSet(geneExpressionBatch.genes, selectedGenes) &&
    geneExpressionBatch.bbox !== undefined &&
    bboxContains(geneExpressionBatch.bbox, normalizedSelection.bbox) &&
    batchHoldsBinSize(geneExpressionBatch, gridCells.binSizeMicrometers)
      ? geneExpressionBatch
      : null
  // Expression is read for the selection's bounding box, and the reader keeps
  // the first `limit` bins of it. A lasso can hold fewer bins than the lens
  // limit while its box holds more, so the limit covers every bin the box can
  // hold, up to a cap; past the cap the summary says it may be incomplete.
  const boxBins = boxBinCapacity(normalizedSelection.bbox, binSize)
  const boxLimit = Math.min(
    Math.max(MAGIC_LENS_CELL_LIMIT, boxBins ?? 0),
    MAGIC_LENS_BOX_BIN_LIMIT,
  )
  const expressionBatch =
    reusableExpressionBatch ??
    (await loadGeneExpression(datasetUrl, normalizedSelection.bbox, selectedGenes, {
      limit: boxLimit,
      signal: loaderOptions.signal,
      ...(binSize === undefined ? {} : { visiumHdBinSizeMicrometers: binSize }),
    }))
  const filteredExpressionElements = expressionBatch.elements.filter((element) =>
    selectedBinIds.has(element.id),
  )
  const filteredMaxCount = filteredExpressionElements.reduce(
    (maxCount, element) => Math.max(maxCount, element.count),
    0,
  )
  // The reader's per-gene counts are for the whole box. When the circle
  // leaves some of its bins out, two or more genes are counted again over the
  // bins kept; one gene's count is the bins' total.
  const geneCounts =
    filteredExpressionElements.length === expressionBatch.elements.length
      ? expressionBatch.geneCounts
      : selectedGenes.length > 1 && filteredExpressionElements.length > 0
        ? await selectedGeneCounts(
            await getSpatialDataset(datasetUrl),
            filteredExpressionElements.map((element) => element.id),
            selectedGenes,
            selectedBinSize,
            loaderOptions.signal,
          )
        : undefined
  const filteredExpressionBatch = {
    elements: filteredExpressionElements,
    genes: expressionBatch.genes,
    maxCount: filteredMaxCount,
    ...(geneCounts === undefined ? {} : { geneCounts }),
  }

  return summarizeMagicLensExpressionBins(
    selectedBins.length,
    filteredExpressionBatch,
    selectedGenes,
    {
      hitLimit:
        selectedBinsResult.hitBinLimit ||
        (reusableExpressionBatch === null && (boxBins ?? 0) > boxLimit),
    },
  )
}

// Bins of the selection's box read for its expression at most; beyond this a
// lens over a thin, long lasso is marked as possibly incomplete.
const MAGIC_LENS_BOX_BIN_LIMIT = 200_000

// How many bins of `binSizeMicrometers` can meet `bbox`, allowing for a grid
// rotated against it; null without a bin size.
function boxBinCapacity(
  bbox: BBox,
  binSizeMicrometers: number | undefined,
): number | null {
  if (binSizeMicrometers === undefined || !(binSizeMicrometers > 0)) {
    return null
  }

  const columns = (bbox.maxX - bbox.minX) / binSizeMicrometers + 2
  const rows = (bbox.maxY - bbox.minY) / binSizeMicrometers + 2
  return Math.ceil(columns * rows)
}

function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.maxX >= inner.maxX &&
    outer.minY <= inner.minY &&
    outer.maxY >= inner.maxY
  )
}

function batchHoldsBinSize(
  batch: GeneExpressionBatch,
  binSizeMicrometers: number | undefined,
): boolean {
  return (
    binSizeMicrometers !== undefined &&
    batch.elements.length > 0 &&
    batch.elements.every((element) => element.binSizeMicrometers === binSizeMicrometers)
  )
}

// Each selected gene's count over `barcodes`, from their expression profiles.
async function selectedGeneCounts(
  dataset: unknown,
  barcodes: readonly string[],
  selectedGenes: readonly string[],
  binSize: VisiumHdBinSizeMicrometers | undefined,
  signal: AbortSignal,
): Promise<readonly GeneExpressionGeneCount[] | undefined> {
  if (!isVisiumHdExpressionProfileDataset(dataset)) {
    return undefined
  }

  const matrix = await (dataset as VisiumHdExpressionProfileDataset).matrix(
    barcodes,
    binSize,
    { signal },
  )
  const counts = new Map(selectedGenes.map((gene) => [gene.toLocaleLowerCase(), 0]))

  for (const barcode of barcodes) {
    const cell = matrix.cells.get(barcode)

    if (cell === undefined) {
      continue
    }

    for (let index = 0; index < cell.geneNames.length; index += 1) {
      const key = cell.geneNames[index]?.toLocaleLowerCase()
      const count = cell.counts[index] ?? 0

      if (key === undefined || !Number.isFinite(count)) {
        continue
      }

      const total = counts.get(key)

      if (total !== undefined) {
        counts.set(key, total + count)
      }
    }
  }

  return selectedGenes
    .map((gene) => ({ gene, count: counts.get(gene.toLocaleLowerCase()) ?? 0 }))
    .sort(
      (left, right) => right.count - left.count || left.gene.localeCompare(right.gene),
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
