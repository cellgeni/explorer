import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_DEFAULT_PALETTE,
  annotationPaletteColor,
  normalizeAnnotationColor,
} from './annotationPalette'

describe('annotation palette', () => {
  it('cycles through a deterministic categorical palette', () => {
    expect(ANNOTATION_DEFAULT_PALETTE).toHaveLength(102)
    expect(annotationPaletteColor(0)).toBe('#1f77b4')
    expect(annotationPaletteColor(102)).toBe('#1f77b4')
    expect(annotationPaletteColor(-1)).toBe('#c1121f')
  })

  // Classes 1 and 23 were #ff7f0e and #ff7f00, ΔE 2 (EXP-049).
  it('has no two colours within CIE76 ΔE 5 of each other', () => {
    const close: string[] = []

    ANNOTATION_DEFAULT_PALETTE.forEach((first, i) => {
      ANNOTATION_DEFAULT_PALETTE.slice(i + 1).forEach((second, offset) => {
        const distance = cie76(first, second)
        if (distance < 5) {
          close.push(
            `${i}:${first} ${i + 1 + offset}:${second} ΔE ${distance.toFixed(1)}`,
          )
        }
      })
    })

    expect(close).toEqual([])
  })

  it('normalizes valid color input and rejects invalid colors', () => {
    expect(normalizeAnnotationColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeAnnotationColor('red')).toBeNull()
  })
})

// CIE76 colour difference: the distance between two sRGB colours in CIELAB.
function cie76(first: string, second: string): number {
  const [l1, a1, b1] = cielab(first)
  const [l2, a2, b2] = cielab(second)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function cielab(hex: string): readonly [number, number, number] {
  const linear = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [linear(1), linear(3), linear(5)]
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
