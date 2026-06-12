import { describe, expect, it } from 'vitest'
import {
  defaultGeneSetName,
  filterGeneOptions,
  formatGeneExpressionTiming,
  formatGeneScaleValue,
  geneExpressionModeLabel,
  geneExpressionScaleKeyFor,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  parseGeneExpressionScoreMode,
  parseGeneSetSymbols,
} from './geneControlsModel'

describe('geneControlsModel', () => {
  it('formats panel and expression statuses', () => {
    expect(genePanelStatusCopy({ status: 'idle' })).toBe('Idle')
    expect(
      genePanelStatusCopy({
        status: 'ready',
        url: 'https://example.test/output',
        genes: ['Actb', 'Gad1'],
      }),
    ).toBe('2 genes')

    expect(
      geneExpressionStatusCopy({
        status: 'loading',
        url: 'https://example.test/output',
        genes: ['Actb'],
        mode: 'sampled',
        visibleCellCount: 100,
      }),
    ).toBe('Expression sample: Actb')
    expect(
      geneExpressionStatusCopy({
        status: 'ready',
        url: 'https://example.test/output',
        genes: ['Actb'],
        mode: 'overview-sampled',
        cellCount: 25,
        visibleCellCount: 1000,
      }),
    ).toBe('Expression overview: 25 positive cells across 1,000 slide cells')
    expect(
      geneExpressionStatusCopy({
        status: 'ready',
        url: 'https://example.test/output',
        genes: ['Actb'],
        mode: 'all-cells',
        cellCount: 25,
        visibleCellCount: 1000,
      }),
    ).toBe('Expression all cells: 25 positive cells across 1,000 slide cells')
    expect(geneExpressionStatusCopy({ status: 'waiting', message: 'Zoom in' })).toBe(
      'Zoom in',
    )
    expect(
      geneExpressionStatusCopy({
        status: 'error',
        url: 'https://example.test/output',
        error: { title: 'Unavailable' },
      }),
    ).toBe('Expression failed - Unavailable')
  })

  it('formats modes, timings, scales, and parser values', () => {
    expect(geneExpressionModeLabel('exact')).toBe('Expression')
    expect(geneExpressionModeLabel('all-cells')).toBe('Expression all cells')
    expect(
      formatGeneExpressionTiming({
        totalMs: 10.4,
        viewportCellsMs: 2.1,
        matrixReadMs: 3.7,
        scoreCellsMs: 4.4,
      }),
    ).toBe('total 10 ms, viewport 2 ms, matrix 4 ms, score 4 ms')
    expect(formatGeneExpressionTiming(undefined)).toBe('timing unavailable')
    expect(
      geneExpressionScaleKeyFor('https://example.test', 'mean', ['Actb', 'Gad1']),
    ).toBe('https://example.test::mean::Actb|Gad1')
    expect(parseGeneExpressionColorScale('viridis')).toBe('viridis')
    expect(parseGeneExpressionColorScale('rainbow')).toBeUndefined()
    expect(parseGeneExpressionScoreMode('z-score')).toBe('z-score')
    expect(parseGeneExpressionDetailMode('exact-region')).toBe('exact-region')
    expect(parseGeneExpressionDetailMode('all-cells')).toBe('all-cells')
    expect(formatGeneScaleValue(0)).toBe('0')
    expect(formatGeneScaleValue(4.123)).toBe('4.12')
  })

  it('filters gene options and parses saved gene-set symbols', () => {
    expect(filterGeneOptions(['Actb', 'Gad1', 'Gapdh'], 'ga', ['Gad1'])).toEqual([
      'Gapdh',
    ])
    expect(filterGeneOptions(['Actb', 'Gad1', 'Gapdh'], '', [], { limit: 2 })).toEqual([
      'Actb',
      'Gad1',
    ])
    expect(parseGeneSetSymbols('gad1, ACTB; missing actb', ['Actb', 'Gad1'])).toEqual([
      'Actb',
      'Gad1',
    ])
    expect(defaultGeneSetName([])).toBe('Selected genes')
    expect(defaultGeneSetName(['A', 'B', 'C', 'D'])).toBe('A, B, C +1')
  })
})
