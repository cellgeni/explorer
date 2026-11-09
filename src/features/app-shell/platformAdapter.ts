import type { RoiSelection } from '../../data/roiSelection'
import type { Platform } from '../../datasets/spatialDataset'
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
import type {
  BoundaryElementsLoader,
  GeneExpressionLoader,
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
  | 'visium-hd'
  | 'h5ad'
  | 'spatialdata'
  | 'image'

export interface AppPlatformLabels {
  readonly embeddingElementPlural: 'cells' | 'bins'
}

export interface AppPlatformCapabilities {
  readonly annotations: boolean
  readonly geometricAnnotations: boolean
  readonly magicLensMinQv: boolean
  readonly nucleusBoundaries: boolean
  readonly transcripts: boolean
  // Selected-cell transcript z histogram, read from transcripts.parquet.
  readonly cellTranscriptDistribution: boolean
  // The Transcripts tab's gene-only filter; per-gene outputs only hold genes.
  readonly transcriptGeneOnlyFilter: boolean
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
  featureLoadEnabled(loadState: DatasetLoadState): boolean
  effectiveTranscriptOverlay(showTranscriptOverlay: boolean): boolean
  boundaryLoadingEnabled(
    showCellBoundaries: boolean,
    showNucleusBoundaries: boolean,
  ): boolean
  boundaryOverlayRequestKey(
    showCellBoundaries: boolean,
    showNucleusBoundaries: boolean,
  ): string
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
    annotations: true,
    geometricAnnotations: true,
    magicLensMinQv: true,
    nucleusBoundaries: false,
    transcripts: true,
    cellTranscriptDistribution: true,
    transcriptGeneOnlyFilter: true,
  },
  pointSizeFullViewScale: 1,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: (showTranscriptOverlay) => showTranscriptOverlay,
  boundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  boundaryOverlayRequestKey: (showCellBoundaries) =>
    `${showCellBoundaries ? 'enabled' : 'disabled'}:no-nucleus`,
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
    annotations: true,
    geometricAnnotations: true,
    magicLensMinQv: false,
    nucleusBoundaries: true,
    transcripts: true,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
  },
  pointSizeFullViewScale: 1,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: (showTranscriptOverlay) => showTranscriptOverlay,
  boundaryLoadingEnabled: (showCellBoundaries, showNucleusBoundaries) =>
    showCellBoundaries || showNucleusBoundaries,
  boundaryOverlayRequestKey: (showCellBoundaries, showNucleusBoundaries) => {
    const enabled = showCellBoundaries || showNucleusBoundaries
    const nucleus = showNucleusBoundaries ? 'nucleus' : 'no-nucleus'

    return `${enabled ? 'enabled' : 'disabled'}:${nucleus}`
  },
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: (showCellBoundaries) => showCellBoundaries,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for Atera',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

const VISIUM_HD_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'visium-hd',
  labels: { embeddingElementPlural: 'bins' },
  capabilities: {
    annotations: false,
    geometricAnnotations: true,
    magicLensMinQv: false,
    nucleusBoundaries: true,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
  },
  pointSizeFullViewScale: 1,
  featureLoadEnabled: () => false,
  effectiveTranscriptOverlay: () => false,
  boundaryLoadingEnabled: (showCellBoundaries, showNucleusBoundaries) =>
    showCellBoundaries || showNucleusBoundaries,
  boundaryOverlayRequestKey: (showCellBoundaries, showNucleusBoundaries) => {
    const enabled = showCellBoundaries || showNucleusBoundaries
    const nucleus = showNucleusBoundaries ? 'nucleus' : 'no-nucleus'

    return `${enabled ? 'enabled' : 'disabled'}:${nucleus}`
  },
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
    annotations: true,
    geometricAnnotations: true,
    magicLensMinQv: false,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
  },
  pointSizeFullViewScale: 0.5,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  boundaryLoadingEnabled: () => false,
  boundaryOverlayRequestKey: () => 'disabled:no-nucleus',
  geneExpressionOverlayEnabled: () => true,
  cellBoundaryHoverEnabled: () => false,
  magicLensAvailability: () => ({
    loadEnabled: false,
    unavailableReason: 'Unavailable for H5AD',
  }),
  canDrawRoi: ({ loadState }) => loadState.status === 'ready',
}

const SPATIALDATA_PLATFORM_ADAPTER: AppPlatformAdapter = {
  kind: 'spatialdata',
  labels: { embeddingElementPlural: 'cells' },
  capabilities: {
    annotations: true,
    geometricAnnotations: true,
    magicLensMinQv: false,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
  },
  pointSizeFullViewScale: 0.5,
  featureLoadEnabled: (loadState) => loadState.status === 'ready',
  effectiveTranscriptOverlay: () => false,
  boundaryLoadingEnabled: (showCellBoundaries) => showCellBoundaries,
  boundaryOverlayRequestKey: (showCellBoundaries) =>
    `${showCellBoundaries ? 'enabled' : 'disabled'}:no-nucleus`,
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
    annotations: false,
    geometricAnnotations: true,
    magicLensMinQv: false,
    nucleusBoundaries: false,
    transcripts: false,
    cellTranscriptDistribution: false,
    transcriptGeneOnlyFilter: false,
  },
  pointSizeFullViewScale: 1,
  featureLoadEnabled: () => false,
  effectiveTranscriptOverlay: () => false,
  boundaryLoadingEnabled: () => false,
  boundaryOverlayRequestKey: () => 'disabled:no-nucleus',
  geneExpressionOverlayEnabled: () => false,
  cellBoundaryHoverEnabled: () => false,
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

  if (loadState.status === 'ready' && datasetPlatform === 'atera') {
    return ATERA_PLATFORM_ADAPTER
  }

  return XENIUM_PLATFORM_ADAPTER
}

export function isVisiumHdPlatform(adapter: AppPlatformAdapter): boolean {
  return adapter.kind === 'visium-hd'
}

export function isH5adPlatform(adapter: AppPlatformAdapter): boolean {
  return adapter.kind === 'h5ad'
}

// H5AD, SpatialData, and Atera read cells, genes, annotations, embeddings,
// and ROI queries from an AnnData table exposed by the spatial dataset.
export function isAnnDataPlatform(adapter: AppPlatformAdapter): boolean {
  return (
    adapter.kind === 'h5ad' || adapter.kind === 'spatialdata' || adapter.kind === 'atera'
  )
}

export function activeVisiumHdRoiStateForPlatform(options: {
  readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly adapter: AppPlatformAdapter
  readonly loadState: DatasetLoadState
  readonly state: VisiumHdRoiState
}): VisiumHdRoiState {
  const { activeBinSize, adapter, loadState, state } = options

  if (
    adapter.kind !== 'visium-hd' ||
    loadState.status !== 'ready' ||
    state.status !== 'ready' ||
    state.url !== loadState.url ||
    state.binSizeMicrometers !== activeBinSize
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
  },
  ...args: Parameters<BoundaryElementsLoader>
): ReturnType<BoundaryElementsLoader> {
  const [baseUrl, bbox, options = {}] = args

  if (adapter.kind === 'h5ad' || adapter.kind === 'image') {
    return { elements: [] }
  }

  if (
    adapter.kind !== 'visium-hd' &&
    adapter.kind !== 'spatialdata' &&
    adapter.kind !== 'atera'
  ) {
    return dependencies.loadBoundaryElements(baseUrl, bbox, options)
  }

  const dataset = await dependencies.getSpatialDataset(baseUrl)
  const meta = await dataset.meta()

  if (!meta.capabilities.cellBoundaries) {
    return { elements: [] }
  }

  return dataset.elements(bbox)
}

export async function loadPlatformNucleusBoundaryElements(
  adapter: AppPlatformAdapter,
  dependencies: {
    readonly getSpatialDataset: SpatialDatasetLoader
  },
  ...args: Parameters<BoundaryElementsLoader>
): ReturnType<BoundaryElementsLoader> {
  const [baseUrl, bbox] = args

  if (adapter.kind !== 'visium-hd' && adapter.kind !== 'atera') {
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
