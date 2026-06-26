import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type {
  TranscriptAggregateBin,
  TranscriptPoint,
} from '../../data/transcriptOverlay'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import {
  IDLE_TRANSCRIPT_CAPABILITY_STATE,
  IDLE_TRANSCRIPT_LAYER_STATE,
  buildCellSummaryTranscriptBins,
  estimateVisibleTranscriptsFromCells,
  isTranscriptExactManualLoadRequired,
  maxTranscriptAggregateCount,
  normalizeTranscriptMinQv,
  normalizeTranscriptPointSize,
  parseTranscriptDensityColorScale,
  parseTranscriptDetailMode,
  parseTranscriptFeatureFilterMode,
  parseTranscriptPointColorMode,
  retainedTranscriptLayerState,
  transcriptCapabilityFailed,
  transcriptCapabilityReady,
  transcriptCapabilityStarted,
  transcriptLayerAggregate,
  transcriptLayerFailed,
  transcriptLayerLoading,
  transcriptLayerReady,
  transcriptLayerUnavailable,
  transcriptLayerWaiting,
  transcriptAggregateBinsForRendering,
  transcriptAggregateFallbackMessage,
  transcriptAggregateScaleMaxForRendering,
  transcriptDensityScaleAriaLabel,
  transcriptDensityScaleValueLabels,
  transcriptExactManualLoadMessage,
  transcriptNativeAggregateMessage,
  transcriptPointsForRendering,
  transcriptStatusCopy,
} from './transcriptLayerModel'

const point: TranscriptPoint = {
  id: 'tx-1',
  cellId: asCellId('aaaaaaaa-1'),
  featureName: 'Actb',
  fovName: null,
  position: { x: micrometers(1), y: micrometers(2) },
  qv: 40,
}

const bin: TranscriptAggregateBin = {
  id: 'bin-1',
  source: 'native-zarr',
  level: 0,
  binX: 1,
  binY: 2,
  position: { x: micrometers(12), y: micrometers(24) },
  radiusMicrometers: 5,
  count: 9,
}

const cells: readonly OverviewCellDatum[] = [
  {
    id: 'aaaaaaaa-1',
    position: [10, -10, 0],
    radiusPixels: 1,
    fillColor: [0, 0, 0],
    transcriptCount: 10,
  },
  {
    id: 'bbbbbbbb-2',
    position: [20, -20, 0],
    radiusPixels: 1,
    fillColor: [0, 0, 0],
    transcriptCount: 5,
  },
]

describe('transcriptLayerModel', () => {
  it('formats transcript status across capability and layer states', () => {
    expect(transcriptStatusCopy({ status: 'idle' }, { status: 'idle' }, false)).toBe(
      'Off',
    )
    expect(
      transcriptStatusCopy(
        { status: 'loading', url: 'https://example.test/output' },
        { status: 'idle' },
        true,
      ),
    ).toBe('Checking')
    expect(
      transcriptStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          capabilities: { rawParquet: true, nativeZarr: false },
        },
        {
          status: 'ready',
          url: 'https://example.test/output',
          points: [point],
          groups: [],
          visibleTranscriptEstimate: 1,
          hitPointLimit: false,
          durationMs: 3,
        },
        true,
      ),
    ).toBe('1 points')
    expect(
      transcriptStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          capabilities: { rawParquet: false, nativeZarr: true },
        },
        {
          status: 'aggregate',
          message: 'density',
          source: 'native-zarr',
          mode: 'density',
          bins: [bin],
          visibleTranscriptEstimate: 10,
        },
        true,
      ),
    ).toBe('1 squares')
  })

  it('retains renderable exact and aggregate layer data during loading', () => {
    expect(
      transcriptPointsForRendering({
        status: 'loading',
        url: 'https://example.test/output',
        visibleTranscriptEstimate: 10,
        previousLayer: { kind: 'exact', points: [point] },
      }),
    ).toEqual([point])
    expect(
      transcriptAggregateBinsForRendering({
        status: 'loading',
        url: 'https://example.test/output',
        visibleTranscriptEstimate: 10,
        previousLayer: { kind: 'aggregate', bins: [bin], scaleMax: 9 },
      }),
    ).toEqual([bin])
    expect(
      transcriptAggregateScaleMaxForRendering({
        status: 'loading',
        url: 'https://example.test/output',
        visibleTranscriptEstimate: 10,
        previousLayer: { kind: 'aggregate', bins: [bin], scaleMax: 9 },
      }),
    ).toBe(9)
    expect(
      retainedTranscriptLayerState({
        status: 'aggregate',
        message: 'density',
        source: 'native-zarr',
        mode: 'density',
        bins: [bin],
        visibleTranscriptEstimate: 10,
        scaleMax: 9,
      }),
    ).toEqual({ kind: 'aggregate', bins: [bin], scaleMax: 9 })
  })

  it('constructs transcript capability and layer transitions', () => {
    const error = { message: 'failed' }

    expect(IDLE_TRANSCRIPT_CAPABILITY_STATE).toEqual({ status: 'idle' })
    expect(transcriptCapabilityStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(
      transcriptCapabilityReady('https://example.test/output', {
        rawParquet: true,
        nativeZarr: false,
      }),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      capabilities: { rawParquet: true, nativeZarr: false },
    })
    expect(transcriptCapabilityFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })

    expect(IDLE_TRANSCRIPT_LAYER_STATE).toEqual({ status: 'idle' })
    expect(
      transcriptLayerWaiting({
        message: 'Zoom in',
        visibleTranscriptEstimate: 80,
        exactLoadRequestKey: 'request-key',
        exactLoadEstimate: 80,
      }),
    ).toEqual({
      status: 'waiting',
      message: 'Zoom in',
      visibleTranscriptEstimate: 80,
      exactLoadRequestKey: 'request-key',
      exactLoadEstimate: 80,
    })
    expect(transcriptLayerUnavailable('Missing output', 12)).toEqual({
      status: 'unavailable',
      message: 'Missing output',
      visibleTranscriptEstimate: 12,
    })
    expect(
      transcriptLayerLoading(
        {
          status: 'ready',
          url: 'https://example.test/output',
          points: [point],
          groups: [],
          visibleTranscriptEstimate: 1,
          hitPointLimit: false,
          durationMs: 3,
        },
        'https://example.test/output',
        10,
      ),
    ).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      visibleTranscriptEstimate: 10,
      previousLayer: { kind: 'exact', points: [point] },
    })
    expect(
      transcriptLayerAggregate({
        source: 'native-zarr',
        mode: 'density',
        bins: [bin],
        message: 'density',
        visibleTranscriptEstimate: 10,
        scaleMax: 9,
        durationMs: 4,
      }),
    ).toEqual({
      status: 'aggregate',
      source: 'native-zarr',
      mode: 'density',
      bins: [bin],
      message: 'density',
      visibleTranscriptEstimate: 10,
      scaleMax: 9,
      durationMs: 4,
    })
    expect(
      transcriptLayerReady({
        url: 'https://example.test/output',
        points: [point],
        groups: [],
        visibleTranscriptEstimate: 1,
        hitPointLimit: false,
        durationMs: 3,
      }),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      points: [point],
      groups: [],
      visibleTranscriptEstimate: 1,
      hitPointLimit: false,
      durationMs: 3,
    })
    expect(transcriptLayerFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

  it('parses and normalizes transcript controls', () => {
    expect(parseTranscriptDetailMode('bins')).toBe('density')
    expect(parseTranscriptDetailMode('exact')).toBe('exact')
    expect(parseTranscriptDetailMode('bad')).toBeUndefined()
    expect(parseTranscriptFeatureFilterMode('selected')).toBe('selected')
    expect(parseTranscriptDensityColorScale('thermal')).toBe('thermal')
    expect(parseTranscriptPointColorMode('quality')).toBe('quality')
    expect(normalizeTranscriptMinQv(Number.NaN)).toBe(20)
    expect(normalizeTranscriptMinQv(45)).toBe(40)
    expect(normalizeTranscriptPointSize(0)).toBe(1)
    expect(normalizeTranscriptPointSize(8)).toBe(6)
  })

  it('formats density labels, manual-load copy, and aggregate messages', () => {
    expect(transcriptDensityScaleValueLabels(undefined)).toEqual(['0', '-', '-'])
    expect(transcriptDensityScaleValueLabels(50)).toEqual(['0', '25', '50'])
    expect(transcriptDensityScaleAriaLabel(50)).toBe(
      'Transcript density color scale from 0 to 50 transcripts per square.',
    )
    expect(isTranscriptExactManualLoadRequired(80, 100)).toBe(true)
    expect(transcriptExactManualLoadMessage(80, 100)).toContain('100 point budget')
    expect(
      transcriptNativeAggregateMessage({
        mode: 'density',
        selectedFeatureCount: 2,
        binCount: 1234,
      }),
    ).toBe(
      'Showing native 2 selected-feature density squares from transcripts.zarr.zip (1,234 squares).',
    )
    expect(
      transcriptAggregateFallbackMessage({
        mode: 'density',
        featureFilterMode: 'selected',
        selectedFeatureCount: 1,
      }),
    ).toContain('Selected-gene filtering is applied by Exact.')
  })

  it('estimates and bins visible transcripts from overview cells', () => {
    const bbox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(15),
      maxY: micrometers(15),
    }

    expect(estimateVisibleTranscriptsFromCells(cells, bbox)).toBe(10)

    const bins = buildCellSummaryTranscriptBins(cells, bbox, 'density')

    expect(bins).toHaveLength(1)
    expect(bins[0]).toMatchObject({
      id: 'cell-summary:density:1:0:0',
      source: 'cell-summary',
      count: 10,
    })
    expect(maxTranscriptAggregateCount([bin, { ...bin, id: 'bin-2', count: 3 }])).toBe(9)
    expect(maxTranscriptAggregateCount([])).toBe(1)
  })
})
