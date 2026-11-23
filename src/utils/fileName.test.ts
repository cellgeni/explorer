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
})
