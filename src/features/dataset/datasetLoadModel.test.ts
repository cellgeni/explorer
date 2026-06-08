import { describe, expect, it } from 'vitest'
import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'
import type {
  BoundaryLoadState,
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
  DatasetLoadState,
  DatasetWarmupState,
  MorphologyLoadState,
} from './datasetLoadModel'

const report: DatasetDiagnosticsReport = {
  baseUrl: 'https://example.test/output',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  checks: [],
}

describe('datasetLoadModel state contracts', () => {
  it('accepts the runtime state shapes used by dataset workflows', () => {
    const datasetStates: readonly DatasetLoadState<{ readonly title: string }>[] = [
      { status: 'idle' },
      { status: 'loading', url: 'https://example.test/output' },
      { status: 'ready', url: 'https://example.test/output', cellCount: 12 },
      {
        status: 'error',
        url: 'https://example.test/output',
        error: { title: 'Failed' },
      },
    ]
    const warmupStates: readonly DatasetWarmupState[] = [
      { status: 'idle' },
      { status: 'loading', url: 'https://example.test/output' },
      { status: 'ready', url: 'https://example.test/output' },
      { status: 'error', url: 'https://example.test/output' },
    ]
    const capabilityStates: readonly CellFeatureMatrixCapabilityState[] = [
      { status: 'idle' },
      {
        status: 'ready',
        url: 'https://example.test/output',
        hasCellMajorCsc: true,
      },
    ]
    const diagnosticsStates: readonly DatasetDiagnosticsState<{
      readonly title: string
    }>[] = [
      { status: 'idle' },
      { status: 'loading', url: 'https://example.test/output' },
      { status: 'ready', url: 'https://example.test/output', report },
      {
        status: 'error',
        url: 'https://example.test/output',
        error: { title: 'Failed' },
      },
    ]
    const morphologyStates: readonly MorphologyLoadState<{ readonly title: string }>[] = [
      { status: 'idle' },
      { status: 'loading', url: 'https://example.test/output' },
      { status: 'ready', url: 'https://example.test/output' },
      {
        status: 'error',
        url: 'https://example.test/output',
        error: { title: 'Failed' },
      },
    ]
    const boundaryStates: readonly BoundaryLoadState<{ readonly title: string }>[] = [
      { status: 'idle' },
      { status: 'loading', url: 'https://example.test/output' },
      { status: 'ready', url: 'https://example.test/output', cellCount: 4 },
      {
        status: 'error',
        url: 'https://example.test/output',
        error: { title: 'Failed' },
      },
    ]

    expect(
      [
        datasetStates,
        warmupStates,
        capabilityStates,
        diagnosticsStates,
        morphologyStates,
        boundaryStates,
      ].map((states) => states.map((state) => state.status)),
    ).toEqual([
      ['idle', 'loading', 'ready', 'error'],
      ['idle', 'loading', 'ready', 'error'],
      ['idle', 'ready'],
      ['idle', 'loading', 'ready', 'error'],
      ['idle', 'loading', 'ready', 'error'],
      ['idle', 'loading', 'ready', 'error'],
    ])
  })
})
