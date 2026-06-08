import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type {
  RoiDrawMode,
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { ROI_CELL_EXPORT_LIMIT } from '../../data/roiCells'
import type { RoiSelection } from '../../data/roiSelection'
import type {
  RoiCellsLoader,
  RoiGeneStatsLoader,
  RoiTranscriptsLoader,
} from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  clearTimeoutRef,
  downloadTextFile,
  formatElapsed,
  isAbortError,
  readTimestamp,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { type MagicLensScope, type MagicLensState } from './magicLensModel'
import {
  ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
  ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS,
  defaultRoiName,
  deferRoiGeneRefinement,
  emptyRoiGeneStats,
  roiCellsToCsv,
  roiGeneViewportWarmupKey,
  roiSelectionLabel,
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

interface UseRoiWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
  readonly loadRoiCells: RoiCellsLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
  readonly loadRoiTranscripts: RoiTranscriptsLoader
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly magicLensAbortRef: MutableRef<AbortController | null>
  readonly magicLensDebounceRef: MutableRef<number | null>
  readonly magicLensLastDetailRef: MutableRef<ViewerMagicLensDetail | null>
  readonly magicLensLastQueryKeyRef: MutableRef<string | null>
  readonly magicLensRequestIdRef: MutableRef<number>
  readonly magicLensScope: MagicLensScope
  readonly roiAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupAbortRef: MutableRef<AbortController | null>
  readonly roiGeneViewportWarmupKeyRef: MutableRef<string | null>
  readonly roiGeneViewportWarmupTimeoutRef: MutableRef<number | null>
  readonly roiIdRef: MutableRef<number>
  readonly roiName: string
  readonly roiRequestIdRef: MutableRef<number>
  readonly roiState: RoiState<StructuredLoadError>
  readonly roiTranscriptExportAbortRef: MutableRef<AbortController | null>
  readonly roiTranscriptExportRequestIdRef: MutableRef<number>
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

interface UseRoiWorkflowResult {
  readonly handleClearRoi: () => void
  readonly handleExportRoiCells: () => void
  readonly handleExportRoiTranscripts: () => void
  readonly handleRoiComplete: (selection: RoiSelection) => void
}

export function useRoiWorkflow({
  appendDebugEvent,
  currentViewportDetail,
  initialSharedRoiSelectionRef,
  loadRoiCells,
  loadRoiGeneStats,
  loadRoiTranscripts,
  loadState,
  magicLensAbortRef,
  magicLensDebounceRef,
  magicLensLastDetailRef,
  magicLensLastQueryKeyRef,
  magicLensRequestIdRef,
  magicLensScope,
  roiAbortRef,
  roiGeneViewportWarmupAbortRef,
  roiGeneViewportWarmupKeyRef,
  roiGeneViewportWarmupTimeoutRef,
  roiIdRef,
  roiName,
  roiRequestIdRef,
  roiState,
  roiTranscriptExportAbortRef,
  roiTranscriptExportRequestIdRef,
  setMagicLensState,
  setRoiGeneStatsState,
  setRoiGeneViewportWarmupState,
  setRoiMode,
  setRoiName,
  setRoiState,
  setRoiTranscriptExportState,
}: UseRoiWorkflowOptions): UseRoiWorkflowResult {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const detail = currentViewportDetail
    const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

    if (
      readyDatasetUrl === null ||
      detail === null ||
      roiState.status !== 'idle' ||
      detail.visibleCellCount <= ROI_GENE_STATS_PREVIEW_CELL_LIMIT
    ) {
      const hadPendingWarmup =
        roiGeneViewportWarmupTimeoutRef.current !== null ||
        roiGeneViewportWarmupAbortRef.current !== null
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)

      if (hadPendingWarmup) {
        roiGeneViewportWarmupKeyRef.current = null
      }

      return
    }

    const warmupKey = roiGeneViewportWarmupKey(readyDatasetUrl, detail)

    if (warmupKey === roiGeneViewportWarmupKeyRef.current) {
      return
    }

    clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    abortActiveRequest(roiGeneViewportWarmupAbortRef)
    setRoiGeneViewportWarmupState({ status: 'loading', key: warmupKey })

    roiGeneViewportWarmupTimeoutRef.current = window.setTimeout(() => {
      const abortController = new AbortController()
      const selection = { kind: 'box' as const, bbox: detail.bbox }
      const warmupStartedAt = readTimestamp()
      roiGeneViewportWarmupAbortRef.current = abortController
      roiGeneViewportWarmupKeyRef.current = warmupKey

      void (async () => {
        try {
          const cellsStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI warmup cells started: ${detail.visibleCellCount.toLocaleString()} visible, limit ${ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT.toLocaleString()}`,
          )
          const cells = await loadRoiCells(readyDatasetUrl, selection, {
            signal: abortController.signal,
            limit: ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT,
          })

          if (abortController.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup cells ready: ${cells.length.toLocaleString()} in ${formatElapsed(cellsStartedAt)}`,
          )

          if (cells.length === 0) {
            appendDebugEvent(
              `ROI gene viewport warmup ready: no cells (${formatElapsed(warmupStartedAt)})`,
              {
                coalesceKey: 'roi-gene-warmup',
              },
            )
            setRoiGeneViewportWarmupState({ status: 'ready', key: warmupKey })
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
            signal: abortController.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
          })

          if (abortController.signal.aborted) {
            return
          }

          appendDebugEvent(
            `ROI warmup genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
              genesStartedAt,
            )}`,
          )
          appendDebugEvent(
            `ROI gene viewport warmup ready (${formatElapsed(warmupStartedAt)})`,
            {
              coalesceKey: 'roi-gene-warmup',
            },
          )
          setRoiGeneViewportWarmupState({ status: 'ready', key: warmupKey })
        } catch (error) {
          if (isAbortError(error)) {
            return
          }

          if (roiGeneViewportWarmupKeyRef.current === warmupKey) {
            roiGeneViewportWarmupKeyRef.current = null
          }

          appendDebugEvent(
            `ROI gene viewport warmup skipped (${formatElapsed(warmupStartedAt)})`,
            {
              coalesceKey: 'roi-gene-warmup',
            },
          )
          setRoiGeneViewportWarmupState({ status: 'error', key: warmupKey })
        } finally {
          if (roiGeneViewportWarmupAbortRef.current === abortController) {
            roiGeneViewportWarmupAbortRef.current = null
          }
        }
      })()
    }, ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS)

    return () => {
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
    }
  }, [
    appendDebugEvent,
    currentViewportDetail,
    loadRoiCells,
    loadRoiGeneStats,
    loadState,
    roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef,
    roiGeneViewportWarmupTimeoutRef,
    roiState.status,
    setRoiGeneViewportWarmupState,
  ])

  const handleRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (loadState.status !== 'ready') {
        return
      }

      const bbox = selection.bbox
      const requestId = roiRequestIdRef.current + 1
      const roiStartedAt = readTimestamp()
      const roiCellsStartedAt = roiStartedAt
      abortActiveRequest(roiAbortRef)
      clearTimeoutRef(magicLensDebounceRef)
      magicLensLastDetailRef.current = null
      magicLensLastQueryKeyRef.current = null
      abortActiveRequest(magicLensAbortRef)
      magicLensRequestIdRef.current += 1
      const abortController = new AbortController()
      roiRequestIdRef.current = requestId
      roiAbortRef.current = abortController
      setRoiMode('idle')
      setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
      clearTimeoutRef(roiGeneViewportWarmupTimeoutRef)
      abortActiveRequest(roiGeneViewportWarmupAbortRef)
      roiGeneViewportWarmupKeyRef.current = null
      setRoiGeneViewportWarmupState({ status: 'idle' })
      setRoiState({ status: 'loading', url: loadState.url, bbox, selection })
      setRoiGeneStatsState({ status: 'idle' })
      setRoiTranscriptExportState({ status: 'idle' })
      setMagicLensState({ status: 'idle' })
      appendDebugEvent(`${roiSelectionLabel(selection)} drawn: ROI cells started`)

      void loadRoiCells(loadState.url, selection, { signal: abortController.signal })
        .then((cells) => {
          if (roiRequestIdRef.current !== requestId) {
            return
          }

          setRoiState({
            status: 'ready',
            url: loadState.url,
            bbox,
            selection,
            cells,
            hitCellLimit: cells.length >= ROI_CELL_EXPORT_LIMIT,
          })
          appendDebugEvent(
            `ROI cells ready: ${cells.length.toLocaleString()}${
              cells.length >= ROI_CELL_EXPORT_LIMIT ? '+' : ''
            } in ${formatElapsed(roiCellsStartedAt)}`,
          )

          if (cells.length === 0) {
            setRoiGeneStatsState({
              status: 'ready',
              url: loadState.url,
              stats: emptyRoiGeneStats(),
            })
            return undefined
          }

          setRoiGeneStatsState({
            status: 'loading',
            url: loadState.url,
            cellCount: cells.length,
          })
          const previewStartedAt = readTimestamp()
          appendDebugEvent(
            `ROI genes preview started: sample ${Math.min(
              cells.length,
              ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            ).toLocaleString()} of ${cells.length.toLocaleString()} cells`,
          )

          return loadRoiGeneStats(loadState.url, cells, {
            signal: abortController.signal,
            cellLimit: ROI_GENE_STATS_PREVIEW_CELL_LIMIT,
            sampleStrategy: 'head',
          })
            .then((previewStats) => {
              if (roiRequestIdRef.current !== requestId) {
                return
              }

              setRoiGeneStatsState({
                status: 'ready',
                url: loadState.url,
                stats: previewStats,
              })
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
                  if (roiRequestIdRef.current !== requestId) {
                    return undefined
                  }

                  return loadRoiGeneStats(loadState.url, cells, {
                    signal: abortController.signal,
                  })
                })
                .then((stats) => {
                  if (roiRequestIdRef.current !== requestId) {
                    return
                  }

                  if (stats === undefined) {
                    return
                  }

                  setRoiGeneStatsState({
                    status: 'ready',
                    url: loadState.url,
                    stats,
                  })
                  appendDebugEvent(
                    `ROI genes ready: ${stats.genes.length.toLocaleString()} genes in ${formatElapsed(
                      refinementStartedAt,
                    )} (total ${formatElapsed(roiStartedAt)})`,
                  )
                })
                .catch((error) => {
                  if (isAbortError(error) || roiRequestIdRef.current !== requestId) {
                    return
                  }

                  appendDebugEvent(
                    `ROI gene refinement failed (${formatElapsed(refinementStartedAt)})`,
                  )
                })
            })
            .catch((error) => {
              if (isAbortError(error) || roiRequestIdRef.current !== requestId) {
                return
              }

              setRoiGeneStatsState({
                status: 'error',
                url: loadState.url,
                error: createStructuredLoadError('ROI genes', error),
              })
              appendDebugEvent(
                `ROI genes unsupported (${formatElapsed(previewStartedAt)})`,
              )
            })
        })
        .catch((error) => {
          if (isAbortError(error) || roiRequestIdRef.current !== requestId) {
            return
          }

          setRoiState({
            status: 'error',
            url: loadState.url,
            bbox,
            selection,
            error: createStructuredLoadError('ROI cells', error),
          })
          setRoiGeneStatsState({ status: 'idle' })
          appendDebugEvent(`ROI cells failed (${formatElapsed(roiCellsStartedAt)})`)
        })
        .finally(() => {
          if (roiAbortRef.current === abortController) {
            roiAbortRef.current = null
          }
        })
    },
    [
      appendDebugEvent,
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
      roiGeneViewportWarmupKeyRef,
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
    initialSharedRoiSelectionRef,
    loadState.status,
    roiState.status,
    setRoiName,
  ])

  const handleClearRoi = useCallback(() => {
    abortActiveRequest(roiAbortRef)
    abortActiveRequest(roiTranscriptExportAbortRef)
    if (magicLensScope === 'roi') {
      abortActiveRequest(magicLensAbortRef)
      magicLensRequestIdRef.current += 1
      setMagicLensState({ status: 'idle' })
    }
    roiRequestIdRef.current += 1
    roiTranscriptExportRequestIdRef.current += 1
    setRoiMode('idle')
    setRoiState({ status: 'idle' })
    setRoiGeneStatsState({ status: 'idle' })
    setRoiTranscriptExportState({ status: 'idle' })
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

  const handleExportRoiTranscripts = useCallback(() => {
    if (roiState.status !== 'ready') {
      return
    }

    const requestId = roiTranscriptExportRequestIdRef.current + 1
    abortActiveRequest(roiTranscriptExportAbortRef)
    const abortController = new AbortController()
    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    roiTranscriptExportRequestIdRef.current = requestId
    roiTranscriptExportAbortRef.current = abortController
    setRoiTranscriptExportState({ status: 'loading', url: roiState.url })
    appendDebugEvent(`Exporting ROI transcripts ${name}`)

    void loadRoiTranscripts(roiState.url, roiState.selection, {
      signal: abortController.signal,
    })
      .then((transcripts) => {
        if (roiTranscriptExportRequestIdRef.current !== requestId) {
          return
        }

        downloadTextFile(
          `${slug(name)}-transcripts.csv`,
          roiTranscriptsToCsv(transcripts),
        )
        setRoiTranscriptExportState({ status: 'idle' })
        appendDebugEvent(
          `Exported ROI transcripts: ${transcripts.length.toLocaleString()} rows`,
        )
      })
      .catch((error) => {
        if (
          isAbortError(error) ||
          roiTranscriptExportRequestIdRef.current !== requestId
        ) {
          return
        }

        setRoiTranscriptExportState({
          status: 'error',
          url: roiState.url,
          error: createStructuredLoadError('ROI transcripts', error),
        })
        appendDebugEvent('ROI transcript export failed')
      })
      .finally(() => {
        if (roiTranscriptExportAbortRef.current === abortController) {
          roiTranscriptExportAbortRef.current = null
        }
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
    handleExportRoiTranscripts,
    handleRoiComplete,
  }
}
