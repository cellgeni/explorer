import { describe, expect, it } from 'vitest'
import type { VisiumHdBinSizeMicrometers } from '../datasets/visiumHdDataset'
import {
  VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN,
  visiumHdAvailableBinSizes,
  visiumHdGridLoadBinSize,
} from './visiumHdGridLod'

const ALL_BIN_SIZES: readonly VisiumHdBinSizeMicrometers[] = [2, 8, 16]

describe('visiumHdGridLoadBinSize', () => {
  it('loads 16 µm bins for a 2 µm selection until zoomed in far enough', () => {
    expect(visiumHdGridLoadBinSize(2, undefined, ALL_BIN_SIZES)).toBe(16)
    expect(visiumHdGridLoadBinSize(2, -4, ALL_BIN_SIZES)).toBe(16)
    expect(
      visiumHdGridLoadBinSize(2, VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN - 0.01, ALL_BIN_SIZES),
    ).toBe(16)
  })

  it('loads the exact 2 µm grid from the threshold zoom upwards', () => {
    expect(
      visiumHdGridLoadBinSize(2, VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN, ALL_BIN_SIZES),
    ).toBe(2)
    expect(visiumHdGridLoadBinSize(2, 8, ALL_BIN_SIZES)).toBe(2)
  })

  it('keeps 2 µm bins at any zoom when 16 µm bins are not available', () => {
    expect(visiumHdGridLoadBinSize(2, undefined, [2, 8])).toBe(2)
    expect(visiumHdGridLoadBinSize(2, 0, [2])).toBe(2)
  })

  it('never changes an 8 or 16 µm selection', () => {
    for (const zoom of [undefined, -2, 0, VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN, 6]) {
      expect(visiumHdGridLoadBinSize(8, zoom, ALL_BIN_SIZES)).toBe(8)
      expect(visiumHdGridLoadBinSize(16, zoom, ALL_BIN_SIZES)).toBe(16)
    }
  })
})

describe('visiumHdAvailableBinSizes', () => {
  it('lists the enabled bin sizes in option order', () => {
    expect(
      visiumHdAvailableBinSizes([
        { size: 16, disabled: false },
        { size: 8, disabled: true },
        { size: 2, disabled: false },
      ]),
    ).toEqual([16, 2])
  })

  it('returns nothing when every option is disabled', () => {
    expect(
      visiumHdAvailableBinSizes([
        { size: 2, disabled: true },
        { size: 16, disabled: true },
      ]),
    ).toEqual([])
  })

  it('keeps a low-zoom 2 µm selection at 2 µm when the 16 µm option is disabled', () => {
    const available = visiumHdAvailableBinSizes([
      { size: 2, disabled: false },
      { size: 8, disabled: false },
      { size: 16, disabled: true },
    ])

    expect(visiumHdGridLoadBinSize(2, 0, available)).toBe(2)
  })
})
