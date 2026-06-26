import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { summarizeDatasetDiagnostics } from '../../data/datasetDiagnostics'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { DatasetDiagnosticsRunner } from '../app-shell/appDependencies'
import {
  downloadTextFile,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import {
  datasetDiagnosticsFailed,
  datasetDiagnosticsReady,
  datasetDiagnosticsStarted,
  type DatasetDiagnosticsState,
} from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { createDiagnosticsDump, type DiagnosticsDumpOptions } from './diagnosticsDump'

interface MutableRef<T> {
  current: T
}

interface DatasetDiagnosticsWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly recordTelemetry: (event: TelemetryEvent) => void
}

interface DatasetDiagnosticsWorkflowControls {
  readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
}

interface DatasetDiagnosticsWorkflowLoaders {
  readonly runDatasetDiagnostics: DatasetDiagnosticsRunner
}

interface DatasetDiagnosticsWorkflowRefs {
  readonly diagnosticsAbortRef: MutableRef<AbortController | null>
}

interface DatasetDiagnosticsWorkflowSetters {
  readonly setDiagnosticsState: Dispatch<
    SetStateAction<DatasetDiagnosticsState<StructuredLoadError>>
  >
}

interface UseDatasetDiagnosticsWorkflowOptions {
  readonly callbacks: DatasetDiagnosticsWorkflowCallbacks
  readonly controls: DatasetDiagnosticsWorkflowControls
  readonly dump: DiagnosticsDumpOptions
  readonly loaders: DatasetDiagnosticsWorkflowLoaders
  readonly refs: DatasetDiagnosticsWorkflowRefs
  readonly setters: DatasetDiagnosticsWorkflowSetters
}

interface UseDatasetDiagnosticsWorkflowResult {
  readonly handleDownloadDiagnostics: () => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
}

export function useDatasetDiagnosticsWorkflow({
  callbacks,
  controls,
  dump,
  loaders,
  refs,
  setters,
}: UseDatasetDiagnosticsWorkflowOptions): UseDatasetDiagnosticsWorkflowResult {
  const { appendDebugEvent, recordTelemetry } = callbacks
  const { visiumHdBinSizeMicrometers } = controls
  const { runDatasetDiagnostics } = loaders
  const { diagnosticsAbortRef } = refs
  const { setDiagnosticsState } = setters
  const {
    activeControlHudTab,
    activeErrors,
    boundaryCellLimit,
    coordinateUnit,
    datasetUrl,
    debugLog,
    diagnosticsState,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    geneExpressionState,
    hoveredTranscript,
    loadState,
    manualTranscriptExactRequestKey,
    measurementEnabled,
    measurementUnit,
    observationColorMode,
    performanceBudget,
    pinnedTranscript,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    telemetryEvents,
    transcriptCapabilityState,
    transcriptDensityColorScale,
    transcriptDetailMode,
    transcriptExactManualLoadRatio,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptLayerState,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
  } = dump
  const diagnosticsRequestIdRef = useRef(0)

  const handleRunDatasetDiagnostics = useCallback(async () => {
    const requestedUrl = datasetUrl.trim()

    if (requestedUrl === '') {
      return
    }

    const diagnosticsStartedAt = readTimestamp()
    const request = startLatestRequest({
      abortRef: diagnosticsAbortRef,
      requestIdRef: diagnosticsRequestIdRef,
    })
    setDiagnosticsState(datasetDiagnosticsStarted(requestedUrl))
    appendDebugEvent(`Diagnosing dataset ${shortDatasetLabel(requestedUrl)}`)

    try {
      const report = await runDatasetDiagnostics(requestedUrl, {
        signal: request.signal,
        ...(visiumHdBinSizeMicrometers === undefined
          ? {}
          : { visiumHdBinSizeMicrometers }),
      })

      if (!request.isCurrent() || request.signal.aborted) {
        return
      }

      const summary = summarizeDatasetDiagnostics(report)
      setDiagnosticsState(datasetDiagnosticsReady(requestedUrl, report))
      appendDebugEvent(`Diagnostics: ${summary}`)
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'success', {
          startedAt: diagnosticsStartedAt,
          detail: summary,
        }),
      )
    } catch (error) {
      if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
        return
      }

      setDiagnosticsState(
        datasetDiagnosticsFailed(
          requestedUrl,
          createStructuredLoadError('Dataset diagnostics', error),
        ),
      )
      appendDebugEvent('Diagnostics failed')
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'failure', {
          startedAt: diagnosticsStartedAt,
          detail: readErrorMessage(error),
        }),
      )
    } finally {
      request.complete()
    }
  }, [
    appendDebugEvent,
    datasetUrl,
    diagnosticsAbortRef,
    recordTelemetry,
    runDatasetDiagnostics,
    setDiagnosticsState,
    visiumHdBinSizeMicrometers,
  ])

  const handleDownloadDiagnostics = useCallback(() => {
    downloadTextFile(
      'xenium-diagnostics.json',
      JSON.stringify(
        createDiagnosticsDump({
          activeControlHudTab,
          activeErrors,
          boundaryCellLimit,
          coordinateUnit,
          datasetUrl,
          debugLog,
          diagnosticsState,
          geneExpressionBatch,
          geneExpressionColorScale,
          geneExpressionDetailMode,
          geneExpressionScoreMode,
          geneExpressionState,
          hoveredTranscript,
          loadState,
          manualTranscriptExactRequestKey,
          measurementEnabled,
          measurementUnit,
          observationColorMode,
          performanceBudget,
          pinnedTranscript,
          selectedGenes,
          shareableViewState,
          shouldLoadMorphology,
          telemetryEvents,
          showTranscriptOverlay,
          transcriptCapabilityState,
          transcriptDetailMode,
          transcriptDensityColorScale,
          transcriptExactPointLimit,
          transcriptExactManualLoadRatio,
          transcriptFeatureFilterMode,
          transcriptGeneOnly,
          transcriptLayerState,
          transcriptMinQv,
          transcriptOpacity,
          transcriptPointColorMode,
          transcriptPointSize,
        }),
        null,
        2,
      ),
      'application/json;charset=utf-8',
    )
    appendDebugEvent('Downloaded diagnostics')
  }, [
    activeControlHudTab,
    activeErrors,
    appendDebugEvent,
    boundaryCellLimit,
    coordinateUnit,
    datasetUrl,
    debugLog,
    diagnosticsState,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    geneExpressionState,
    hoveredTranscript,
    loadState,
    manualTranscriptExactRequestKey,
    measurementEnabled,
    measurementUnit,
    observationColorMode,
    performanceBudget,
    pinnedTranscript,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    telemetryEvents,
    transcriptCapabilityState,
    transcriptDensityColorScale,
    transcriptDetailMode,
    transcriptExactManualLoadRatio,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptLayerState,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
  ])

  return { handleDownloadDiagnostics, handleRunDatasetDiagnostics }
}
