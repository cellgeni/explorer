import { describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import {
  canShowBeside,
  compareUrlsAfterOpening,
  keepsViewOnOpening,
  linkedSectionEntries,
  MAX_LINKED_SECTIONS,
  toggledCompareUrls,
} from './linkedSectionsModel'

const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    datasets: [
      { dataset: 'p1-s1.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s2.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s3.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s4.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s5.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p2-s1.zarr', coordinateSystem: 'patient-2' },
      { dataset: 'atlas.zarr' },
    ],
  },
  'https://example.test/study/collection.json',
)
const [S1, S2, S3, S4, S5, P2, ATLAS] = COLLECTION.datasets.map((entry) => entry.url) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]
const entry = (url: string) => COLLECTION.datasets.find((item) => item.url === url)!

describe('linked sections', () => {
  it('offers only other sections of the open dataset’s coordinate system', () => {
    expect(canShowBeside(entry(S1), entry(S2))).toBe(true)
    expect(canShowBeside(entry(S1), entry(S1))).toBe(false)
    expect(canShowBeside(entry(S1), entry(P2))).toBe(false)
    expect(canShowBeside(entry(S1), entry(ATLAS))).toBe(false)
    // A dataset outside any coordinate system has no sections beside it.
    expect(canShowBeside(entry(ATLAS), entry(S1))).toBe(false)
    expect(canShowBeside(undefined, entry(S1))).toBe(false)
  })

  it('shows the compare= sections that can be, in order, up to the limit', () => {
    expect(
      linkedSectionEntries(COLLECTION, S1, [
        S3,
        P2,
        S1,
        'https://elsewhere.test/x',
        S3,
        S2,
      ]).map((shown) => shown.url),
    ).toEqual([S3, S2])
    expect(
      linkedSectionEntries(COLLECTION, S1, [S2, S3, S4, S5]).map((shown) => shown.url),
    ).toEqual([S2, S3, S4].slice(0, MAX_LINKED_SECTIONS))
    expect(linkedSectionEntries(null, S1, [S2])).toEqual([])
    expect(linkedSectionEntries(COLLECTION, ATLAS, [S2])).toEqual([])
  })

  it('toggles a section beside the open one', () => {
    const shown = [entry(S2)]

    expect(toggledCompareUrls(shown, entry(S3))).toEqual([S2, S3])
    expect(toggledCompareUrls(shown, entry(S2))).toEqual([])
    expect(toggledCompareUrls([entry(S2), entry(S3), entry(S4)], entry(S5))).toEqual([
      S2,
      S3,
      S4,
    ])
  })

  it('keeps the view and the panels when opening another registered section', () => {
    const shown = [entry(S2), entry(S3)]

    expect(keepsViewOnOpening(COLLECTION, S1, S4)).toBe(true)
    expect(keepsViewOnOpening(COLLECTION, S1, P2)).toBe(false)
    expect(keepsViewOnOpening(COLLECTION, ATLAS, S1)).toBe(false)
    expect(keepsViewOnOpening(null, S1, S2)).toBe(false)

    // Opening a panel swaps it with the open dataset.
    expect(compareUrlsAfterOpening(COLLECTION, S1, shown, S3)).toEqual([S2, S1])
    // Opening another section keeps the panels.
    expect(compareUrlsAfterOpening(COLLECTION, S1, shown, S4)).toEqual([S2, S3])
    // Leaving the coordinate system closes them.
    expect(compareUrlsAfterOpening(COLLECTION, S1, shown, P2)).toEqual([])
    expect(compareUrlsAfterOpening(COLLECTION, S1, shown, ATLAS)).toEqual([])
    expect(compareUrlsAfterOpening(COLLECTION, null, shown, S2)).toEqual([])
  })
})
