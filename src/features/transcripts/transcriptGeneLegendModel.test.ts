import { describe, expect, it } from 'vitest'
import { transcriptFeatureColor } from '../../rendering/transcriptColors'
import {
  TRANSCRIPT_GENE_PALETTE,
  assignTranscriptGeneColors,
  countTranscriptsByGene,
  hashedTranscriptGeneColor,
  hexToTranscriptColor,
  transcriptGeneColor,
  transcriptGeneLegend,
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
})
