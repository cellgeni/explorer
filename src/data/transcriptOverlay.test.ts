import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TRANSCRIPT_EXACT_RENDER_LIMIT,
  TRANSCRIPT_EXACT_RENDER_LIMIT,
  loadDatasetTranscriptViewport,
  mergeTranscriptPointMetadata,
  normalizeTranscriptExactPointLimit,
  planTranscriptLod,
  transcriptViewportRequestKey,
  type TranscriptPoint,
} from './transcriptOverlay'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import type { XeniumDataset } from '../datasets/xeniumDataset'

const transcriptZarrMock = vi.hoisted(() => ({
  loadTranscriptZarrAggregates: vi.fn(),
  loadTranscriptZarrViewport: vi.fn(),
}))

vi.mock('./transcriptZarr', () => transcriptZarrMock)

beforeEach(() => {
  transcriptZarrMock.loadTranscriptZarrAggregates.mockReset()
  transcriptZarrMock.loadTranscriptZarrViewport.mockReset()
})

describe('transcriptOverlay', () => {
  it('plans exact rendering when the viewport is close and inside budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 2 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT,
        hasRawParquet: true,
        hasNativeZarr: false,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('exact')
  })

  it('prefers native Xenium Zarr LOD when exact rendering would exceed budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: -1 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT + 1,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('native-zarr')
  })

  it('switches auto mode to exact when the estimate is under budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 3 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: 20,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('exact')
  })

  it('waits instead of sampling exact rows when native LOD is unavailable', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 0 } },
      {
        detailMode: 'exact',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT + 1,
        hasRawParquet: true,
        hasNativeZarr: false,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('waiting')
  })

  it('requires a selected-gene filter when selected mode has no genes', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 3 } },
      {
        detailMode: 'exact',
        visibleTranscriptEstimate: 10,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: false,
      },
    )

    expect(plan.kind).toBe('waiting')
    if (plan.kind !== 'waiting') {
      throw new Error('Expected waiting transcript LOD plan.')
    }

    expect(plan.message).toContain('Select genes')
  })

  it('normalizes the exact point budget', () => {
    expect(normalizeTranscriptExactPointLimit(undefined)).toBe(
      TRANSCRIPT_EXACT_RENDER_LIMIT,
    )
    expect(normalizeTranscriptExactPointLimit(Number.NaN)).toBe(
      TRANSCRIPT_EXACT_RENDER_LIMIT,
    )
    expect(normalizeTranscriptExactPointLimit(12.6)).toBe(13)
    expect(normalizeTranscriptExactPointLimit(-4)).toBe(1)
    expect(normalizeTranscriptExactPointLimit(300_000)).toBe(300_000)
    expect(normalizeTranscriptExactPointLimit(1_500_000)).toBe(
      MAX_TRANSCRIPT_EXACT_RENDER_LIMIT,
    )
  })

  it('normalizes feature order in viewport request keys', () => {
    const bbox = {
      minX: micrometers(1),
      minY: micrometers(2),
      maxX: micrometers(3),
      maxY: micrometers(4),
    }
    const left = transcriptViewportRequestKey('https://example.test/out', bbox, {
      minQv: 20,
      geneOnly: true,
      featureNames: ['Gad1', 'Actb'],
      pointLimit: 100,
    })
    const right = transcriptViewportRequestKey('https://example.test/out', bbox, {
      minQv: 20,
      geneOnly: true,
      featureNames: ['Actb', 'Gad1'],
      pointLimit: 100,
    })

    expect(left).toBe(right)
  })

  it('merges Parquet transcript assignment metadata into native Zarr points', () => {
    const cellId = intToCellId(1, 1)
    const nativePoint = transcriptPoint({
      id: 'FOV-001:12',
      transcriptId: '12',
      cellId: null,
      cellAssignment: 'unavailable',
      fovName: 'FOV-001',
    })
    const parquetPoint = transcriptPoint({
      id: '12',
      transcriptId: '12',
      cellId,
      cellAssignment: 'known',
      fovName: 'FOV-001',
      overlapsNucleus: true,
      nucleusDistance: 0,
    })

    expect(mergeTranscriptPointMetadata([nativePoint], [parquetPoint])).toEqual([
      expect.objectContaining({
        id: 'FOV-001:12',
        transcriptId: '12',
        cellId,
        cellAssignment: 'known',
        overlapsNucleus: true,
        nucleusDistance: 0,
      }),
    ])
  })

  it('returns native exact points when Parquet metadata enrichment is slow', async () => {
    vi.useFakeTimers()
    const onFallback = vi.fn()
    const nativeResult = {
      points: [
        transcriptPoint({
          id: 'FOV-001:12',
          transcriptId: '12',
          cellId: null,
          cellAssignment: 'unavailable',
          fovName: 'FOV-001',
        }),
      ],
      groups: [],
      hitPointLimit: false,
    }
    const transcriptsForViewport = vi.fn(() => pendingPromise())
    transcriptZarrMock.loadTranscriptZarrViewport.mockResolvedValue(nativeResult)

    try {
      const result = loadDatasetTranscriptViewport(
        'https://example.test/xenium/',
        {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(10),
          maxY: micrometers(10),
        },
        {
          validateRangeSupport: vi.fn(async () => undefined),
          getDataset: async () =>
            ({
              transcriptsForViewport,
            }) as unknown as XeniumDataset,
          metadataEnrichmentTimeoutMs: 25,
          onFallback,
        },
      )

      await vi.advanceTimersByTimeAsync(25)

      await expect(result).resolves.toEqual(nativeResult)
      expect(transcriptsForViewport).toHaveBeenCalled()
      expect(onFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'Transcripts',
          message: expect.stringContaining('without Parquet assignment metadata'),
          detail: 'Metadata enrichment exceeded 25 ms.',
          coalesceKey: 'transcript-metadata-enrichment:https://example.test/xenium/',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to raw transcripts.parquet when native exact Zarr is unavailable', async () => {
    const parquetResult = {
      points: [
        transcriptPoint({
          id: '12',
          transcriptId: '12',
          cellId: intToCellId(1, 1),
          cellAssignment: 'known',
          fovName: 'FOV-001',
        }),
      ],
      groups: [],
      hitPointLimit: false,
    }
    const validateRangeSupport = vi.fn(async (_url: string, options) => {
      if (options.label === 'transcripts.zarr.zip') {
        throw new Error('missing zarr')
      }
    })
    const transcriptsForViewport = vi.fn(async () => parquetResult)
    const onFallback = vi.fn()

    await expect(
      loadDatasetTranscriptViewport(
        'https://example.test/xenium/',
        {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(10),
          maxY: micrometers(10),
        },
        {
          validateRangeSupport,
          getDataset: async () =>
            ({
              transcriptsForViewport,
            }) as unknown as XeniumDataset,
          onFallback,
        },
      ),
    ).resolves.toEqual(parquetResult)

    expect(transcriptsForViewport).toHaveBeenCalled()
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Transcripts',
        message: expect.stringContaining('switched to raw transcripts.parquet'),
        coalesceKey: 'transcript-exact-raw-parquet:https://example.test/xenium/',
      }),
    )
  })

  it('returns native exact points when Parquet metadata enrichment fails', async () => {
    const nativeResult = {
      points: [
        transcriptPoint({
          id: 'FOV-001:12',
          transcriptId: '12',
          cellId: null,
          cellAssignment: 'unavailable',
          fovName: 'FOV-001',
        }),
      ],
      groups: [],
      hitPointLimit: false,
    }
    const validateRangeSupport = vi.fn(async (_url: string, options) => {
      if (options.label === 'transcripts.parquet') {
        throw new Error('missing parquet')
      }
    })
    const onFallback = vi.fn()
    transcriptZarrMock.loadTranscriptZarrViewport.mockResolvedValue(nativeResult)

    await expect(
      loadDatasetTranscriptViewport(
        'https://example.test/xenium/',
        {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(10),
          maxY: micrometers(10),
        },
        {
          validateRangeSupport,
          onFallback,
        },
      ),
    ).resolves.toEqual(nativeResult)

    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Transcripts',
        message: expect.stringContaining('Parquet metadata enrichment failed'),
        detail: 'missing parquet',
        coalesceKey: 'transcript-metadata-enrichment:https://example.test/xenium/',
      }),
    )
  })
})

function pendingPromise<T = never>(): Promise<T> {
  return new Promise<T>(() => {})
}

function transcriptPoint({
  id,
  transcriptId,
  cellId,
  cellAssignment,
  fovName,
  overlapsNucleus,
  nucleusDistance,
}: {
  readonly id: string
  readonly transcriptId: string
  readonly cellId: TranscriptPoint['cellId']
  readonly cellAssignment: TranscriptPoint['cellAssignment']
  readonly fovName: string
  readonly overlapsNucleus?: boolean
  readonly nucleusDistance?: number
}): TranscriptPoint {
  return {
    id,
    transcriptId,
    cellId,
    ...(cellAssignment === undefined ? {} : { cellAssignment }),
    featureName: 'Actb',
    fovName,
    position: {
      x: micrometers(1),
      y: micrometers(2),
    },
    qv: 31,
    isGene: true,
    ...(overlapsNucleus === undefined ? {} : { overlapsNucleus }),
    ...(nucleusDistance === undefined ? {} : { nucleusDistance }),
  }
}
