import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  loadDatasetCellTranscriptDistribution,
  summarizeCellTranscriptZDistribution,
} from './cellTranscripts'
import { micrometers } from './coords'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { CellId } from './cellid'
import type { DatasetTranscript, XeniumDataset } from '../datasets/xeniumDataset'

vi.mock('./xeniumDatasetCache', () => ({
  cachedXeniumTranscriptDataset: vi.fn(),
}))

describe('cell transcript distribution loader', () => {
  beforeEach(() => {
    vi.mocked(cachedXeniumTranscriptDataset).mockReset()
  })

  it('summarizes transcript z locations into stable bins', () => {
    const cellId = intToCellId(1, 1)
    const transcripts: readonly DatasetTranscript[] = [
      transcript(cellId, 0),
      transcript(cellId, 0.4),
      transcript(cellId, 1),
      transcript(cellId, undefined),
    ]

    expect(
      summarizeCellTranscriptZDistribution(transcripts, {
        binCount: 2,
        minQv: 30,
      }),
    ).toEqual({
      bins: [
        { minZ: 0, maxZ: 0.5, count: 2, percent: 66.66666666666666 },
        { minZ: 0.5, maxZ: 1, count: 1, percent: 33.33333333333333 },
      ],
      transcriptCount: 4,
      zCount: 3,
      missingZCount: 1,
      minZ: 0,
      maxZ: 1,
      maxBinCount: 2,
      hitTranscriptLimit: false,
      minQv: 30,
    })
  })

  it('collapses a single z plane into one bin', () => {
    const cellId = intToCellId(1, 1)

    expect(
      summarizeCellTranscriptZDistribution([
        transcript(cellId, 3),
        transcript(cellId, 3),
      ]),
    ).toMatchObject({
      bins: [{ minZ: 3, maxZ: 3, count: 2, percent: 100 }],
      minZ: 3,
      maxZ: 3,
      maxBinCount: 2,
    })
  })

  it('validates range support and delegates to the selected-cell transcript query', async () => {
    const cellId = intToCellId(1, 1)
    const validateRangeSupport = vi.fn(async () => undefined)
    const transcriptsForCellId = vi.fn(async () => [
      transcript(cellId, 1),
      transcript(cellId, 2),
    ])
    const getDataset = vi.fn(
      async () => ({ transcriptsForCellId }) as unknown as XeniumDataset,
    )

    await expect(
      loadDatasetCellTranscriptDistribution('https://example.test/xenium/', cellId, {
        getDataset,
        validateRangeSupport,
        limit: 50,
        minQv: 35,
        binCount: 2,
      }),
    ).resolves.toMatchObject({
      transcriptCount: 2,
      zCount: 2,
      minZ: 1,
      maxZ: 2,
    })

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/transcripts.parquet',
      { label: 'transcripts.parquet' },
    )
    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(transcriptsForCellId).toHaveBeenCalledWith(cellId, {
      limit: 50,
      minQv: 35,
    })
  })

  it('uses the transcript dataset cache by default', async () => {
    const cellId = intToCellId(1, 1)
    const transcriptsForCellId = vi.fn(async () =>
      Array.from({ length: 2 }, () => transcript(cellId, 1)),
    )
    vi.mocked(cachedXeniumTranscriptDataset).mockResolvedValue(
      { transcriptsForCellId } as unknown as XeniumDataset,
    )

    await loadDatasetCellTranscriptDistribution('https://example.test/xenium/', cellId, {
      validateRangeSupport: async () => undefined,
    })

    expect(cachedXeniumTranscriptDataset).toHaveBeenCalledWith(
      'https://example.test/xenium/',
    )
    expect(transcriptsForCellId).toHaveBeenCalledWith(cellId, {
      limit: CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
      minQv: 20,
    })
  })
})

function transcript(cellId: CellId, zLocation: number | undefined): DatasetTranscript {
  return {
    cellId,
    featureName: 'Actb',
    position: { x: micrometers(1), y: micrometers(2) },
    zLocation,
    qv: 35,
    overlapsNucleus: true,
    isGene: true,
  }
}
