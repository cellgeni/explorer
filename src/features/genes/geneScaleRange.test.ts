import { describe, expect, it } from 'vitest'
import { geneExpressionIntensity } from '../../rendering/deckLayerColors'
import {
  AUTO_GENE_SCALE_RANGE,
  formatGeneScaleRange,
  geneScaleBounds,
  geneScaleMidpoint,
  geneScoreSpread,
  parseGeneScaleRange,
} from './geneScaleRange'

describe('gene scale range', () => {
  it('fills Auto ends from 0 and the highest score', () => {
    expect(geneScaleBounds(AUTO_GENE_SCALE_RANGE, 92)).toEqual({ min: 0, max: 92 })
    expect(geneScaleBounds({ min: 5, max: null }, 92)).toEqual({ min: 5, max: 92 })
    expect(geneScaleBounds({ min: null, max: 20 }, 92)).toEqual({ min: 0, max: 20 })
  })

  it('puts the Auto top at the 99th percentile of the scores above 0', () => {
    // 990 cells at 1 to 10 and 10 outliers at 100: the 990th of 1,000.
    const scores = [
      ...Array.from({ length: 990 }, (_value, index) => (index % 10) + 1),
      ...Array.from({ length: 10 }, () => 100),
      // Zeros do not count: otherwise a sparse gene's top would be 0.
      ...Array.from({ length: 50_000 }, () => 0),
    ]
    expect(geneScoreSpread(scores)).toEqual({ top: 10, highest: 100 })
    expect(geneScoreSpread(scores.slice().reverse())).toEqual({ top: 10, highest: 100 })
    // With 100 or fewer cells, the highest score.
    expect(geneScoreSpread([0, 2, 7, 3])).toEqual({ top: 7, highest: 7 })
    expect(geneScoreSpread([0, -1.5, 0])).toEqual({ top: 0, highest: 0 })
    expect(geneScoreSpread([])).toEqual({ top: 0, highest: 0 })
  })

  it('matches a sort on many tied and spread scores', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return seed / 2_147_483_647
    }

    for (const size of [101, 1_000, 30_001]) {
      const scores = Array.from({ length: size }, () =>
        random() < 0.5 ? Math.floor(random() * 6) : random() * 40,
      )
      const positive = scores.filter((score) => score > 0).sort((a, b) => a - b)
      const expected = positive[Math.ceil(0.99 * positive.length) - 1]

      expect(geneScoreSpread(scores).top).toBe(expected)
    }
  })

  it('puts the gradient middle a quarter of the way up the range', () => {
    expect(geneScaleMidpoint({ min: 0, max: 8 })).toBe(2)
    expect(geneScaleMidpoint({ min: 4, max: 12 })).toBe(6)
  })

  it('reads and writes geneRange= values', () => {
    // Written only when it undoes a dataset manifest's range.
    expect(formatGeneScaleRange(AUTO_GENE_SCALE_RANGE)).toBe(',')
    expect(parseGeneScaleRange(',')).toEqual(AUTO_GENE_SCALE_RANGE)
    expect(formatGeneScaleRange({ min: 1.5, max: 20 })).toBe('1.5,20')
    expect(formatGeneScaleRange({ min: null, max: 20 })).toBe(',20')
    expect(parseGeneScaleRange('1.5,20')).toEqual({ min: 1.5, max: 20 })
    expect(parseGeneScaleRange(',20')).toEqual({ min: null, max: 20 })
    expect(parseGeneScaleRange('-1,')).toEqual({ min: -1, max: null })
    expect(parseGeneScaleRange('20,5')).toBeUndefined()
    expect(parseGeneScaleRange('a,5')).toBeUndefined()
    expect(parseGeneScaleRange('5')).toBeUndefined()
  })
})

describe('geneExpressionIntensity', () => {
  it('takes the square root of the share of the range, clamped', () => {
    expect(geneExpressionIntensity(4, 0, 16)).toBe(0.5)
    expect(geneExpressionIntensity(6, 2, 18)).toBe(0.5)
    expect(geneExpressionIntensity(1, 2, 18)).toBe(0)
    expect(geneExpressionIntensity(40, 2, 18)).toBe(1)
  })

  it('splits at the bottom of an empty range', () => {
    expect(geneExpressionIntensity(3, 3, 3)).toBe(0)
    expect(geneExpressionIntensity(4, 3, 3)).toBe(1)
  })
})
