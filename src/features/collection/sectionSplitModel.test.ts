import { describe, expect, it } from 'vitest'
import { sectionSplitLink } from './sectionSplitModel'

const TABLE = 'https://example.test/ef6/aligned.h5ad'
const GROUPS = [
  {
    id: 'analysis:cell-cluster',
    label: 'cell_cluster',
    groupingName: 'cell_cluster',
    groupCount: 15,
  },
  { id: 'analysis:section', label: 'section', groupingName: 'section', groupCount: 14 },
]
const OPEN = {
  datasetUrl: TABLE,
  platform: 'h5ad' as const,
  groupOptions: GROUPS,
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

  it('offers nothing without a set named like sections', () => {
    expect(sectionSplitLink({ ...OPEN, groupOptions: GROUPS.slice(0, 1) })).toBeNull()
    expect(
      sectionSplitLink({
        ...OPEN,
        groupOptions: [{ ...GROUPS[1]!, groupCount: 1 }],
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
