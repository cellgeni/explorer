import { describe, expect, it } from 'vitest'
import { formatSquareMicrometers, withMicrometers, withSquareMicrometers } from './units'

describe('units', () => {
  it('writes micrometres with the micro sign', () => {
    expect(withMicrometers('9.3')).toBe('9.3 µm')
    expect(withSquareMicrometers('68.3')).toBe('68.3 µm²')
    expect(withMicrometers('1').codePointAt(2)).toBe(0xb5)
  })

  it('formats areas with fewer decimals as they grow', () => {
    expect(formatSquareMicrometers(6.125)).toBe('6.13 µm²')
    expect(formatSquareMicrometers(48.25)).toBe('48.3 µm²')
    expect(formatSquareMicrometers(13_972_207.4)).toBe('13,972,207 µm²')
  })
})
