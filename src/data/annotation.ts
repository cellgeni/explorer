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

export interface LoadDatasetAnnotationsOptions {
  readonly groupId?: string
  readonly signal?: AbortSignal
}
