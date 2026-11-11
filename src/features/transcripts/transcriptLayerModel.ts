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
  transcriptGenesLabel,
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
      // The genes the squares count; empty when they count all transcripts.
      readonly featureNames: readonly string[]
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
      // What showed before the load, for Cancel (15.3-D).
      readonly previousState?: SettledTranscriptLayerState<ErrorType>
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

export type SettledTranscriptLayerState<
  ErrorType extends TranscriptLoadErrorSummary = TranscriptLoadErrorSummary,
> = Exclude<TranscriptLayerState<ErrorType>, { readonly status: 'loading' }>

export const IDLE_TRANSCRIPT_CAPABILITY_STATE: TranscriptCapabilityState<never> = {
  status: 'idle',
}
export const IDLE_TRANSCRIPT_LAYER_STATE: TranscriptLayerState<never> = {
  status: 'idle',
}

export function transcriptCapabilityStarted(
  url: string,
): TranscriptCapabilityState<never> {
  return { status: 'loading', url }
}

export function transcriptCapabilityReady(
  url: string,
  capabilities: TranscriptCapabilities,
): TranscriptCapabilityState<never> {
  return { status: 'ready', url, capabilities }
}

export function transcriptCapabilityFailed<ErrorType extends TranscriptLoadErrorSummary>(
  url: string,
  error: ErrorType,
): TranscriptCapabilityState<ErrorType> {
  return { status: 'error', url, error }
}

interface TranscriptLayerWaitingOptions {
  readonly message: string
  readonly visibleTranscriptEstimate: number
  readonly exactLoadRequestKey?: string
  readonly exactLoadEstimate?: number
}

export function transcriptLayerWaiting({
  exactLoadEstimate,
  exactLoadRequestKey,
  message,
  visibleTranscriptEstimate,
}: TranscriptLayerWaitingOptions): TranscriptLayerState<never> {
  return {
    status: 'waiting',
    message,
    visibleTranscriptEstimate,
    ...(exactLoadRequestKey === undefined ? {} : { exactLoadRequestKey }),
    ...(exactLoadEstimate === undefined ? {} : { exactLoadEstimate }),
  }
}

export function transcriptLayerUnavailable(
  message: string,
  visibleTranscriptEstimate: number,
): TranscriptLayerState<never> {
  return { status: 'unavailable', message, visibleTranscriptEstimate }
}

export function transcriptLayerLoading<ErrorType extends TranscriptLoadErrorSummary>(
  current: TranscriptLayerState<ErrorType>,
  url: string,
  visibleTranscriptEstimate: number,
): TranscriptLayerState<ErrorType> {
  const previousLayer = retainedTranscriptLayerState(current)
  const previousState = current.status === 'loading' ? current.previousState : current

  return {
    status: 'loading',
    url,
    visibleTranscriptEstimate,
    ...(previousLayer === undefined ? {} : { previousLayer }),
    ...(previousState === undefined || previousState.status === 'idle'
      ? {}
      : { previousState }),
  }
}

// Cancel (15.3-D) goes back to what showed before the load. A cancel is not
// an error, so an earlier error is not shown again.
export function transcriptLayerCancelled<ErrorType extends TranscriptLoadErrorSummary>(
  current: TranscriptLayerState<ErrorType>,
): TranscriptLayerState<ErrorType> {
  if (current.status !== 'loading') {
    return current
  }

  const previousState = current.previousState

  return previousState === undefined || previousState.status === 'error'
    ? IDLE_TRANSCRIPT_LAYER_STATE
    : previousState
}

interface TranscriptLayerAggregateOptions {
  readonly source: 'cell-summary' | 'native-zarr'
  readonly mode: 'density'
  readonly bins: readonly TranscriptAggregateBin[]
  readonly featureNames: readonly string[]
  readonly message: string
  readonly visibleTranscriptEstimate: number
  readonly scaleMax?: number | undefined
  readonly durationMs?: number | undefined
}

export function transcriptLayerAggregate({
  bins,
  durationMs,
  featureNames,
  message,
  mode,
  scaleMax,
  source,
  visibleTranscriptEstimate,
}: TranscriptLayerAggregateOptions): TranscriptLayerState<never> {
  return {
    status: 'aggregate',
    source,
    mode,
    bins,
    featureNames,
    message,
    visibleTranscriptEstimate,
    ...(scaleMax === undefined ? {} : { scaleMax }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

interface TranscriptLayerReadyOptions {
  readonly url: string
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly visibleTranscriptEstimate: number
  readonly hitPointLimit: boolean
  readonly durationMs: number
}

export function transcriptLayerReady({
  durationMs,
  groups,
  hitPointLimit,
  points,
  url,
  visibleTranscriptEstimate,
}: TranscriptLayerReadyOptions): TranscriptLayerState<never> {
  return {
    status: 'ready',
    url,
    points,
    groups,
    visibleTranscriptEstimate,
    hitPointLimit,
    durationMs,
  }
}

export function transcriptLayerFailed<ErrorType extends TranscriptLoadErrorSummary>(
  url: string,
  error: ErrorType,
): TranscriptLayerState<ErrorType> {
  return { status: 'error', url, error }
}

export type TranscriptRetainedLayerState =
  | {
      readonly kind: 'exact'
      readonly points: readonly TranscriptPoint[]
    }
  | {
      readonly kind: 'aggregate'
      readonly source: 'cell-summary' | 'native-zarr'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly featureNames: readonly string[]
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

// The transcripts an exact read would load in this view, for the point
// budget meter. Per-gene outputs (Atera) read only the selected genes, so
// their estimate is the selected-gene count from the density; other outputs
// read every transcript in the view, estimated from the cells.
export function transcriptBudgetEstimate<ErrorType extends TranscriptLoadErrorSummary>(
  capabilityState: TranscriptCapabilityState<ErrorType>,
  layerState: TranscriptLayerState<ErrorType>,
  visibleTranscriptEstimate: number,
): number {
  const isPerGene =
    capabilityState.status === 'ready' &&
    capabilityState.capabilities.geneRanges !== undefined

  return isPerGene && 'visibleTranscriptEstimate' in layerState
    ? layerState.visibleTranscriptEstimate
    : visibleTranscriptEstimate
}

// What the density squares on screen count, for the legend: the genes (none
// for all transcripts), whether the counts come from cell totals, and the
// square size.
export interface TranscriptDensityContent {
  readonly source: 'cell-summary' | 'native-zarr'
  readonly featureNames: readonly string[]
  readonly binSizeMicrometers: number | undefined
}

export function transcriptDensityContentForRendering<
  ErrorType extends TranscriptLoadErrorSummary,
>(layerState: TranscriptLayerState<ErrorType>): TranscriptDensityContent | null {
  const layer =
    layerState.status === 'aggregate'
      ? layerState
      : layerState.status === 'loading' && layerState.previousLayer?.kind === 'aggregate'
        ? layerState.previousLayer
        : null

  if (layer === null || layer.bins.length === 0) {
    return null
  }

  return {
    source: layer.source,
    featureNames: layer.featureNames,
    binSizeMicrometers: layer.bins[0]?.binSizeMicrometers,
  }
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
      source: layerState.source,
      bins: layerState.bins,
      featureNames: layerState.featureNames,
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
  sourceFile = 'transcripts.zarr.zip',
}: {
  readonly mode: 'density'
  readonly selectedFeatureCount: number
  readonly binCount: number
  readonly sourceFile?: string | undefined
}): string {
  const featureLabel =
    selectedFeatureCount > 0
      ? `${selectedFeatureCount.toLocaleString()} selected-feature`
      : 'all-transcript'

  return `Showing native ${featureLabel} density squares from ${sourceFile} (${binCount.toLocaleString()} squares).`
}

// The selected-gene density was not read because the new genes need more of
// density/gene than one request reads (15.1-J). Each gene is read for the
// whole slide, so zooming in does not help; fewer genes do. Exact points do
// not use density/gene.
export function transcriptGeneDensityOverBudgetMessage(
  featureNames: readonly string[],
  overBudget: { readonly chunkCount: number; readonly chunkLimit: number },
): string {
  return `Transcript density for ${transcriptGenesLabel(featureNames)} needs ${overBudget.chunkCount.toLocaleString()} density/gene data chunks, and the app reads up to ${overBudget.chunkLimit.toLocaleString()} at a time. Select fewer genes, or zoom in until exact points load.`
}

export function transcriptGeneDensityMissingMessage(binCount: number): string {
  return `This output has no per-gene density (density/gene), so the ${binCount.toLocaleString()} squares count all transcripts. Exact points still show the selected genes.`
}

// Per-gene transcript outputs (Atera) have no all-gene density or points.
export function transcriptPerGeneCellSummaryMessage(hasSelectedGenes: boolean): string {
  return `Showing all-gene cell-summary density squares from cell transcript counts. ${transcriptPerGeneSelectGenesHint(hasSelectedGenes)} to see their transcript density and exact points.`
}

export function transcriptPerGeneExactNeedsGenesMessage(
  hasSelectedGenes: boolean,
): string {
  return `${transcriptPerGeneSelectGenesHint(hasSelectedGenes)} to load exact transcript points. This dataset stores transcripts per gene.`
}

function transcriptPerGeneSelectGenesHint(hasSelectedGenes: boolean): string {
  return hasSelectedGenes ? 'Set Feature filter to Selected genes' : 'Select genes'
}

export function transcriptPerGeneUnavailableMessage(error: string | undefined): string {
  return `Per-gene transcript density is unavailable${error === undefined ? '.' : `: ${error}`}`
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
