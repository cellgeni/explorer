import { describe, expect, it } from 'vitest'
import { colorModeAfterGeneChange } from './geneColorModeModel'

describe('colorModeAfterGeneChange', () => {
  it('colours by gene expression when genes are added', () => {
    expect(
      colorModeAfterGeneChange('annotations', 'annotations', {
        added: true,
        geneCount: 1,
      }),
    ).toBe('gene-expression')
  })

  it('keeps the mode when a gene is removed and others remain', () => {
    expect(
      colorModeAfterGeneChange('annotations', 'transcript-count', {
        added: false,
        geneCount: 2,
      }),
    ).toBe('annotations')
  })

  it('goes back to the mode from before when the last gene is removed', () => {
    expect(
      colorModeAfterGeneChange('gene-expression', 'metadata', {
        added: false,
        geneCount: 0,
      }),
    ).toBe('metadata')
  })

  it('leaves another mode alone when the last gene is removed', () => {
    expect(
      colorModeAfterGeneChange('annotations', 'transcript-count', {
        added: false,
        geneCount: 0,
      }),
    ).toBe('annotations')
  })
})
