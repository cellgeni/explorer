import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import { ROI_TRANSCRIPT_EXPORT_LIMIT, loadDatasetRoiTranscripts } from './roiTranscripts'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { RoiSelection } from './roiSelection'
import type { XeniumDataset } from '../datasets/xeniumDataset'

vi.mock('./xeniumDatasetCache', () => ({
  cachedXeniumTranscriptDataset: vi.fn(),
}))

const bbox = {
  minX: micrometers(1),
  maxX: micrometers(2),
  minY: micrometers(3),
  maxY: micrometers(4),
}

describe('dataset ROI transcript loader', () => {
  beforeEach(() => {
    vi.mocked(cachedXeniumTranscriptDataset).mockReset()
  })

  it('validates range support and delegates to the dataset transcript query', async () => {
    const cellId = intToCellId(1, 1)
    const validateRangeSupport = vi.fn(async () => undefined)
    const transcriptsInBbox = vi.fn(async () => [
      {
        cellId,
        featureName: 'Actb',
        position: { x: micrometers(1), y: micrometers(3) },
        zLocation: 0,
        qv: 30,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    const getDataset = vi.fn(
      async () => ({ transcriptsInBbox }) as unknown as XeniumDataset,
    )

    await expect(
      loadDatasetRoiTranscripts('https://example.test/xenium/', bbox, {
        getDataset,
        validateRangeSupport,
      }),
    ).resolves.toHaveLength(1)

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/transcripts.parquet',
      { label: 'transcripts.parquet' },
    )
    expect(getDataset).toHaveBeenCalledWith('https://example.test/xenium/')
    expect(transcriptsInBbox).toHaveBeenCalledWith(bbox, {
      limit: ROI_TRANSCRIPT_EXPORT_LIMIT,
      minQv: 20,
    })
  })

  it('passes custom transcript limits and QV thresholds', async () => {
    const transcriptsInBbox = vi.fn(async () => [])
    const getDataset = vi.fn(
      async () => ({ transcriptsInBbox }) as unknown as XeniumDataset,
    )

    await loadDatasetRoiTranscripts('https://example.test/xenium/', bbox, {
      getDataset,
      limit: 500,
      minQv: 35,
      validateRangeSupport: async () => undefined,
    })

    expect(transcriptsInBbox).toHaveBeenCalledWith(bbox, {
      limit: 500,
      minQv: 35,
    })
  })

  it('delegates lasso ROI transcript export to the exact selection query', async () => {
    const transcriptsForSelection = vi.fn(async () => [])
    const getDataset = vi.fn(
      async () => ({ transcriptsForSelection }) as unknown as XeniumDataset,
    )
    const selection: RoiSelection = {
      kind: 'lasso',
      bbox,
      points: [
        { x: micrometers(1), y: micrometers(3) },
        { x: micrometers(2), y: micrometers(3) },
        { x: micrometers(2), y: micrometers(4) },
      ],
    }

    await loadDatasetRoiTranscripts('https://example.test/xenium/', selection, {
      getDataset,
      minQv: 35,
      validateRangeSupport: async () => undefined,
    })

    expect(transcriptsForSelection).toHaveBeenCalledWith(selection, {
      limit: ROI_TRANSCRIPT_EXPORT_LIMIT,
      minQv: 35,
    })
  })

  it('uses a separate transcript dataset cache by default', async () => {
    const transcriptsInBbox = vi.fn(async () => [])
    vi.mocked(cachedXeniumTranscriptDataset).mockResolvedValue(
      { transcriptsInBbox } as unknown as XeniumDataset,
    )

    await loadDatasetRoiTranscripts('https://example.test/xenium/', bbox, {
      validateRangeSupport: async () => undefined,
    })

    expect(cachedXeniumTranscriptDataset).toHaveBeenCalledWith(
      'https://example.test/xenium/',
    )
    expect(transcriptsInBbox).toHaveBeenCalledWith(bbox, {
      limit: ROI_TRANSCRIPT_EXPORT_LIMIT,
      minQv: 20,
    })
  })
})
