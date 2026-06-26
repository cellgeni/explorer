import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { ROI_CELL_EXPORT_LIMIT } from '../../data/roiCells'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { RoiSelection } from '../../data/roiSelection'
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
import { slug } from '../../utils/slug'

interface MutableRef<T> {
  current: T
}

interface UseRoiWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
}

interface UseRoiWorkflowControls {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly enabled?: boolean
  readonly magicLensScope: MagicLensScope
  readonly roiName: string
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
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
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
  readonly handleClearRoi: () => void
  readonly handleExportRoiCells: () => void
  readonly handleExportRoiGeoJson: () => void
  readonly handleExportRoiTranscripts: () => void
  readonly handleRoiComplete: (selection: RoiSelection) => void
}

export function useRoiWorkflow({
  callbacks: { appendDebugEvent, appendFallbackNotice },
  controls: { currentViewportDetail, enabled = true, magicLensScope, roiName },
  data: { loadState, roiState },
  loaders: { loadRoiCells, loadRoiGeneStats, loadRoiTranscripts },
  refs: {
    initialSharedRoiSelectionRef,
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
          const stats = await loadRoiGeneStats(readyDatasetUrl, cells, {
            signal: request.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
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
        } catch (error) {
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
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
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupRequestIdRef,
    roiGeneViewportWarmupTimeoutRef,
    roiState.status,
    setRoiGeneViewportWarmupState,
  ])

  const handleRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (!enabled || loadState.status !== 'ready') {
        return
      }

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
            setRoiGeneStatsState(roiGeneStatsReady(loadState.url, emptyRoiGeneStats()))
            return undefined
          }

          setRoiGeneStatsState(roiGeneStatsLoading(loadState.url, cells.length))
          const previewStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI genes preview started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )

          return loadRoiGeneStats(loadState.url, cells, {
            signal: request.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
            onFallback: appendFallbackNotice,
          })
            .then((previewStats) => {
              if (!request.isCurrent() || request.signal.aborted) {
                return
              }

              setRoiGeneStatsState(roiGeneStatsReady(loadState.url, previewStats))
              appendDebugEvent(
                `ROI genes preview ready: ${previewStats.genes.length.toLocaleString()} genes in ${formatElapsed(
                  previewStartedAt,
                )}`,
              )

              if (cells.length <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT) {
                return undefined
              }

              const refinementStartedAt = readTimestamp()
              appendDebugEvent(
                `ROI genes refinement started: ${cells.length.toLocaleString()} cells`,
              )
              return deferRoiGeneRefinement()
                .then(() => {
                  if (!request.isCurrent() || request.signal.aborted) {
                    return undefined
                  }

                  return loadRoiGeneStats(loadState.url, cells, {
                    signal: request.signal,
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

                  setRoiGeneStatsState(roiGeneStatsReady(loadState.url, stats))
                  appendDebugEvent(
                    `ROI genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
                      refinementStartedAt,
                    )} (total ${formatElapsed(roiStartedAt)})`,
                  )
                })
                .catch((error) => {
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
            })
            .catch((error) => {
              if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
                return
              }

              setRoiGeneStatsState(
                roiGeneStatsFailed(
                  loadState.url,
                  createStructuredLoadError('ROI genes', error),
                ),
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
      setRoiState,
      setRoiTranscriptExportState,
    ],
  )

  useEffect(() => {
    const selection = initialSharedRoiSelectionRef.current

    if (
      selection === null ||
      !enabled ||
      loadState.status !== 'ready' ||
      roiState.status !== 'idle'
    ) {
      return
    }

    initialSharedRoiSelectionRef.current = null
    setRoiName('Shared ROI')
    handleRoiComplete(selection)
  }, [
    handleRoiComplete,
    enabled,
    initialSharedRoiSelectionRef,
    loadState.status,
    roiState.status,
    setRoiName,
  ])

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
    setRoiState,
    setRoiTranscriptExportState,
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
    handleClearRoi,
    handleExportRoiCells,
    handleExportRoiGeoJson,
    handleExportRoiTranscripts,
    handleRoiComplete,
  }
}
