import {
  loadDatasetAnnotationGroups,
  loadDatasetAnnotations,
  type AnnotationGroupOption,
  type LoadDatasetAnnotationsOptions,
} from '../../data/datasetAnnotations'
import { loadDatasetBoundaryElements } from '../../data/datasetBoundaries'
import {
  loadDatasetAnalysisEmbeddings,
  type LoadDatasetAnalysisEmbeddingsOptions,
} from '../../data/analysisEmbeddings'
import { loadDatasetGeneExpression } from '../../data/geneExpression'
import { loadDatasetOverview } from '../../data/datasetOverview'
import {
  warmDatasetForRoi,
  type WarmDatasetForRoiOptions,
  type WarmDatasetForRoiResult,
} from '../../data/datasetWarmup'
import { loadGenePanel } from '../../data/genePanel'
import {
  loadCustomMorphologyLayer,
  loadMorphologyImage,
} from '../../data/morphologyImage'
import { loadDatasetRoiCells } from '../../data/roiCells'
import { loadDatasetRoiGeneStats, type RoiGeneStats } from '../../data/roiGeneStats'
import { loadDatasetRoiTranscripts } from '../../data/roiTranscripts'
import {
  loadDatasetCellTranscriptDistribution,
  type CellTranscriptZDistribution,
} from '../../data/cellTranscripts'
import {
  loadDatasetTranscriptCapabilities,
  loadDatasetTranscriptAggregates,
  loadDatasetTranscriptViewport,
  type TranscriptCapabilities,
  type TranscriptAggregateResult,
  type TranscriptGroupSummary,
  type TranscriptPoint,
} from '../../data/transcriptOverlay'
import { runDatasetDiagnostics } from '../../data/datasetDiagnostics'
import {
  cachedSpatialDataset,
  detectSpatialDataset,
  type AnySpatialDataset,
  type CachedSpatialDatasetOptions,
  type DetectSpatialDatasetOptions,
  type SpatialDatasetDetection,
} from '../../datasets/datasetFactory'
import type { BBox, DataPoint } from '../../data/coords'
import type { CellId } from '../../data/cellid'
import type { GeneExpressionStageTimingHandler } from '../../data/geneExpressionTiming'
import type { ChannelAutoContrast } from '../../data/morphologyContrast'
import type { CellOverviewPoint } from '../../data/hyparquetCells'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import type { AnalysisEmbedding } from '../../data/analysisEmbeddings'
import type {
  DatasetCell,
  DatasetTranscript,
  GeneExpressionBatch,
} from '../../datasets/xeniumDataset'
import type { Annotation, ElementBatch } from '../../datasets/spatialDataset'
import type { RoiSelectionInput } from '../../data/roiSelection'

export type DatasetOverviewLoader = (
  baseUrl: string,
  options?: {
    readonly limit?: number | null
    readonly includeCellIds?: boolean
    readonly signal?: AbortSignal
  },
) => Promise<readonly CellOverviewPoint[]>

export type MorphologyImageLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<MorphologyImage>

export type CustomMorphologyLayerLoader = (
  imageUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<MorphologyImage>

export type BoundaryElementsLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: { readonly signal?: AbortSignal },
) => Promise<ElementBatch>

export type GenePanelLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly string[]>

export type AnnotationLoader = (
  baseUrl: string,
  options?: LoadDatasetAnnotationsOptions,
) => Promise<readonly Annotation[]>

export type AnnotationGroupLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly AnnotationGroupOption[]>

export type AnalysisEmbeddingsLoader = (
  baseUrl: string,
  options?: LoadDatasetAnalysisEmbeddingsOptions,
) => Promise<readonly AnalysisEmbedding[]>

export type RoiCellsLoader = (
  baseUrl: string,
  selection: RoiSelectionInput,
  options?: { readonly signal?: AbortSignal; readonly limit?: number },
) => Promise<readonly DatasetCell[]>

export type RoiGeneStatsLoader = (
  baseUrl: string,
  cells: readonly DatasetCell[],
  options?: {
    readonly signal?: AbortSignal
    readonly cellLimit?: number
    readonly geneLimit?: number
    readonly sampleStrategy?: 'stratified' | 'head'
  },
) => Promise<RoiGeneStats>

export type RoiTranscriptsLoader = (
  baseUrl: string,
  selection: RoiSelectionInput,
  options?: {
    readonly signal?: AbortSignal
    readonly limit?: number
    readonly minQv?: number
  },
) => Promise<readonly DatasetTranscript[]>

export type CellTranscriptDistributionLoader = (
  baseUrl: string,
  cellId: CellId,
  options?: {
    readonly signal?: AbortSignal
    readonly limit?: number
    readonly minQv?: number
    readonly binCount?: number
    readonly bbox?: BBox
    readonly boundaryPolygon?: readonly DataPoint[]
  },
) => Promise<CellTranscriptZDistribution>

export type TranscriptCapabilitiesLoader = (
  baseUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<TranscriptCapabilities>

export type TranscriptAggregateLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: {
    readonly signal?: AbortSignal
    readonly mode?: 'density'
    readonly featureNames?: readonly string[]
    readonly maxBins?: number
  },
) => Promise<TranscriptAggregateResult>

export type TranscriptViewportLoader = (
  baseUrl: string,
  bbox: BBox,
  options?: {
    readonly signal?: AbortSignal
    readonly pointLimit?: number
    readonly groupLimit?: number
    readonly minQv?: number
    readonly geneOnly?: boolean
    readonly featureNames?: readonly string[]
  },
) => Promise<{
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly hitPointLimit: boolean
}>

export type GeneExpressionLoader = (
  baseUrl: string,
  bbox: BBox,
  genes: readonly string[],
  options?: {
    readonly limit?: number
    readonly sampleStride?: number
    readonly signal?: AbortSignal
    readonly onStageTiming?: GeneExpressionStageTimingHandler
  },
) => Promise<GeneExpressionBatch>

export type AutoChannelContrastLoader = (
  channel: MorphologyImageChannel,
  options?: { readonly signal?: AbortSignal },
) => Promise<ChannelAutoContrast>

export type DatasetWarmupLoader = (
  baseUrl: string,
  options?: Pick<WarmDatasetForRoiOptions, 'signal' | 'onCellFeatureMatrixCapability'>,
) => Promise<WarmDatasetForRoiResult | void>

export type DatasetDiagnosticsRunner = typeof runDatasetDiagnostics
export type SpatialDatasetDetector = (
  baseUrl: string,
  options?: DetectSpatialDatasetOptions,
) => Promise<SpatialDatasetDetection>
export type SpatialDatasetLoader = (
  baseUrl: string,
  options?: CachedSpatialDatasetOptions,
) => Promise<AnySpatialDataset>

export interface AppProps {
  readonly loadDatasetOverview?: DatasetOverviewLoader
  readonly loadMorphologyImage?: MorphologyImageLoader
  readonly loadCustomMorphologyLayer?: CustomMorphologyLayerLoader
  readonly loadBoundaryElements?: BoundaryElementsLoader
  readonly loadGenePanel?: GenePanelLoader
  readonly loadAnnotations?: AnnotationLoader
  readonly loadAnnotationGroups?: AnnotationGroupLoader
  readonly loadAnalysisEmbeddings?: AnalysisEmbeddingsLoader
  readonly loadRoiCells?: RoiCellsLoader
  readonly loadRoiGeneStats?: RoiGeneStatsLoader
  readonly loadRoiTranscripts?: RoiTranscriptsLoader
  readonly loadCellTranscriptDistribution?: CellTranscriptDistributionLoader
  readonly loadTranscriptCapabilities?: TranscriptCapabilitiesLoader
  readonly loadTranscriptAggregates?: TranscriptAggregateLoader
  readonly loadTranscriptViewport?: TranscriptViewportLoader
  readonly loadGeneExpression?: GeneExpressionLoader
  readonly warmDatasetForRoi?: DatasetWarmupLoader
  readonly runDatasetDiagnostics?: DatasetDiagnosticsRunner
  readonly detectSpatialDataset?: SpatialDatasetDetector
  readonly getSpatialDataset?: SpatialDatasetLoader
  readonly computeAutoChannelContrast?: AutoChannelContrastLoader
}

export const defaultAppDependencies = {
  loadDatasetOverview,
  loadMorphologyImage,
  loadCustomMorphologyLayer,
  loadBoundaryElements: loadDatasetBoundaryElements,
  loadGenePanel,
  loadAnnotations: loadDatasetAnnotations,
  loadAnnotationGroups: loadDatasetAnnotationGroups,
  loadAnalysisEmbeddings: loadDatasetAnalysisEmbeddings,
  loadRoiCells: loadDatasetRoiCells,
  loadRoiGeneStats: loadDatasetRoiGeneStats,
  loadRoiTranscripts: loadDatasetRoiTranscripts,
  loadCellTranscriptDistribution: loadDatasetCellTranscriptDistribution,
  loadTranscriptCapabilities: loadDatasetTranscriptCapabilities,
  loadTranscriptAggregates: loadDatasetTranscriptAggregates,
  loadTranscriptViewport: loadDatasetTranscriptViewport,
  loadGeneExpression: loadDatasetGeneExpression,
  warmDatasetForRoi,
  runDatasetDiagnostics,
  detectSpatialDataset,
  getSpatialDataset: cachedSpatialDataset,
  computeAutoChannelContrast: defaultComputeAutoChannelContrast,
} satisfies Required<AppProps>

async function defaultComputeAutoChannelContrast(
  channel: MorphologyImageChannel,
  options?: { readonly signal?: AbortSignal },
): Promise<ChannelAutoContrast> {
  const morphologyContrast = await import('../../data/morphologyContrast')

  return morphologyContrast.computeChannelAutoContrast(channel.loader, options)
}
