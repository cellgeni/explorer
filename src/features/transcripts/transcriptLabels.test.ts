import { describe, expect, it } from 'vitest'
import {
  transcriptAggregateRenderedLabel,
  transcriptCapabilityLabel,
} from './transcriptLabels'

describe('transcriptLabels', () => {
  it('formats aggregate and capability labels', () => {
    expect(transcriptAggregateRenderedLabel([])).toBe('0 squares')
    expect(transcriptCapabilityLabel({ nativeZarr: true, rawParquet: true })).toBe(
      'Native LOD + exact',
    )
    expect(transcriptCapabilityLabel({ nativeZarr: true, rawParquet: false })).toBe(
      'Native LOD',
    )
    expect(transcriptCapabilityLabel({ nativeZarr: false, rawParquet: true })).toBe(
      'Exact only',
    )
    expect(transcriptCapabilityLabel({ nativeZarr: false, rawParquet: false })).toBe(
      'No transcripts',
    )
  })

  it('labels per-gene transcript outputs', () => {
    const perGene = { rawParquet: false, nativeZarr: true, geneRanges: true }

    expect(transcriptCapabilityLabel(perGene)).toBe('Per-gene LOD + exact')
    expect(transcriptCapabilityLabel({ ...perGene, geneRanges: false })).toBe(
      'Per-gene LOD',
    )
    expect(transcriptCapabilityLabel({ ...perGene, nativeZarr: false })).toBe(
      'Per-gene exact',
    )
    expect(
      transcriptCapabilityLabel({ ...perGene, nativeZarr: false, geneRanges: false }),
    ).toBe('No transcripts')
  })
})
