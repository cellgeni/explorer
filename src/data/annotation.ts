import type { CellId } from './cellid'

// Annotation types shared by the dataset readers and the loaders that call
// them, kept apart from both so that neither imports the other for them.

// A class of cells, such as a cluster or cell type, and the cells in it.
export interface Annotation<ElementId extends string = CellId> {
  readonly id: string
  readonly label: string
  readonly cellIds: readonly ElementId[]
  // The class's colour as the dataset stores it (`#rrggbb`), used until the
  // user picks another.
  readonly color?: string
}

// An annotation set a dataset offers, such as an analysis grouping or an obs
// column, with how many classes it has.
export interface AnnotationGroupOption {
  readonly id: string
  readonly label: string
  readonly groupingName: string
  readonly groupCount: number
}

// More categories than this, and a column labels cells rather than grouping
// them.
const ID_LIKE_CATEGORY_LIMIT = 500

// H5AD and SpatialData columns that identify cells or ontology terms rather
// than group them (15.1-I). They are listed apart, under "More columns", and
// "All" leaves them out: each would be one class per cell.
export function isIdLikeAnnotationGroup(
  group: Pick<AnnotationGroupOption, 'label' | 'groupCount'>,
): boolean {
  const label = group.label.toLowerCase()
  return (
    label.endsWith('_ontology_term_id') ||
    label === 'observation_joinid' ||
    group.groupCount > ID_LIKE_CATEGORY_LIMIT
  )
}

export interface LoadDatasetAnnotationsOptions {
  readonly groupId?: string
  readonly signal?: AbortSignal
}
