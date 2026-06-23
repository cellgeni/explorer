import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { RoiSelectionInput } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/xeniumDataset'
import {
  filterCellsForCircle,
  magicLensDetailQueryKey,
  magicLensElementLabel,
  magicLensPrimaryMetricLabel,
  magicLensScopeLabel,
  magicLensStatusCopy,
  normalizeMagicLensMinQv,
  normalizeMagicLensRadius,
  parseMagicLensScope,
  resolveMagicLensSelection,
  summarizeMagicLensCells,
  summarizeMagicLensExpressionBins,
  summarizeMagicLensExpressionProfile,
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

  it('summarizes Visium HD expression bins with expression labels', () => {
    const summary = summarizeMagicLensExpressionBins(
      3,
      {
        cells: [
          {
            id: 'BC-1',
            position: { x: micrometers(0), y: micrometers(0) },
            count: 6,
          },
          {
            id: 'BC-2',
            position: { x: micrometers(1), y: micrometers(1) },
            count: 2,
          },
        ],
        genes: ['A2M', 'GAD1'],
        geneCounts: [
          { gene: 'A2M', count: 6 },
          { gene: 'GAD1', count: 2 },
        ],
      },
      ['A2M'],
      { hitLimit: true },
    )

    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 8,
      cellCount: 3,
      geneCount: 2,
      selectedGeneTranscriptCount: 6,
      hitLimit: true,
    })
    expect(summary.topGenes).toEqual([
      { gene: 'A2M', count: 6, percentTotal: 75, selected: true },
      { gene: 'GAD1', count: 2, percentTotal: 25, selected: false },
    ])
    expect(magicLensPrimaryMetricLabel(summary)).toBe('UMIs')
    expect(magicLensElementLabel(summary)).toBe('Bins')
    expect(
      magicLensStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/visium',
          scope: 'viewport',
          summary,
        },
        'viewport',
        'ready',
        true,
        false,
      ),
    ).toBe('8 UMIs')
  })

  it('summarizes Visium HD all-gene expression profiles for magic lens areas', () => {
    const summary = summarizeMagicLensExpressionProfile(
      2,
      {
        totalCount: 12,
        hitGeneLimit: true,
        genes: [
          { gene: 'A2M', count: 7, percentTotal: 58.333 },
          { gene: 'GAD1', count: 5, percentTotal: 41.667 },
        ],
      },
      [],
      {},
    )

    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 12,
      cellCount: 2,
      geneCount: 2,
      selectedGeneTranscriptCount: 0,
      hitLimit: true,
    })
    expect(summary.topGenes).toEqual([
      { gene: 'A2M', count: 7, percentTotal: 58.333, selected: false },
      { gene: 'GAD1', count: 5, percentTotal: 41.667, selected: false },
    ])
  })
})
