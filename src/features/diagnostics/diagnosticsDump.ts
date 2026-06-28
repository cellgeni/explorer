import {
  summarizeDatasetDiagnostics,
  type DatasetDiagnosticsReport,
} from '../../data/datasetDiagnostics'
import type { GeneExpressionBatchTiming } from '../../datasets/xeniumDataset'

interface DatasetLoadDiagnosticState {
  readonly status: string
  readonly url?: string
  readonly cellCount?: number
  readonly error?: unknown
}

type DatasetDiagnosticsDiagnosticState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly report: DatasetDiagnosticsReport
    }
  | { readonly status: 'error'; readonly url: string; readonly error: unknown }

interface TranscriptDiagnosticLayerState {
  readonly status: string
  readonly visibleTranscriptEstimate?: number
  readonly exactLoadEstimate?: number
  readonly exactLoadRequestKey?: string
  readonly message?: string
  readonly points?: readonly unknown[]
  readonly hitPointLimit?: boolean
  readonly durationMs?: number
  readonly bins?: readonly unknown[]
  readonly source?: string
}

interface GeneExpressionDiagnosticState {
  readonly status: string
  readonly url?: string
  readonly genes?: readonly string[]
  readonly mode?: string
  readonly cellCount?: number
  readonly visibleCellCount?: number
  readonly message?: string
  readonly error?: unknown
}

interface GeneExpressionDiagnosticBatch {
  readonly elements: readonly unknown[]
  readonly genes: readonly string[]
  readonly maxCount: number
  readonly timing?: GeneExpressionBatchTiming
}

interface TranscriptDiagnosticInspection {
  readonly transcript?: {
    readonly id: string
    readonly transcriptId?: string | null
    readonly featureName: string
    readonly fovName?: string | null
    readonly cellId?: string | null
    readonly qv?: number
    readonly zLocation?: number
  }
  readonly aggregate?: {
    readonly id: string
    readonly featureName?: string
    readonly count: number
    readonly binTotalCount?: number
    readonly source?: string
    readonly level: number
    readonly binX: number
    readonly binY: number
  }
  readonly screen: unknown
}

export interface DiagnosticsDumpOptions {
  readonly activeControlHudTab: string
  readonly activeErrors: readonly unknown[]
  readonly boundaryCellLimit: number
  readonly coordinateUnit: string
  readonly datasetUrl: string
  readonly debugLog: readonly unknown[]
  readonly diagnosticsState: DatasetDiagnosticsDiagnosticState
  readonly geneExpressionColorScale: string
  readonly geneExpressionBatch: GeneExpressionDiagnosticBatch | null
  readonly geneExpressionDetailMode: string
  readonly geneExpressionScoreMode: string
  readonly geneExpressionState: GeneExpressionDiagnosticState
  readonly hoveredTranscript: TranscriptDiagnosticInspection | null
  readonly loadState: DatasetLoadDiagnosticState
  readonly manualTranscriptExactRequestKey: string | null
  readonly measurementEnabled: boolean
  readonly measurementUnit: string
  readonly observationColorMode: string
  readonly performanceBudget: unknown
  readonly pinnedTranscript: TranscriptDiagnosticInspection | null
  readonly selectedGenes: readonly string[]
  readonly shareableViewState: unknown
  readonly shouldLoadMorphology: boolean
  readonly telemetryEvents: readonly unknown[]
  readonly showTranscriptOverlay: boolean
  readonly transcriptCapabilityState: unknown
  readonly transcriptDetailMode: string
  readonly transcriptDensityColorScale: string
  readonly transcriptExactPointLimit: number
  readonly transcriptExactManualLoadRatio: number
  readonly transcriptFeatureFilterMode: string
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptDiagnosticLayerState
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: string
  readonly transcriptPointSize: number
}

export function createDiagnosticsDump(
  options: DiagnosticsDumpOptions,
): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    datasetUrl: options.datasetUrl,
    location: readCurrentLocation(),
    performanceBudget: options.performanceBudget,
    controls: {
      activeControlHudTab: options.activeControlHudTab,
      boundaryCellLimit: options.boundaryCellLimit,
      coordinateUnit: options.coordinateUnit,
      geneExpressionColorScale: options.geneExpressionColorScale,
      geneExpressionDetailMode: options.geneExpressionDetailMode,
      geneExpressionScoreMode: options.geneExpressionScoreMode,
      measurementEnabled: options.measurementEnabled,
      measurementUnit: options.measurementUnit,
      observationColorMode: options.observationColorMode,
      selectedGenes: options.selectedGenes,
      shareableViewState: options.shareableViewState,
      shouldLoadMorphology: options.shouldLoadMorphology,
      showTranscriptOverlay: options.showTranscriptOverlay,
      transcriptDetailMode: options.transcriptDetailMode,
      transcriptDensityColorScale: options.transcriptDensityColorScale,
      transcriptPointColorMode: options.transcriptPointColorMode,
      transcriptExactPointLimit: options.transcriptExactPointLimit,
      transcriptFeatureFilterMode: options.transcriptFeatureFilterMode,
      transcriptGeneOnly: options.transcriptGeneOnly,
      transcriptMinQv: options.transcriptMinQv,
      transcriptOpacity: options.transcriptOpacity,
      transcriptPointSize: options.transcriptPointSize,
    },
    states: {
      dataset: summarizeDatasetLoadState(options.loadState),
      diagnostics: summarizeDiagnosticsState(options.diagnosticsState),
      geneExpression: summarizeGeneExpressionState(
        options.geneExpressionState,
        options.geneExpressionBatch,
      ),
      transcripts: {
        capability: options.transcriptCapabilityState,
        layer: options.transcriptLayerState,
        exactBudget: summarizeTranscriptExactBudgetDecision(
          options.transcriptLayerState,
          options.transcriptExactPointLimit,
          options.transcriptExactManualLoadRatio,
          options.manualTranscriptExactRequestKey,
        ),
        hovered: summarizeTranscriptInspection(options.hoveredTranscript),
        pinned: summarizeTranscriptInspection(options.pinnedTranscript),
      },
    },
    activeErrors: options.activeErrors,
    activityLog: options.debugLog,
    telemetryEvents: options.telemetryEvents,
  }
}

function summarizeGeneExpressionState(
  state: GeneExpressionDiagnosticState,
  batch: GeneExpressionDiagnosticBatch | null,
): Record<string, unknown> {
  return {
    status: state.status,
    url: state.url,
    mode: state.mode,
    genes: state.genes,
    cellCount: state.cellCount,
    visibleCellCount: state.visibleCellCount,
    message: state.message,
    error: summarizeUnknownError(state.error),
    ...(batch === null
      ? {}
      : {
          batch: {
            positiveElementCount: batch.elements.length,
            genes: batch.genes,
            maxCount: batch.maxCount,
            timing: batch.timing,
          },
        }),
  }
}

function summarizeUnknownError(error: unknown): Record<string, unknown> | undefined {
  if (error === undefined) {
    return undefined
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }

  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>
  }

  return { message: String(error) }
}

function summarizeTranscriptInspection(
  detail: TranscriptDiagnosticInspection | null,
): Record<string, unknown> | null {
  if (detail === null) {
    return null
  }

  if (detail.transcript !== undefined) {
    return {
      kind: 'transcript',
      id: detail.transcript.id,
      transcriptId: detail.transcript.transcriptId,
      featureName: detail.transcript.featureName,
      fovName: detail.transcript.fovName,
      cellId: detail.transcript.cellId,
      qv: detail.transcript.qv,
      zLocation: detail.transcript.zLocation,
      screen: detail.screen,
    }
  }

  if (detail.aggregate !== undefined) {
    return {
      kind: detail.aggregate.featureName === undefined ? 'density-bin' : 'feature-bin',
      id: detail.aggregate.id,
      featureName: detail.aggregate.featureName,
      count: detail.aggregate.count,
      binTotalCount: detail.aggregate.binTotalCount,
      source: detail.aggregate.source,
      level: detail.aggregate.level,
      binX: detail.aggregate.binX,
      binY: detail.aggregate.binY,
      screen: detail.screen,
    }
  }

  return null
}

function summarizeTranscriptExactBudgetDecision(
  layerState: TranscriptDiagnosticLayerState,
  exactPointLimit: number,
  manualLoadRatio: number,
  manualRequestKey: string | null,
): Record<string, unknown> {
  return {
    status: layerState.status,
    exactPointLimit,
    manualRequestKey,
    visibleTranscriptEstimate: layerState.visibleTranscriptEstimate,
    manualLoadThreshold: exactPointLimit * manualLoadRatio,
    ...(layerState.status === 'waiting'
      ? {
          exactLoadEstimate: layerState.exactLoadEstimate,
          hasExactLoadAction: layerState.exactLoadRequestKey !== undefined,
          message: layerState.message,
        }
      : {}),
    ...(layerState.status === 'ready'
      ? {
          renderedPointCount: layerState.points?.length,
          hitPointLimit: layerState.hitPointLimit,
          durationMs: layerState.durationMs,
        }
      : {}),
    ...(layerState.status === 'aggregate'
      ? {
          renderedBinCount: layerState.bins?.length,
          source: layerState.source,
          durationMs: layerState.durationMs,
        }
      : {}),
  }
}

function summarizeDatasetLoadState(
  state: DatasetLoadDiagnosticState,
): Record<string, unknown> {
  if (state.status === 'ready') {
    return {
      status: state.status,
      url: state.url,
      cellCount: state.cellCount,
    }
  }

  if (state.status === 'loading' || state.status === 'error') {
    return {
      status: state.status,
      url: state.url,
      ...(state.status === 'error' ? { error: state.error } : {}),
    }
  }

  return { status: state.status }
}

function summarizeDiagnosticsState(
  state: DatasetDiagnosticsDiagnosticState,
): Record<string, unknown> {
  if (state.status === 'ready') {
    return {
      status: state.status,
      url: state.url,
      summary: summarizeDatasetDiagnostics(state.report),
      report: state.report,
    }
  }

  if (state.status === 'loading' || state.status === 'error') {
    return {
      status: state.status,
      url: state.url,
      ...(state.status === 'error' ? { error: state.error } : {}),
    }
  }

  return { status: state.status }
}

function readCurrentLocation(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.href
}
