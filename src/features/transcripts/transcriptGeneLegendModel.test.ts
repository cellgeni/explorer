import { describe, expect, it } from 'vitest'
import { transcriptFeatureColor } from '../../rendering/transcriptColors'
import {
  OTHER_TRANSCRIPT_GENES_COLOR,
  OTHER_TRANSCRIPT_GENES_ID,
  TRANSCRIPT_GENE_PALETTE,
  assignTranscriptGeneColors,
  countTranscriptsByGene,
  genesInHiddenSets,
  hashedTranscriptGeneColor,
  hexToTranscriptColor,
  transcriptGeneColor,
  transcriptGeneLegend,
  transcriptGeneSetGrouping,
  transcriptGeneSetLegend,
} from './transcriptGeneLegendModel'

describe('transcriptGeneLegendModel', () => {
  it('gives selected genes their own colours, others the old colour from the name', () => {
    const assigned = assignTranscriptGeneColors({}, ['GFAP', 'SNAP25'])

    expect(transcriptGeneColor('SNAP25', assigned, {})).toBe(TRANSCRIPT_GENE_PALETTE[1])
    expect(transcriptGeneColor('MBP', assigned, {})).toBe(
      hashedTranscriptGeneColor('MBP'),
    )
    expect(hexToTranscriptColor(hashedTranscriptGeneColor('MBP'))).toEqual(
      transcriptFeatureColor('MBP'),
    )
    expect(transcriptGeneColor('GFAP', assigned, { GFAP: '#123456' })).toBe('#123456')
  })

  it('keeps a selected gene’s colour as genes are added and removed', () => {
    const first = assignTranscriptGeneColors({}, ['GFAP', 'SNAP25'])
    // AQP4 sorts first but takes the next free colour.
    const added = assignTranscriptGeneColors(first, ['AQP4', 'GFAP', 'SNAP25'])

    expect(added).toEqual({
      GFAP: TRANSCRIPT_GENE_PALETTE[0],
      SNAP25: TRANSCRIPT_GENE_PALETTE[1],
      AQP4: TRANSCRIPT_GENE_PALETTE[2],
    })

    // A removed gene's colour is free again.
    const removed = assignTranscriptGeneColors(added, ['AQP4', 'SNAP25'])
    expect(assignTranscriptGeneColors(removed, ['AQP4', 'MBP', 'SNAP25']).MBP).toBe(
      TRANSCRIPT_GENE_PALETTE[0],
    )
  })

  it('turns hex into a deck.gl colour', () => {
    expect(hexToTranscriptColor('#ff8000')).toEqual([255, 128, 0, 235])
    expect(hexToTranscriptColor('red')).toEqual([76, 211, 194, 235])
  })

  it('counts points per gene', () => {
    const counts = countTranscriptsByGene([
      { featureName: 'A' },
      { featureName: 'B' },
      { featureName: 'A' },
    ])
    expect([...counts]).toEqual([
      ['A', 2],
      ['B', 1],
    ])
  })

  it('lists the selected genes in order under Selected genes', () => {
    const legend = transcriptGeneLegend({
      assigned: assignTranscriptGeneColors({}, ['SNAP25', 'GFAP']),
      counts: new Map([['GFAP', 4]]),
      filterMode: 'selected',
      hiddenGenes: new Set(['SNAP25']),
      overrides: {},
      selectedGenes: ['SNAP25', 'GFAP'],
    })

    expect(legend).toEqual({
      items: [
        { gene: 'SNAP25', color: TRANSCRIPT_GENE_PALETTE[0], visible: false, count: 0 },
        { gene: 'GFAP', color: TRANSCRIPT_GENE_PALETTE[1], visible: true, count: 4 },
      ],
      moreCount: 0,
    })
  })

  it('lists the genes with most points under All features', () => {
    const legend = transcriptGeneLegend({
      assigned: {},
      counts: new Map([
        ['B', 2],
        ['A', 2],
        ['C', 9],
      ]),
      filterMode: 'all',
      hiddenGenes: new Set(),
      overrides: {},
      selectedGenes: [],
      limit: 2,
    })

    expect(legend.items.map((item) => item.gene)).toEqual(['C', 'A'])
    expect(legend.moreCount).toBe(1)
  })

  it('groups genes by the first saved set listing them, others in Other genes', () => {
    const grouping = transcriptGeneSetGrouping(
      [
        { id: 'gene-set:a', name: 'A', genes: ['GFAP', 'AQP4'] },
        { id: 'gene-set:b', name: 'B', genes: ['AQP4', 'SNAP25'] },
      ],
      { 'gene-set:b': '#123456' },
    )

    expect(grouping.groupOf('AQP4')).toMatchObject({ id: 'gene-set:a', label: 'A' })
    expect(grouping.groupOf('SNAP25')).toMatchObject({ color: '#123456', geneCount: 2 })
    expect(grouping.groupOf('MBP')).toMatchObject({
      id: OTHER_TRANSCRIPT_GENES_ID,
      color: OTHER_TRANSCRIPT_GENES_COLOR,
    })
    expect(grouping.groups.map((group) => [group.label, group.color])).toEqual([
      ['A', TRANSCRIPT_GENE_PALETTE[0]],
      ['B', '#123456'],
      ['Other genes', OTHER_TRANSCRIPT_GENES_COLOR],
    ])

    const counts = new Map([
      ['GFAP', 3],
      ['AQP4', 2],
      ['MBP', 1],
    ])
    const legend = transcriptGeneSetLegend({
      counts,
      grouping,
      hiddenSets: new Set(['gene-set:b']),
    })

    // Every set is listed, empty or not; Other genes only with points.
    expect(legend.items.map((item) => [item.gene, item.count, item.visible])).toEqual([
      ['A', 5, true],
      ['B', 0, false],
      ['Other genes', 1, true],
    ])
    expect(
      transcriptGeneSetLegend({
        counts: new Map([['GFAP', 1]]),
        grouping,
        hiddenSets: new Set(),
      }).items.map((item) => item.gene),
    ).toEqual(['A', 'B'])
    expect([...genesInHiddenSets(counts, grouping, new Set(['gene-set:a']))]).toEqual([
      'GFAP',
      'AQP4',
    ])
  })
})
