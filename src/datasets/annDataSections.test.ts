import { describe, expect, it } from 'vitest'
import {
  annDataSectionUrl,
  isSectionColumnName,
  parseAnnDataSectionUrl,
} from './annDataSections'

const FILE = 'https://example.test/ef6/aligned.h5ad'

describe('AnnData section URLs', () => {
  it('names one section, and the file split into them', () => {
    expect(parseAnnDataSectionUrl(`${FILE}#obs.section=section_01`)).toEqual({
      fileUrl: FILE,
      column: 'section',
      value: 'section_01',
    })
    expect(parseAnnDataSectionUrl(`${FILE}#obs.section`)).toEqual({
      fileUrl: FILE,
      column: 'section',
      value: null,
    })
    expect(annDataSectionUrl(FILE, 'section', 'section_01')).toBe(
      `${FILE}#obs.section=section_01`,
    )
    expect(annDataSectionUrl(FILE, 'section')).toBe(`${FILE}#obs.section`)
  })

  it('percent-encodes columns and values, and reads them back', () => {
    const url = annDataSectionUrl(
      `${FILE.replace('.h5ad', '.zarr')}/`,
      'tissue slice',
      'a=b/c#1+2',
    )

    expect(url).toBe(
      'https://example.test/ef6/aligned.zarr#obs.tissue%20slice=a%3Db%2Fc%231%2B2',
    )
    expect(parseAnnDataSectionUrl(url)).toEqual({
      fileUrl: 'https://example.test/ef6/aligned.zarr',
      column: 'tissue slice',
      value: 'a=b/c#1+2',
    })
  })

  it('leaves other URLs and fragments alone', () => {
    expect(parseAnnDataSectionUrl(FILE)).toBeNull()
    expect(parseAnnDataSectionUrl(`${FILE}#z=3`)).toBeNull()
    expect(parseAnnDataSectionUrl(`${FILE}#obs.`)).toBeNull()
  })

  it('knows the usual names of section columns', () => {
    expect(isSectionColumnName('Section')).toBe(true)
    expect(isSectionColumnName('library_id')).toBe(true)
    expect(isSectionColumnName('cell_type')).toBe(false)
  })
})
