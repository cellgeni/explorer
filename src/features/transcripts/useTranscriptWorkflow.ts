import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  TRANSCRIPT_GROUP_LIMIT,
  transcriptAggregateRequestKey,
  planTranscriptLod,
  transcriptViewportRequestKey,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type {
  TranscriptAggregateLoader,
  TranscriptCapabilitiesLoader,
  TranscriptViewportLoader,
} from '../app-shell/appDependencies'
import type { ControlHudTab } from '../app-shell/appShellModel'
import {
  abortActiveRequest,
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
import {
  TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS,
  TRANSCRIPT_NATIVE_DENSITY_MAX_BINS,
  buildCellSummaryTranscriptBins,
  isTranscriptExactManualLoadRequired,
  maxTranscriptAggregateCount,
  retainedTranscriptLayerState,
  transcriptAggregateFallbackMessage,
  transcriptExactManualLoadMessage,
  transcriptNativeAggregateMessage,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './transcriptLayerModel'
import { transcriptCapabilityLabel } from './transcriptLabels'

const EMPTY_GENE_LIST: readonly string[] = []

interface MutableRef<T> {
  current: T
}

interface UseTranscriptWorkflowOptions {
  readonly activeControlHudTab: ControlHudTab
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly loadRequestIdRef: MutableRef<number>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly loadTranscriptAggregates: TranscriptAggregateLoader
  readonly loadTranscriptCapabilities: TranscriptCapabilitiesLoader
  readonly loadTranscriptViewport: TranscriptViewportLoader
  readonly manualTranscriptExactRequestKey: string | null
  readonly overviewCells: readonly OverviewCellDatum[]
  readonly selectedGenes: readonly string[]
  readonly setTranscriptCapabilityState: Dispatch<
    SetStateAction<TranscriptCapabilityState<StructuredLoadError>>
  >
  readonly setTranscriptLayerState: Dispatch<
    SetStateAction<TranscriptLayerState<StructuredLoadError>>
  >
  readonly showTranscriptOverlay: boolean
  readonly transcriptAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityRequestIdRef: MutableRef<number>
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptGeneOnly: boolean
  readonly transcriptMinQv: number
  readonly transcriptRequestIdRef: MutableRef<number>
  readonly transcriptViewportKeyRef: MutableRef<string | null>
  readonly visibleTranscriptEstimate: number
}

export function useTranscriptWorkflow({
  activeControlHudTab,
  appendDebugEvent,
  appendFallbackNotice,
  currentViewportDetail,
  effectiveTranscriptFeatureFilterMode,
  loadRequestIdRef,
  loadState,
  loadTranscriptAggregates,
  loadTranscriptCapabilities,
  loadTranscriptViewport,
  manualTranscriptExactRequestKey,
  overviewCells,
  selectedGenes,
  setTranscriptCapabilityState,
  setTranscriptLayerState,
  showTranscriptOverlay,
  transcriptAbortRef,
  transcriptCapabilityAbortRef,
  transcriptCapabilityRequestIdRef,
  transcriptCapabilityState,
  transcriptDetailMode,
  transcriptExactPointLimit,
  transcriptGeneOnly,
  transcriptMinQv,
  transcriptRequestIdRef,
  transcriptViewportKeyRef,
  visibleTranscriptEstimate,
}: UseTranscriptWorkflowOptions): void {
  useEffect(() => {
    if (
      loadState.status !== 'ready' ||
      transcriptCapabilityState.status !== 'idle' ||
      (!showTranscriptOverlay && activeControlHudTab !== 'transcripts')
    ) {
      return
    }

    const requestedUrl = loadState.url
    const requestId = loadRequestIdRef.current
    const abortController = new AbortController()
    const transcriptStartedAt = readTimestamp()
    abortActiveRequest(transcriptCapabilityAbortRef)
    transcriptCapabilityRequestIdRef.current += 1
    transcriptCapabilityAbortRef.current = abortController
    queueMicrotask(() => {
      if (transcriptCapabilityAbortRef.current === abortController) {
        setTranscriptCapabilityState({ status: 'loading', url: requestedUrl })
      }
    })
    appendDebugEvent('Transcript output check started')

    void loadTranscriptCapabilities(requestedUrl, {
      signal: abortController.signal,
    })
      .then((capabilities) => {
        if (loadRequestIdRef.current !== requestId || abortController.signal.aborted) {
          return
        }

        setTranscriptCapabilityState({
          status: 'ready',
          url: requestedUrl,
          capabilities,
        })
        appendDebugEvent(
          `Transcript outputs: ${transcriptCapabilityLabel(capabilities)} (${formatElapsed(
            transcriptStartedAt,
          )})`,
          { coalesceKey: 'transcript-capability' },
        )
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return
        }

        setTranscriptCapabilityState({
          status: 'error',
          url: requestedUrl,
          error: createStructuredLoadError('Transcripts', error),
        })
        appendDebugEvent('Transcript output check failed', {
          coalesceKey: 'transcript-capability',
        })
      })
      .finally(() => {
        if (transcriptCapabilityAbortRef.current === abortController) {
          transcriptCapabilityAbortRef.current = null
        }
      })
  }, [
    activeControlHudTab,
    appendDebugEvent,
    loadRequestIdRef,
    loadState,
    loadTranscriptCapabilities,
    setTranscriptCapabilityState,
    showTranscriptOverlay,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef,
    transcriptCapabilityState.status,
  ])

  useEffect(() => {
    if (
      !showTranscriptOverlay ||
      loadState.status !== 'ready' ||
      currentViewportDetail === null
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const clearRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === clearRequestId) {
          setTranscriptLayerState((current) =>
            current.status === 'idle' ? current : { status: 'idle' },
          )
        }
      })
      return
    }

    if (
      transcriptCapabilityState.status === 'idle' ||
      transcriptCapabilityState.status === 'loading'
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const waitingRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: 'Checking transcript outputs for this dataset.',
            visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    if (transcriptCapabilityState.status === 'error') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const errorRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === errorRequestId) {
          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: transcriptCapabilityState.error,
          })
        }
      })
      return
    }

    const featureNames =
      effectiveTranscriptFeatureFilterMode === 'selected'
        ? selectedGenes
        : EMPTY_GENE_LIST
    const aggregateFeatureNames = EMPTY_GENE_LIST
    const hasSelectedFeatureFilter =
      effectiveTranscriptFeatureFilterMode !== 'selected' || featureNames.length > 0
    const plan = planTranscriptLod(currentViewportDetail, {
      detailMode: transcriptDetailMode,
      visibleTranscriptEstimate,
      exactLimit: transcriptExactPointLimit,
      hasRawParquet: transcriptCapabilityState.capabilities.rawParquet,
      hasNativeZarr: transcriptCapabilityState.capabilities.nativeZarr,
      hasSelectedFeatureFilter,
    })

    if (plan.kind === 'native-zarr') {
      const maxBins = TRANSCRIPT_NATIVE_DENSITY_MAX_BINS
      const requestKey = transcriptAggregateRequestKey(
        loadState.url,
        currentViewportDetail.bbox,
        {
          mode: plan.mode,
          featureNames: aggregateFeatureNames,
          maxBins,
        },
      )

      if (requestKey === transcriptViewportKeyRef.current) {
        return
      }

      abortActiveRequest(transcriptAbortRef)
      const requestId = transcriptRequestIdRef.current + 1
      const abortController = new AbortController()
      const transcriptStartedAt = readTimestamp()
      transcriptRequestIdRef.current = requestId
      transcriptAbortRef.current = abortController
      transcriptViewportKeyRef.current = requestKey
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === requestId) {
          setTranscriptLayerState((current) => {
            const previousLayer = retainedTranscriptLayerState(current)

            return {
              status: 'loading',
              url: loadState.url,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              ...(previousLayer === undefined ? {} : { previousLayer }),
            }
          })
        }
      })
      appendDebugEvent('Native transcript aggregate query started', {
        coalesceKey: 'transcript-query',
      })

      void loadTranscriptAggregates(loadState.url, currentViewportDetail.bbox, {
        signal: abortController.signal,
        mode: plan.mode,
        featureNames: aggregateFeatureNames,
        maxBins,
      })
        .then((result) => {
          if (transcriptRequestIdRef.current !== requestId) {
            return
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          setTranscriptLayerState({
            status: 'aggregate',
            source: result.source,
            mode: plan.mode,
            bins: result.bins,
            message: transcriptNativeAggregateMessage({
              mode: plan.mode,
              selectedFeatureCount: result.selectedFeatureNames.length,
              binCount: result.bins.length,
            }),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            ...(result.scaleMax === undefined ? {} : { scaleMax: result.scaleMax }),
            durationMs,
          })
          appendDebugEvent(
            `Native transcript aggregate ready: ${result.bins.length.toLocaleString()} squares in ${formatElapsed(
              transcriptStartedAt,
            )}`,
            { coalesceKey: 'transcript-query' },
          )
        })
        .catch((error) => {
          if (isAbortError(error) || transcriptRequestIdRef.current !== requestId) {
            return
          }

          transcriptViewportKeyRef.current = null
          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Transcripts', error),
          })
          appendDebugEvent('Native transcript aggregate query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          if (transcriptAbortRef.current === abortController) {
            transcriptAbortRef.current = null
          }
        })

      return () => {
        if (transcriptAbortRef.current === abortController) {
          abortActiveRequest(transcriptAbortRef)
        }
      }
    }

    if (
      (plan.kind === 'waiting' || plan.kind === 'unavailable') &&
      !transcriptCapabilityState.capabilities.nativeZarr &&
      transcriptDetailMode !== 'exact' &&
      visibleTranscriptEstimate > 0
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const aggregateRequestId = transcriptRequestIdRef.current
      const fallbackMode = 'density'
      const bins = buildCellSummaryTranscriptBins(
        overviewCells,
        currentViewportDetail.bbox,
        fallbackMode,
      )
      appendFallbackNotice({
        source: 'Transcripts',
        message:
          'Native transcripts.zarr.zip density was unavailable, so the app switched to cell transcript-count summary bins.',
        action:
          'This fallback shows approximate all-transcript density and cannot provide feature-level aggregate details.',
        coalesceKey: `transcript-cell-summary:${loadState.url}`,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === aggregateRequestId) {
          setTranscriptLayerState({
            status: 'aggregate',
            source: 'cell-summary',
            mode: fallbackMode,
            bins,
            message: transcriptAggregateFallbackMessage({
              mode: fallbackMode,
              featureFilterMode: effectiveTranscriptFeatureFilterMode,
              selectedFeatureCount: featureNames.length,
            }),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            scaleMax: maxTranscriptAggregateCount(bins),
          })
        }
      })
      return
    }

    if (plan.kind === 'waiting') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const waitingRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: plan.message,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    if (plan.kind === 'unavailable') {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const unavailableRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === unavailableRequestId) {
          setTranscriptLayerState({
            status: 'unavailable',
            message: plan.message,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      return
    }

    const requestKey = transcriptViewportRequestKey(
      loadState.url,
      currentViewportDetail.bbox,
      {
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
        pointLimit: transcriptExactPointLimit,
      },
    )

    if (
      isTranscriptExactManualLoadRequired(
        plan.visibleTranscriptEstimate,
        transcriptExactPointLimit,
      ) &&
      manualTranscriptExactRequestKey !== requestKey
    ) {
      abortActiveRequest(transcriptAbortRef)
      transcriptRequestIdRef.current += 1
      const waitingRequestId = transcriptRequestIdRef.current
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState({
            status: 'waiting',
            message: transcriptExactManualLoadMessage(
              plan.visibleTranscriptEstimate,
              transcriptExactPointLimit,
            ),
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            exactLoadRequestKey: requestKey,
            exactLoadEstimate: plan.visibleTranscriptEstimate,
          })
        }
      })
      appendDebugEvent('Transcript exact query waiting for manual viewport load', {
        coalesceKey: 'transcript-query',
      })
      return
    }

    if (requestKey === transcriptViewportKeyRef.current) {
      return
    }

    abortActiveRequest(transcriptAbortRef)
    const requestId = transcriptRequestIdRef.current + 1
    const abortController = new AbortController()
    const transcriptStartedAt = readTimestamp()
    transcriptRequestIdRef.current = requestId
    transcriptAbortRef.current = abortController
    transcriptViewportKeyRef.current = requestKey
    queueMicrotask(() => {
      if (transcriptRequestIdRef.current === requestId) {
        setTranscriptLayerState((current) => {
          const previousLayer = retainedTranscriptLayerState(current)

          return {
            status: 'loading',
            url: loadState.url,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            ...(previousLayer === undefined ? {} : { previousLayer }),
          }
        })
      }
    })
    appendDebugEvent(
      `Transcript exact query started: ${plan.visibleTranscriptEstimate.toLocaleString()} estimated`,
      { coalesceKey: 'transcript-query' },
    )

    let didExactQueryTimeOut = false
    let exactQueryTimeout: number | null = null
    const startTimeout = window.setTimeout(() => {
      exactQueryTimeout = window.setTimeout(() => {
        if (transcriptRequestIdRef.current !== requestId) {
          return
        }

        didExactQueryTimeOut = true
        transcriptViewportKeyRef.current = null

        if (transcriptAbortRef.current === abortController) {
          transcriptAbortRef.current = null
        }

        abortController.abort()
        setTranscriptLayerState({
          status: 'waiting',
          message:
            'Exact transcript loading exceeded 12 seconds. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.',
          visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
        })
        appendDebugEvent('Transcript exact query timed out', {
          coalesceKey: 'transcript-query',
        })
      }, TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS)

      void loadTranscriptViewport(loadState.url, currentViewportDetail.bbox, {
        signal: abortController.signal,
        pointLimit: transcriptExactPointLimit,
        groupLimit: TRANSCRIPT_GROUP_LIMIT,
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
        onFallback: appendFallbackNotice,
      })
        .then((result) => {
          if (didExactQueryTimeOut || transcriptRequestIdRef.current !== requestId) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          if (result.hitPointLimit) {
            transcriptViewportKeyRef.current = null
            setTranscriptLayerState({
              status: 'waiting',
              message: `Exact transcript viewport exceeded the ${transcriptExactPointLimit.toLocaleString()} point budget. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.`,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            })
            appendDebugEvent('Transcript exact query exceeded point budget', {
              coalesceKey: 'transcript-query',
            })
            return
          }

          setTranscriptLayerState({
            status: 'ready',
            url: loadState.url,
            points: result.points,
            groups: result.groups,
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            hitPointLimit: result.hitPointLimit,
            durationMs,
          })
          appendDebugEvent(
            `Transcript exact query ready: ${result.points.length.toLocaleString()} points in ${formatElapsed(
              transcriptStartedAt,
            )}`,
            { coalesceKey: 'transcript-query' },
          )
        })
        .catch((error) => {
          if (
            didExactQueryTimeOut ||
            isAbortError(error) ||
            transcriptRequestIdRef.current !== requestId
          ) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          setTranscriptLayerState({
            status: 'error',
            url: loadState.url,
            error: createStructuredLoadError('Transcripts', error),
          })
          appendDebugEvent('Transcript query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          if (transcriptAbortRef.current === abortController) {
            transcriptAbortRef.current = null
          }
        })
    }, 220)

    return () => {
      window.clearTimeout(startTimeout)
      if (exactQueryTimeout !== null) {
        window.clearTimeout(exactQueryTimeout)
      }

      if (transcriptAbortRef.current === abortController) {
        abortActiveRequest(transcriptAbortRef)
      }
    }
  }, [
    appendDebugEvent,
    appendFallbackNotice,
    currentViewportDetail,
    effectiveTranscriptFeatureFilterMode,
    loadState,
    loadTranscriptAggregates,
    loadTranscriptViewport,
    manualTranscriptExactRequestKey,
    overviewCells,
    selectedGenes,
    setTranscriptLayerState,
    showTranscriptOverlay,
    transcriptAbortRef,
    transcriptCapabilityState,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptRequestIdRef,
    transcriptViewportKeyRef,
    visibleTranscriptEstimate,
  ])
}
