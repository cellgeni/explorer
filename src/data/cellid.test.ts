import { describe, expect, it } from 'vitest'
import {
  asCellId,
  asCellIdPrefix,
  asCellIdSuffix,
  cellIdFromIntPair,
  cellIdToInt,
  intToCellId,
} from './cellid'

describe('Xenium cell ID codec', () => {
  it('encodes integer pairs using shifted hex digits', () => {
    expect(intToCellId(0, 1)).toBe('aaaaaaaa-1')
    expect(intToCellId(0x1234abcd, 2)).toBe('bcdeklmn-2')
    expect(intToCellId(0xffffffff, 3)).toBe('pppppppp-3')
  })

  it('round-trips typed integer pairs', () => {
    const pair = {
      prefix: asCellIdPrefix(0x89abcdef),
      suffix: asCellIdSuffix(7),
    }

    expect(cellIdToInt(cellIdFromIntPair(pair))).toEqual(pair)
  })

  it('rejects malformed cell IDs and out-of-range integer parts', () => {
    expect(() => asCellId('1234abcd-1')).toThrow(/Invalid Xenium cell ID/)
    expect(() => intToCellId(-1, 1)).toThrow(/prefix must be a uint32/)
    expect(() => intToCellId(1, 0x1_0000_0000)).toThrow(/suffix must be a uint32/)
  })
})
