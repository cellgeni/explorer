import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import {
  ROI_TRANSCRIPT_EXPORT_LIMIT,
  loadDatasetRoiTranscripts,
  loadPerGeneRoiTranscripts,
  type PerGeneTranscriptReader,
} from './roiTranscripts'
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
    vi.mocked(cachedXeniumTranscriptDataset).mockResolvedValue({
      transcriptsInBbox,
    } as unknown as XeniumDataset)

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

describe('per-gene ROI transcript export (Atera)', () => {
  const point = {
    id: '0,0:4',
    cellId: intToCellId(1, 1),
    cellAssignment: 'known' as const,
    featureName: 'UMOD',
    fovName: null,
    position: { x: micrometers(1.5), y: micrometers(3.5) },
    zLocation: 2,
    qv: 30,
    overlapsNucleus: false,
    isGene: true,
  }

  it('reads the selected genes in the box as export rows', async () => {
    const readTranscripts = vi.fn(async () => ({
      points: [point],
      groups: [],
      hitPointLimit: false,
    }))

    await expect(
      loadPerGeneRoiTranscripts(readTranscripts, bbox, { featureNames: ['UMOD'] }),
    ).resolves.toEqual([
      {
        cellId: point.cellId,
        featureName: 'UMOD',
        position: point.position,
        zLocation: 2,
        qv: 30,
        overlapsNucleus: false,
        isGene: true,
      },
    ])
    expect(readTranscripts).toHaveBeenCalledWith(bbox, {
      featureNames: ['UMOD'],
      pointLimit: ROI_TRANSCRIPT_EXPORT_LIMIT,
      groupLimit: 1,
      minQv: 20,
    })
  })

  it('keeps lasso points only, before the limit', async () => {
    const readTranscripts = vi.fn<PerGeneTranscriptReader>(async () => ({
      points: [],
      groups: [],
      hitPointLimit: false,
    }))
    const lasso: RoiSelection = {
      kind: 'lasso',
      bbox,
      points: [
        { x: micrometers(1), y: micrometers(3) },
        { x: micrometers(2), y: micrometers(3) },
        { x: micrometers(1), y: micrometers(4) },
      ],
    }

    await loadPerGeneRoiTranscripts(readTranscripts, lasso, {
      featureNames: ['UMOD'],
      limit: 10,
    })

    const options = readTranscripts.mock.calls[0]?.[1]
    expect(options).toMatchObject({ pointLimit: 10 })
    expect(options?.contains?.({ x: micrometers(1.2), y: micrometers(3.2) })).toBe(true)
    expect(options?.contains?.({ x: micrometers(1.9), y: micrometers(3.9) })).toBe(false)
  })

  it('asks for genes instead of reading every gene', async () => {
    const readTranscripts = vi.fn()

    await expect(
      loadPerGeneRoiTranscripts(readTranscripts, bbox, { featureNames: [] }),
    ).rejects.toThrow('Select genes to export their transcripts.')
    expect(readTranscripts).not.toHaveBeenCalled()
  })
})
