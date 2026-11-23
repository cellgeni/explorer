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

  // OME-XML symbols are matched as written, so Mm is not mm (EXP-240).
  it.each([
    ['Mm', 1e12],
    ['mm', 1e3],
    ['Pm', 1e21],
    ['pm', 1e-6],
    ['Ym', 1e30],
    ['ym', 1e-18],
    ['dam', 1e7],
    ['thou', 25.4],
    ['li', 25_400 / 12],
    ['pt', 25_400 / 72],
    ['yd', 914_400],
    ['mi', 1_609_344_000],
    ['ua', 1.495_978_707e17],
    ['ly', 9.460_730_472_580_8e21],
    ['pc', 3.085_677_581_491_367e22],
    ['Å', 1e-4],
    ['UM', 1],
  ])('reads the OME-XML symbol %s', (unit, expected) => {
    expect(micrometersPerLengthUnit(unit)).toBeCloseTo(expected, 12)
  })

  it.each([undefined, '', 'pixel', 'second', 'reference frame'])(
    'knows no length for %s',
    (unit) => {
      expect(micrometersPerLengthUnit(unit)).toBeUndefined()
    },
  )
})
