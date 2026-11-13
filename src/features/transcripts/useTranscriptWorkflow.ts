import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  TRANSCRIPT_GROUP_LIMIT,
  transcriptAggregateRequestKey,
  planTranscriptLod,
  transcriptViewportRequestKey,
  type TranscriptAggregateResult,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
  type TranscriptLodPlan,
} from '../../data/transcriptOverlay'
import type { FallbackNotifier } from '../../data/fallbackNotice'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import type {
  TranscriptAggregateLoader,
  TranscriptCapabilitiesLoader,
  TranscriptViewportLoader,
} from '../app-shell/appDependencies'
import {
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type DebugLogAppendOptions,
  type LatestRequest,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  TRANSCRIPT_EXACT_SLOW_QUERY_MESSAGE,
  TRANSCRIPT_EXACT_SLOW_QUERY_MS,
  TRANSCRIPT_NATIVE_DENSITY_MAX_BINS,
  IDLE_TRANSCRIPT_LAYER_STATE,
  buildCellSummaryTranscriptBins,
  isTranscriptExactManualLoadRequired,
  maxTranscriptAggregateCount,
  transcriptCapabilityFailed,
  transcriptCapabilityReady,
  transcriptCapabilityStarted,
  transcriptLayerAggregate,
  transcriptLayerCancelled,
  transcriptLayerFailed,
  transcriptLayerLoading,
  transcriptLayerReady,
  transcriptLayerSlow,
  transcriptLayerUnavailable,
  transcriptLayerWaiting,
  transcriptAggregateFallbackMessage,
  transcriptExactManualLoadMessage,
  transcriptGeneDensityMissingMessage,
  transcriptGeneDensityOverBudgetMessage,
  transcriptNativeAggregateMessage,
  transcriptPerGeneCellSummaryMessage,
  transcriptPerGeneExactNeedsGenesMessage,
  transcriptPerGeneUnavailableMessage,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './transcriptLayerModel'
import { transcriptCapabilityLabel } from './transcriptLabels'

const EMPTY_GENE_LIST: readonly string[] = []

// Per-gene density for one viewport and gene set. Its selected-gene count is
// the estimate that decides between density and exact points.
interface GeneAggregate {
  readonly key: string
  readonly result: TranscriptAggregateResult
  readonly durationMs: number
}

interface MutableRef<T> {
  current: T
}

interface UseTranscriptWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice: FallbackNotifier
}

interface UseTranscriptWorkflowControls {
  // The Transcripts section is open, so its status should say what the
  // dataset has even before the overlay is on.
  readonly transcriptControlsOpen: boolean
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
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
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

interface UseTranscriptWorkflowResult {
  // Cancel in the loading list (15.3-D): stops the transcript read and goes
  // back to what showed before it.
  readonly cancelTranscriptLoad: () => void
  // Exact tiles read, 0 to 1, while a native Zarr exact read runs.
  readonly transcriptLoadProgress: number | undefined
}

// Progress of one exact read, so a finished read does not clear a newer one.
interface ExactLoadProgress {
  readonly requestId: number
  readonly fraction: number
}

// For the layer effect's cleanup. A rerun with the key already in
// transcriptViewportKeyRef returns early, so when the cleanup stops a read
// that is still running (a new viewport object for the same view, or a
// dependency the key leaves out), it clears the key and the rerun starts the
// read again. A read that finished, was cancelled (15.3-D) or was replaced is
// no longer in transcriptAbortRef, so its key stays.
function releaseRunningRequestKey(
  request: LatestRequest,
  requestKey: string,
  abortRef: MutableRef<AbortController | null>,
  viewportKeyRef: MutableRef<string | null>,
): void {
  if (
    abortRef.current === request.abortController &&
    viewportKeyRef.current === requestKey
  ) {
    viewportKeyRef.current = null
  }
}

export function useTranscriptWorkflow({
  callbacks: { appendDebugEvent, appendFallbackNotice },
  controls: {
    transcriptControlsOpen,
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
  setters: {
    setManualTranscriptExactRequestKey,
    setTranscriptCapabilityState,
    setTranscriptLayerState,
  },
}: UseTranscriptWorkflowOptions): UseTranscriptWorkflowResult {
  const [geneAggregate, setGeneAggregate] = useState<GeneAggregate | null>(null)
  const [exactLoadProgress, setExactLoadProgress] = useState<ExactLoadProgress | null>(
    null,
  )
  // The per-gene density read in flight, and the one last cancelled. A
  // cancelled read starts again only once the view or genes change. Exact
  // and all-gene density reads use transcriptViewportKeyRef for the same.
  const geneAggregateRequestRef = useRef<{
    readonly requestId: number
    readonly key: string
  } | null>(null)
  const cancelledGeneAggregateKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      loadState.status !== 'ready' ||
      transcriptCapabilityState.status !== 'idle' ||
      (!showTranscriptOverlay && !transcriptControlsOpen)
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

        if (capabilities.nativeZarrGridCountsError !== undefined) {
          appendFallbackNotice({
            source: 'Transcripts',
            message:
              'transcripts.zarr.zip grid counts were unavailable, so the app estimates visible transcripts from cell transcript counts.',
            action:
              'Auto and the exact point budget use this estimate, which leaves out transcripts outside cells.',
            detail: capabilities.nativeZarrGridCountsError,
            coalesceKey: `transcript-estimate-cells:${requestedUrl}`,
          })
        }

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
    transcriptControlsOpen,
    appendDebugEvent,
    appendFallbackNotice,
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
    const capabilities = transcriptCapabilityState.capabilities
    let plan: TranscriptLodPlan

    // Per-gene outputs (Atera) read density and exact points per selected
    // gene. Without genes the layer is cell-summary squares; with genes the
    // per-gene density loads first, and its selected-gene count decides
    // between showing it and loading exact points.
    if (capabilities.geneRanges !== undefined) {
      if (featureNames.length === 0) {
        const summaryRequestId = invalidateLatestRequest({
          abortRef: transcriptAbortRef,
          requestIdRef: transcriptRequestIdRef,
        })
        const hasSelectedGenes = selectedGenes.length > 0
        const bins =
          transcriptDetailMode === 'exact'
            ? null
            : buildCellSummaryTranscriptBins(
                overviewCells,
                currentViewportDetail.bbox,
                'density',
              )
        transcriptViewportKeyRef.current = null
        queueMicrotask(() => {
          if (transcriptRequestIdRef.current !== summaryRequestId) {
            return
          }

          setTranscriptLayerState(
            bins === null
              ? transcriptLayerWaiting({
                  message: transcriptPerGeneExactNeedsGenesMessage(hasSelectedGenes),
                  visibleTranscriptEstimate,
                })
              : transcriptLayerAggregate({
                  source: 'cell-summary',
                  mode: 'density',
                  bins,
                  featureNames: EMPTY_GENE_LIST,
                  message: transcriptPerGeneCellSummaryMessage(hasSelectedGenes),
                  visibleTranscriptEstimate,
                  scaleMax: maxTranscriptAggregateCount(bins),
                }),
          )
        })
        return
      }

      if (!capabilities.nativeZarr) {
        const unavailableRequestId = invalidateLatestRequest({
          abortRef: transcriptAbortRef,
          requestIdRef: transcriptRequestIdRef,
        })
        transcriptViewportKeyRef.current = null
        queueMicrotask(() => {
          if (transcriptRequestIdRef.current === unavailableRequestId) {
            setTranscriptLayerState(
              transcriptLayerUnavailable(
                transcriptPerGeneUnavailableMessage(capabilities.nativeZarrError),
                visibleTranscriptEstimate,
              ),
            )
          }
        })
        return
      }

      const maxBins = TRANSCRIPT_NATIVE_DENSITY_MAX_BINS
      const aggregateKey = transcriptAggregateRequestKey(
        loadState.url,
        currentViewportDetail.bbox,
        { mode: 'density', featureNames, maxBins },
      )

      if (geneAggregate?.key !== aggregateKey) {
        if (cancelledGeneAggregateKeyRef.current === aggregateKey) {
          return
        }

        cancelledGeneAggregateKeyRef.current = null
        const request = startLatestRequest({
          abortRef: transcriptAbortRef,
          requestIdRef: transcriptRequestIdRef,
        })
        geneAggregateRequestRef.current = {
          requestId: request.requestId,
          key: aggregateKey,
        }
        const transcriptStartedAt = readTimestamp()
        const previousEstimate = geneAggregate?.result.visibleTranscriptCount ?? 0
        // The layer turns to loading, so whatever the estimate picks loads again.
        transcriptViewportKeyRef.current = null
        queueMicrotask(() => {
          if (request.isCurrent() && !request.signal.aborted) {
            setTranscriptLayerState((current) =>
              transcriptLayerLoading(current, loadState.url, previousEstimate),
            )
          }
        })
        appendDebugEvent('Per-gene transcript density query started', {
          coalesceKey: 'transcript-query',
        })

        void loadTranscriptAggregates(loadState.url, currentViewportDetail.bbox, {
          signal: request.signal,
          mode: 'density',
          featureNames,
          maxBins,
        })
          .then((result) => {
            if (!request.isCurrent() || request.signal.aborted) {
              return
            }

            setGeneAggregate({
              key: aggregateKey,
              result,
              durationMs: Math.max(0, readTimestamp() - transcriptStartedAt),
            })
            appendDebugEvent(
              `Per-gene transcript density ready: ${result.bins.length.toLocaleString()} squares, ${(
                result.visibleTranscriptCount ?? 0
              ).toLocaleString()} visible, in ${formatElapsed(transcriptStartedAt)}`,
              { coalesceKey: 'transcript-query' },
            )
          })
          .catch((error) => {
            if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
              return
            }

            setTranscriptLayerState(
              transcriptLayerFailed(
                loadState.url,
                createStructuredLoadError('Transcripts', error),
              ),
            )
            appendDebugEvent('Per-gene transcript density query failed', {
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

      const geneEstimate = geneAggregate.result.visibleTranscriptCount ?? 0
      plan = planTranscriptLod(currentViewportDetail, {
        detailMode: transcriptDetailMode,
        visibleTranscriptEstimate: geneEstimate,
        exactLimit: transcriptExactPointLimit,
        hasRawParquet: false,
        hasNativeZarr: true,
        hasExactSource: capabilities.geneRanges,
        hasSelectedFeatureFilter: true,
      })

      if (plan.kind === 'native-zarr') {
        if (transcriptViewportKeyRef.current === aggregateKey) {
          return
        }

        const densityRequestId = invalidateLatestRequest({
          abortRef: transcriptAbortRef,
          requestIdRef: transcriptRequestIdRef,
        })
        const { durationMs, result } = geneAggregate
        transcriptViewportKeyRef.current = aggregateKey
        queueMicrotask(() => {
          if (transcriptRequestIdRef.current === densityRequestId) {
            setTranscriptLayerState(
              transcriptLayerAggregate({
                source: result.source,
                mode: 'density',
                bins: result.bins,
                featureNames: result.selectedFeatureNames,
                message: transcriptNativeAggregateMessage({
                  mode: 'density',
                  selectedFeatureCount: result.selectedFeatureNames.length,
                  binCount: result.bins.length,
                  sourceFile: result.sourceFile,
                }),
                visibleTranscriptEstimate: geneEstimate,
                scaleMax: result.scaleMax,
                durationMs,
              }),
            )
          }
        })
        return
      }
    } else {
      plan = planTranscriptLod(currentViewportDetail, {
        detailMode: transcriptDetailMode,
        visibleTranscriptEstimate,
        exactLimit: transcriptExactPointLimit,
        hasRawParquet: capabilities.rawParquet,
        hasNativeZarr: capabilities.nativeZarr,
        hasSelectedFeatureFilter:
          effectiveTranscriptFeatureFilterMode !== 'selected' || featureNames.length > 0,
      })
    }

    // With the Selected genes filter, the density counts those genes, from
    // density/gene (15.1-J). Exact reads still scan every transcript in the
    // view, so Auto keeps switching on the all-transcript estimate, from the
    // transcripts.zarr.zip grid counts when the capability check read them.
    if (plan.kind === 'native-zarr') {
      const maxBins = TRANSCRIPT_NATIVE_DENSITY_MAX_BINS
      const requestKey = transcriptAggregateRequestKey(
        loadState.url,
        currentViewportDetail.bbox,
        {
          mode: plan.mode,
          featureNames,
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
        featureNames,
        maxBins,
      })
        .then((result) => {
          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          const durationMs = Math.max(0, readTimestamp() - transcriptStartedAt)

          if (result.overBudget !== undefined) {
            setTranscriptLayerState(
              transcriptLayerWaiting({
                message: transcriptGeneDensityOverBudgetMessage(
                  result.selectedFeatureNames,
                  result.overBudget,
                ),
                visibleTranscriptEstimate: plan.visibleTranscriptEstimate,
              }),
            )
            appendDebugEvent(
              `Selected-gene density skipped: ${result.overBudget.chunkCount.toLocaleString()} data chunks in view`,
              { coalesceKey: 'transcript-query' },
            )
            return
          }

          setTranscriptLayerState(
            transcriptLayerAggregate({
              source: result.source,
              mode: plan.mode,
              bins: result.bins,
              featureNames: result.selectedFeatureNames,
              message:
                featureNames.length > 0 && result.selectedFeatureNames.length === 0
                  ? transcriptGeneDensityMissingMessage(result.bins.length)
                  : transcriptNativeAggregateMessage({
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
        releaseRunningRequestKey(
          request,
          requestKey,
          transcriptAbortRef,
          transcriptViewportKeyRef,
        )
        request.abortController.abort()
        request.complete()
      }
    }

    if (
      (plan.kind === 'waiting' || plan.kind === 'unavailable') &&
      capabilities.geneRanges === undefined &&
      !capabilities.nativeZarr &&
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
              featureNames: EMPTY_GENE_LIST,
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

    let exactQueryTimeout: number | null = null
    let progressPercent = -1
    const startTimeout = window.setTimeout(() => {
      if (!request.isCurrent() || request.signal.aborted) {
        return
      }

      // A slow load is not abandoned: on a slow network or device, or while
      // a shared link's other layers load, the points can arrive well after
      // 12 s. Changing the view or detail still cancels it.
      exactQueryTimeout = window.setTimeout(() => {
        exactQueryTimeout = null

        if (!request.isCurrent() || request.signal.aborted) {
          return
        }

        setTranscriptLayerState((current) =>
          transcriptLayerSlow(current, TRANSCRIPT_EXACT_SLOW_QUERY_MESSAGE),
        )
        appendDebugEvent('Transcript exact query still loading after 12 s', {
          coalesceKey: 'transcript-query',
        })
      }, TRANSCRIPT_EXACT_SLOW_QUERY_MS)

      void loadTranscriptViewport(loadState.url, currentViewportDetail.bbox, {
        signal: request.signal,
        pointLimit: transcriptExactPointLimit,
        groupLimit: TRANSCRIPT_GROUP_LIMIT,
        minQv: transcriptMinQv,
        geneOnly: transcriptGeneOnly,
        featureNames,
        onFallback: appendFallbackNotice,
        // Whole percents only, so a read of many tiles does not re-render
        // the app for each one.
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 100)

          if (
            percent === progressPercent ||
            !request.isCurrent() ||
            request.signal.aborted
          ) {
            return
          }

          progressPercent = percent
          setExactLoadProgress({ requestId: request.requestId, fraction })
        },
      })
        .then((result) => {
          if (!request.isCurrent() || request.signal.aborted) {
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
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
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

          setExactLoadProgress((current) =>
            current?.requestId === request.requestId ? null : current,
          )
          request.complete()
        })
    }, 220)

    return () => {
      releaseRunningRequestKey(
        request,
        requestKey,
        transcriptAbortRef,
        transcriptViewportKeyRef,
      )
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
    geneAggregate,
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

  // transcriptViewportKeyRef keeps the cancelled exact or density key, so the
  // effect does not start it again for the same view. The manual-load key is
  // cleared, so `Load exact viewport` can start it again.
  const cancelTranscriptLoad = useCallback(() => {
    const geneAggregateRequest = geneAggregateRequestRef.current

    if (geneAggregateRequest?.requestId === transcriptRequestIdRef.current) {
      cancelledGeneAggregateKeyRef.current = geneAggregateRequest.key
    }

    invalidateLatestRequest({
      abortRef: transcriptAbortRef,
      requestIdRef: transcriptRequestIdRef,
    })
    setExactLoadProgress(null)
    setManualTranscriptExactRequestKey(null)
    setTranscriptLayerState(transcriptLayerCancelled)
    appendDebugEvent('Cancelled transcripts', { coalesceKey: 'transcript-query' })
  }, [
    appendDebugEvent,
    setManualTranscriptExactRequestKey,
    setTranscriptLayerState,
    transcriptAbortRef,
    transcriptRequestIdRef,
  ])

  return {
    cancelTranscriptLoad,
    transcriptLoadProgress: exactLoadProgress?.fraction,
  }
}
