import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { asCellId, cellIdToInt, cellIdToIntPair, intToCellId } from './cellid'

const uint32Arb = fc.integer({ min: 0, max: 0xffffffff })

// A Xenium cell ID as written by Xenium Ranger: eight shifted-hex letters
// a–p, a dash and a decimal suffix without leading zeros.
const cellIdTextArb = fc
  .tuple(
    fc.array(fc.constantFrom(...'abcdefghijklmnop'), { minLength: 8, maxLength: 8 }),
    uint32Arb,
  )
  .map(([letters, suffix]) => `${letters.join('')}-${suffix}`)

describe('Xenium cell ID codec (property)', () => {
  it('round-trips any uint32 prefix and suffix', () => {
    fc.assert(
      fc.property(uint32Arb, uint32Arb, (prefix, suffix) => {
        const cellId = intToCellId(prefix, suffix)

        expect(cellIdToIntPair(cellId)).toEqual({ prefix, suffix })
        expect(cellIdToInt(cellId)).toEqual({ prefix, suffix })
      }),
    )
  })

  it('writes eight letters, a dash and the decimal suffix', () => {
    fc.assert(
      fc.property(uint32Arb, uint32Arb, (prefix, suffix) => {
        expect(intToCellId(prefix, suffix)).toMatch(new RegExp(`^[a-p]{8}-${suffix}$`))
      }),
    )
  })

  it('round-trips any well-formed cell ID string', () => {
    fc.assert(
      fc.property(cellIdTextArb, (text) => {
        const { prefix, suffix } = cellIdToIntPair(asCellId(text))

        expect(intToCellId(prefix, suffix)).toBe(text)
      }),
    )
  })

  it('sorts cell IDs with the same suffix in prefix order', () => {
    fc.assert(
      fc.property(uint32Arb, uint32Arb, uint32Arb, (left, right, suffix) => {
        const leftId = intToCellId(left, suffix)
        const rightId = intToCellId(right, suffix)

        expect(leftId < rightId).toBe(left < right)
        expect(leftId === rightId).toBe(left === right)
      }),
    )
  })
})
