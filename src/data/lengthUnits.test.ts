import { describe, expect, it } from 'vitest'
import { micrometersPerLengthUnit } from './lengthUnits'

describe('length units', () => {
  it.each([
    ['angstrom', 1e-4],
    ['Å', 1e-4],
    ['picometer', 1e-6],
    ['nanometres', 1e-3],
    ['µm', 1],
    ['μm', 1],
    ['microns', 1],
    ['Micrometer', 1],
    ['millimetre', 1e3],
    ['centimeter', 1e4],
    ['decimeter', 1e5],
    ['meters', 1e6],
    ['kilometer', 1e9],
    ['inches', 25_400],
    ['foot', 304_800],
    ['feet', 304_800],
  ])('converts %s', (unit, expected) => {
    expect(micrometersPerLengthUnit(unit)).toBeCloseTo(expected, 12)
  })

  it.each([undefined, '', 'pixel', 'second', 'reference frame'])(
    'knows no length for %s',
    (unit) => {
      expect(micrometersPerLengthUnit(unit)).toBeUndefined()
    },
  )
})
