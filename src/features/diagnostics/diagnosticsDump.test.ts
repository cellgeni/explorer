import { describe, expect, it } from 'vitest'
import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'
import { createDiagnosticsDump } from './diagnosticsDump'

const report: DatasetDiagnosticsReport = {
  baseUrl: 'https://example.test/output',
  platform: 'xenium',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  checks: [
    {
      id: 'cells-parquet',
      label: 'Overview cells',
      url: 'https://example.test/output/cells.parquet',
      required: true,
      status: 'pass',
      message: 'Byte-range readable',
      durationMs: 1,
    },
  ],
}

describe('createDiagnosticsDump', () => {
  it('serializes controls, state summaries, transcript inspections, and budget decisions', () => {
    window.history.pushState(null, '', '/viewer?dataset=test')

    expect(
      createDiagnosticsDump({
        activeControlHudTab: 'transcripts',
        activeErrors: [{ title: 'Error' }],
        boundaryCellLimit: 50000,
        coordinateUnit: 'um',
        datasetUrl: 'https://example.test/output',
        debugLog: [{ message: 'Loaded' }],
        diagnosticsState: {
          status: 'ready',
          url: 'https://example.test/output',
          report,
        },
        geneExpressionBatch: {
          elements: [{ id: 'aaaaaaaa-1' }],
          genes: ['Actb'],
          maxCount: 4,
          timing: {
            viewportCellsMs: 1,
            matrixReadMs: 2,
            scoreCellsMs: 3,
            totalMs: 6,
            stageSummary: 'Viewport cell query 1 ms',
          },
        },
        geneExpressionColorScale: 'plasma',
        geneExpressionDetailMode: 'auto',
        geneExpressionScoreMode: 'sum',
        geneExpressionState: {
          status: 'ready',
          url: 'https://example.test/output',
          genes: ['Actb'],
          mode: 'exact',
          cellCount: 1,
          visibleCellCount: 12,
        },
        hoveredTranscript: {
          transcript: {
            id: 'tx-1',
            transcriptId: 'raw-1',
            featureName: 'Actb',
            fovName: null,
            cellId: 'aaaaaaaa-1',
            qv: 40,
            zLocation: 3,
          },
          screen: { x: 1, y: 2 },
        },
        loadState: {
          status: 'ready',
          url: 'https://example.test/output',
          cellCount: 12,
        },
        manualTranscriptExactRequestKey: 'manual-key',
        measurementEnabled: true,
        measurementUnit: 'um',
        observationColorMode: 'transcript-count',
        performanceBudget: { fps: 60 },
        pinnedTranscript: {
          aggregate: {
            id: 'bin-1',
            count: 10,
            source: 'native-zarr',
            level: 0,
            binX: 1,
            binY: 2,
          },
          screen: { x: 3, y: 4 },
        },
        selectedGenes: ['Actb'],
        shareableViewState: { target: [1, 2, 0], zoom: 3 },
        shouldLoadMorphology: true,
        telemetryEvents: [{ name: 'load' }],
        showTranscriptOverlay: true,
        transcriptCapabilityState: { status: 'ready' },
        transcriptDetailMode: 'auto',
        transcriptDensityColorScale: 'thermal',
        transcriptExactPointLimit: 100,
        transcriptExactManualLoadRatio: 0.8,
        transcriptFeatureFilterMode: 'selected',
        transcriptGeneOnly: true,
        transcriptLayerState: {
          status: 'waiting',
          visibleTranscriptEstimate: 80,
          exactLoadEstimate: 80,
          exactLoadRequestKey: 'request-key',
          message: 'Manual load required',
        },
        transcriptMinQv: 20,
        transcriptOpacity: 0.8,
        transcriptPointColorMode: 'feature',
        transcriptPointSize: 2,
      }),
    ).toMatchObject({
      generatedAt: expect.any(String),
      datasetUrl: 'https://example.test/output',
      location: expect.stringContaining('/viewer?dataset=test'),
      controls: {
        activeControlHudTab: 'transcripts',
        selectedGenes: ['Actb'],
        transcriptGeneOnly: true,
      },
      states: {
        dataset: {
          status: 'ready',
          url: 'https://example.test/output',
          cellCount: 12,
        },
        diagnostics: {
          status: 'ready',
          summary: 'All checks passed',
          report,
        },
        geneExpression: {
          status: 'ready',
          mode: 'exact',
          genes: ['Actb'],
          cellCount: 1,
          visibleCellCount: 12,
          batch: {
            positiveElementCount: 1,
            maxCount: 4,
            timing: {
              stageSummary: 'Viewport cell query 1 ms',
            },
          },
        },
        transcripts: {
          exactBudget: {
            status: 'waiting',
            exactPointLimit: 100,
            manualLoadThreshold: 80,
            manualRequestKey: 'manual-key',
            exactLoadEstimate: 80,
            hasExactLoadAction: true,
            message: 'Manual load required',
          },
          hovered: {
            kind: 'transcript',
            id: 'tx-1',
            featureName: 'Actb',
          },
          pinned: {
            kind: 'density-bin',
            id: 'bin-1',
            count: 10,
          },
        },
      },
      activeErrors: [{ title: 'Error' }],
      activityLog: [{ message: 'Loaded' }],
      telemetryEvents: [{ name: 'load' }],
    })
  })
})
