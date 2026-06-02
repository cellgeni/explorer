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

  it('normalizes valid color input and rejects invalid colors', () => {
    expect(normalizeAnnotationColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeAnnotationColor('red')).toBeNull()
  })
})
