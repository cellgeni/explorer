import { describe, expect, it } from 'vitest'
import { VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON } from '../../datasets/visiumHdStrategy'
import {
  createVisiumHdBinOptions,
  parseVisiumHdBarcodeMappingBudgetInput,
  parseVisiumHdTwoMicrometerBudgetInput,
  updateVisiumHdBinOptionsForTwoMicrometerBudget,
} from './visiumHdModel'

describe('Visium HD controls model', () => {
  it('keeps 2 µm disabled without an explicit filtered-barcode budget', () => {
    expect(createVisiumHdBinOptions([16, 8, 2])).toEqual([
      { size: 16, available: true, disabled: false },
      { size: 8, available: true, disabled: false },
      {
        size: 2,
        available: true,
        disabled: true,
        reason: VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
      },
    ])
  })

  it('enables 2 µm when a filtered-barcode budget is configured', () => {
    expect(
      createVisiumHdBinOptions(
        [16, 8, 2],
        {},
        { twoMicrometerFilteredBarcodeBudget: 25_000 },
      ),
    ).toEqual([
      { size: 16, available: true, disabled: false },
      { size: 8, available: true, disabled: false },
      { size: 2, available: true, disabled: false },
    ])
  })

  it('does not enable missing 2 µm outputs even when a budget is configured', () => {
    expect(
      createVisiumHdBinOptions(
        [16, 8],
        {},
        { twoMicrometerFilteredBarcodeBudget: 25_000 },
      ),
    ).toContainEqual({
      size: 2,
      available: false,
      disabled: true,
      reason: '2 µm binned output was not detected.',
    })
  })

  it('parses optional 2 µm budget input values', () => {
    expect(parseVisiumHdTwoMicrometerBudgetInput('')).toBeUndefined()
    expect(parseVisiumHdTwoMicrometerBudgetInput('25000')).toBe(25_000)
    expect(parseVisiumHdTwoMicrometerBudgetInput('25000.9')).toBe(25_000)
    expect(parseVisiumHdTwoMicrometerBudgetInput('0')).toBeUndefined()
    expect(parseVisiumHdTwoMicrometerBudgetInput('not-a-number')).toBeUndefined()
  })

  it('parses optional barcode mapping row budget input values', () => {
    expect(parseVisiumHdBarcodeMappingBudgetInput('')).toBeUndefined()
    expect(parseVisiumHdBarcodeMappingBudgetInput('12000000')).toBe(12_000_000)
    expect(parseVisiumHdBarcodeMappingBudgetInput('12000000.9')).toBe(12_000_000)
    expect(parseVisiumHdBarcodeMappingBudgetInput('0')).toBeUndefined()
    expect(parseVisiumHdBarcodeMappingBudgetInput('not-a-number')).toBeUndefined()
  })

  it('refreshes existing bin options when the 2 µm budget changes', () => {
    const options = createVisiumHdBinOptions([16, 8, 2], { 16: 54_504 })

    expect(
      updateVisiumHdBinOptionsForTwoMicrometerBudget(options, 25_000),
    ).toContainEqual({
      size: 2,
      available: true,
      disabled: false,
    })
    expect(
      updateVisiumHdBinOptionsForTwoMicrometerBudget(options, undefined),
    ).toContainEqual({
      size: 2,
      available: true,
      disabled: true,
      reason: VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
    })
  })
})
