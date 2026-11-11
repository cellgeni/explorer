import type { FallbackNotice } from '../../data/fallbackNotice'

const DEBUG_LOG_LIMIT = 32
const FALLBACK_NOTICE_LIMIT = 16

export interface DebugLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
  readonly coalesceKey?: string
}

export interface DebugLogAppendOptions {
  readonly coalesceKey?: string
}

export type AppendDebugEvent = (message: string, options?: DebugLogAppendOptions) => void

// Where a task's result shows (15.2-C): a layer panel
// section, the info drawer ('dataset'), or a card.
export type LoadingTaskArea =
  | 'dataset'
  | 'image'
  | 'cells'
  | 'transcripts'
  | 'magic-lens'
  | 'selection'
  | 'cell'

export interface LoadingTask {
  readonly id: string
  // The layer section or card whose data is loading.
  readonly area: LoadingTaskArea
  readonly label: string
  readonly detail?: string
  // The loading list offers Cancel (15.3-D).
  readonly cancellable?: boolean
  // How far the task has got, 0 to 1, where it knows.
  readonly progress?: number
}

// Tasks the loading list can cancel (15.3-D). App maps each to the workflow
// that owns its request; cancelling returns that state to idle.
export type CancellableLoadingTaskId =
  | 'dataset'
  | 'dataset-diagnostics'
  | 'transcript-overlay'
  | 'magic-lens'
  | 'embeddings'
  | 'cell-details'
  | 'cell-transcripts'
  | 'roi-cells'
  | 'roi-genes'

const CANCELLABLE_LOADING_TASK_IDS: ReadonlySet<string> =
  new Set<CancellableLoadingTaskId>([
    'dataset',
    'dataset-diagnostics',
    'transcript-overlay',
    'magic-lens',
    'embeddings',
    'cell-details',
    'cell-transcripts',
    'roi-cells',
    'roi-genes',
  ])

export function isCancellableLoadingTaskId(id: string): id is CancellableLoadingTaskId {
  return CANCELLABLE_LOADING_TASK_IDS.has(id)
}

export interface FallbackNoticeEntry extends FallbackNotice {
  readonly id: number
  readonly timestamp: number
}

interface MutableRef<T> {
  current: T
}

export interface LatestRequestRefs {
  readonly abortRef: MutableRef<AbortController | null>
  readonly requestIdRef: MutableRef<number>
}

export interface LatestRequest {
  readonly requestId: number
  readonly abortController: AbortController
  readonly signal: AbortSignal
  readonly isCurrent: () => boolean
  readonly complete: () => void
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
  readonly visiumHdExpressionProjectionState?: LoadingStatusState
  readonly transcriptCapabilityState: LoadingStatusState
  readonly transcriptLayerState: LoadingTranscriptLayerState
  readonly magicLensState: LoadingStatusState
  readonly annotationState: LoadingStatusState
  readonly analysisEmbeddingState: LoadingStatusState
  readonly cellDetailState: LoadingCellState
  readonly cellTranscriptDistributionState: LoadingCellState
  readonly visiumHdExpressionProfileState?: LoadingSelectionState
  readonly roiState: LoadingStatusState
  readonly roiGeneStatsState: LoadingRoiGeneStatsState
  readonly roiTranscriptExportState: LoadingStatusState
  readonly isRoiGeneViewportWarmupLoading: boolean
  readonly autoContrastChannelCount: number
  readonly geneExpressionLoadingLabel?: string | undefined
  readonly magicLensLoadingScopeLabel?: string | undefined
  // Exact transcript tiles read so far, 0 to 1.
  readonly transcriptLoadProgress?: number | undefined
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

interface LoadingSelectionState extends LoadingStatusState {
  readonly selectionId?: string
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
  visiumHdExpressionProjectionState,
  transcriptCapabilityState,
  transcriptLayerState,
  magicLensState,
  annotationState,
  analysisEmbeddingState,
  cellDetailState,
  cellTranscriptDistributionState,
  visiumHdExpressionProfileState,
  roiState,
  roiGeneStatsState,
  roiTranscriptExportState,
  isRoiGeneViewportWarmupLoading,
  autoContrastChannelCount,
  geneExpressionLoadingLabel = 'Loading expression',
  magicLensLoadingScopeLabel = 'Lens',
  transcriptLoadProgress,
}: LoadingTaskStateInputs): readonly LoadingTask[] {
  const tasks: LoadingTask[] = []

  if (isLoadingWithUrl(loadState)) {
    tasks.push({
      id: 'dataset',
      area: 'dataset',
      label: 'Loading dataset',
      detail: shortDatasetLabel(loadState.url),
    })
  }

  if (isLoadingWithUrl(datasetWarmupState)) {
    tasks.push({
      id: 'dataset-warmup',
      area: 'dataset',
      label: 'Preparing dataset',
      detail: shortDatasetLabel(datasetWarmupState.url),
    })
  }

  if (isLoadingWithUrl(diagnosticsState)) {
    tasks.push({
      id: 'dataset-diagnostics',
      area: 'dataset',
      label: 'Diagnosing dataset',
      detail: shortDatasetLabel(diagnosticsState.url),
    })
  }

  if (genePanelState.status === 'loading') {
    tasks.push({
      id: 'gene-panel',
      area: 'cells',
      label: 'Loading gene panel',
    })
  }

  if (morphologyState.status === 'loading') {
    tasks.push({
      id: 'morphology',
      area: 'image',
      label: 'Loading image',
    })
  }

  if (customMorphologyLayerState.status === 'loading') {
    tasks.push({
      id: 'custom-morphology-layer',
      area: 'image',
      label: 'Loading custom layer',
    })
  }

  if (annotationGroupState.status === 'loading') {
    tasks.push({
      id: 'annotation-sets',
      area: 'cells',
      label: 'Loading annotation sets',
    })
  }

  if (boundaryState.status === 'loading') {
    tasks.push({
      id: 'boundaries',
      area: 'cells',
      label: 'Loading boundaries',
    })
  }

  if (geneExpressionState.status === 'loading') {
    tasks.push({
      id: 'gene-expression',
      area: 'cells',
      label: geneExpressionLoadingLabel,
      detail: geneExpressionState.genes?.join(', ') ?? '',
    })
  }

  if (visiumHdExpressionProjectionState?.status === 'loading') {
    tasks.push({
      id: 'visium-hd-expression-projection',
      area: 'cells',
      label: 'Mapping expression to cells',
    })
  }

  if (transcriptCapabilityState.status === 'loading') {
    tasks.push({
      id: 'transcript-capabilities',
      area: 'transcripts',
      label: 'Checking transcripts',
    })
  }

  if (transcriptLayerState.status === 'loading') {
    const visibleTranscriptEstimate = transcriptLayerState.visibleTranscriptEstimate ?? 0
    tasks.push({
      id: 'transcript-overlay',
      area: 'transcripts',
      label: 'Loading transcripts',
      detail: `${visibleTranscriptEstimate.toLocaleString()} estimated`,
      ...(transcriptLoadProgress === undefined
        ? {}
        : { progress: transcriptLoadProgress }),
    })
  }

  if (magicLensState.status === 'loading') {
    tasks.push({
      id: 'magic-lens',
      area: 'magic-lens',
      label: 'Scanning magic lens',
      detail: magicLensLoadingScopeLabel,
    })
  }

  if (annotationState.status === 'loading') {
    tasks.push({
      id: 'annotations',
      area: 'cells',
      label: 'Loading annotations',
    })
  }

  if (analysisEmbeddingState.status === 'loading') {
    tasks.push({
      id: 'embeddings',
      area: 'cells',
      label: 'Loading embeddings',
    })
  }

  if (cellDetailState.status === 'loading') {
    tasks.push({
      id: 'cell-details',
      area: 'cell',
      label: 'Loading cell details',
      detail: shortIdentifier(cellDetailState.cellId ?? ''),
    })
  }

  if (cellTranscriptDistributionState.status === 'loading') {
    tasks.push({
      id: 'cell-transcripts',
      area: 'cell',
      label: 'Loading cell z distribution',
      detail: shortIdentifier(cellTranscriptDistributionState.cellId ?? ''),
    })
  }

  if (visiumHdExpressionProfileState?.status === 'loading') {
    tasks.push({
      id: 'visium-hd-expression-profile',
      area: 'cell',
      label: 'Loading expression profile',
      detail: shortIdentifier(visiumHdExpressionProfileState.selectionId ?? ''),
    })
  }

  if (roiState.status === 'loading') {
    tasks.push({
      id: 'roi-cells',
      area: 'selection',
      label: 'Querying ROI cells',
    })
  }

  if (isRoiGeneViewportWarmupLoading) {
    tasks.push({
      id: 'roi-gene-warmup',
      area: 'selection',
      label: 'Preparing cell feature matrix',
    })
  }

  if (roiGeneStatsState.status === 'loading') {
    const cellCount = roiGeneStatsState.cellCount ?? 0
    tasks.push({
      id: 'roi-genes',
      area: 'selection',
      label: 'Querying ROI genes',
      detail: `${cellCount.toLocaleString()} cells`,
    })
  }

  if (roiTranscriptExportState.status === 'loading') {
    tasks.push({
      id: 'roi-transcripts',
      area: 'selection',
      label: 'Exporting ROI transcripts',
    })
  }

  if (autoContrastChannelCount > 0) {
    const channelNoun = autoContrastChannelCount === 1 ? 'channel' : 'channels'
    tasks.push({
      id: 'auto-contrast',
      area: 'image',
      label: 'Auto contrast',
      detail: `${autoContrastChannelCount.toLocaleString()} ${channelNoun}`,
    })
  }

  return tasks.map((task) =>
    isCancellableLoadingTaskId(task.id) ? { ...task, cancellable: true } : task,
  )
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

export function createFallbackNoticeEntry(
  id: number,
  notice: FallbackNotice,
): FallbackNoticeEntry {
  return {
    id,
    timestamp: readTimestamp(),
    ...notice,
  }
}

export function appendFallbackNoticeEntry(
  current: readonly FallbackNoticeEntry[],
  entry: FallbackNoticeEntry,
): readonly FallbackNoticeEntry[] {
  const first = current[0]

  if (
    first !== undefined &&
    entry.coalesceKey !== undefined &&
    first.coalesceKey === entry.coalesceKey
  ) {
    return [entry, ...current.slice(1)]
  }

  return [entry, ...current].slice(0, FALLBACK_NOTICE_LIMIT)
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

export function startLatestRequest({
  abortRef,
  requestIdRef,
}: LatestRequestRefs): LatestRequest {
  abortActiveRequest(abortRef)
  const requestId = requestIdRef.current + 1
  const abortController = new AbortController()
  requestIdRef.current = requestId
  abortRef.current = abortController

  return {
    requestId,
    abortController,
    signal: abortController.signal,
    isCurrent: () => requestIdRef.current === requestId,
    complete: () => {
      if (abortRef.current === abortController) {
        abortRef.current = null
      }
    },
  }
}

export function invalidateLatestRequest({
  abortRef,
  requestIdRef,
}: LatestRequestRefs): number {
  abortActiveRequest(abortRef)
  requestIdRef.current += 1
  return requestIdRef.current
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
