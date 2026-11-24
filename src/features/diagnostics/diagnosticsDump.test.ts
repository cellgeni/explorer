import { describe, expect, it } from 'vitest'
import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'
import { createDiagnosticsDump, diagnosticsDumpFileName } from './diagnosticsDump'

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

const DUMP_OPTIONS: Parameters<typeof createDiagnosticsDump>[0] = {
  openPanels: ['transcripts'],
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
}

describe('createDiagnosticsDump', () => {
  // The dump is made to be attached to bug reports (EXP-233).
  it('leaves the query of a signed address out of the dump', () => {
    const signed =
      'https://bucket.s3.amazonaws.com/run.h5ad?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=c0ffee'
    window.history.pushState(
      null,
      '',
      `/viewer#dataset=${encodeURIComponent(signed)}&genes=Actb`,
    )

    const dump = createDiagnosticsDump({
      ...DUMP_OPTIONS,
      datasetUrl: signed,
      activeErrors: [
        { title: 'Error', message: `H5AD file returned HTTP 403 for ${signed}.` },
      ],
      loadState: { status: 'ready', url: signed, cellCount: 12 },
      diagnosticsState: {
        status: 'ready',
        url: signed,
        report: {
          ...report,
          baseUrl: signed,
          checks: [{ ...report.checks[0]!, url: signed }],
        },
      },
      telemetryEvents: [{ name: 'dataset.load', detail: `Failed: ${signed}` }],
    })
    const text = JSON.stringify(dump)

    expect(text).not.toContain('X-Amz-Signature')
    expect(text).not.toContain('AKIAEXAMPLE')
    expect(dump).toMatchObject({
      datasetUrl: 'https://bucket.s3.amazonaws.com/run.h5ad',
      activeErrors: [
        {
          message:
            'H5AD file returned HTTP 403 for https://bucket.s3.amazonaws.com/run.h5ad.',
        },
      ],
      location: expect.stringMatching(
        /#dataset=https%3A%2F%2Fbucket\.s3\.amazonaws\.com%2Frun\.h5ad&genes=Actb$/,
      ),
    })
  })

  it('keeps every value of a repeated parameter when one is signed', () => {
    const signed = 'https://bucket.s3.amazonaws.com/he.ome.tif?X-Amz-Signature=c0ffee'
    const hash = new URLSearchParams([
      ['dataset', 'https://example.test/output'],
      ['customImageUrl', 'https://example.test/dapi.ome.tif'],
      ['customImageUrl', signed],
      ['customImageUrl', 'https://example.test/cd45.ome.tif'],
    ])
    window.history.pushState(null, '', `/viewer#${hash.toString()}`)

    const location = String(createDiagnosticsDump(DUMP_OPTIONS).location)
    const params = new URLSearchParams(location.slice(location.indexOf('#') + 1))

    expect(location).not.toContain('X-Amz-Signature')
    expect(params.get('dataset')).toBe('https://example.test/output')
    expect(params.getAll('customImageUrl')).toEqual([
      'https://example.test/dapi.ome.tif',
      'https://bucket.s3.amazonaws.com/he.ome.tif',
      'https://example.test/cd45.ome.tif',
    ])
  })

  it('serializes controls, state summaries, transcript inspections, and budget decisions', () => {
    window.history.pushState(null, '', '/viewer?dataset=test')

    expect(createDiagnosticsDump(DUMP_OPTIONS)).toMatchObject({
      generatedAt: expect.any(String),
      datasetUrl: 'https://example.test/output',
      location: expect.stringContaining('/viewer?dataset=test'),
      controls: {
        openPanels: ['transcripts'],
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

describe('diagnosticsDumpFileName', () => {
  it('uses the UTC time to the second, without colons', () => {
    expect(diagnosticsDumpFileName(new Date('2026-11-17T14:05:09.987Z'))).toBe(
      'diagnostics-2026-11-17T14-05-09Z.json',
    )
    expect(diagnosticsDumpFileName(new Date('2026-01-02T03:04:05+05:00'))).toBe(
      'diagnostics-2026-01-01T22-04-05Z.json',
    )
  })
})
