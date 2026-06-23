import { describe, expect, it } from 'vitest'
import { createVisiumHdBinOptions } from './visiumHdModel'

describe('Visium HD controls model', () => {
  it('enables detected 2 µm outputs without an explicit filtered-barcode budget', () => {
    expect(createVisiumHdBinOptions([16, 8, 2])).toEqual([
      { size: 16, available: true, disabled: false },
      { size: 8, available: true, disabled: false },
      { size: 2, available: true, disabled: false },
    ])
  })

  it('keeps missing 2 µm outputs disabled', () => {
    expect(createVisiumHdBinOptions([16, 8])).toContainEqual({
      size: 2,
      available: false,
      disabled: true,
      reason: '2 µm binned output was not detected.',
    })
  })
})
