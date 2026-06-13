import type { ControlHudTab } from './appShellModel'

const DEBUG_LOG_LIMIT = 32

export interface DebugLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
  readonly coalesceKey?: string
}

export interface DebugLogAppendOptions {
  readonly coalesceKey?: string
}

export interface LoadingTask {
  readonly id: string
  readonly tabId: ControlHudTab
  readonly label: string
  readonly detail?: string
}

interface LoadingTaskStateInputs {
  readonly loadState: LoadingUrlState
  readonly datasetWarmupState: LoadingUrlState
  readonly diagnosticsState: LoadingUrlState
  readonly genePanelState: LoadingStatusState
  readonly morphologyState: LoadingStatusState
  readonly customMorphologyLayerState: LoadingStatusState
  readonly annotationGroupState: LoadingStatusState
  readonly boundaryState: LoadingStatusState
  readonly geneExpressionState: LoadingGeneExpressionState
  readonly transcriptCapabilityState: LoadingStatusState
  readonly transcriptLayerState: LoadingTranscriptLayerState
  readonly magicLensState: LoadingStatusState
  readonly annotationState: LoadingStatusState
  readonly analysisEmbeddingState: LoadingStatusState
  readonly cellDetailState: LoadingCellState
  readonly cellTranscriptDistributionState: LoadingCellState
  readonly roiState: LoadingStatusState
  readonly roiGeneStatsState: LoadingRoiGeneStatsState
  readonly roiTranscriptExportState: LoadingStatusState
  readonly isRoiGeneViewportWarmupLoading: boolean
  readonly autoContrastChannelCount: number
  readonly geneExpressionLoadingLabel?: string | undefined
  readonly magicLensLoadingScopeLabel?: string | undefined
}

interface LoadingStatusState {
  readonly status: string
}

interface LoadingUrlState extends LoadingStatusState {
  readonly url?: string
}

interface LoadingGeneExpressionState extends LoadingStatusState {
  readonly genes?: readonly string[]
}

interface LoadingTranscriptLayerState extends LoadingStatusState {
  readonly visibleTranscriptEstimate?: number
}

interface LoadingCellState extends LoadingStatusState {
  readonly cellId?: string
}

interface LoadingRoiGeneStatsState extends LoadingStatusState {
  readonly cellCount?: number
}

export function createLoadingTasks({
  loadState,
  datasetWarmupState,
  diagnosticsState,
  genePanelState,
  morphologyState,
  customMorphologyLayerState,
  annotationGroupState,
  boundaryState,
  geneExpressionState,
  transcriptCapabilityState,
  transcriptLayerState,
  magicLensState,
  annotationState,
  analysisEmbeddingState,
  cellDetailState,
  cellTranscriptDistributionState,
  roiState,
  roiGeneStatsState,
  roiTranscriptExportState,
  isRoiGeneViewportWarmupLoading,
  autoContrastChannelCount,
  geneExpressionLoadingLabel = 'Loading expression',
  magicLensLoadingScopeLabel = 'Lens',
}: LoadingTaskStateInputs): readonly LoadingTask[] {
  const tasks: LoadingTask[] = []

  if (isLoadingWithUrl(loadState)) {
    tasks.push({
      id: 'dataset',
      tabId: 'dataset',
      label: 'Loading dataset',
      detail: shortDatasetLabel(loadState.url),
    })
  }

  if (isLoadingWithUrl(datasetWarmupState)) {
    tasks.push({
      id: 'dataset-warmup',
      tabId: 'dataset',
      label: 'Preparing dataset',
      detail: shortDatasetLabel(datasetWarmupState.url),
    })
  }

  if (isLoadingWithUrl(diagnosticsState)) {
    tasks.push({
      id: 'dataset-diagnostics',
      tabId: 'dataset',
      label: 'Diagnosing dataset',
      detail: shortDatasetLabel(diagnosticsState.url),
    })
  }

  if (genePanelState.status === 'loading') {
    tasks.push({ id: 'gene-panel', tabId: 'genes', label: 'Loading gene panel' })
  }

  if (morphologyState.status === 'loading') {
    tasks.push({ id: 'morphology', tabId: 'layers', label: 'Loading image' })
  }

  if (customMorphologyLayerState.status === 'loading') {
    tasks.push({
      id: 'custom-morphology-layer',
      tabId: 'layers',
      label: 'Loading custom layer',
    })
  }

  if (annotationGroupState.status === 'loading') {
    tasks.push({
      id: 'annotation-sets',
      tabId: 'annotations',
      label: 'Loading annotation sets',
    })
  }

  if (boundaryState.status === 'loading') {
    tasks.push({ id: 'boundaries', tabId: 'layers', label: 'Loading boundaries' })
  }

  if (geneExpressionState.status === 'loading') {
    tasks.push({
      id: 'gene-expression',
      tabId: 'genes',
      label: geneExpressionLoadingLabel,
      detail: geneExpressionState.genes?.join(', ') ?? '',
    })
  }

  if (transcriptCapabilityState.status === 'loading') {
    tasks.push({
      id: 'transcript-capabilities',
      tabId: 'transcripts',
      label: 'Checking transcripts',
    })
  }

  if (transcriptLayerState.status === 'loading') {
    const visibleTranscriptEstimate = transcriptLayerState.visibleTranscriptEstimate ?? 0
    tasks.push({
      id: 'transcript-overlay',
      tabId: 'transcripts',
      label: 'Loading transcripts',
      detail: `${visibleTranscriptEstimate.toLocaleString()} estimated`,
    })
  }

  if (magicLensState.status === 'loading') {
    tasks.push({
      id: 'magic-lens',
      tabId: 'magic-lens',
      label: 'Scanning magic lens',
      detail: magicLensLoadingScopeLabel,
    })
  }

  if (annotationState.status === 'loading') {
    tasks.push({
      id: 'annotations',
      tabId: 'annotations',
      label: 'Loading annotations',
    })
  }

  if (analysisEmbeddingState.status === 'loading') {
    tasks.push({ id: 'embeddings', tabId: 'cell', label: 'Loading embeddings' })
  }

  if (cellDetailState.status === 'loading') {
    tasks.push({
      id: 'cell-details',
      tabId: 'cell',
      label: 'Loading cell details',
      detail: shortIdentifier(cellDetailState.cellId ?? ''),
    })
  }

  if (cellTranscriptDistributionState.status === 'loading') {
    tasks.push({
      id: 'cell-transcripts',
      tabId: 'cell',
      label: 'Loading cell z distribution',
      detail: shortIdentifier(cellTranscriptDistributionState.cellId ?? ''),
    })
  }

  if (roiState.status === 'loading') {
    tasks.push({ id: 'roi-cells', tabId: 'roi', label: 'Querying ROI cells' })
  }

  if (isRoiGeneViewportWarmupLoading) {
    tasks.push({
      id: 'roi-gene-warmup',
      tabId: 'roi',
      label: 'Preparing cell feature matrix',
    })
  }

  if (roiGeneStatsState.status === 'loading') {
    const cellCount = roiGeneStatsState.cellCount ?? 0
    tasks.push({
      id: 'roi-genes',
      tabId: 'roi',
      label: 'Querying ROI genes',
      detail: `${cellCount.toLocaleString()} cells`,
    })
  }

  if (roiTranscriptExportState.status === 'loading') {
    tasks.push({
      id: 'roi-transcripts',
      tabId: 'roi',
      label: 'Exporting ROI transcripts',
    })
  }

  if (autoContrastChannelCount > 0) {
    const channelNoun = autoContrastChannelCount === 1 ? 'channel' : 'channels'
    tasks.push({
      id: 'auto-contrast',
      tabId: 'layers',
      label: 'Auto contrast',
      detail: `${autoContrastChannelCount.toLocaleString()} ${channelNoun}`,
    })
  }

  return tasks
}

export function createDebugLogEntry(
  id: number,
  message: string,
  options: DebugLogAppendOptions = {},
): DebugLogEntry {
  return {
    id,
    timestamp: readTimestamp(),
    message,
    ...(options.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey }),
  }
}

export function appendDebugLogEntry(
  current: readonly DebugLogEntry[],
  entry: DebugLogEntry,
): readonly DebugLogEntry[] {
  const first = current[0]

  if (
    first !== undefined &&
    entry.coalesceKey !== undefined &&
    first.coalesceKey === entry.coalesceKey
  ) {
    return [entry, ...current.slice(1)]
  }

  return [entry, ...current].slice(0, DEBUG_LOG_LIMIT)
}

export function readTimestamp(): number {
  return Date.now()
}

export function formatElapsed(startedAt: number): string {
  const elapsedMs = Math.max(0, readTimestamp() - startedAt)

  if (elapsedMs < 1_000) {
    return `${Math.round(elapsedMs)} ms`
  }

  return `${(elapsedMs / 1_000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} s`
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function shortDatasetLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const lastPathSegment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return shortIdentifier(lastPathSegment ?? parsed.host)
  } catch {
    return shortIdentifier(url)
  }
}

export function shortIdentifier(value: string): string {
  const normalized = value.trim()

  if (normalized.length <= 24) {
    return normalized
  }

  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

function isLoadingWithUrl(
  state: LoadingUrlState,
): state is { readonly status: 'loading'; readonly url: string } {
  return state.status === 'loading' && state.url !== undefined
}

export function abortActiveRequest(ref: { current: AbortController | null }): void {
  ref.current?.abort()
  ref.current = null
}

export function clearTimeoutRef(ref: { current: number | null }): void {
  if (ref.current !== null && typeof window !== 'undefined') {
    window.clearTimeout(ref.current)
  }

  ref.current = null
}

export function throwAbortError(message: string): never {
  const error = new Error(message)
  error.name = 'AbortError'
  throw error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
