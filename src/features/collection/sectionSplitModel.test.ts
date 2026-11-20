import { describe, expect, it } from 'vitest'
import { sectionSplitLink } from './sectionSplitModel'

const TABLE = 'https://example.test/ef6/aligned.h5ad'
const COLUMNS = [
  { column: 'cell_cluster', sectionCount: 15 },
  { column: 'section', sectionCount: 14 },
]
const OPEN = {
  datasetUrl: TABLE,
  platform: 'h5ad' as const,
  sectionColumns: COLUMNS,
  inCollection: false,
  pathname: '/explorer/',
}

describe('sectionSplitLink', () => {
  it('links an AnnData table to its sections as a collection', () => {
    expect(sectionSplitLink(OPEN)).toEqual({
      href: `/explorer/?collection=${encodeURIComponent(`${TABLE}#obs.section`)}`,
      column: 'section',
      sectionCount: 14,
    })
  })

  it('offers nothing without a column named like sections', () => {
    expect(sectionSplitLink({ ...OPEN, sectionColumns: COLUMNS.slice(0, 1) })).toBeNull()
    expect(
      sectionSplitLink({
        ...OPEN,
        sectionColumns: [{ column: 'section', sectionCount: 1 }],
      }),
    ).toBeNull()
  })

  it('offers nothing for a section, a collection, a Visium table or another platform', () => {
    expect(
      sectionSplitLink({ ...OPEN, datasetUrl: `${TABLE}#obs.section=s1` }),
    ).toBeNull()
    expect(sectionSplitLink({ ...OPEN, inCollection: true })).toBeNull()
    expect(sectionSplitLink({ ...OPEN, platform: 'visium' })).toBeNull()
    expect(sectionSplitLink({ ...OPEN, platform: 'xenium' })).toBeNull()
    expect(sectionSplitLink({ ...OPEN, datasetUrl: null })).toBeNull()
  })
})
