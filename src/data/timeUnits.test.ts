import { describe, expect, it } from 'vitest'
import { timeUnitSymbol } from './timeUnits'

describe('timeUnitSymbol', () => {
  it('gives symbols for OME-NGFF time units and abbreviations', () => {
    expect(timeUnitSymbol('second')).toBe('s')
    expect(timeUnitSymbol('Minutes')).toBe('min')
    expect(timeUnitSymbol('hour')).toBe('h')
    expect(timeUnitSymbol('millisecond')).toBe('ms')
    expect(timeUnitSymbol('ms')).toBe('ms')
    expect(timeUnitSymbol('hrs')).toBe('h')
    expect(timeUnitSymbol('days')).toBe('d')
  })

  it('gives none for other units', () => {
    expect(timeUnitSymbol(undefined)).toBeUndefined()
    expect(timeUnitSymbol('micrometer')).toBeUndefined()
    expect(timeUnitSymbol('femtosecond')).toBeUndefined()
  })
})
