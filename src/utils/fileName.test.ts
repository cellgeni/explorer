import { describe, expect, it } from 'vitest'
import { fileNamePart } from './fileName'

describe('fileNamePart', () => {
  it('keeps letters of any script, without accents', () => {
    expect(fileNamePart('Tumour edge', 'selection')).toBe('tumour-edge')
    expect(fileNamePart('Épithélium', 'selection')).toBe('epithelium')
    expect(fileNamePart('腫瘍', 'selection')).toBe('腫瘍')
    expect(fileNamePart('肝臓 2', 'selection')).toBe('肝臓-2')
    expect(fileNamePart(' *** ', 'selection')).toBe('selection')
  })

  // Only Latin, Greek and Cyrillic accents go; other marks are part of the
  // letter (EXP-239).
  it('keeps the marks that belong to letters, composed as typed', () => {
    expect(fileNamePart('がん', 'selection')).toBe('がん')
    expect(fileNamePart('パン', 'selection')).toBe('パン')
    expect(fileNamePart('हिन्दी', 'selection')).toBe('हिन्दी')
    expect(fileNamePart('की', 'selection')).not.toBe(fileNamePart('के', 'selection'))
    expect(fileNamePart('ที่ดิน', 'selection')).toBe('ที่ดิน')
    expect(fileNamePart('조직 경계', 'selection')).toBe('조직-경계')
    expect(fileNamePart('Ελληνικά Кирилли́ца', 'selection')).toBe('ελληνικα-кириллица')
  })
})
