import { describe, expect, it } from 'vitest'
import type { DatasetDiagnosticsReport } from '../../data/datasetDiagnostics'
import {
  IDLE_BOUNDARY_LOAD_STATE,
  IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE,
  IDLE_DATASET_DIAGNOSTICS_STATE,
  IDLE_DATASET_LOAD_STATE,
  IDLE_DATASET_WARMUP_STATE,
  IDLE_MORPHOLOGY_LOAD_STATE,
  boundaryLoadFailed,
  boundaryLoadReady,
  boundaryLoadStarted,
  cellFeatureMatrixCapabilityReady,
  datasetDiagnosticsFailed,
  datasetDiagnosticsReady,
  datasetDiagnosticsStarted,
  datasetLoadFailed,
  datasetLoadReady,
  datasetLoadStarted,
  datasetWarmupFailed,
  datasetWarmupReady,
  datasetWarmupStarted,
  morphologyLoadFailed,
  morphologyLoadReady,
  morphologyLoadStarted,
  type BoundaryLoadState,
  type CellFeatureMatrixCapabilityState,
  type DatasetDiagnosticsState,
  type DatasetLoadState,
  type DatasetWarmupState,
  type MorphologyLoadState,
} from './datasetLoadModel'

const report: DatasetDiagnosticsReport = {
  baseUrl: 'https://example.test/output',
  platform: 'xenium',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  checks: [],
}

describe('datasetLoadModel state contracts', () => {
  it('constructs dataset load and warmup transitions', () => {
    const error = { title: 'Failed' }

    expect(IDLE_DATASET_LOAD_STATE).toEqual({ status: 'idle' })
    expect(datasetLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(datasetLoadReady('https://example.test/output', 12)).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 12,
    })
    expect(datasetLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
    expect(IDLE_DATASET_WARMUP_STATE).toEqual({ status: 'idle' })
    expect(datasetWarmupStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(datasetWarmupReady('https://example.test/output')).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
    })
    expect(datasetWarmupFailed('https://example.test/output')).toEqual({
      status: 'error',
      url: 'https://example.test/output',
    })
    expect(IDLE_MORPHOLOGY_LOAD_STATE).toEqual({ status: 'idle' })
    expect(morphologyLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(morphologyLoadReady('https://example.test/image.ome.tif')).toEqual({
      status: 'ready',
      url: 'https://example.test/image.ome.tif',
    })
    expect(morphologyLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
    expect(IDLE_DATASET_DIAGNOSTICS_STATE).toEqual({ status: 'idle' })
    expect(datasetDiagnosticsStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(datasetDiagnosticsReady('https://example.test/output', report)).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      report,
    })
    expect(datasetDiagnosticsFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
    expect(IDLE_BOUNDARY_LOAD_STATE).toEqual({ status: 'idle' })
    expect(boundaryLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(boundaryLoadReady('https://example.test/output', 4)).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellCount: 4,
    })
    expect(boundaryLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
    expect(IDLE_CELL_FEATURE_MATRIX_CAPABILITY_STATE).toEqual({ status: 'idle' })
    expect(cellFeatureMatrixCapabilityReady('https://example.test/output', true)).toEqual(
      {
        status: 'ready',
        url: 'https://example.test/output',
        hasCellMajorCsc: true,
      },
    )
  })

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
