import { describe, expect, it } from 'vitest'
import { normaliseToRgba } from './jpeg2000'

describe('JPEG-2000 windowing', () => {
  it('normalises grayscale pixels to opaque RGBA with a supplied window', () => {
    const result = normaliseToRgba(new Uint16Array([0, 50, 100]), 3, 1, {
      lo: 0,
      hi: 100,
    })

    expect([...result.rgba]).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ])
    expect(result.lo).toBe(0)
    expect(result.hi).toBe(100)
  })

  it('auto-calibrates a non-degenerate percentile window', () => {
    const result = normaliseToRgba(new Uint16Array([7, 7, 7]), 3, 1)

    expect(result.lo).toBe(7)
    expect(result.hi).toBe(8)
  })

  it('tints grayscale pixels by intensity instead of filling the whole tile', () => {
    const result = normaliseToRgba(
      new Uint16Array([0, 50, 100]),
      3,
      1,
      {
        lo: 0,
        hi: 100,
      },
      {
        color: [80, 160, 240],
        alphaFromIntensity: true,
      },
    )

    expect([...result.rgba]).toEqual([0, 0, 0, 0, 40, 80, 120, 128, 80, 160, 240, 255])
  })
})
