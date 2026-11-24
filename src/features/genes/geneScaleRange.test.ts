import { describe, expect, it } from 'vitest'
import { geneExpressionIntensity } from '../../rendering/deckLayerColors'
import {
  AUTO_GENE_SCALE_RANGE,
  formatGeneScaleRange,
  formatPercentile,
  geneScaleBounds,
  geneScaleMidpoint,
  geneScalePercentile,
  geneScoreSpread,
  parseGeneScaleRange,
} from './geneScaleRange'

describe('gene scale range', () => {
  it('fills Auto ends from 0 and the highest score', () => {
    expect(geneScaleBounds(AUTO_GENE_SCALE_RANGE, 92)).toEqual({ min: 0, max: 92 })
    expect(geneScaleBounds({ min: 5, max: null }, 92)).toEqual({ min: 5, max: 92 })
    expect(geneScaleBounds({ min: null, max: 20 }, 92)).toEqual({ min: 0, max: 20 })
  })

  it('runs from 0 where a kept bottom is not below the data’s top', () => {
    // Set to 3 on a gene whose top was 20, kept for one whose top is 1.5.
    expect(geneScaleBounds({ min: 3, max: null }, 1.5)).toEqual({ min: 0, max: 1.5 })
    expect(geneScaleBounds({ min: 2, max: { percentile: 95 } }, 2)).toEqual({
      min: 0,
      max: 2,
    })
    // It applies again where it fits, and a bottom below 0 always does.
    expect(geneScaleBounds({ min: 3, max: null }, 20)).toEqual({ min: 3, max: 20 })
    expect(geneScaleBounds({ min: -3, max: null }, 0)).toEqual({ min: -3, max: 0 })
  })

  it('takes the nearest rank in whole numbers', () => {
    const scores = (count: number) =>
      Array.from({ length: count }, (_v, index) => index + 1)

    // 0.999 * 1000 and 0.07 * 100 are just above 999 and 7 in floating point.
    expect(geneScoreSpread(scores(1000), 99.9).top).toBe(999)
    expect(geneScoreSpread(scores(100), 7).top).toBe(7)
    expect(geneScoreSpread(scores(50), 14).top).toBe(7)
    expect(geneScoreSpread(scores(25), 28).top).toBe(7)
    expect(geneScoreSpread(scores(1000), 99.95).top).toBe(1000)
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
    // At the 95th of 1 to 100: the 95th score.
    const oneToHundred = Array.from({ length: 100 }, (_value, index) => index + 1)
    expect(geneScoreSpread(oneToHundred, 95)).toEqual({ top: 95, highest: 100 })
    expect(geneScoreSpread(oneToHundred)).toEqual({ top: 99, highest: 100 })
    // At the 99th with 100 or fewer cells, the highest score.
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
    // An empty bottom is 0, so the top must be above it.
    expect(parseGeneScaleRange(',0')).toBeUndefined()
    expect(parseGeneScaleRange(',-3')).toBeUndefined()
    expect(parseGeneScaleRange('-5,-3')).toEqual({ min: -5, max: -3 })
    expect(parseGeneScaleRange('a,5')).toBeUndefined()
    expect(parseGeneScaleRange('5')).toBeUndefined()
  })

  it('reads and writes a percentile top, geneRange=,p95', () => {
    const p95 = { min: null, max: { percentile: 95 } }

    expect(parseGeneScaleRange(',p95')).toEqual(p95)
    expect(formatGeneScaleRange(p95)).toBe(',p95')
    expect(parseGeneScaleRange('2,p99.5')).toEqual({ min: 2, max: { percentile: 99.5 } })
    expect(parseGeneScaleRange(',p100')).toEqual({ min: null, max: { percentile: 100 } })
    for (const value of [',p0', ',p101', ',95p', ',P95', ',p', 'p5,10']) {
      expect(parseGeneScaleRange(value)).toBeUndefined()
    }

    expect(geneScalePercentile(p95)).toBe(95)
    expect(geneScalePercentile(AUTO_GENE_SCALE_RANGE)).toBe(99)
    expect(geneScalePercentile({ min: null, max: 40 })).toBe(99)
    // A percentile top is the data's, like Auto; a score is itself.
    expect(geneScaleBounds(p95, 7)).toEqual({ min: 0, max: 7 })
    expect(geneScaleBounds({ min: 1, max: 40 }, 7)).toEqual({ min: 1, max: 40 })
  })

  it('names percentiles', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 95, 99, 100, 99.5].map(formatPercentile)).toEqual(
      [
        '1st',
        '2nd',
        '3rd',
        '4th',
        '11th',
        '12th',
        '13th',
        '21st',
        '95th',
        '99th',
        '100th',
        '99.5th',
      ],
    )
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
