import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadDatasetTranscriptCapabilities,
  loadDatasetTranscriptViewport,
  mergeTranscriptPointMetadata,
} from './datasetTranscripts'
import type { TranscriptPoint } from './transcriptOverlay'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import type { XeniumDataset } from '../datasets/xeniumDataset'

const transcriptZarrMock = vi.hoisted(() => ({
  loadTranscriptZarrAggregates: vi.fn(),
  loadTranscriptZarrGridCounts: vi.fn(),
  loadTranscriptZarrViewport: vi.fn(),
}))

vi.mock('./transcriptZarr', () => transcriptZarrMock)

beforeEach(() => {
  transcriptZarrMock.loadTranscriptZarrAggregates.mockReset()
  transcriptZarrMock.loadTranscriptZarrGridCounts.mockReset()
  transcriptZarrMock.loadTranscriptZarrViewport.mockReset()
})

describe('datasetTranscripts', () => {
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

  it('pairs a Zarr point with the Parquet row of its 64-bit transcript ID', () => {
    const cellId = intToCellId(1, 1)
    // The Xenium demo's transcript 281668250306971 = 0x1002d × 2^32 + 67995:
    // field of view F1 (index 45 in fov_names) and the low 32 bits the Zarr
    // keeps.
    const nativePoint = transcriptPoint({
      id: 'F1:67995',
      transcriptId: '67995',
      cellId: null,
      cellAssignment: 'unavailable',
      fovName: 'F1',
    })
    const parquetPoint = transcriptPoint({
      id: '281668250306971',
      transcriptId: '281668250306971',
      cellId,
      cellAssignment: 'known',
      fovName: 'F1',
      overlapsNucleus: true,
      nucleusDistance: 0,
    })
    // G1 (index 60) has a transcript with the same low 32 bits.
    const otherFov = transcriptPoint({
      id: '281732674816411',
      transcriptId: '281732674816411',
      cellId: intToCellId(2, 2),
      cellAssignment: 'known',
      fovName: 'G1',
    })

    expect(mergeTranscriptPointMetadata([nativePoint], [otherFov, parquetPoint])).toEqual(
      [
        expect.objectContaining({
          id: 'F1:67995',
          transcriptId: '281668250306971',
          cellId,
          cellAssignment: 'known',
          overlapsNucleus: true,
          nucleusDistance: 0,
        }),
      ],
    )
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

  it('passes tile progress through to the native exact read (15.3-D)', async () => {
    const nativeResult = { points: [], groups: [], hitPointLimit: false }
    const onProgress = vi.fn()
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
        { validateRangeSupport: vi.fn(async () => undefined), onProgress },
      ),
    ).resolves.toEqual(nativeResult)

    expect(transcriptZarrMock.loadTranscriptZarrViewport).toHaveBeenCalledWith(
      expect.stringContaining('transcripts.zarr.zip'),
      expect.anything(),
      expect.objectContaining({ onProgress }),
    )
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

  describe('transcript capabilities', () => {
    const gridCounts = {
      level: 0,
      tileSizeMicrometers: 250,
      gridKeys: ['0,0'],
      transcriptCounts: [42],
    }

    it('reads the transcripts.zarr.zip grid counts for the visible estimate', async () => {
      transcriptZarrMock.loadTranscriptZarrGridCounts.mockResolvedValue(gridCounts)

      await expect(
        loadDatasetTranscriptCapabilities('https://example.test/xenium/', {
          validateRangeSupport: vi.fn(async () => undefined),
        }),
      ).resolves.toEqual({
        rawParquet: true,
        nativeZarr: true,
        nativeZarrGridCounts: gridCounts,
      })
      expect(transcriptZarrMock.loadTranscriptZarrGridCounts).toHaveBeenCalledWith(
        'https://example.test/xenium/transcripts.zarr.zip',
        {},
      )
    })

    it('keeps the native Zarr and says why when its grid counts cannot be read', async () => {
      transcriptZarrMock.loadTranscriptZarrGridCounts.mockRejectedValueOnce(
        new Error('transcripts.zarr.zip is missing grid_number_objects metadata.'),
      )
      transcriptZarrMock.loadTranscriptZarrGridCounts.mockResolvedValueOnce(null)
      const validateRangeSupport = vi.fn(async () => undefined)

      await expect(
        loadDatasetTranscriptCapabilities('https://example.test/xenium/', {
          validateRangeSupport,
        }),
      ).resolves.toEqual({
        rawParquet: true,
        nativeZarr: true,
        nativeZarrGridCountsError:
          'transcripts.zarr.zip is missing grid_number_objects metadata.',
      })
      await expect(
        loadDatasetTranscriptCapabilities('https://example.test/xenium/', {
          validateRangeSupport,
        }),
      ).resolves.toMatchObject({
        nativeZarr: true,
        nativeZarrGridCountsError: 'transcripts.zarr.zip has no level-0 grid counts.',
      })
    })

    it('does not read grid counts without a range-readable transcripts.zarr.zip', async () => {
      const validateRangeSupport = vi.fn(async (_url: string, options) => {
        if (options.label === 'transcripts.zarr.zip') {
          throw new Error('missing zarr')
        }
      })

      await expect(
        loadDatasetTranscriptCapabilities('https://example.test/xenium/', {
          validateRangeSupport,
        }),
      ).resolves.toEqual({
        rawParquet: true,
        nativeZarr: false,
        nativeZarrError: 'missing zarr',
      })
      expect(transcriptZarrMock.loadTranscriptZarrGridCounts).not.toHaveBeenCalled()
    })

    it('stops when the check is cancelled while the grid counts load', async () => {
      const controller = new AbortController()
      transcriptZarrMock.loadTranscriptZarrGridCounts.mockImplementation(async () => {
        controller.abort()
        return gridCounts
      })

      await expect(
        loadDatasetTranscriptCapabilities('https://example.test/xenium/', {
          validateRangeSupport: vi.fn(async () => undefined),
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })
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
