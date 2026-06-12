import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { RoiSelectionInput } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/xeniumDataset'
import {
  filterCellsForCircle,
  magicLensDetailQueryKey,
  magicLensScopeLabel,
  magicLensStatusCopy,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  parseMagicLensScope,
  resolveMagicLensSelection,
  summarizeMagicLensCells,
} from './magicLensModel'

const cells: readonly DatasetCell[] = [
  {
    id: asCellId('aaaaaaaa-1'),
    position: { x: micrometers(0), y: micrometers(0) },
    transcriptCount: 10,
  },
  {
    id: asCellId('bbbbbbbb-2'),
    position: { x: micrometers(20), y: micrometers(0) },
    transcriptCount: 5,
  },
]

const stats: RoiGeneStats = {
  genes: [
    {
      gene: 'Actb',
      count: 7,
      detectedCells: 1,
      percentCells: 50,
      meanPerCell: 7,
      percentTotal: 70,
    },
    {
      gene: 'Gad1',
      count: 3,
      detectedCells: 1,
      percentCells: 50,
      meanPerCell: 3,
      percentTotal: 30,
    },
  ],
  cellCount: 2,
  sampledCellCount: 2,
  totalCount: 10,
  hitCellLimit: false,
}

describe('magicLensModel', () => {
  it('resolves scope labels and selections', () => {
    const roiSelection: RoiSelectionInput = {
      minX: micrometers(1),
      minY: micrometers(2),
      maxX: micrometers(3),
      maxY: micrometers(4),
    }

    expect(magicLensScopeLabel('cursor')).toBe('Cursor')
    expect(magicLensScopeLabel('viewport')).toBe('Viewport')
    expect(magicLensScopeLabel('roi')).toBe('ROI')
    expect(parseMagicLensScope('cursor')).toBe('cursor')
    expect(parseMagicLensScope('viewport')).toBe('viewport')
    expect(parseMagicLensScope('roi')).toBe('roi')
    expect(parseMagicLensScope('bad')).toBeNull()
    expect(resolveMagicLensSelection('roi', null, roiSelection)).toBe(roiSelection)
    expect(
      resolveMagicLensSelection('cursor', { bbox: roiSelection }, roiSelection),
    ).toBeNull()
    expect(resolveMagicLensSelection('viewport', { bbox: roiSelection }, null)).toBe(
      roiSelection,
    )
  })

  it('summarizes cells and filters circular selections', () => {
    expect(summarizeMagicLensCells(cells, stats, ['actb'], { hitLimit: true })).toEqual({
      transcriptCount: 15,
      cellCount: 2,
      geneCount: 2,
      selectedGeneTranscriptCount: 7,
      topGenes: [
        { gene: 'Actb', count: 7, percentTotal: 70, selected: true },
        { gene: 'Gad1', count: 3, percentTotal: 30, selected: false },
      ],
      hitLimit: true,
    })
    expect(
      filterCellsForCircle(cells, {
        center: { x: micrometers(0), y: micrometers(0) },
        radiusMicrometers: 10,
      }),
    ).toEqual([cells[0]])
  })

  it('formats status, query keys, and normalized controls', () => {
    expect(
      magicLensStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          scope: 'cursor',
          summary: summarizeMagicLensCells(cells, stats, [], {}),
        },
        'cursor',
        'ready',
        true,
        true,
      ),
    ).toBe('15 transcripts')
    expect(magicLensStatusCopy({ status: 'idle' }, 'cursor', 'ready', true, false)).toBe(
      'Lens off',
    )
    expect(magicLensStatusCopy({ status: 'idle' }, 'roi', 'ready', false, true)).toBe(
      'ROI required',
    )
    expect(
      magicLensDetailQueryKey(
        {
          center: { x: micrometers(9), y: micrometers(17) },
          radiusMicrometers: 44.4,
        },
        19,
        ['Gad1', 'actb'],
      ),
    ).toBe('2:4:44:19:actb,gad1')
    expect(normalizeMagicLensRadius(Number.NaN)).toBe(80)
    expect(normalizeMagicLensRadius(1_000)).toBe(500)
    expect(normalizeMagicLensMinQv(-5)).toBe(0)
    expect(normalizeMagicLensMinQv(Number.NaN)).toBe(20)
  })
})
