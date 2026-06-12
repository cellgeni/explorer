import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { summarizeDatasetDiagnostics } from '../../data/datasetDiagnostics'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { DatasetDiagnosticsRunner } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  downloadTextFile,
  isAbortError,
  readTimestamp,
  shortDatasetLabel,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetDiagnosticsState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { createDiagnosticsDump, type DiagnosticsDumpOptions } from './diagnosticsDump'

interface MutableRef<T> {
  current: T
}

interface UseDatasetDiagnosticsWorkflowOptions extends DiagnosticsDumpOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly diagnosticsAbortRef: MutableRef<AbortController | null>
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly runDatasetDiagnostics: DatasetDiagnosticsRunner
  readonly setDiagnosticsState: Dispatch<
    SetStateAction<DatasetDiagnosticsState<StructuredLoadError>>
  >
}

interface UseDatasetDiagnosticsWorkflowResult {
  readonly handleDownloadDiagnostics: () => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
}

export function useDatasetDiagnosticsWorkflow({
  activeControlHudTab,
  activeErrors,
  appendDebugEvent,
  boundaryCellLimit,
  coordinateUnit,
  datasetUrl,
  debugLog,
  diagnosticsAbortRef,
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
  recordTelemetry,
  runDatasetDiagnostics,
  selectedGenes,
  setDiagnosticsState,
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
}: UseDatasetDiagnosticsWorkflowOptions): UseDatasetDiagnosticsWorkflowResult {
  const handleRunDatasetDiagnostics = useCallback(async () => {
    const requestedUrl = datasetUrl.trim()

    if (requestedUrl === '') {
      return
    }

    const diagnosticsStartedAt = readTimestamp()
    abortActiveRequest(diagnosticsAbortRef)
    const abortController = new AbortController()
    diagnosticsAbortRef.current = abortController
    setDiagnosticsState({ status: 'loading', url: requestedUrl })
    appendDebugEvent(`Diagnosing dataset ${shortDatasetLabel(requestedUrl)}`)

    try {
      const report = await runDatasetDiagnostics(requestedUrl, {
        signal: abortController.signal,
      })

      if (diagnosticsAbortRef.current !== abortController) {
        return
      }

      const summary = summarizeDatasetDiagnostics(report)
      setDiagnosticsState({ status: 'ready', url: requestedUrl, report })
      appendDebugEvent(`Diagnostics: ${summary}`)
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'success', {
          startedAt: diagnosticsStartedAt,
          detail: summary,
        }),
      )
    } catch (error) {
      if (isAbortError(error) || diagnosticsAbortRef.current !== abortController) {
        return
      }

      setDiagnosticsState({
        status: 'error',
        url: requestedUrl,
        error: createStructuredLoadError('Dataset diagnostics', error),
      })
      appendDebugEvent('Diagnostics failed')
      recordTelemetry(
        telemetryEvent('dataset.diagnostics', 'failure', {
          startedAt: diagnosticsStartedAt,
          detail: readErrorMessage(error),
        }),
      )
    } finally {
      if (diagnosticsAbortRef.current === abortController) {
        diagnosticsAbortRef.current = null
      }
    }
  }, [
    appendDebugEvent,
    datasetUrl,
    diagnosticsAbortRef,
    recordTelemetry,
    runDatasetDiagnostics,
    setDiagnosticsState,
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
