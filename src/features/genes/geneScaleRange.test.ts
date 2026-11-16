import { describe, expect, it } from 'vitest'
import { geneExpressionIntensity } from '../../rendering/deckLayerColors'
import {
  AUTO_GENE_SCALE_RANGE,
  formatGeneScaleRange,
  geneScaleBounds,
  geneScaleMidpoint,
  parseGeneScaleRange,
} from './geneScaleRange'

describe('gene scale range', () => {
  it('fills Auto ends from 0 and the highest score', () => {
    expect(geneScaleBounds(AUTO_GENE_SCALE_RANGE, 92)).toEqual({ min: 0, max: 92 })
    expect(geneScaleBounds({ min: 5, max: null }, 92)).toEqual({ min: 5, max: 92 })
    expect(geneScaleBounds({ min: null, max: 20 }, 92)).toEqual({ min: 0, max: 20 })
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
