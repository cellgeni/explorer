import type { AnnotationGroupOption } from '../../data/datasetAnnotations'
import {
  annDataSectionUrl,
  isSectionColumnName,
  parseAnnDataSectionUrl,
} from '../../datasets/annDataSections'
import { MAX_COLLECTION_DATASETS } from '../../datasets/datasetCollection'
import type { Platform } from '../../datasets/spatialDataset'
import { collectionLinkHref } from '../start/datasetLibraryModel'

// The link that opens an AnnData table's sections as a collection, one
// dataset per value of an obs column named like a section column (`section`,
// `sample`, `library_id`; see SECTION_COLUMN_NAMES). Offered for a table
// opened whole, outside a collection; a Visium table's sections are its
// libraries.
export interface SectionSplitLink {
  readonly href: string
  readonly column: string
  readonly sectionCount: number
}

export function sectionSplitLink({
  datasetUrl,
  platform,
  groupOptions,
  inCollection,
  pathname,
}: {
  readonly datasetUrl: string | null
  readonly platform: Platform | null
  readonly groupOptions: readonly AnnotationGroupOption[]
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

  const group = groupOptions.find(
    ({ groupingName, groupCount }) =>
      isSectionColumnName(groupingName) &&
      groupCount >= 2 &&
      groupCount <= MAX_COLLECTION_DATASETS,
  )

  return group === undefined
    ? null
    : {
        href: collectionLinkHref(
          annDataSectionUrl(datasetUrl, group.groupingName),
          pathname,
        ),
        column: group.groupingName,
        sectionCount: group.groupCount,
      }
}
