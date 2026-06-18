import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type {
  ViewerMagicLensDetail,
  ViewerViewportDetail,
} from '../../components/ViewerCore'
import { normalizeRoiSelection, type RoiSelectionInput } from '../../data/roiSelection'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { RoiCellsLoader, RoiGeneStatsLoader } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  clearTimeoutRef,
  isAbortError,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  MAGIC_LENS_CELL_LIMIT,
  MAGIC_LENS_GENE_STATS_LIMIT,
  filterCellsForCircle,
  magicLensDetailQueryKey,
  magicLensScopeLabel,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  resolveMagicLensSelection,
  summarizeMagicLensCells,
  type MagicLensCircleFilter,
  type MagicLensScope,
  type MagicLensState,
} from './magicLensModel'
import { emptyRoiGeneStats } from './roiModel'

interface MutableRef<T> {
  current: T
}

interface UseMagicLensWorkflowOptions {
  readonly activeRoiSelection: RoiSelectionInput | null
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly loadRoiCells: RoiCellsLoader
  readonly loadRoiGeneStats: RoiGeneStatsLoader
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly magicLensAbortRef: MutableRef<AbortController | null>
  readonly magicLensActive: boolean
  readonly magicLensDebounceRef: MutableRef<number | null>
  readonly magicLensLastDetailRef: MutableRef<ViewerMagicLensDetail | null>
  readonly magicLensLastQueryKeyRef: MutableRef<string | null>
  readonly magicLensMinQv: number
  readonly magicLensRequestIdRef: MutableRef<number>
  readonly magicLensScope: MagicLensScope
  readonly selectedGenes: readonly string[]
  readonly setMagicLensActive: Dispatch<SetStateAction<boolean>>
  readonly setMagicLensMinQv: Dispatch<SetStateAction<number>>
  readonly setMagicLensRadiusMicrometers: Dispatch<SetStateAction<number>>
  readonly setMagicLensScope: Dispatch<SetStateAction<MagicLensScope>>
  readonly setMagicLensState: Dispatch<
    SetStateAction<MagicLensState<StructuredLoadError>>
  >
  readonly setMeasurementEnabled: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementResetKey: Dispatch<SetStateAction<number>>
}

interface UseMagicLensWorkflowResult {
  readonly handleMagicLensCursorActiveChange: (active: boolean) => void
  readonly handleMagicLensLeave: () => void
  readonly handleMagicLensMinQvChange: (value: number) => void
  readonly handleMagicLensMove: (detail: ViewerMagicLensDetail) => void
  readonly handleMagicLensRadiusChange: (value: number) => void
  readonly handleMagicLensScopeChange: (scope: MagicLensScope) => void
  readonly handleRunMagicLens: () => void
}

export function useMagicLensWorkflow({
  activeRoiSelection,
  appendDebugEvent,
  appendFallbackNotice,
  currentViewportDetail,
  loadRoiCells,
  loadRoiGeneStats,
  loadState,
  magicLensAbortRef,
  magicLensActive,
  magicLensDebounceRef,
  magicLensLastDetailRef,
  magicLensLastQueryKeyRef,
  magicLensMinQv,
  magicLensRequestIdRef,
  magicLensScope,
  selectedGenes,
  setMagicLensActive,
  setMagicLensMinQv,
  setMagicLensRadiusMicrometers,
  setMagicLensScope,
  setMagicLensState,
  setMeasurementEnabled,
  setMeasurementResetKey,
}: UseMagicLensWorkflowOptions): UseMagicLensWorkflowResult {
  const runMagicLensQuery = useCallback(
    (
      selection: RoiSelectionInput,
      scope: MagicLensScope,
      circleFilter: MagicLensCircleFilter | null = null,
    ) => {
      if (loadState.status !== 'ready') {
        return
      }

      const requestId = magicLensRequestIdRef.current + 1
      abortActiveRequest(magicLensAbortRef)
      const abortController = new AbortController()
      magicLensRequestIdRef.current = requestId
      magicLensAbortRef.current = abortController
      setMagicLensState({
        status: 'loading',
        url: loadState.url,
        scope,
      })
      appendDebugEvent(
        `Scanning magic lens ${magicLensScopeLabel(scope)}`,
        scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-scan' } : {},
      )

      const normalizedSelection = normalizeRoiSelection(selection)

      void loadRoiCells(loadState.url, normalizedSelection, {
        signal: abortController.signal,
        limit: MAGIC_LENS_CELL_LIMIT,
      })
        .then((cells) => {
          if (magicLensRequestIdRef.current !== requestId) {
            return undefined
          }

          const lensCells =
            circleFilter === null ? cells : filterCellsForCircle(cells, circleFilter)

          if (lensCells.length === 0) {
            setMagicLensState({
              status: 'ready',
              url: loadState.url,
              scope,
              summary: summarizeMagicLensCells(
                lensCells,
                emptyRoiGeneStats(),
                selectedGenes,
                {
                  hitLimit: cells.length >= MAGIC_LENS_CELL_LIMIT,
                },
              ),
            })
            appendDebugEvent(
              'Magic lens ready: 0 cells',
              scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-ready' } : {},
            )
            return undefined
          }

          return loadRoiGeneStats(loadState.url, lensCells, {
            signal: abortController.signal,
            cellLimit: MAGIC_LENS_CELL_LIMIT,
            geneLimit: MAGIC_LENS_GENE_STATS_LIMIT,
            onFallback: appendFallbackNotice,
          }).then((stats) => {
            if (magicLensRequestIdRef.current !== requestId) {
              return
            }

            setMagicLensState({
              status: 'ready',
              url: loadState.url,
              scope,
              summary: summarizeMagicLensCells(lensCells, stats, selectedGenes, {
                hitLimit: cells.length >= MAGIC_LENS_CELL_LIMIT || stats.hitCellLimit,
              }),
            })
            appendDebugEvent(
              `Magic lens ready: ${lensCells.length.toLocaleString()} cells`,
              scope === 'cursor' ? { coalesceKey: 'magic-lens-cursor-ready' } : {},
            )
          })
        })
        .catch((error) => {
          if (isAbortError(error) || magicLensRequestIdRef.current !== requestId) {
            return
          }

          setMagicLensState({
            status: 'error',
            url: loadState.url,
            scope,
            error: createStructuredLoadError('Magic lens', error),
          })
          appendDebugEvent('Magic lens failed')
        })
        .finally(() => {
          if (magicLensAbortRef.current === abortController) {
            magicLensAbortRef.current = null
          }
        })
    },
    [
      appendDebugEvent,
      appendFallbackNotice,
      loadRoiCells,
      loadRoiGeneStats,
      loadState,
      magicLensAbortRef,
      magicLensRequestIdRef,
      selectedGenes,
      setMagicLensState,
    ],
  )

  const handleMagicLensLeave = useCallback(() => {
    clearTimeoutRef(magicLensDebounceRef)
    magicLensLastDetailRef.current = null
    magicLensLastQueryKeyRef.current = null

    if (magicLensScope !== 'cursor') {
      return
    }

    abortActiveRequest(magicLensAbortRef)
    magicLensRequestIdRef.current += 1
    setMagicLensState({ status: 'idle' })
  }, [
    magicLensAbortRef,
    magicLensDebounceRef,
    magicLensLastDetailRef,
    magicLensLastQueryKeyRef,
    magicLensRequestIdRef,
    magicLensScope,
    setMagicLensState,
  ])

  const handleRunMagicLens = useCallback(() => {
    if (loadState.status !== 'ready') {
      return
    }

    const selection = resolveMagicLensSelection(
      magicLensScope,
      currentViewportDetail,
      activeRoiSelection,
    )

    if (selection === null) {
      appendDebugEvent('Magic lens scope unavailable')
      return
    }

    runMagicLensQuery(selection, magicLensScope)
  }, [
    activeRoiSelection,
    appendDebugEvent,
    currentViewportDetail,
    loadState.status,
    magicLensScope,
    runMagicLensQuery,
  ])

  const handleMagicLensScopeChange = useCallback(
    (nextScope: MagicLensScope) => {
      if (nextScope === 'cursor') {
        setMagicLensScope('cursor')
        setMagicLensState({ status: 'idle' })
        magicLensLastQueryKeyRef.current = null
        appendDebugEvent('Magic lens scope: cursor', {
          coalesceKey: 'magic-lens-scope',
        })
        return
      }

      handleMagicLensLeave()
      setMagicLensActive(false)
      setMagicLensScope(nextScope)
      appendDebugEvent(
        nextScope === 'viewport' ? 'Magic lens scope: viewport' : 'Magic lens scope: ROI',
        { coalesceKey: 'magic-lens-scope' },
      )
    },
    [
      appendDebugEvent,
      handleMagicLensLeave,
      magicLensLastQueryKeyRef,
      setMagicLensActive,
      setMagicLensScope,
      setMagicLensState,
    ],
  )

  const handleMagicLensRadiusChange = useCallback(
    (value: number) => {
      const nextRadius = normalizeMagicLensRadius(value)

      setMagicLensRadiusMicrometers(nextRadius)
      magicLensLastQueryKeyRef.current = null
      appendDebugEvent(`Magic lens radius: ${nextRadius} um`, {
        coalesceKey: 'magic-lens-radius',
      })
    },
    [appendDebugEvent, magicLensLastQueryKeyRef, setMagicLensRadiusMicrometers],
  )

  const handleMagicLensMinQvChange = useCallback(
    (value: number) => {
      const nextMinQv = normalizeMagicLensMinQv(value)

      setMagicLensMinQv(nextMinQv)
      magicLensLastQueryKeyRef.current = null
      appendDebugEvent(`Magic lens min QV: ${nextMinQv}`, {
        coalesceKey: 'magic-lens-min-qv',
      })
    },
    [appendDebugEvent, magicLensLastQueryKeyRef, setMagicLensMinQv],
  )

  const handleMagicLensCursorActiveChange = useCallback(
    (nextActive: boolean) => {
      setMagicLensActive(nextActive)

      if (!nextActive) {
        handleMagicLensLeave()
        return
      }

      setMeasurementEnabled(false)
      setMeasurementResetKey((current) => current + 1)
      setMagicLensState({ status: 'idle' })
      magicLensLastQueryKeyRef.current = null
      appendDebugEvent('Magic lens enabled')
    },
    [
      appendDebugEvent,
      handleMagicLensLeave,
      magicLensLastQueryKeyRef,
      setMagicLensActive,
      setMagicLensState,
      setMeasurementEnabled,
      setMeasurementResetKey,
    ],
  )

  const handleMagicLensMove = useCallback(
    (detail: ViewerMagicLensDetail) => {
      if (
        loadState.status !== 'ready' ||
        magicLensScope !== 'cursor' ||
        !magicLensActive
      ) {
        return
      }

      magicLensLastDetailRef.current = detail
      const queryKey = magicLensDetailQueryKey(detail, magicLensMinQv, selectedGenes)

      if (magicLensLastQueryKeyRef.current === queryKey) {
        return
      }

      clearTimeoutRef(magicLensDebounceRef)

      if (typeof window === 'undefined') {
        magicLensLastQueryKeyRef.current = queryKey
        runMagicLensQuery(detail.bbox, 'cursor', {
          center: detail.center,
          radiusMicrometers: detail.radiusMicrometers,
        })
        return
      }

      magicLensDebounceRef.current = window.setTimeout(() => {
        const latestDetail = magicLensLastDetailRef.current

        if (latestDetail === null) {
          return
        }

        const latestQueryKey = magicLensDetailQueryKey(
          latestDetail,
          magicLensMinQv,
          selectedGenes,
        )
        magicLensLastQueryKeyRef.current = latestQueryKey
        runMagicLensQuery(latestDetail.bbox, 'cursor', {
          center: latestDetail.center,
          radiusMicrometers: latestDetail.radiusMicrometers,
        })
      }, 320)
    },
    [
      loadState.status,
      magicLensActive,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensMinQv,
      magicLensScope,
      runMagicLensQuery,
      selectedGenes,
    ],
  )

  return {
    handleMagicLensCursorActiveChange,
    handleMagicLensLeave,
    handleMagicLensMinQvChange,
    handleMagicLensMove,
    handleMagicLensRadiusChange,
    handleMagicLensScopeChange,
    handleRunMagicLens,
  }
}
