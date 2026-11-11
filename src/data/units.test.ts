import { describe, expect, it } from 'vitest'
import { withMicrometers, withSquareMicrometers } from './units'

describe('units', () => {
  it('writes micrometres with the micro sign', () => {
    expect(withMicrometers('9.3')).toBe('9.3 µm')
    expect(withSquareMicrometers('68.3')).toBe('68.3 µm²')
    expect(withMicrometers('1').codePointAt(2)).toBe(0xb5)
  })
})
