import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { ROI_CELL_EXPORT_LIMIT } from '../../data/roiCells'
import { RoiGeneStatsH5FallbackSkippedError } from '../../data/roiGeneStats'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { RoiSelection } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/xeniumDataset'
import type {
  RoiCellsLoader,
  RoiGeneStatsLoader,
  RoiTranscriptsLoader,
} from '../app-shell/appDependencies'
import {
  clearTimeoutRef,
  downloadTextFile,
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  IDLE_MAGIC_LENS_STATE,
  type MagicLensScope,
  type MagicLensState,
} from './magicLensModel'
import {
  IDLE_ROI_GENE_STATS_STATE,
  IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE,
  IDLE_ROI_STATE,
  IDLE_ROI_TRANSCRIPT_EXPORT_STATE,
  ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS,
  defaultRoiName,
  deferRoiGeneRefinement,
  emptyRoiGeneStats,
  roiCellsToCsv,
  roiFailed,
  roiGeneDatasetWarmupKey,
  roiGeneStatsFailed,
  roiGeneStatsLoading,
  roiGeneStatsReady,
  roiGeneViewportWarmupFailed,
  roiGeneViewportWarmupLoading,
  roiGeneViewportWarmupReady,
  roiLoading,
  roiReady,
  roiSelectionLabel,
  roiSelectionToGeoJson,
  roiTranscriptExportFailed,
  roiTranscriptExportLoading,
  roiTranscriptsToCsv,
  type RoiGeneStatsState,
  type RoiGeneViewportWarmupState,
  type RoiState,
  type RoiTranscriptExportState,
} from './roiModel'
import {
  ALL_GENES,
  IDLE_ROI_REFERENCE_STATE,
  referenceOutsideSelection,
  roiReferenceFailed,
  roiReferenceLoading,
  roiReferenceReady,
  roiReferenceUnavailable,
  type RoiReferenceState,
} from './roiEnrichmentModel'
import { slug } from '../../utils/slug'

interface MutableRef<T> {
  current: T
}

const NO_REFERENCE_CELLS: readonly DatasetCell[] = []

interface UseRoiWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
}

interface UseRoiWorkflowControls {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly enabled?: boolean
  readonly magicLensScope: MagicLensScope
  readonly viewportGeneWarmupEnabled?: boolean
  readonly roiName: string
  // The reference sample for enriched genes (15.4-B): cells spread over the
  // tissue. Those outside a selection are its comparison; the warm-up reads
  // them all first.
  readonly referenceCells?: readonly DatasetCell[]
}

interface UseRoiWorkflowData {
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly roiState: RoiState<StructuredLoadError>
}

interface UseRoiWorkflowLoaders {
  readonly loadRoiCells: RoiCellsLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
  readonly loadRoiTranscripts: RoiTranscriptsLoader
}

interface UseRoiWorkflowRefs {
  readonly magicLensAbortRef: MutableRef<AbortController | null>
  readonly magicLensDebounceRef: MutableRef<number | null>
  readonly magicLensLastDetailRef: MutableRef<ViewerMagicLensDetail | null>
  readonly magicLensLastQueryKeyRef: MutableRef<string | null>
  readonly magicLensRequestIdRef: MutableRef<number>
  readonly roiAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupKeyRef: MutableRef<string | null>
  readonly roiGeneViewportWarmupTimeoutRef: MutableRef<number | null>
  readonly roiIdRef: MutableRef<number>
  readonly roiRequestIdRef: MutableRef<number>
  readonly roiTranscriptExportAbortRef: MutableRef<AbortController | null>
  readonly roiTranscriptExportRequestIdRef: MutableRef<number>
}

interface UseRoiWorkflowSetters {
  readonly setMagicLensState: Dispatch<
    SetStateAction<MagicLensState<StructuredLoadError>>
  >
  readonly setRoiGeneStatsState: Dispatch<
    SetStateAction<RoiGeneStatsState<StructuredLoadError>>
  >
  readonly setRoiGeneViewportWarmupState: Dispatch<
    SetStateAction<RoiGeneViewportWarmupState>
  >
  readonly setRoiMode: Dispatch<SetStateAction<RoiDrawMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setRoiReferenceState: Dispatch<
    SetStateAction<RoiReferenceState<StructuredLoadError>>
  >
  readonly setRoiState: Dispatch<SetStateAction<RoiState<StructuredLoadError>>>
  readonly setRoiTranscriptExportState: Dispatch<
    SetStateAction<RoiTranscriptExportState<StructuredLoadError>>
  >
}

interface UseRoiWorkflowOptions {
  readonly callbacks: UseRoiWorkflowCallbacks
  readonly controls: UseRoiWorkflowControls
  readonly data: UseRoiWorkflowData
  readonly loaders: UseRoiWorkflowLoaders
  readonly refs: UseRoiWorkflowRefs
  readonly setters: UseRoiWorkflowSetters
}

interface UseRoiWorkflowResult {
  // Cancel in the loading list (15.3-D).
  readonly handleCancelRoiCells: () => void
  readonly handleCancelRoiGenes: () => void
  readonly handleClearRoi: () => void
  readonly handleExportRoiCells: () => void
  readonly handleExportRoiGeoJson: () => void
  readonly handleExportRoiTranscripts: () => void
  readonly handleRoiComplete: (selection: RoiSelection) => void
}

export function useRoiWorkflow({
  callbacks: { appendDebugEvent, appendFallbackNotice },
  controls: {
    currentViewportDetail,
    enabled = true,
    magicLensScope,
    viewportGeneWarmupEnabled = true,
    roiName,
    referenceCells = NO_REFERENCE_CELLS,
  },
  data: { loadState, roiState },
  loaders: { loadRoiCells, loadRoiGeneStats, loadRoiTranscripts },
  refs: {
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef,
    roiAbortRef,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiIdRef,
    roiRequestIdRef,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef,
  },
  setters: {
    setMagicLensState,
    setRoiGeneStatsState,
    setRoiGeneViewportWarmupState,
    setRoiMode,
    setRoiName,
    setRoiReferenceState,
    setRoiState,
    setRoiTranscriptExportState,
  },
}: UseRoiWorkflowOptions): UseRoiWorkflowResult {
  const roiGeneViewportWarmupRequestIdRef = useRef(0)

  useEffect(
    () => () => {
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      invalidateLatestRequest({
        abortRef: roiGeneViewportWarmupAbortRef,
        requestIdRef: roiGeneViewportWarmupRequestIdRef,
      })
      roiGeneViewportWarmupKeyRef.current = null
    },
    [
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupRequestIdRef,
      roiGeneViewportWarmupTimeoutRef,
    ],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const detail = currentViewportDetail
    const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

    if (
      !enabled ||
      !viewportGeneWarmupEnabled ||
      readyDatasetUrl === null ||
      detail === null ||
      roiState.status !== 'idle' ||
      detail.visibleCellCount <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT
    ) {
      const hadPendingWarmup =
        roiGeneViewportWarmupTimeoutRef.current !== null ||
        roiGeneViewportWarmupAbortRef.current !== null
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      invalidateLatestRequest({
        abortRef: roiGeneViewportWarmupAbortRef,
        requestIdRef: roiGeneViewportWarmupRequestIdRef,
      })

      if (hadPendingWarmup) {
        roiGeneViewportWarmupKeyRef.current = null
        setRoiGeneViewportWarmupState(IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE)
      }

      return
    }

    const warmupKey = roiGeneDatasetWarmupKey(readyDatasetUrl)

    if (warmupKey === roiGeneViewportWarmupKeyRef.current) {
      return
    }

    clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    invalidateLatestRequest({
      abortRef: roiGeneViewportWarmupAbortRef,
      requestIdRef: roiGeneViewportWarmupRequestIdRef,
    })
    roiGeneViewportWarmupKeyRef.current = warmupKey
    setRoiGeneViewportWarmupState(roiGeneViewportWarmupLoading(warmupKey))

    roiGeneViewportWarmupTimeoutRef.current = window.setTimeout(() => {
      roiGeneViewportWarmupTimeoutRef.current = null
      const request = startLatestRequest({
        abortRef: roiGeneViewportWarmupAbortRef,
        requestIdRef: roiGeneViewportWarmupRequestIdRef,
      })
      const selection = { kind: 'box' as const, bbox: detail.bbox }
      const warmupStartedAt = readTimestamp()

      void (async () => {
        try {
          const cellsStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI warmup cells started: ${detail.visibleCellCount.toLocaleString()} visible, limit ${ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT.toLocaleString()}`,
          )
          const cells = await loadRoiCells(readyDatasetUrl, selection, {
            signal: request.signal,
            limit: ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
          })

          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup cells ready: ${cells.length.toLocaleString()} in ${formatElapsed(cellsStartedAt)}`,
          )

          if (cells.length === 0) {
            appendDebugEvent(
              `ROI gene warmup ready: no cells (${formatElapsed(warmupStartedAt)})`,
              {
                coalesceKey: 'roi-gene-warmup',
              },
            )
            setRoiGeneViewportWarmupState(roiGeneViewportWarmupReady(warmupKey))
            return
          }

          const genesStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI warmup genes started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )
          // Only from the Zarr matrix: the H5 fallback reads the whole file
          // (433 MB on the Xenium demo), which waits for an ROI.
          const stats = await loadRoiGeneStats(readyDatasetUrl, cells, {
            signal: request.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
            allowH5Fallback: false,
            onFallback: appendFallbackNotice,
          })

          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
              genesStartedAt,
            )}`,
          )
          appendDebugEvent(`ROI gene warmup ready (${formatElapsed(warmupStartedAt)})`, {
            coalesceKey: 'roi-gene-warmup',
          })
          setRoiGeneViewportWarmupState(roiGeneViewportWarmupReady(warmupKey))

          // The reference sample for enriched genes (15.4-B), read now so a
          // selection's comparison comes from the cache.
          if (referenceCells.length === 0) {
            return
          }

          const referenceStartedAt = readTimestamp()
          try {
            await loadRoiGeneStats(readyDatasetUrl, referenceCells, {
              signal: request.signal,
              cellLimit: referenceCells.length,
              sampleStrategy: 'head',
              geneLimit: ALL_GENES,
              allowH5Fallback: false,
              onFallback: appendFallbackNotice,
            })
          } catch (error) {
            if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
              return
            }

            appendDebugEvent(
              `ROI warmup reference skipped (${formatElapsed(referenceStartedAt)})`,
            )
            return
          }

          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup reference ready: ${referenceCells.length.toLocaleString()} cells in ${formatElapsed(
              referenceStartedAt,
            )}`,
          )
        } catch (error) {
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
            return
          }

          if (error instanceof RoiGeneStatsH5FallbackSkippedError) {
            appendDebugEvent(
              `ROI gene warmup ready: no matrix sample, the Zarr matrix cannot serve cells and the H5 fallback waits for an ROI (${formatElapsed(warmupStartedAt)})`,
              {
                coalesceKey: 'roi-gene-warmup',
              },
            )
            setRoiGeneViewportWarmupState(roiGeneViewportWarmupReady(warmupKey))
            return
          }

          appendDebugEvent(
            `ROI gene warmup skipped (${formatElapsed(warmupStartedAt)})`,
            {
              coalesceKey: 'roi-gene-warmup',
            },
          )
          setRoiGeneViewportWarmupState(roiGeneViewportWarmupFailed(warmupKey))
        } finally {
          request.complete()
        }
      })()
    }, ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)
  }, [
    appendDebugEvent,
    appendFallbackNotice,
    currentViewportDetail,
    enabled,
    loadRoiCells,
    loadRoiGeneStats,
    loadState,
    referenceCells,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupRequestIdRef,
    roiGeneViewportWarmupTimeoutRef,
    roiState.status,
    setRoiGeneViewportWarmupState,
    viewportGeneWarmupEnabled,
  ])

  const handleRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (!enabled || loadState.status !== 'ready') {
        return
      }

      const url = loadState.url
      const bbox = selection.bbox
      const roiStartedAt = readTimestamp()
      const roiCellsStartedAt = roiStartedAt
      const request = startLatestRequest({
        abortRef: roiAbortRef,
        requestIdRef: roiRequestIdRef,
      })
      clearTimeoutRef(magicLensDebounceRef)
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      invalidateLatestRequest({
        abortRef: magicLensAbortRef,
        requestIdRef: magicLensRequestIdRef,
      })
      setRoiMode('idle')
      setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      invalidateLatestRequest({
        abortRef: roiGeneViewportWarmupAbortRef,
        requestIdRef: roiGeneViewportWarmupRequestIdRef,
      })
      setRoiGeneViewportWarmupState(IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE)
      setRoiState(roiLoading(loadState.url, bbox, selection))
      setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
      setRoiReferenceState(IDLE_ROI_REFERENCE_STATE)
      setRoiTranscriptExportState(IDLE_ROI_TRANSCRIPT_EXPORT_STATE)
      setMagicLensState(IDLE_MAGIC_LENS_STATE)
      appendDebugEvent(`${roiSelectionLabel(selection)} drawn: ROI cells started`)

      void loadRoiCells(loadState.url, selection, { signal: request.signal })
        .then((cells) => {
          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          setRoiState(
            roiReady(
              loadState.url,
              bbox,
              selection,
              cells,
              cells.length >= ROI_CELL_EXPORT_LIMIT,
            ),
          )
          appendDebugEvent(
            `ROI cells ready: ${cells.length.toLocaleString()}${
              cells.length >= ROI_CELL_EXPORT_LIMIT ? '+' : ''
            } in ${formatElapsed(roiCellsStartedAt)}`,
          )

          if (cells.length === 0) {
            setRoiGeneStatsState(roiGeneStatsReady(url, emptyRoiGeneStats()))
            return undefined
          }

          // The reference cells outside the selection, for enriched genes
          // (15.4-B). Its errors stay in its own state.
          const readReference = (): Promise<void> => {
            const outside = referenceOutsideSelection(
              referenceCells,
              selection,
              (cell) => cell.position,
            )

            if (outside.length === 0) {
              setRoiReferenceState(roiReferenceUnavailable(url))
              return Promise.resolve()
            }

            const referenceStartedAt = readTimestamp()
            setRoiReferenceState(roiReferenceLoading(url, outside.length))
            appendDebugEvent(
              `ROI reference started: ${outside.length.toLocaleString()} cells outside`,
            )

            return loadRoiGeneStats(url, outside, {
              signal: request.signal,
              cellLimit: outside.length,
              sampleStrategy: 'head',
              geneLimit: ALL_GENES,
              onFallback: appendFallbackNotice,
            })
              .then((stats) => {
                if (!request.isCurrent() || request.signal.aborted) {
                  return
                }

                setRoiReferenceState(roiReferenceReady(url, stats))
                appendDebugEvent(
                  `ROI reference ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
                    referenceStartedAt,
                  )}`,
                )
              })
              .catch((error: unknown) => {
                if (
                  isAbortError(error) ||
                  !request.isCurrent() ||
                  request.signal.aborted
                ) {
                  return
                }

                setRoiReferenceState(
                  roiReferenceFailed(url, createStructuredLoadError('ROI genes', error)),
                )
                appendDebugEvent(
                  `ROI reference failed (${formatElapsed(referenceStartedAt)})`,
                )
              })
          }

          const refine = (): Promise<void> => {
            const refinementStartedAt = readTimestamp()
            appendDebugEvent(
              `ROI genes refinement started: ${cells.length.toLocaleString()} cells`,
            )
            return deferRoiGeneRefinement()
              .then(() => {
                if (!request.isCurrent() || request.signal.aborted) {
                  return undefined
                }

                return loadRoiGeneStats(url, cells, {
                  signal: request.signal,
                  geneLimit: ALL_GENES,
                  onFallback: appendFallbackNotice,
                })
              })
              .then((stats) => {
                if (!request.isCurrent() || request.signal.aborted) {
                  return
                }

                if (stats === undefined) {
                  return
                }

                setRoiGeneStatsState(roiGeneStatsReady(url, stats))
                appendDebugEvent(
                  `ROI genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
                    refinementStartedAt,
                  )} (total ${formatElapsed(roiStartedAt)})`,
                )
              })
              .catch((error: unknown) => {
                if (
                  isAbortError(error) ||
                  !request.isCurrent() ||
                  request.signal.aborted
                ) {
                  return
                }

                appendDebugEvent(
                  `ROI gene refinement failed (${formatElapsed(refinementStartedAt)})`,
                )
              })
          }

          setRoiGeneStatsState(roiGeneStatsLoading(url, cells.length))
          const previewStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI genes preview started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )

          // The preview first, then the comparison, then every cell.
          return loadRoiGeneStats(url, cells, {
            signal: request.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
            geneLimit: ALL_GENES,
            onFallback: appendFallbackNotice,
          })
            .then((previewStats) => {
              if (!request.isCurrent() || request.signal.aborted) {
                return undefined
              }

              setRoiGeneStatsState(roiGeneStatsReady(url, previewStats))
              appendDebugEvent(
                `ROI genes preview ready: ${previewStats.genes.length.toLocaleString()} genes in ${formatElapsed(
                  previewStartedAt,
                )}`,
              )

              return readReference().then(() =>
                cells.length <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT ||
                !request.isCurrent() ||
                request.signal.aborted
                  ? undefined
                  : refine(),
              )
            })
            .catch((error: unknown) => {
              if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
                return
              }

              setRoiGeneStatsState(
                roiGeneStatsFailed(url, createStructuredLoadError('ROI genes', error)),
              )
              appendDebugEvent(
                `ROI genes unsupported (${formatElapsed(previewStartedAt)})`,
              )
            })
        })
        .catch((error) => {
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
            return
          }

          setRoiState(
            roiFailed(
              loadState.url,
              bbox,
              selection,
              createStructuredLoadError('ROI cells', error),
            ),
          )
          setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
          appendDebugEvent(`ROI cells failed (${formatElapsed(roiCellsStartedAt)})`)
        })
        .finally(() => {
          request.complete()
        })
    },
    [
      appendDebugEvent,
      appendFallbackNotice,
      enabled,
      loadRoiCells,
      loadRoiGeneStats,
      loadState,
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef,
      referenceCells,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupRequestIdRef,
      roiGeneViewportWarmupTimeoutRef,
      roiIdRef,
      roiRequestIdRef,
      setMagicLensState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
    ],
  )

  const handleClearRoi = useCallback(() => {
    invalidateLatestRequest({
      abortRef: roiAbortRef,
      requestIdRef: roiRequestIdRef,
    })
    invalidateLatestRequest({
      abortRef: roiTranscriptExportAbortRef,
      requestIdRef: roiTranscriptExportRequestIdRef,
    })
    if (magicLensScope === 'roi') {
      invalidateLatestRequest({
        abortRef: magicLensAbortRef,
        requestIdRef: magicLensRequestIdRef,
      })
      setMagicLensState(IDLE_MAGIC_LENS_STATE)
    }
    setRoiMode('idle')
    setRoiState(IDLE_ROI_STATE)
    setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
    setRoiReferenceState(IDLE_ROI_REFERENCE_STATE)
    setRoiTranscriptExportState(IDLE_ROI_TRANSCRIPT_EXPORT_STATE)
    appendDebugEvent('Cleared ROI')
  }, [
    appendDebugEvent,
    magicLensAbortRef,
    magicLensRequestIdRef,
    magicLensScope,
    roiAbortRef,
    roiRequestIdRef,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef,
    setMagicLensState,
    setRoiGeneStatsState,
    setRoiMode,
    setRoiReferenceState,
    setRoiState,
    setRoiTranscriptExportState,
  ])

  // Cancelling the cells query drops the ROI, as Clear does.
  const handleCancelRoiCells = useCallback(() => {
    invalidateLatestRequest({
      abortRef: roiAbortRef,
      requestIdRef: roiRequestIdRef,
    })
    setRoiState((current) => (current.status === 'loading' ? IDLE_ROI_STATE : current))
    setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
    setRoiReferenceState(IDLE_ROI_REFERENCE_STATE)
    appendDebugEvent('Cancelled ROI cells')
  }, [
    appendDebugEvent,
    roiAbortRef,
    roiRequestIdRef,
    setRoiGeneStatsState,
    setRoiReferenceState,
    setRoiState,
  ])

  // Cancelling the genes query keeps the ROI and its cells. The genes load
  // again only for a new ROI.
  const handleCancelRoiGenes = useCallback(() => {
    invalidateLatestRequest({
      abortRef: roiAbortRef,
      requestIdRef: roiRequestIdRef,
    })
    setRoiGeneStatsState((current) =>
      current.status === 'loading' ? IDLE_ROI_GENE_STATS_STATE : current,
    )
    setRoiReferenceState((current) =>
      current.status === 'loading' ? IDLE_ROI_REFERENCE_STATE : current,
    )
    appendDebugEvent('Cancelled ROI genes')
  }, [
    appendDebugEvent,
    roiAbortRef,
    roiRequestIdRef,
    setRoiGeneStatsState,
    setRoiReferenceState,
  ])

  const handleExportRoiCells = useCallback(() => {
    if (roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    downloadTextFile(`${slug(name)}-cells.csv`, roiCellsToCsv(roiState.cells))
    appendDebugEvent(`Exported ROI cells ${name}`)
  }, [appendDebugEvent, roiIdRef, roiName, roiState])

  const handleExportRoiGeoJson = useCallback(() => {
    if (roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)

    downloadTextFile(
      `${slug(name)}-roi.geojson`,
      roiSelectionToGeoJson(roiState.selection, {
        roi_name: name,
        dataset_platform: 'xenium',
        dataset_url: roiState.url,
        selected_cell_count: roiState.cells.length,
        hit_cell_limit: roiState.hitCellLimit,
      }),
      'application/geo+json;charset=utf-8',
    )
    appendDebugEvent(`Exported ROI GeoJSON ${name}`)
  }, [appendDebugEvent, roiIdRef, roiName, roiState])

  const handleExportRoiTranscripts = useCallback(() => {
    if (roiState.status !== 'ready') {
      return
    }

    const request = startLatestRequest({
      abortRef: roiTranscriptExportAbortRef,
      requestIdRef: roiTranscriptExportRequestIdRef,
    })
    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    setRoiTranscriptExportState(roiTranscriptExportLoading(roiState.url))
    appendDebugEvent(`Exporting ROI transcripts ${name}`)

    void loadRoiTranscripts(roiState.url, roiState.selection, {
      signal: request.signal,
    })
      .then((transcripts) => {
        if (!request.isCurrent() || request.signal.aborted) {
          return
        }

        downloadTextFile(
          `${slug(name)}-transcripts.csv`,
          roiTranscriptsToCsv(transcripts),
        )
        setRoiTranscriptExportState(IDLE_ROI_TRANSCRIPT_EXPORT_STATE)
        appendDebugEvent(
          `Exported ROI transcripts: ${transcripts.length.toLocaleString()} rows`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
          return
        }

        setRoiTranscriptExportState(
          roiTranscriptExportFailed(
            roiState.url,
            createStructuredLoadError('ROI transcripts', error),
          ),
        )
        appendDebugEvent('ROI transcript export failed')
      })
      .finally(() => {
        request.complete()
      })
  }, [
    appendDebugEvent,
    loadRoiTranscripts,
    roiIdRef,
    roiName,
    roiState,
    roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef,
    setRoiTranscriptExportState,
  ])

  return {
    handleCancelRoiCells,
    handleCancelRoiGenes,
    handleClearRoi,
    handleExportRoiCells,
    handleExportRoiGeoJson,
    handleExportRoiTranscripts,
    handleRoiComplete,
  }
}
