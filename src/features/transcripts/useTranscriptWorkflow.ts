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
  TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS,
  TRANSCRIPT_NATIVE_DENSITY_MAX_BINS,
  IDLE_TRANSCRIPT_LAYER_STATE,
  buildCellSummaryTranscriptBins,
  isTranscriptExactManualLoadRequired,
  maxTranscriptAggregateCount,
  transcriptCapabilityFailed,
  transcriptCapabilityReady,
  transcriptCapabilityStarted,
  transcriptLayerAggregate,
  transcriptLayerFailed,
  transcriptLayerLoading,
  transcriptLayerReady,
  transcriptLayerUnavailable,
  transcriptLayerWaiting,
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

interface UseTranscriptWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
}

interface UseTranscriptWorkflowControls {
  readonly activeControlHudTab: ControlHudTab
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly manualTranscriptExactRequestKey: string | null
  readonly showTranscriptOverlay: boolean
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptGeneOnly: boolean
  readonly transcriptMinQv: number
  readonly visibleTranscriptEstimate: number
}

interface UseTranscriptWorkflowData {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly overviewCells: readonly OverviewCellDatum[]
  readonly selectedGenes: readonly string[]
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
}

interface UseTranscriptWorkflowLoaders {
  readonly loadTranscriptAggregates: TranscriptAggregateLoader
  readonly loadTranscriptCapabilities: TranscriptCapabilitiesLoader
  readonly loadTranscriptViewport: TranscriptViewportLoader
}

interface UseTranscriptWorkflowRefs {
  readonly loadRequestIdRef: MutableRef<number>
  readonly transcriptAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityAbortRef: MutableRef<AbortController | null>
  readonly transcriptCapabilityRequestIdRef: MutableRef<number>
  readonly transcriptRequestIdRef: MutableRef<number>
  readonly transcriptViewportKeyRef: MutableRef<string | null>
}

interface UseTranscriptWorkflowSetters {
  readonly setTranscriptCapabilityState: Dispatch<
    SetStateAction<TranscriptCapabilityState<StructuredLoadError>>
  >
  readonly setTranscriptLayerState: Dispatch<
    SetStateAction<TranscriptLayerState<StructuredLoadError>>
  >
}

interface UseTranscriptWorkflowOptions {
  readonly callbacks: UseTranscriptWorkflowCallbacks
  readonly controls: UseTranscriptWorkflowControls
  readonly data: UseTranscriptWorkflowData
  readonly loaders: UseTranscriptWorkflowLoaders
  readonly refs: UseTranscriptWorkflowRefs
  readonly setters: UseTranscriptWorkflowSetters
}

export function useTranscriptWorkflow({
  callbacks: { appendDebugEvent, appendFallbackNotice },
  controls: {
    activeControlHudTab,
    effectiveTranscriptFeatureFilterMode,
    manualTranscriptExactRequestKey,
    showTranscriptOverlay,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptGeneOnly,
    transcriptMinQv,
    visibleTranscriptEstimate,
  },
  data: {
    currentViewportDetail,
    loadState,
    overviewCells,
    selectedGenes,
    transcriptCapabilityState,
  },
  loaders: {
    loadTranscriptAggregates,
    loadTranscriptCapabilities,
    loadTranscriptViewport,
  },
  refs: {
    loadRequestIdRef,
    transcriptAbortRef,
    transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef,
    transcriptRequestIdRef,
    transcriptViewportKeyRef,
  },
  setters: { setTranscriptCapabilityState, setTranscriptLayerState },
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
    const datasetRequestId = loadRequestIdRef.current
    const request = startLatestRequest({
      abortRef: transcriptCapabilityAbortRef,
      requestIdRef: transcriptCapabilityRequestIdRef,
    })
    const transcriptStartedAt = readTimestamp()
    queueMicrotask(() => {
      if (request.isCurrent() && !request.signal.aborted) {
        setTranscriptCapabilityState(transcriptCapabilityStarted(requestedUrl))
      }
    })
    appendDebugEvent('Transcript output check started')

    void loadTranscriptCapabilities(requestedUrl, {
      signal: request.signal,
    })
      .then((capabilities) => {
        if (
          loadRequestIdRef.current !== datasetRequestId ||
          !request.isCurrent() ||
          request.signal.aborted
        ) {
          return
        }

        setTranscriptCapabilityState(
          transcriptCapabilityReady(requestedUrl, capabilities),
        )
        appendDebugEvent(
          `Transcript outputs: ${transcriptCapabilityLabel(capabilities)} (${formatElapsed(
            transcriptStartedAt,
          )})`,
          { coalesceKey: 'transcript-capability' },
        )
      })
      .catch((error) => {
        if (
          isAbortError(error) ||
          loadRequestIdRef.current !== datasetRequestId ||
          !request.isCurrent() ||
          request.signal.aborted
        ) {
          return
        }

        setTranscriptCapabilityState(
          transcriptCapabilityFailed(
            requestedUrl,
            createStructuredLoadError('Transcripts', error),
          ),
        )
        appendDebugEvent('Transcript output check failed', {
          coalesceKey: 'transcript-capability',
        })
      })
      .finally(() => {
        request.complete()
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
      const clearRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === clearRequestId) {
          setTranscriptLayerState((current) =>
            current.status === 'idle' ? current : IDLE_TRANSCRIPT_LAYER_STATE,
          )
        }
      })
      return
    }

    if (
      transcriptCapabilityState.status === 'idle' ||
      transcriptCapabilityState.status === 'loading'
    ) {
      const waitingRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState(
            transcriptLayerWaiting({
              message: 'Checking transcript outputs for this dataset.',
              visibleTranscriptEstimate,
            }),
          )
        }
      })
      return
    }

    if (transcriptCapabilityState.status === 'error') {
      const errorRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === errorRequestId) {
          setTranscriptLayerState(
            transcriptLayerFailed(loadState.url, transcriptCapabilityState.error),
          )
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

      const request = startLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      const transcriptStartedAt = readTimestamp()
      transcriptViewportKeyRef.current = requestKey
      queueMicrotask(() => {
        if (request.isCurrent() && !request.signal.aborted) {
          setTranscriptLayerState((current) =>
            transcriptLayerLoading(
              current,
              loadState.url,
              plan.visibleTranscriptEstimate,
            ),
          )
        }
      })
      appendDebugEvent('Native transcript aggregate query started', {
        coalesceKey: 'transcript-query',
      })

      void loadTranscriptAggregates(loadState.url, currentViewportDetail.bbox, {
        signal: request.signal,
        mode: plan.mode,
        featureNames: aggregateFeatureNames,
        maxBins,
      })
        .then((result) => {
          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          setTranscriptLayerState(
            transcriptLayerAggregate({
              source: result.source,
              mode: plan.mode,
              bins: result.bins,
              message: transcriptNativeAggregateMessage({
                mode: plan.mode,
                selectedFeatureCount: result.selectedFeatureNames.length,
                binCount: result.bins.length,
              }),
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              scaleMax: result.scaleMax,
              durationMs,
            }),
          )
          appendDebugEvent(
            `Native transcript aggregate ready: ${result.bins.length.toLocaleString()} squares in ${formatElapsed(
              transcriptStartedAt,
            )}`,
            { coalesceKey: 'transcript-query' },
          )
        })
        .catch((error) => {
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
            return
          }

          transcriptViewportKeyRef.current = null
          setTranscriptLayerState(
            transcriptLayerFailed(
              loadState.url,
              createStructuredLoadError('Transcripts', error),
            ),
          )
          appendDebugEvent('Native transcript aggregate query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          request.complete()
        })

      return () => {
        request.abortController.abort()
        request.complete()
      }
    }

    if (
      (plan.kind === 'waiting' || plan.kind === 'unavailable') &&
      !transcriptCapabilityState.capabilities.nativeZarr &&
      transcriptDetailMode !== 'exact' &&
      visibleTranscriptEstimate > 0
    ) {
      const aggregateRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
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
          setTranscriptLayerState(
            transcriptLayerAggregate({
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
            }),
          )
        }
      })
      return
    }

    if (plan.kind === 'waiting') {
      const waitingRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState(
            transcriptLayerWaiting({
              message: plan.message,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
            }),
          )
        }
      })
      return
    }

    if (plan.kind === 'unavailable') {
      const unavailableRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === unavailableRequestId) {
          setTranscriptLayerState(
            transcriptLayerUnavailable(plan.message, plan.visibleTranscriptEstimate),
          )
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
      const waitingRequestId = invalidateLatestRequest({
        abortRef: transcriptAbortRef,
        requestIdRef: transcriptRequestIdRef,
      })
      transcriptViewportKeyRef.current = null
      queueMicrotask(() => {
        if (transcriptRequestIdRef.current === waitingRequestId) {
          setTranscriptLayerState(
            transcriptLayerWaiting({
              message: transcriptExactManualLoadMessage(
                plan.visibleTranscriptEstimate,
                transcriptExactPointLimit,
              ),
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              exactLoadRequestKey: requestKey,
              exactLoadEstimate: plan.visibleTranscriptEstimate,
            }),
          )
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

    const request = startLatestRequest({
      abortRef: transcriptAbortRef,
      requestIdRef: transcriptRequestIdRef,
    })
    const transcriptStartedAt = readTimestamp()
    transcriptViewportKeyRef.current = requestKey
    queueMicrotask(() => {
      if (request.isCurrent() && !request.signal.aborted) {
        setTranscriptLayerState((current) =>
          transcriptLayerLoading(current, loadState.url, plan.visibleTranscriptEstimate),
        )
      }
    })
    appendDebugEvent(
      `Transcript exact query started: ${plan.visibleTranscriptEstimate.toLocaleString()} estimated`,
      { coalesceKey: 'transcript-query' },
    )

    let didExactQueryTimeOut = false
    let exactQueryTimeout: number | null = null
    const startTimeout = window.setTimeout(() => {
      if (!request.isCurrent() || request.signal.aborted) {
        return
      }

      exactQueryTimeout = window.setTimeout(() => {
        if (!request.isCurrent() || request.signal.aborted) {
          return
        }

        didExactQueryTimeOut = true
        transcriptViewportKeyRef.current = null

        request.complete()
        request.abortController.abort()
        setTranscriptLayerState(
          transcriptLayerWaiting({
            message:
              'Exact transcript loading exceeded 12 seconds. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.',
            visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
          }),
        )
        appendDebugEvent('Transcript exact query timed out', {
          coalesceKey: 'transcript-query',
        })
      }, TRANSCRIPT_EXACT_QUERY_TIMEOUT_MS)

      void loadTranscriptViewport(loadState.url, currentViewportDetail.bbox, {
        signal: request.signal,
        pointLimit: transcriptExactPointLimit,
        groupLimit: TRANSCRIPT_GROUP_LIMIT,
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
        onFallback: appendFallbackNotice,
      })
        .then((result) => {
          if (didExactQueryTimeOut || !request.isCurrent() || request.signal.aborted) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          if (result.hitPointLimit) {
            transcriptViewportKeyRef.current = null
            setTranscriptLayerState(
              transcriptLayerWaiting({
                message: `Exact transcript viewport exceeded the ${transcriptExactPointLimit.toLocaleString()} point budget. Use Density/Auto for this zoom level, zoom closer, or filter to fewer genes.`,
                visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              }),
            )
            appendDebugEvent('Transcript exact query exceeded point budget', {
              coalesceKey: 'transcript-query',
            })
            return
          }

          setTranscriptLayerState(
            transcriptLayerReady({
              url: loadState.url,
              points: result.points,
              groups: result.groups,
              visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              hitPointLimit: result.hitPointLimit,
              durationMs,
            }),
          )
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
            !request.isCurrent() ||
            request.signal.aborted
          ) {
            return
          }

          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          setTranscriptLayerState(
            transcriptLayerFailed(
              loadState.url,
              createStructuredLoadError('Transcripts', error),
            ),
          )
          appendDebugEvent('Transcript query failed', {
            coalesceKey: 'transcript-query',
          })
        })
        .finally(() => {
          if (exactQueryTimeout !== null) {
            window.clearTimeout(exactQueryTimeout)
            exactQueryTimeout = null
          }

          request.complete()
        })
    }, 220)

    return () => {
      window.clearTimeout(startTimeout)
      if (exactQueryTimeout !== null) {
        window.clearTimeout(exactQueryTimeout)
      }

      request.abortController.abort()
      request.complete()
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
