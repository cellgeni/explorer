import { describe, expect, it } from 'vitest'
import { slug } from './slug'

describe('slug', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(slug('T cells')).toBe('t-cells')
    expect(slug('Cluster 10')).toBe('cluster-10')
    expect(slug('ROI_1')).toBe('roi-1')
  })

  it('collapses runs of punctuation and whitespace into one hyphen', () => {
    expect(slug('CD4+ / CD8+   T-cells')).toBe('cd4-cd8-t-cells')
    expect(slug('leiden\t(res=0.5)')).toBe('leiden-res-0-5')
  })

  it('drops separators at either end', () => {
    expect(slug('  --Leiden clusters!! ')).toBe('leiden-clusters')
    expect(slug('#1')).toBe('1')
  })

  it('treats letters outside a-z as separators', () => {
    expect(slug('Müller glia')).toBe('m-ller-glia')
    expect(slug('Area µm²')).toBe('area-m')
  })

  it('falls back to "annotation" when nothing is left', () => {
    expect(slug('')).toBe('annotation')
    expect(slug('   ')).toBe('annotation')
    expect(slug('!!!')).toBe('annotation')
    expect(slug('µ²')).toBe('annotation')
  })

  it('is stable when applied twice', () => {
    for (const value of ['Cell type (manual)', '__x__', 'A  B', '', 'Ünïcode']) {
      expect(slug(slug(value))).toBe(slug(value))
    }
  })
})
