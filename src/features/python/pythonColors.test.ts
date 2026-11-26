import { describe, expect, it } from 'vitest'
import {
  isPythonColorMap,
  parseHexColor,
  pythonRampColors,
  pythonRampGradient,
  pythonRampStops,
  rgbHex,
} from './pythonColors'

const GREEN = [0, 128, 0] as const

describe('Python colours', () => {
  it('reads "#rrggbb" and nothing else', () => {
    expect(parseHexColor('#00ff7f')).toEqual([0, 255, 127])
    expect(parseHexColor('#00FF7F')).toEqual([0, 255, 127])
    expect(parseHexColor('green')).toBeNull()
    expect(parseHexColor('#0f0')).toBeNull()
    expect(rgbHex([0, 255, 127])).toBe('#00ff7f')
  })

  it('knows the colour maps Python accepts', () => {
    for (const name of ['viridis', 'magma', 'inferno', 'plasma', 'cividis', 'turbo']) {
      expect(isPythonColorMap(name)).toBe(true)
    }
    expect(isPythonColorMap('jet')).toBe(false)
    expect(isPythonColorMap('toString')).toBe(false)
  })

  it('ramps a single hue from pale at vmin to the full colour at vmax', () => {
    const stops = pythonRampStops({ color: GREEN })
    const colors = pythonRampColors(Float32Array.of(0, 5, 10, 20, -3), stops, {
      vmin: 0,
      vmax: 10,
      reverse: false,
    })

    expect(Array.from(colors.slice(0, 3))).toEqual([217, 236, 217])
    expect(Array.from(colors.slice(6, 9))).toEqual([...GREEN])
    // Outside the range: clamped to the ends.
    expect(Array.from(colors.slice(9, 12))).toEqual([...GREEN])
    expect(Array.from(colors.slice(12, 15))).toEqual([217, 236, 217])
    // Half way.
    expect(Array.from(colors.slice(3, 6))).toEqual([109, 182, 109])
  })

  it('flips with reverse, and draws NaN as the palest colour either way', () => {
    const stops = pythonRampStops({ color: GREEN })
    const colors = pythonRampColors(Float32Array.of(0, 10, Number.NaN), stops, {
      vmin: 0,
      vmax: 10,
      reverse: true,
    })

    expect(Array.from(colors.slice(0, 3))).toEqual([...GREEN])
    expect(Array.from(colors.slice(3, 6))).toEqual([217, 236, 217])
    expect(Array.from(colors.slice(6, 9))).toEqual([217, 236, 217])
  })

  it('draws every value at the top when vmin equals vmax', () => {
    const colors = pythonRampColors(
      Float32Array.of(3, 3),
      pythonRampStops({ color: GREEN }),
      { vmin: 3, vmax: 3, reverse: false },
    )

    expect(Array.from(colors)).toEqual([...GREEN, ...GREEN])
  })

  it('follows a colour map’s stops', () => {
    const stops = pythonRampStops({ cmap: 'viridis' })
    const colors = pythonRampColors(Float32Array.of(0, 1), stops, {
      vmin: 0,
      vmax: 1,
      reverse: false,
    })

    expect(rgbHex([colors[0] ?? 0, colors[1] ?? 0, colors[2] ?? 0])).toBe('#440154')
    expect(rgbHex([colors[3] ?? 0, colors[4] ?? 0, colors[5] ?? 0])).toBe('#fde725')
    expect(pythonRampGradient(stops, false)).toMatch(/^linear-gradient\(90deg, #440154,/)
    expect(pythonRampGradient(stops, true)).toMatch(/^linear-gradient\(90deg, #fde725,/)
  })
})
