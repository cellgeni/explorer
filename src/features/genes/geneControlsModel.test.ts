import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import {
  EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
  IDLE_GENE_EXPRESSION_STATE,
  IDLE_GENE_PANEL_STATE,
  defaultGeneSetName,
  filterGeneOptions,
  geneSearchEmptyMessage,
  geneExpressionLoadFailed,
  geneExpressionLoadReady,
  geneExpressionLoadStarted,
  formatGeneExpressionTiming,
  formatGeneScaleValue,
  geneExpressionWaiting,
  genePanelLoadFailed,
  genePanelLoadReady,
  genePanelLoadStarted,
  geneExpressionModeLabel,
  geneExpressionBatchScaleKey,
  geneExpressionScaleDomainWith,
  geneExpressionScaleKeyFor,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  parseGeneExpressionColorScale,
  parseGeneExpressionDetailMode,
  roundGeneScaleValue,
  parseGeneExpressionScoreMode,
  formatGeneSetsLink,
  parseGeneSetSymbols,
  geneSetSymbolsNotice,
  matchGeneSetSymbols,
  unnamedGeneSetName,
  parseGeneSetsLink,
  rememberedGeneExpressionScale,
  savedGeneSetId,
  withGeneSetAt,
} from './geneControlsModel'

describe('geneControlsModel', () => {
  it('constructs gene panel transitions', () => {
    const error = { title: 'Unavailable' }

    expect(IDLE_GENE_PANEL_STATE).toEqual({ status: 'idle' })
    expect(genePanelLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(
      genePanelLoadReady('https://example.test/output', ['Gapdh', 'Actb', 'Gad1']),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb', 'Gad1', 'Gapdh'],
    })
    expect(
      genePanelLoadReady(
        'https://example.test/output',
        ['MYH7'],
        new Map([['MYH7', 'ENSG00000092054']]),
      ),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['MYH7'],
      aliases: new Map([['MYH7', 'ENSG00000092054']]),
    })
    expect(genePanelLoadReady('https://example.test/output', ['A'], new Map())).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['A'],
    })
    expect(genePanelLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

  it('constructs gene expression transitions', () => {
    const error = { title: 'Unavailable' }

    expect(IDLE_GENE_EXPRESSION_STATE).toEqual({ status: 'idle' })
    expect(geneExpressionWaiting('Zoom in')).toEqual({
      status: 'waiting',
      message: 'Zoom in',
    })
    expect(
      geneExpressionLoadStarted('https://example.test/output', ['Actb'], 'sampled', 100),
    ).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      genes: ['Actb'],
      mode: 'sampled',
      visibleCellCount: 100,
    })
    expect(
      geneExpressionLoadReady('https://example.test/output', ['Actb'], 'exact', 12, 100),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb'],
      mode: 'exact',
      cellCount: 12,
      visibleCellCount: 100,
    })
    expect(geneExpressionLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

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
        mode: 'sampled',
        cellCount: 25,
        visibleCellCount: 1000,
      }),
    ).toBe('Expression sample: 25 positive cells across 1,000 visible cells')
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
    expect(
      geneExpressionStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          genes: ['Actb'],
          mode: 'all-cells',
          cellCount: 1,
          visibleCellCount: 370,
        },
        'spots',
      ),
    ).toBe('Expression all spots: 1 positive spot across 370 slide spots')
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
    expect(geneExpressionModeLabel('all-cells', 'bins')).toBe('Expression all bins')
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

  it('writes small scale values to two significant digits, never "-0"', () => {
    // Fraction-normalised matrices hold scores near 0.001.
    expect(formatGeneScaleValue(0.0042)).toBe('0.0042')
    expect(formatGeneScaleValue(0.0123)).toBe('0.012')
    expect(formatGeneScaleValue(0.0007)).toBe('0.0007')
    expect(formatGeneScaleValue(-0.004)).toBe('-0.004')
    expect(formatGeneScaleValue(0.25)).toBe('0.25')
    expect(formatGeneScaleValue(12.34)).toBe('12.3')
    // The end fields show the same digits.
    expect(roundGeneScaleValue(0.0042)).toBe(0.0042)
    expect(roundGeneScaleValue(0.0123)).toBe(0.012)
    expect(roundGeneScaleValue(-0.004)).toBe(-0.004)
    expect(roundGeneScaleValue(4.123)).toBe(4.12)
    expect(roundGeneScaleValue(12.34)).toBe(12.3)
    expect(roundGeneScaleValue(Number.NaN)).toBe(0)
  })

  it('remembers one Gene scale top per Visium HD bin size', () => {
    const key = geneExpressionScaleKeyFor('https://example.test/hd', 'sum', ['Actb'])
    const bins = (binSizeMicrometers: number) => ({
      elements: [
        {
          id: 'bin',
          position: { x: micrometers(0), y: micrometers(0) },
          count: 1,
          binSizeMicrometers,
        },
      ],
    })
    const key16 = geneExpressionBatchScaleKey(key, bins(16))
    const key2 = geneExpressionBatchScaleKey(key, bins(2))
    expect(key16).not.toBe(key2)
    // Other platforms' batches keep the selection's key.
    expect(geneExpressionBatchScaleKey(key, { elements: [] })).toBe(key)

    // Zoomed out, a 2 µm selection reads 16 µm bins, which sum 64 2 µm bins.
    const zoomedOut = geneExpressionScaleDomainWith(
      EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
      key16,
      99,
      { top: 150, highest: 190 },
    )
    const zoomedIn = geneExpressionScaleDomainWith(zoomedOut, key2, 99, {
      top: 3,
      highest: 6,
    })
    expect(rememberedGeneExpressionScale(zoomedIn, key2, 99)).toMatchObject({
      top: 3,
      highest: 6,
    })
    // Zooming back out restores the 16 µm top.
    expect(rememberedGeneExpressionScale(zoomedIn, key16, 99)).toMatchObject({
      top: 150,
      highest: 190,
    })
    // A lower 16 µm batch read later does not lower it.
    const pannedOut = geneExpressionScaleDomainWith(zoomedIn, key16, 99, {
      top: 40,
      highest: 50,
    })
    expect(rememberedGeneExpressionScale(pannedOut, key16, 99).top).toBe(150)
    expect(rememberedGeneExpressionScale(pannedOut, key2, 99).top).toBe(3)
    // Other genes, or another percentile, start afresh.
    const otherGenes = geneExpressionScaleKeyFor('https://example.test/hd', 'sum', [
      'Gad1',
    ])
    const switched = geneExpressionScaleDomainWith(
      pannedOut,
      geneExpressionBatchScaleKey(otherGenes, bins(16)),
      99,
      { top: 9, highest: 9 },
    )
    expect(switched.otherBinSizes).toBeUndefined()
    expect(rememberedGeneExpressionScale(pannedOut, key16, 95)).toBe(
      EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
    )
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
  })

  it('lists the typed symbols that match no gene', () => {
    const match = matchGeneSetSymbols('gad1, Foo; ACTB foo BAR2', ['Actb', 'Gad1'])

    // Once each, as first typed, in typed order.
    expect(match).toEqual({ genes: ['Actb', 'Gad1'], unmatched: ['Foo', 'BAR2'] })
    expect(geneSetSymbolsNotice(match)).toBe(
      'Applied 2 genes. No gene in this dataset matches Foo or BAR2.',
    )
    expect(geneSetSymbolsNotice(matchGeneSetSymbols('Actb', ['Actb']))).toBeNull()
    expect(
      geneSetSymbolsNotice(matchGeneSetSymbols('x1 x2 x3 x4 x5 x6 x7 Actb', ['Actb'])),
    ).toBe(
      'Applied 1 gene. No gene in this dataset matches x1, x2, x3, x4, x5 and 2 more.',
    )
    expect(geneSetSymbolsNotice(matchGeneSetSymbols('nope', ['Actb']))).toBe(
      'No gene in this dataset matches nope. The selection is unchanged.',
    )
  })

  it('numbers an unnamed set whose default name a set of other genes has', () => {
    const saved = (genes: readonly string[]) => {
      const name = defaultGeneSetName(genes)
      return { id: savedGeneSetId(name), name, genes, scoreMode: 'sum' as const }
    }
    const proliferation = ['CCNB1', 'CDK1', 'MKI67', 'TOP2A']
    const other = ['CCNB1', 'CDK1', 'MKI67', 'PCNA']

    expect(unnamedGeneSetName(other, [])).toBe('CCNB1, CDK1, MKI67 +1')
    expect(unnamedGeneSetName(other, [saved(proliferation)])).toBe(
      'CCNB1, CDK1, MKI67 +1 (2)',
    )
    expect(
      unnamedGeneSetName(other, [
        saved(proliferation),
        {
          id: savedGeneSetId('CCNB1, CDK1, MKI67 +1 (2)'),
          name: 'CCNB1, CDK1, MKI67 +1 (2)',
          genes: ['CCNB1', 'CDK1', 'MKI67', 'AURKA'],
          scoreMode: 'sum',
        },
      ]),
    ).toBe('CCNB1, CDK1, MKI67 +1 (3)')
    // The same genes again take their set's name, and replace it.
    expect(unnamedGeneSetName(proliferation, [saved(proliferation)])).toBe(
      'CCNB1, CDK1, MKI67 +1',
    )
  })

  it('matches gene aliases in search and gene-set symbols', () => {
    const genes = ['MYH6', 'MYH7', 'NPPA']
    const aliases = new Map([
      ['MYH6', 'ENSG00000197616'],
      ['MYH7', 'ENSG00000092054'],
      ['NPPA', 'NPPB'],
    ])

    expect(filterGeneOptions(genes, 'ensg0000009', [], { aliases })).toEqual(['MYH7'])
    expect(filterGeneOptions(genes, 'ENSG', ['MYH6'], { aliases })).toEqual(['MYH7'])
    expect(filterGeneOptions(genes, 'ensg', [])).toEqual([])
    // A gene name wins over another gene's alias spelled the same way.
    expect(
      parseGeneSetSymbols(
        'ENSG00000092054 ensg00000197616 MYH7 nppb',
        [...genes, 'NPPB'],
        aliases,
      ),
    ).toEqual(['MYH6', 'MYH7', 'NPPB'])
    expect(defaultGeneSetName(['A', 'B', 'C', 'D'])).toBe('A, B, C +1')
  })

  it('ranks exact matches, then prefixes, alias prefixes and substrings', () => {
    const genes = ['NIPSNAP1', 'SNAP25', 'XSNAP', 'SNAP23', 'GAD1']
    const aliases = new Map([['GAD1', 'SNAPLIKE']])

    expect(filterGeneOptions(genes, 'snap', [], { aliases })).toEqual([
      'SNAP25',
      'SNAP23',
      'GAD1',
      'NIPSNAP1',
      'XSNAP',
    ])
    expect(filterGeneOptions(genes, 'snap25', [])).toEqual(['SNAP25'])
    expect(filterGeneOptions(genes, 'snaplike', [], { aliases })).toEqual(['GAD1'])
    expect(filterGeneOptions(genes, 'snap', ['SNAP25'], { limit: 2 })).toEqual([
      'SNAP23',
      'NIPSNAP1',
    ])
  })

  it('says when a search finds only genes that are already selected', () => {
    expect(geneSearchEmptyMessage('snap25', ['SNAP25'], { noun: 'genes' })).toBe(
      'SNAP25 is already selected',
    )
    expect(
      geneSearchEmptyMessage('snap', ['SNAP23', 'SNAP25', 'SNAP29', 'SNAP91'], {
        noun: 'genes',
      }),
    ).toBe('SNAP23, SNAP25, SNAP29 and 1 more are already selected')
    expect(geneSearchEmptyMessage('zzz', ['SNAP25'], { noun: 'features' })).toBe(
      'No matching features',
    )
    expect(geneSearchEmptyMessage('', [], { noun: 'genes' })).toBe('No matching genes')
  })

  it('puts a removed gene set back at its place, unless it is back already', () => {
    const set = (id: string, name: string) => ({
      id,
      name,
      genes: ['Actb'],
      scoreMode: 'sum' as const,
    })
    const remaining = [set('a', 'First'), set('c', 'Third')]

    expect(
      withGeneSetAt(remaining, set('b', 'Second'), 1).map((geneSet) => geneSet.id),
    ).toEqual(['a', 'b', 'c'])
    expect(withGeneSetAt(remaining, set('b', 'Second'), 9).at(-1)?.id).toBe('b')
    // A set saved since under the same name wins.
    expect(withGeneSetAt(remaining, set('b', 'third'), 0)).toBe(remaining)
  })

  it('writes saved gene sets to the link and reads them back', () => {
    const sets = [
      {
        id: savedGeneSetId('Actb, Gad1'),
        name: 'Actb, Gad1',
        genes: ['Actb', 'Gad1'],
        scoreMode: 'mean' as const,
      },
      {
        id: savedGeneSetId('T|B; 100%'),
        name: 'T|B; 100%',
        genes: ['CD3E', 'MS4A1'],
        scoreMode: 'sum' as const,
      },
    ]
    const link = formatGeneSetsLink(sets)

    expect(link).toBe('Actb%2C Gad1|mean|Actb,Gad1;T%7CB%3B 100%25|sum|CD3E,MS4A1')
    expect(parseGeneSetsLink(link)).toEqual(sets)
    expect(formatGeneSetsLink([])).toBeUndefined()
    expect(parseGeneSetsLink(undefined)).toEqual([])
  })

  it('drops link gene sets without a name or genes, and repeated names', () => {
    expect(
      parseGeneSetsLink(
        'Markers|z-score|Actb;|sum|Gad1;Empty|sum|;markers|sum|Sst;Odd|nope|Vip',
      ),
    ).toEqual([
      { id: 'gene-set:markers', name: 'Markers', genes: ['Actb'], scoreMode: 'z-score' },
      // An unknown score reads as the default.
      { id: 'gene-set:odd', name: 'Odd', genes: ['Vip'], scoreMode: 'sum' },
    ])
  })
})
