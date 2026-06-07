import { micrometers, type BBox } from '../../data/coords'
import type {
  TranscriptAggregateBin,
  TranscriptCapabilities,
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
  TranscriptGroupSummary,
  TranscriptPoint,
} from '../../data/transcriptOverlay'
import {
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
  type OverviewCellDatum,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  transcriptAggregateRenderedLabel,
  transcriptCapabilityLabel,
} from './transcriptLabels'

export const TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS = 12_000
export const TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO = 0.8
export const TRANSCRIPT_NATIVE_DENSITY_MAX_BINS = 1_500

const EMPTY_TRANSCRIPT_POINTS: readonly TranscriptPoint[] = []
const EMPTY_TRANSCRIPT_AGGREGATE_BINS: readonly TranscriptAggregateBin[] = []

export interface TranscriptLoadErrorSummary {
  readonly message: string
}

export type TranscriptCapabilityState<
  ErrorType extends TranscriptLoadErrorSummary = TranscriptLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly capabilities: TranscriptCapabilities
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type TranscriptLayerState<
  ErrorType extends TranscriptLoadErrorSummary = TranscriptLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'waiting'
      readonly message: string
      readonly visibleTranscriptEstimate: number
      readonly exactLoadRequestKey?: string
      readonly exactLoadEstimate?: number
    }
  | {
      readonly status: 'aggregate'
      readonly message: string
      readonly source: 'cell-summary' | 'native-zarr'
      readonly mode: 'density'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly visibleTranscriptEstimate: number
      readonly scaleMax?: number
      readonly durationMs?: number
    }
  | {
      readonly status: 'unavailable'
      readonly message: string
      readonly visibleTranscriptEstimate: number
    }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly visibleTranscriptEstimate: number
      readonly previousLayer?: TranscriptRetainedLayerState
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly points: readonly TranscriptPoint[]
      readonly groups: readonly TranscriptGroupSummary[]
      readonly visibleTranscriptEstimate: number
      readonly hitPointLimit: boolean
      readonly durationMs: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type TranscriptRetainedLayerState =
  | {
      readonly kind: 'exact'
      readonly points: readonly TranscriptPoint[]
    }
  | {
      readonly kind: 'aggregate'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly scaleMax?: number
    }

export function transcriptStatusCopy<ErrorType extends TranscriptLoadErrorSummary>(
  capabilityState: TranscriptCapabilityState<ErrorType>,
  layerState: TranscriptLayerState<ErrorType>,
  isEnabled: boolean,
): string {
  if (!isEnabled) {
    return 'Off'
  }

  if (capabilityState.status === 'loading') {
    return 'Checking'
  }

  if (layerState.status === 'loading') {
    return 'Loading'
  }

  if (layerState.status === 'ready') {
    return `${layerState.points.length.toLocaleString()} points`
  }

  if (layerState.status === 'aggregate') {
    return transcriptAggregateRenderedLabel(layerState.bins)
  }

  if (layerState.status === 'waiting') {
    return 'Waiting'
  }

  if (layerState.status === 'unavailable' || layerState.status === 'error') {
    return 'Unavailable'
  }

  if (capabilityState.status === 'ready') {
    return transcriptCapabilityLabel(capabilityState.capabilities)
  }

  return 'Idle'
}

export function transcriptPointsForRendering<
  ErrorType extends TranscriptLoadErrorSummary,
>(layerState: TranscriptLayerState<ErrorType>): readonly TranscriptPoint[] {
  if (layerState.status === 'ready') {
    return layerState.points
  }

  if (layerState.status === 'loading' && layerState.previousLayer?.kind === 'exact') {
    return layerState.previousLayer.points
  }

  return EMPTY_TRANSCRIPT_POINTS
}

export function transcriptAggregateBinsForRendering<
  ErrorType extends TranscriptLoadErrorSummary,
>(layerState: TranscriptLayerState<ErrorType>): readonly TranscriptAggregateBin[] {
  if (layerState.status === 'aggregate') {
    return layerState.bins
  }

  if (layerState.status === 'loading' && layerState.previousLayer?.kind === 'aggregate') {
    return layerState.previousLayer.bins
  }

  return EMPTY_TRANSCRIPT_AGGREGATE_BINS
}

export function transcriptAggregateScaleMaxForRendering<
  ErrorType extends TranscriptLoadErrorSummary,
>(layerState: TranscriptLayerState<ErrorType>): number | undefined {
  if (layerState.status === 'aggregate') {
    return layerState.scaleMax
  }

  if (layerState.status === 'loading' && layerState.previousLayer?.kind === 'aggregate') {
    return layerState.previousLayer.scaleMax
  }

  return undefined
}

export function transcriptDensityScaleValueLabels(
  scaleMax: number | undefined,
): readonly [string, string, string] {
  if (scaleMax === undefined || !Number.isFinite(scaleMax) || scaleMax <= 0) {
    return ['0', '-', '-']
  }

  return [
    '0',
    formatTranscriptDensityScaleValue(scaleMax * 0.5),
    formatTranscriptDensityScaleValue(scaleMax),
  ]
}

export function transcriptDensityScaleAriaLabel(scaleMax: number | undefined): string {
  if (scaleMax === undefined || !Number.isFinite(scaleMax) || scaleMax <= 0) {
    return 'Transcript density color scale values unavailable until density renders.'
  }

  return `Transcript density color scale from 0 to ${formatTranscriptDensityScaleValue(
    scaleMax,
  )} transcripts per square.`
}

export function retainedTranscriptLayerState<
  ErrorType extends TranscriptLoadErrorSummary,
>(layerState: TranscriptLayerState<ErrorType>): TranscriptRetainedLayerState | undefined {
  if (layerState.status === 'ready') {
    return {
      kind: 'exact',
      points: layerState.points,
    }
  }

  if (layerState.status === 'aggregate') {
    return {
      kind: 'aggregate',
      bins: layerState.bins,
      ...(layerState.scaleMax === undefined ? {} : { scaleMax: layerState.scaleMax }),
    }
  }

  if (layerState.status === 'loading') {
    return layerState.previousLayer
  }

  return undefined
}

export function isTranscriptDetailMode(value: string): value is TranscriptDetailMode {
  return value === 'auto' || value === 'density' || value === 'exact'
}

export function isTranscriptFeatureFilterMode(
  value: string,
): value is TranscriptFeatureFilterMode {
  return value === 'all' || value === 'selected'
}

export function parseTranscriptDensityColorScale(
  value: string | undefined,
): TranscriptDensityColorScale | undefined {
  return value !== undefined && isTranscriptDensityColorScale(value) ? value : undefined
}

export function parseTranscriptPointColorMode(
  value: string | undefined,
): TranscriptPointColorMode | undefined {
  return value !== undefined && isTranscriptPointColorMode(value) ? value : undefined
}

export function isTranscriptExactManualLoadRequired(
  estimate: number,
  exactPointLimit: number,
): boolean {
  return estimate >= exactPointLimit * TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO
}

export function transcriptExactManualLoadMessage(
  estimate: number,
  exactPointLimit: number,
): string {
  return `Exact transcript viewport is near the ${exactPointLimit.toLocaleString()} point budget (${estimate.toLocaleString()} estimated). Load exact viewport to fetch these points intentionally.`
}

export function parseTranscriptDetailMode(
  value: string | undefined,
): TranscriptDetailMode | undefined {
  if (value === 'bins') {
    return 'density'
  }

  return value !== undefined && isTranscriptDetailMode(value) ? value : undefined
}

export function parseTranscriptFeatureFilterMode(
  value: string | undefined,
): TranscriptFeatureFilterMode | undefined {
  return value !== undefined && isTranscriptFeatureFilterMode(value) ? value : undefined
}

export function normalizeTranscriptMinQv(value: number): number {
  if (!Number.isFinite(value)) {
    return 20
  }

  return Math.max(0, Math.min(40, Math.round(value)))
}

export function normalizeTranscriptPointSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 2
  }

  return Math.max(1, Math.min(6, Math.round(value)))
}

export function estimateVisibleTranscriptsFromCells(
  cells: readonly OverviewCellDatum[],
  bbox: BBox,
): number {
  let transcriptCount = 0

  for (const cell of cells) {
    const [x = 0, deckY = 0] = cell.position
    const rawY = -deckY

    if (x < bbox.minX || x > bbox.maxX || rawY < bbox.minY || rawY > bbox.maxY) {
      continue
    }

    transcriptCount += cell.transcriptCount ?? 0
  }

  return Math.max(0, Math.floor(transcriptCount))
}

export function buildCellSummaryTranscriptBins(
  cells: readonly OverviewCellDatum[],
  bbox: BBox,
  mode: 'density',
): readonly TranscriptAggregateBin[] {
  const width = Math.max(1, bbox.maxX - bbox.minX)
  const height = Math.max(1, bbox.maxY - bbox.minY)
  const targetAxisBins = 44
  const minBinSize = 24
  const binSize = Math.max(minBinSize, Math.max(width, height) / targetAxisBins)
  const radiusMicrometers = Math.max(3, Math.min(90, binSize * 0.45))
  const level = Math.max(0, Math.floor(Math.log2(Math.max(1, binSize / 10))))
  const bins = new Map<
    string,
    {
      readonly binX: number
      readonly binY: number
      count: number
    }
  >()

  for (const cell of cells) {
    const transcriptCount = cell.transcriptCount ?? 0

    if (transcriptCount <= 0) {
      continue
    }

    const [x = 0, deckY = 0] = cell.position
    const y = -deckY

    if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) {
      continue
    }

    const binX = Math.floor((x - bbox.minX) / binSize)
    const binY = Math.floor((y - bbox.minY) / binSize)
    const key = `${binX}:${binY}`
    const existing = bins.get(key)

    if (existing === undefined) {
      bins.set(key, { binX, binY, count: transcriptCount })
    } else {
      existing.count += transcriptCount
    }
  }

  return [...bins.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 4_096)
    .map((bin) => {
      const centerX = bbox.minX + (bin.binX + 0.5) * binSize
      const centerY = bbox.minY + (bin.binY + 0.5) * binSize

      return {
        id: `cell-summary:${mode}:${level}:${bin.binX}:${bin.binY}`,
        source: 'cell-summary',
        level,
        binX: bin.binX,
        binY: bin.binY,
        position: {
          x: micrometers(centerX),
          y: micrometers(centerY),
        },
        radiusMicrometers,
        binSizeMicrometers: binSize,
        count: Math.floor(bin.count),
      }
    })
}

export function maxTranscriptAggregateCount(
  bins: readonly TranscriptAggregateBin[],
): number {
  let maxCount = 0

  for (const bin of bins) {
    maxCount = Math.max(maxCount, bin.count)
  }

  return Math.max(1, maxCount)
}

export function transcriptNativeAggregateMessage({
  selectedFeatureCount,
  binCount,
}: {
  readonly mode: 'density'
  readonly selectedFeatureCount: number
  readonly binCount: number
}): string {
  const featureLabel =
    selectedFeatureCount > 0
      ? `${selectedFeatureCount.toLocaleString()} selected-feature`
      : 'all-transcript'

  return `Showing native ${featureLabel} density squares from transcripts.zarr.zip (${binCount.toLocaleString()} squares).`
}

export function transcriptAggregateFallbackMessage({
  featureFilterMode,
  selectedFeatureCount,
}: {
  readonly mode: 'density'
  readonly featureFilterMode: TranscriptFeatureFilterMode
  readonly selectedFeatureCount: number
}): string {
  const filterNote =
    featureFilterMode === 'selected' && selectedFeatureCount > 0
      ? ' Selected-gene filtering is applied by Exact.'
      : ''

  return `Showing all-gene cell-summary density squares for this viewport. Min QV and gene-only filters need exact points or native transcript LOD.${filterNote}`
}

function formatTranscriptDensityScaleValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
