import { describe, expect, it } from 'vitest'
import type { MerscopeImageOptions } from '../../datasets/merscopeDataset'
import {
  formatMerscopeImageChoice,
  formatMerscopeImageSize,
  IDLE_MERSCOPE_IMAGE_STATE,
  merscopeImageControlLoading,
  merscopeImageControlReady,
  merscopeImageForLoad,
  merscopeImageSelectionToShareable,
  parseMerscopeImageChoice,
} from './merscopeImageModel'

const MB = 1024 * 1024

function options(dapiBytes: number): MerscopeImageOptions {
  return {
    fileName: 'region_0.vzg',
    stains: [
      { stain: 'DAPI', planes: [3, 4].map((z) => ({ z, byteLength: dapiBytes })) },
      { stain: 'Cell_bound_2', planes: [{ z: 3, byteLength: 40 * MB }] },
    ],
    defaultChoice: { stain: 'DAPI', z: 3 },
    placement: { originX: 0, originY: 0, micronsPerPixel: 0.108 },
  }
}

describe('MERSCOPE image choice', () => {
  it('writes and reads `<stain>_z<plane>` and `none`', () => {
    expect(formatMerscopeImageChoice({ stain: 'Cell_bound_2', z: 3 })).toBe(
      'Cell_bound_2_z3',
    )
    expect(parseMerscopeImageChoice('Cell_bound_2_z3')).toEqual({
      stain: 'Cell_bound_2',
      z: 3,
    })
    expect(parseMerscopeImageChoice('none')).toBeNull()
    expect(parseMerscopeImageChoice(undefined)).toBeUndefined()
    expect(parseMerscopeImageChoice('DAPI')).toBeUndefined()
  })

  it('loads a small default, and defers a large one unless a link asks for it', () => {
    expect(merscopeImageForLoad(options(40 * MB), undefined)).toEqual({
      choice: { stain: 'DAPI', z: 3 },
      deferred: false,
    })
    expect(merscopeImageForLoad(options(333 * MB), undefined)).toEqual({
      choice: null,
      deferred: true,
    })
    expect(merscopeImageForLoad(options(333 * MB), 'DAPI_z4')).toEqual({
      choice: { stain: 'DAPI', z: 4 },
      deferred: false,
    })
    expect(merscopeImageForLoad(options(40 * MB), 'none')).toEqual({
      choice: null,
      deferred: false,
    })
    // A choice the .vzg lacks falls back to the default rule.
    expect(merscopeImageForLoad(options(40 * MB), 'PolyT_z3').choice).toEqual({
      stain: 'DAPI',
      z: 3,
    })
  })

  it('shows pyramid sizes in KB or MB', () => {
    expect(formatMerscopeImageSize(19_873)).toBe('19 KB')
    expect(formatMerscopeImageSize(4.25 * MB)).toBe('4.3 MB')
    expect(formatMerscopeImageSize(332_683_540)).toBe('317 MB')
  })

  it('keeps the choice in the link once the .vzg is read', () => {
    const ready = merscopeImageControlReady(options(40 * MB), { stain: 'DAPI', z: 3 })

    expect(merscopeImageSelectionToShareable(IDLE_MERSCOPE_IMAGE_STATE)).toEqual({})
    expect(merscopeImageSelectionToShareable(ready)).toEqual({ merscopeImage: 'DAPI_z3' })
    expect(
      merscopeImageSelectionToShareable(merscopeImageControlLoading(ready, null)),
    ).toEqual({ merscopeImage: 'none' })
    expect(merscopeImageControlLoading(IDLE_MERSCOPE_IMAGE_STATE, null)).toBe(
      IDLE_MERSCOPE_IMAGE_STATE,
    )
  })
})
