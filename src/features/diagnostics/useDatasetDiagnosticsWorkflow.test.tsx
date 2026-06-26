import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'
import type { TelemetryEvent } from '../../data/telemetry'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { DatasetDiagnosticsRunner } from '../app-shell/appDependencies'
import type { DatasetDiagnosticsState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { useDatasetDiagnosticsWorkflow } from './useDatasetDiagnosticsWorkflow'

const successfulReport: DatasetDiagnosticsReport = {
  baseUrl: 'https://example.test/output',
  platform: 'xenium',
  startedAt: '2026-06-08T00:00:00.000Z',
  completedAt: '2026-06-08T00:00:01.000Z',
  checks: [
    {
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url: 'https://example.test/output/experiment.xenium',
      required: true,
      status: 'pass',
      message: 'Readable',
      durationMs: 1,
    },
  ],
}

const secondSuccessfulReport: DatasetDiagnosticsReport = {
  ...successfulReport,
  completedAt: '2026-06-08T00:00:02.000Z',
}

interface DiagnosticsSnapshot {
  readonly debugMessages: readonly string[]
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly telemetryEvents: readonly TelemetryEvent[]
}

interface DiagnosticsProbeProps {
  readonly datasetUrl?: string
  readonly onReady: (
    api: ReturnType<typeof useDatasetDiagnosticsWorkflow>,
    snapshot: DiagnosticsSnapshot,
  ) => void
  readonly runDatasetDiagnostics: DatasetDiagnosticsRunner
  readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
}

let diagnosticsApi: ReturnType<typeof useDatasetDiagnosticsWorkflow>
let diagnosticsSnapshot: DiagnosticsSnapshot

function DiagnosticsProbe({
  datasetUrl = ' https://example.test/output ',
  onReady,
  runDatasetDiagnostics,
  visiumHdBinSizeMicrometers,
}: DiagnosticsProbeProps) {
  const [diagnosticsState, setDiagnosticsState] = React.useState<
    DatasetDiagnosticsState<StructuredLoadError>
  >({ status: 'idle' })
  const diagnosticsAbortRef = React.useRef<AbortController | null>(null)
  const debugMessagesRef = React.useRef<string[]>([])
  const telemetryEventsRef = React.useRef<TelemetryEvent[]>([])

  const api = useDatasetDiagnosticsWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      recordTelemetry: (event) => {
        telemetryEventsRef.current.push(event)
      },
    },
    controls: {
      ...(visiumHdBinSizeMicrometers === undefined ? {} : { visiumHdBinSizeMicrometers }),
    },
    dump: {
      activeControlHudTab: 'dataset',
      activeErrors: [],
      boundaryCellLimit: 2500,
      coordinateUnit: 'um',
      datasetUrl,
      debugLog: [],
      diagnosticsState,
      geneExpressionBatch: null,
      geneExpressionColorScale: 'plasma',
      geneExpressionDetailMode: 'auto',
      geneExpressionScoreMode: 'sum',
      geneExpressionState: { status: 'idle' },
      hoveredTranscript: null,
      loadState: { status: 'idle' },
      manualTranscriptExactRequestKey: null,
      measurementEnabled: false,
      measurementUnit: 'um',
      observationColorMode: 'transcript-count',
      performanceBudget: {},
      pinnedTranscript: null,
      selectedGenes: [],
      shareableViewState: undefined,
      shouldLoadMorphology: true,
      showTranscriptOverlay: false,
      telemetryEvents: [],
      transcriptCapabilityState: { status: 'idle' },
      transcriptDensityColorScale: 'thermal',
      transcriptDetailMode: 'auto',
      transcriptExactManualLoadRatio: 0.8,
      transcriptExactPointLimit: 100_000,
      transcriptFeatureFilterMode: 'all',
      transcriptGeneOnly: true,
      transcriptLayerState: { status: 'idle' },
      transcriptMinQv: 20,
      transcriptOpacity: 0.85,
      transcriptPointColorMode: 'feature',
      transcriptPointSize: 2,
    },
    loaders: { runDatasetDiagnostics },
    refs: { diagnosticsAbortRef },
    setters: { setDiagnosticsState },
  })

  React.useEffect(() => {
    onReady(api, {
      debugMessages: debugMessagesRef.current,
      diagnosticsState,
      telemetryEvents: telemetryEventsRef.current,
    })
  })

  return null
}

describe('useDatasetDiagnosticsWorkflow', () => {
  it('runs diagnostics and records success telemetry', async () => {
    const runDatasetDiagnostics = vi.fn(async () => successfulReport)

    render(
      <DiagnosticsProbe
        onReady={(nextApi, nextSnapshot) => {
          diagnosticsApi = nextApi
          diagnosticsSnapshot = nextSnapshot
        }}
        runDatasetDiagnostics={runDatasetDiagnostics}
      />,
    )

    await act(async () => {
      await diagnosticsApi.handleRunDatasetDiagnostics()
    })

    expect(runDatasetDiagnostics).toHaveBeenCalledWith(
      'https://example.test/output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(diagnosticsSnapshot.diagnosticsState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      report: successfulReport,
    })
    expect(diagnosticsSnapshot.debugMessages).toContain('Diagnosing dataset output')
    expect(diagnosticsSnapshot.debugMessages).toContain('Diagnostics: All checks passed')
    expect(diagnosticsSnapshot.telemetryEvents.at(-1)).toMatchObject({
      name: 'dataset.diagnostics',
      outcome: 'success',
      detail: 'All checks passed',
    })
  })

  it('stores structured errors and failure telemetry', async () => {
    const runDatasetDiagnostics = vi.fn(async () => {
      throw new Error('HTTP 500')
    })

    render(
      <DiagnosticsProbe
        onReady={(nextApi, nextSnapshot) => {
          diagnosticsApi = nextApi
          diagnosticsSnapshot = nextSnapshot
        }}
        runDatasetDiagnostics={runDatasetDiagnostics}
      />,
    )

    await act(async () => {
      await diagnosticsApi.handleRunDatasetDiagnostics()
    })

    expect(diagnosticsSnapshot.diagnosticsState.status).toBe('error')
    expect(
      diagnosticsSnapshot.diagnosticsState.status === 'error'
        ? diagnosticsSnapshot.diagnosticsState.error.title
        : '',
    ).toBe('HTTP 500 response')
    expect(
      diagnosticsSnapshot.diagnosticsState.status === 'error'
        ? diagnosticsSnapshot.diagnosticsState.error.source
        : '',
    ).toBe('Dataset diagnostics')
    expect(diagnosticsSnapshot.debugMessages).toContain('Diagnostics failed')
    expect(diagnosticsSnapshot.telemetryEvents.at(-1)).toMatchObject({
      name: 'dataset.diagnostics',
      outcome: 'failure',
      detail: 'HTTP 500',
    })
  })

  it('does not run diagnostics for a blank dataset URL', async () => {
    const runDatasetDiagnostics = vi.fn(async () => successfulReport)

    render(
      <DiagnosticsProbe
        datasetUrl="   "
        onReady={(nextApi, nextSnapshot) => {
          diagnosticsApi = nextApi
          diagnosticsSnapshot = nextSnapshot
        }}
        runDatasetDiagnostics={runDatasetDiagnostics}
      />,
    )

    await act(async () => {
      await diagnosticsApi.handleRunDatasetDiagnostics()
    })

    expect(runDatasetDiagnostics).not.toHaveBeenCalled()
    expect(diagnosticsSnapshot.diagnosticsState).toEqual({ status: 'idle' })
  })

  it('passes the active Visium HD bin size into diagnostics', async () => {
    const runDatasetDiagnostics = vi.fn(async () => successfulReport)

    render(
      <DiagnosticsProbe
        onReady={(nextApi, nextSnapshot) => {
          diagnosticsApi = nextApi
          diagnosticsSnapshot = nextSnapshot
        }}
        runDatasetDiagnostics={runDatasetDiagnostics}
        visiumHdBinSizeMicrometers={8}
      />,
    )

    await act(async () => {
      await diagnosticsApi.handleRunDatasetDiagnostics()
    })

    expect(runDatasetDiagnostics).toHaveBeenCalledWith(
      'https://example.test/output',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        visiumHdBinSizeMicrometers: 8,
      }),
    )
  })

  it('ignores stale diagnostics completions after a newer run starts', async () => {
    const firstRun = createDeferred<DatasetDiagnosticsReport>()
    const secondRun = createDeferred<DatasetDiagnosticsReport>()
    const signals: AbortSignal[] = []
    const runDatasetDiagnostics = vi.fn((_, options) => {
      signals.push(options.signal)
      return signals.length === 1 ? firstRun.promise : secondRun.promise
    })

    render(
      <DiagnosticsProbe
        onReady={(nextApi, nextSnapshot) => {
          diagnosticsApi = nextApi
          diagnosticsSnapshot = nextSnapshot
        }}
        runDatasetDiagnostics={runDatasetDiagnostics}
      />,
    )

    let firstRequest!: Promise<void>
    await act(async () => {
      firstRequest = diagnosticsApi.handleRunDatasetDiagnostics()
      await Promise.resolve()
    })

    let secondRequest!: Promise<void>
    await act(async () => {
      secondRequest = diagnosticsApi.handleRunDatasetDiagnostics()
      await Promise.resolve()
    })

    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      secondRun.resolve(secondSuccessfulReport)
      await secondRequest
    })

    expect(diagnosticsSnapshot.diagnosticsState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      report: secondSuccessfulReport,
    })

    await act(async () => {
      firstRun.resolve(successfulReport)
      await firstRequest
    })

    expect(diagnosticsSnapshot.diagnosticsState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      report: secondSuccessfulReport,
    })
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}
