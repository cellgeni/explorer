import type { RoiSelection } from '../../data/roiSelection'
import {
  isCellOutlineDataset,
  type CellOutlineRequest,
  type Platform,
  type SpatialElement,
} from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'
import type { CellExpressionProfileSelection } from '../cells/cellExpressionProfileModel'
import type { BoundaryLoadState, DatasetLoadState } from '../dataset/datasetLoadModel'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import type { RoiState } from '../roi/roiModel'
import { IDLE_VISIUM_HD_ROI_STATE, type VisiumHdRoiState } from '../roi/visiumHdRoiModel'
import type { AteraDataset } from '../../datasets/ateraDataset'
import type { ImportedSegmentation } from '../../datasets/importedSegmentation'
import { loadPerGeneCellTranscriptDistribution } from '../../data/datasetCellTranscripts'
import { loadPerGeneRoiTranscripts } from '../../data/roiTranscripts'
import type {
  BoundaryElementsLoader,
  CellTranscriptDistributionLoader,
  GeneExpressionLoader,
  RoiTranscriptsLoader,
  SpatialDatasetLoader,
  TranscriptAggregateLoader,
  TranscriptCapabilitiesLoader,
  TranscriptViewportLoader,
} from './appDependencies'
import {
  isSpatialGeneExpressionDataset,
  isSpatialSegmentationDataset,
} from './visiumHdAppController'

export type AppPlatformKind =
  | 'xenium'
  | 'atera'
  | 'visium'
  | 'visium-hd'
  | 'merscope'
  | 'h5ad'
  | 'spatialdata'
  | 'image'

// The platform as the top bar's summary and the info drawer name it.
export const PLATFORM_NAMES: Readonly<Record<AppPlatformKind, string>> = {
  xenium: 'Xenium',
  atera: 'Atera',
  visium: 'Visium',
  'visium-hd': 'Visium HD',
  merscope: 'MERSCOPE',
  h5ad: 'H5AD',
  spatialdata: 'SpatialData',
  image: 'Image',
}

export interface AppPlatformLabels {
  readonly embeddingElementPlural: 'cells' | 'bins' | 'spots'
}

export interface AppPlatformCapabilities {
  // Cells, spots or bins to draw and colour; a plain image has none, so it
  // has no Cells section or Cell card (15.2-C).
  readonly cells: boolean
  // The Magic Lens tool and tab.
  readonly magicLens: boolean
  readonly annotations: boolean
  readonly geometricAnnotations: boolean
  readonly nucleusBoundaries: boolean
  readonly transcripts: boolean
  // Selected-cell transcript z histogram, read from transcripts.zarr.zip.
  readonly cellTranscriptDistribution: boolean
  // The Transcripts section's gene-only filter; per-gene outputs only hold genes.
  readonly transcriptGeneOnlyFilter: boolean
  // The Segmentation section: outlines imported from a label mask or polygon
  // file onto a plain image.
  readonly segmentationImport: boolean
}

export interface PlatformMagicLensAvailability {
  readonly loadEnabled: boolean
  readonly unavailableReason?: string
}

export interface AppPlatformAdapter {
  readonly kind: AppPlatformKind
  readonly labels: AppPlatformLabels
  readonly capabilities: AppPlatformCapabilities
  readonly pointSizeFullViewScale: number
  // Points with a physical size (Visium spots) keep it at every zoom instead
  // of being capped to a few screen pixels.
  readonly trueSizePoints: boolean
  featureLoadEnabled(loadState: DatasetLoadState): boolean
  effectiveTranscriptOverlay(showTranscriptOverlay: boolean): boolean
  // Whether cell outlines are read. Nuclei are read on their own while their
  // checkbox is on (capabilities.nucleusBoundaries).
  cellBoundaryLoadingEnabled(showCellBoundaries: boolean): boolean
  geneExpressionOverlayEnabled(spatialGridCellCount: number): boolean
  cellBoundaryHoverEnabled(showCellBoundaries: boolean): boolean
  magicLensAvailability(
    loadState: DatasetLoadState,
    spatialGridCellCount: number,
  ): PlatformMagicLensAvailability
  canDrawRoi(options: PlatformRoiDrawOptions): boolean
}

export interface PlatformRoiDrawOptions {
  readonly isDatasetPreparationPending: boolean
  readonly loadState: DatasetLoadState
  readonly spatialGridCellCount: number
  readonly visiumHdControlState: VisiumHdControlState
}

const XENIUM_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'xenium',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: true,
    transcripts: true,
    cellTranscriptDistribution: true,
    transcriptGeneOnlyFilter: true,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: false,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: (showTranscriptOverlay) => showTranscriptOverlay,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: (loadState) => ({
    loadEnabled: loadState.status === 'ready',
  }),
  canDrawRoi: ({ isDatasetPreparationPending, loadState }) =>
    loadState.status === 'ready' && !isDatasetPreparationPending,
}

// Atera reads cells, genes, and annotations from the AnnData matrix like H5AD
// and SpatialData, draws boundaries from cells.zarr.zip, and reads transcripts
// per selected gene from binned_transcripts.zarr.zip and transcripts.zarr.zip.
const ATERA_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'atera',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: true,
    transcripts: true,
    cellTranscriptDistribution: true,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: false,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: (showTranscriptOverlay) => showTranscriptOverlay,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: (loadState) => ({
    loadEnabled: loadState.status === 'ready',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

const VISIUM_HD_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'visium-hd',
  labels: { embeddingElementPlural: 'bins' },
  capabilities: {
    cells: true,
    magicLens: true,
    // Space Ranger's clusterings of the 8 and 16 µm tiers.
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: true,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: false,
  featureLoadEnabled: () => false,
  effectiveTranscriptOverlay: () => false,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: (spatialGridCellCount) => spatialGridCellCount === 0,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: (loadState, spatialGridCellCount) => {
    const isReady = loadState.status === 'ready'

    return {
      loadEnabled: isReady && spatialGridCellCount > 0,
      ...(isReady && spatialGridCellCount === 0
        ? { unavailableReason: 'Bins pending' }
        : {}),
    }
  },
  canDrawRoi: ({ loadState, spatialGridCellCount, visiumHdControlState }) =>
    loadState.status === 'ready' &&
    spatialGridCellCount > 0 &&
    visiumHdControlState.status !== 'loading',
}

const H5AD_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'h5ad',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 0.5,
  trueSizePoints: false,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  // Cell boundaries come from a label image a manifest or collection pairs
  // with the table; without one the dataset returns none.
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for H5AD',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

// Standard Visium spots come from an AnnData table, either an .h5ad with
// `uns/spatial` or Space Ranger output read into one. Spots are drawn at
// their 55 µm size; outlines come from `dataset.elements(bbox)`.
const VISIUM_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'visium',
  labels: { embeddingElementPlural: 'spots' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: true,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for Visium',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

// MERSCOPE cells, genes, and annotations come from an AnnData table built
// from cell_by_gene.csv and cell_metadata.csv. Boundaries are read whole from
// one Parquet file when first shown; transcripts and images are not read.
const MERSCOPE_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'merscope',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: false,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for MERSCOPE',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

// Nuclei come from a nucleus shapes element (`nucleus_boundaries`); the
// checkbox shows only for stores that have one
// (`nucleusBoundaryControlsVisibleFor`). Cell outlines are read only while
// shown, so nuclei alone do not wait for the cell shapes.
const SPATIALDATA_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'spatialdata',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: true,
    magicLens: true,
    annotations: true,
    geometricAnnotations: true,
    nucleusBoundaries: true,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: false,
  },
  pointSizeFullViewScale: 0.5,
  trueSizePoints: false,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for SpatialData',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

const IMAGE_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'image',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    cells: false,
    magicLens: false,
    annotations: false,
    geometricAnnotations: true,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
    segmentationImport: true,
  },
  pointSizeFullViewScale: 1,
  trueSizePoints: false,
  featureLoadEnabled: () => false,
  effectiveTranscriptOverlay: () => false,
  // Outlines come from an imported segmentation; without one there are none
  // to count in view, so none are requested.
  cellBoundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  geneExpressionOverlayEnabled: () => false,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for image-only sources',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

export function appPlatformAdapterFor(
  loadState: DatasetLoadState,
  datasetPlatform: Platform | null,
): AppPlatformAdapter {
  if (loadState.status === 'ready' && datasetPlatform === 'image') {
    return IMAGE_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'visium-hd') {
    return VISIUM_HD_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'h5ad') {
    return H5AD_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'spatialdata') {
    return SPATIALDATA_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'visium') {
    return VISIUM_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'atera') {
    return ATERA_PLATFORM_ADAPTER
  }

  if (loadState.status === 'ready' && datasetPlatform === 'merscope') {
    return MERSCOPE_PLATFORM_ADAPTER
  }

  return XENIUM_PLATFORM_ADAPTER
}

// Whether the Cells section offers the `Nucleus boundaries` checkbox. A
// SpatialData store offers it only when it has a nucleus shapes element.
export function nucleusBoundaryControlsVisibleFor(
  adapter: AppPlatformAdapter,
  spatialDataNuclei: string | undefined,
): boolean {
  return (
    adapter.capabilities.nucleusBoundaries &&
    (adapter.kind !== 'spatialdata' || spatialDataNuclei !== undefined)
  )
}

export function isVisiumHdPlatform(adapter: AppPlatformAdapter): boolean {
  return adapter.kind === 'visium-hd'
}

export function isH5adPlatform(adapter: AppPlatformAdapter): boolean {
  return adapter.kind === 'h5ad'
}

// H5AD, Visium, SpatialData, Atera, and MERSCOPE read cells, genes,
// annotations, embeddings, and ROI queries from an AnnData table exposed by
// the spatial dataset.
export function isAnnDataPlatform(adapter: AppPlatformAdapter): boolean {
  return (
    adapter.kind === 'h5ad' ||
    adapter.kind === 'visium' ||
    adapter.kind === 'spatialdata' ||
    adapter.kind === 'atera' ||
    adapter.kind === 'merscope'
  )
}

// A Visium HD ROI holds bins of the tier drawn when it was drawn: the
// selected size, or the coarser tier drawn in its place zoomed out or while a
// switch loads. It stays while either is its tier.
export function activeVisiumHdRoiStateForPlatform(options: {
  readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly adapter: AppPlatformAdapter
  readonly drawnBinSize?: VisiumHdBinSizeMicrometers | undefined
  readonly loadState: DatasetLoadState
  readonly state: VisiumHdRoiState
}): VisiumHdRoiState {
  const { activeBinSize, adapter, drawnBinSize, loadState, state } = options

  if (
    adapter.kind !== 'visium-hd' ||
    loadState.status !== 'ready' ||
    state.status !== 'ready' ||
    state.url !== loadState.url ||
    (state.binSizeMicrometers !== activeBinSize &&
      (drawnBinSize === undefined || state.binSizeMicrometers !== drawnBinSize))
  ) {
    return IDLE_VISIUM_HD_ROI_STATE
  }

  return state
}

export function platformRoiElementIds(
  adapter: AppPlatformAdapter,
  roiState: RoiState,
  visiumHdRoiState: VisiumHdRoiState,
): readonly string[] {
  if (adapter.kind === 'image') {
    return []
  }

  if (adapter.kind === 'visium-hd') {
    return visiumHdRoiState.status === 'ready'
      ? visiumHdRoiState.bins.map((bin) => bin.barcode)
      : []
  }

  return roiState.status === 'ready' ? roiState.cells.map((cell) => cell.id) : []
}

export function platformRoiSelection(
  adapter: AppPlatformAdapter,
  roiState: RoiState,
  visiumHdRoiState: VisiumHdRoiState,
): RoiSelection | null {
  if (adapter.kind === 'image') {
    return null
  }

  if (adapter.kind === 'visium-hd') {
    return visiumHdRoiState.status === 'ready' ? visiumHdRoiState.selection : null
  }

  return roiState.status === 'idle' ? null : roiState.selection
}

export function platformSelectedEmbeddingElementId(
  adapter: AppPlatformAdapter,
  selectedCell: Pick<OverviewCellDatum, 'id'> | null,
  selectedGridCell: Pick<GridCellDatum, 'id'> | null,
): string | null {
  if (adapter.kind === 'image') {
    return null
  }

  return adapter.kind === 'visium-hd'
    ? (selectedGridCell?.id ?? null)
    : (selectedCell?.id ?? null)
}

export function platformAnalysisEmbeddingOptions(
  adapter: AppPlatformAdapter,
  activeBinSize: VisiumHdBinSizeMicrometers | undefined,
): { readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers } {
  return adapter.kind === 'visium-hd' && activeBinSize !== undefined
    ? { visiumHdBinSizeMicrometers: activeBinSize }
    : {}
}

export function platformBoundarySurfaceReserved(
  adapter: AppPlatformAdapter,
  options: {
    readonly boundaryState: BoundaryLoadState
    readonly expressionBoundaryCount: number
    readonly showCellBoundaries: boolean
  },
): boolean {
  return (
    adapter.kind === 'visium-hd' &&
    options.showCellBoundaries &&
    options.boundaryState.status === 'loading'
  )
}

export function platformActiveBoundaryCell(
  adapter: AppPlatformAdapter,
  selectedBoundaryCell: CellBoundaryDatum | null,
  boundaryLayerData: readonly CellBoundaryDatum[],
): CellBoundaryDatum | null {
  if (adapter.kind !== 'visium-hd' || selectedBoundaryCell === null) {
    return null
  }

  return boundaryLayerData.find((cell) => cell.id === selectedBoundaryCell.id) ?? null
}

export function platformExpressionProfileSelection(
  adapter: AppPlatformAdapter,
  activeBoundaryCell: Pick<CellBoundaryDatum, 'id'> | null,
  activeGridCell: Pick<GridCellDatum, 'id'> | null,
): CellExpressionProfileSelection | null {
  if (adapter.kind !== 'visium-hd') {
    return null
  }

  if (activeBoundaryCell !== null) {
    return {
      id: activeBoundaryCell.id,
      kind: 'cell',
    }
  }

  if (activeGridCell !== null) {
    return {
      id: activeGridCell.id,
      kind: 'bin',
    }
  }

  return null
}

export function platformRoiCompleteHandler<Handler>(
  adapter: AppPlatformAdapter,
  handlers: {
    readonly image?: Handler
    readonly visiumHd: Handler
    readonly xenium: Handler
  },
): Handler {
  if (adapter.kind === 'visium-hd') {
    return handlers.visiumHd
  }

  if (adapter.kind === 'image' && handlers.image !== undefined) {
    return handlers.image
  }

  return handlers.xenium
}

export async function loadPlatformBoundaryElements(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadBoundaryElements: BoundaryElementsLoader
    // An image's imported segmentation, the only outlines an image has.
    readonly importedSegmentation?: ImportedSegmentation | null
  },
  ...args: Parameters<BoundaryElementsLoader>
): ReturnType<BoundaryElementsLoader> {
  const [baseUrl, bbox, options = {}] = args

  if (adapter.kind === 'image') {
    return dependencies.importedSegmentation === undefined ||
      dependencies.importedSegmentation === null
      ? { elements: [] }
      : dependencies.importedSegmentation.outlines(bbox, options)
  }

  if (
    adapter.kind !== 'h5ad' &&
    adapter.kind !== 'visium-hd' &&
    adapter.kind !== 'visium' &&
    adapter.kind !== 'spatialdata' &&
    adapter.kind !== 'atera' &&
    adapter.kind !== 'merscope'
  ) {
    return dependencies.loadBoundaryElements(baseUrl, bbox, options)
  }

  const dataset = await dependencies.getSpatialDataset(baseUrl)
  const meta = await dataset.meta()

  if (!meta.capabilities.cellBoundaries) {
    return { elements: [] }
  }

  return options.plane === undefined
    ? dataset.elements(bbox)
    : dataset.elements(bbox, { plane: options.plane })
}

// Box reads in flight at once for a dataset without its own read for given
// cells.
const CELL_OUTLINE_BOX_READS = 3

// The outlines of a page of cells for the Cell Query pictures (plan 23-H):
// one read where the dataset has one for given cells (Xenium), otherwise the
// Cell card's box read around each cell, a few at a time.
export async function loadPlatformCellOutlines(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadBoundaryElements: BoundaryElementsLoader
  },
  baseUrl: string,
  cells: readonly CellOutlineRequest[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<ReadonlyMap<string, SpatialElement>> {
  const found = new Map<string, SpatialElement>()

  if (adapter.kind === 'image' || cells.length === 0) {
    return found
  }

  const dataset = await dependencies.getSpatialDataset(baseUrl)
  const meta = await dataset.meta()

  if (!meta.capabilities.cellBoundaries) {
    return found
  }

  if (isCellOutlineDataset(dataset)) {
    for (const element of await dataset.cellOutlines(cells, options)) {
      found.set(String(element.id), element)
    }
    return found
  }

  let next = 0
  const readNext = async (): Promise<void> => {
    while (next < cells.length && options.signal?.aborted !== true) {
      const cell = cells[next]
      next += 1
      if (cell === undefined) continue
      const batch = await loadPlatformBoundaryElements(
        adapter,
        dependencies,
        baseUrl,
        cell.bbox,
        options,
      )
      const element = batch.elements.find((candidate) => candidate.id === cell.id)
      if (element !== undefined) found.set(cell.id, element)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CELL_OUTLINE_BOX_READS, cells.length) }, readNext),
  )
  return found
}

export async function loadPlatformNucleusBoundaryElements(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
  },
  ...args: Parameters<BoundaryElementsLoader>
): ReturnType<BoundaryElementsLoader> {
  const [baseUrl, bbox] = args

  if (
    adapter.kind !== 'visium-hd' &&
    adapter.kind !== 'atera' &&
    adapter.kind !== 'xenium' &&
    adapter.kind !== 'spatialdata'
  ) {
    return { elements: [] }
  }

  const dataset = await dependencies.getSpatialDataset(baseUrl)
  const meta = await dataset.meta()
  const hasNucleusSegmentation =
    meta.segmentations?.some((segmentation) => segmentation.kind === 'nucleus') ?? false

  if (!hasNucleusSegmentation || !isSpatialSegmentationDataset(dataset)) {
    return { elements: [] }
  }

  return {
    elements: await dataset.segmentationElements('nucleus', bbox),
  }
}

export async function loadPlatformGeneExpression(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadGeneExpression: GeneExpressionLoader
  },
  ...args: Parameters<GeneExpressionLoader>
): ReturnType<GeneExpressionLoader> {
  const [baseUrl, bbox, genes, options = {}] = args
  const { visiumHdBinSizeMicrometers, ...geneExpressionOptions } = options

  if (adapter.kind === 'image') {
    return {
      genes,
      elements: [],
      population: 'all',
      maxCount: 0,
    }
  }

  if (adapter.kind === 'xenium') {
    return dependencies.loadGeneExpression(baseUrl, bbox, genes, geneExpressionOptions)
  }

  const dataset = await dependencies.getSpatialDataset(baseUrl)

  if (!isSpatialGeneExpressionDataset(dataset)) {
    throw new Error('Loaded dataset does not expose selected-gene expression.')
  }

  const binSizeMicrometers = visiumHdBinSizeMicrometers ?? dependencies.activeBinSize

  return dataset.geneExpression(bbox, genes, {
    ...geneExpressionOptions,
    ...(adapter.kind === 'visium-hd' && binSizeMicrometers !== undefined
      ? { binSizeMicrometers }
      : {}),
  })
}

type PerGeneTranscriptDataset = Pick<
  AteraDataset,
  'transcriptCapabilities' | 'transcriptAggregates' | 'transcriptViewport'
>

// Atera transcripts come from the dataset, per selected gene; every other
// platform keeps the Xenium transcript loaders.
export async function loadPlatformTranscriptCapabilities(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadTranscriptCapabilities: TranscriptCapabilitiesLoader
  },
  ...args: Parameters<TranscriptCapabilitiesLoader>
): ReturnType<TranscriptCapabilitiesLoader> {
  const [baseUrl, options = {}] = args

  if (adapter.kind !== 'atera') {
    return dependencies.loadTranscriptCapabilities(baseUrl, options)
  }

  return (
    await perGeneTranscriptDataset(dependencies.getSpatialDataset, baseUrl)
  ).transcriptCapabilities()
}

export async function loadPlatformTranscriptAggregates(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadTranscriptAggregates: TranscriptAggregateLoader
  },
  ...args: Parameters<TranscriptAggregateLoader>
): ReturnType<TranscriptAggregateLoader> {
  const [baseUrl, bbox, options = {}] = args

  if (adapter.kind !== 'atera') {
    return dependencies.loadTranscriptAggregates(baseUrl, bbox, options)
  }

  return (
    await perGeneTranscriptDataset(dependencies.getSpatialDataset, baseUrl)
  ).transcriptAggregates(bbox, {
    featureNames: options.featureNames ?? [],
    ...(options.maxBins === undefined ? {} : { maxBins: options.maxBins }),
    ...(options.minQv === undefined ? {} : { minQv: options.minQv }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

// Atera transcripts are all genes, so the gene-only filter does not apply.
export async function loadPlatformTranscriptViewport(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadTranscriptViewport: TranscriptViewportLoader
  },
  ...args: Parameters<TranscriptViewportLoader>
): ReturnType<TranscriptViewportLoader> {
  const [baseUrl, bbox, options = {}] = args

  if (adapter.kind !== 'atera') {
    return dependencies.loadTranscriptViewport(baseUrl, bbox, options)
  }

  return (
    await perGeneTranscriptDataset(dependencies.getSpatialDataset, baseUrl)
  ).transcriptViewport(bbox, {
    featureNames: options.featureNames ?? [],
    ...(options.pointLimit === undefined ? {} : { pointLimit: options.pointLimit }),
    ...(options.groupLimit === undefined ? {} : { groupLimit: options.groupLimit }),
    ...(options.minQv === undefined ? {} : { minQv: options.minQv }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

// Atera exports the selected genes' transcripts from transcripts.zarr.zip;
// the other AnnData platforms have no transcripts to export.
export async function loadPlatformRoiTranscripts(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadRoiTranscripts: RoiTranscriptsLoader
    readonly selectedGenes: readonly string[]
  },
  ...args: Parameters<RoiTranscriptsLoader>
): ReturnType<RoiTranscriptsLoader> {
  const [baseUrl, selection, options = {}] = args

  if (adapter.kind === 'atera') {
    const dataset = await perGeneTranscriptDataset(
      dependencies.getSpatialDataset,
      baseUrl,
    )

    return loadPerGeneRoiTranscripts(
      (bbox, readOptions) => dataset.transcriptViewport(bbox, readOptions),
      selection,
      { ...options, featureNames: dependencies.selectedGenes },
    )
  }

  if (!isAnnDataPlatform(adapter)) {
    return dependencies.loadRoiTranscripts(baseUrl, selection, options)
  }

  throw new Error(
    `${
      adapter.kind === 'merscope'
        ? PLATFORM_NAMES[adapter.kind]
        : adapter.kind === 'visium'
          ? 'Visium'
          : 'H5AD and SpatialData'
    } datasets do not support ROI transcript export.`,
  )
}

// Atera's cell histogram counts the selected genes inside the cell outline.
export async function loadPlatformCellTranscriptDistribution(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
    readonly loadCellTranscriptDistribution: CellTranscriptDistributionLoader
    readonly selectedGenes: readonly string[]
  },
  ...args: Parameters<CellTranscriptDistributionLoader>
): ReturnType<CellTranscriptDistributionLoader> {
  const [baseUrl, cellId, options = {}] = args

  if (adapter.kind !== 'atera') {
    return dependencies.loadCellTranscriptDistribution(baseUrl, cellId, options)
  }

  const { boundaryPolygon } = options

  if (boundaryPolygon === undefined) {
    throw new Error('Atera cell transcript z distribution needs the cell outline.')
  }

  const dataset = await perGeneTranscriptDataset(dependencies.getSpatialDataset, baseUrl)

  return loadPerGeneCellTranscriptDistribution(
    (bbox, readOptions) => dataset.transcriptViewport(bbox, readOptions),
    {
      featureNames: dependencies.selectedGenes,
      boundaryPolygon,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.minQv === undefined ? {} : { minQv: options.minQv }),
      ...(options.binCount === undefined ? {} : { binCount: options.binCount }),
    },
  )
}

async function perGeneTranscriptDataset(
  getSpatialDataset: SpatialDatasetLoader,
  baseUrl: string,
): Promise<PerGeneTranscriptDataset> {
  const dataset: unknown = await getSpatialDataset(baseUrl)

  if (
    !hasMethod(dataset, 'transcriptCapabilities') ||
    !hasMethod(dataset, 'transcriptAggregates') ||
    !hasMethod(dataset, 'transcriptViewport')
  ) {
    throw new Error('Loaded dataset does not expose per-gene transcripts.')
  }

  return dataset as PerGeneTranscriptDataset
}

function hasMethod(value: unknown, name: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[name] === 'function'
  )
}
