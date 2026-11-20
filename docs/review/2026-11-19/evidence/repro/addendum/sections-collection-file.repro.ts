// Addendum, review 2026-11-20: docs/dataset-collections.md (Sections Of One
// Table) says a collection file can list sections by the table's relative
// path and `#obs.<column>=<value>`. Checks that the runtime parser keeps the
// fragment and that the section URL parses back to the table and value.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/addendum/sections-collection-file.repro.ts
import { describe, expect, it } from 'vitest'
import { parseAnnDataSectionUrl } from '../../../../../../src/datasets/annDataSections'
import { fetchDatasetCollection } from '../../../../../../src/datasets/datasetCollection'

describe('sections of one table: listed in a collection file', () => {
  it('keeps the fragment of a relative section path', async () => {
    const fetchImpl = (async () =>
      Response.json({
        version: 1,
        datasets: [
          {
            dataset: 'aligned.h5ad#obs.section=section_01',
            name: 'First',
            coordinateSystem: 'ef6',
            z: 0,
          },
          {
            dataset: 'aligned.h5ad#obs.section=section%2014',
            name: 'Last',
            coordinateSystem: 'ef6',
            z: 780,
          },
        ],
      })) as unknown as typeof fetch

    const collection = await fetchDatasetCollection(
      'https://host.test/study/collection.json',
      { fetchImpl },
    )
    const urls = collection.datasets.map((entry) => entry.url)

    expect(urls).toEqual([
      'https://host.test/study/aligned.h5ad#obs.section=section_01',
      'https://host.test/study/aligned.h5ad#obs.section=section%2014',
    ])
    expect(urls.map((url) => parseAnnDataSectionUrl(url))).toEqual([
      {
        fileUrl: 'https://host.test/study/aligned.h5ad',
        column: 'section',
        value: 'section_01',
      },
      {
        fileUrl: 'https://host.test/study/aligned.h5ad',
        column: 'section',
        value: 'section 14',
      },
    ])
  })
})
