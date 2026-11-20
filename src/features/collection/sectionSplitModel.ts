import {
  annDataSectionUrl,
  isSectionColumnName,
  parseAnnDataSectionUrl,
  type AnnDataSectionColumn,
} from '../../datasets/annDataSections'
import { MAX_COLLECTION_DATASETS } from '../../datasets/datasetCollection'
import type { Platform } from '../../datasets/spatialDataset'
import { collectionLinkHref } from '../start/datasetLibraryModel'

// The link that opens an AnnData table's sections as a collection, one
// dataset per value of an obs column named like a section column (`section`,
// `sample`, `library_id`; see SECTION_COLUMN_NAMES), from the columns the
// table lists as splitting it (`sectionColumns()`), whether labels or whole
// numbers. Offered for a table opened whole, outside a collection; a Visium
// table's sections are its libraries.
export interface SectionSplitLink {
  readonly href: string
  readonly column: string
  readonly sectionCount: number
}

export function sectionSplitLink({
  datasetUrl,
  platform,
  sectionColumns,
  inCollection,
  pathname,
}: {
  readonly datasetUrl: string | null
  readonly platform: Platform | null
  readonly sectionColumns: readonly AnnDataSectionColumn[]
  readonly inCollection: boolean
  readonly pathname: string
}): SectionSplitLink | null {
  if (
    datasetUrl === null ||
    platform !== 'h5ad' ||
    inCollection ||
    parseAnnDataSectionUrl(datasetUrl) !== null
  ) {
    return null
  }

  const split = sectionColumns.find(
    ({ column, sectionCount }) =>
      isSectionColumnName(column) &&
      sectionCount >= 2 &&
      sectionCount <= MAX_COLLECTION_DATASETS,
  )

  return split === undefined
    ? null
    : {
        href: collectionLinkHref(annDataSectionUrl(datasetUrl, split.column), pathname),
        column: split.column,
        sectionCount: split.sectionCount,
      }
}
