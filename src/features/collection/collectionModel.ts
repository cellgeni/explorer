import type { ShareableState } from '../../data/shareableState'
import type {
  DatasetCollection,
  DatasetCollectionDefaults,
  DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import { datasetDisplayName } from '../app-shell/documentTitle'
import { manifestDefaultsToShareableState } from '../dataset/datasetManifestModel'

// The open dataset collection (collection=). One dataset of it is shown at a
// time, through the usual dataset load.
export type CollectionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly collection: DatasetCollection
    }
  | { readonly status: 'error'; readonly url: string; readonly message: string }

export const IDLE_COLLECTION_STATE: CollectionState = { status: 'idle' }

// How the bar shows the datasets: previews in a row under the view, previews
// in a grid over it (Expand), or names only (Previews off).
export type CollectionView = 'row' | 'grid' | 'names'

const COLLECTION_VIEWS: readonly CollectionView[] = ['row', 'grid', 'names']

// The link's collectionView=; the row when it has none.
export function collectionViewFromLink(state: ShareableState): CollectionView {
  return COLLECTION_VIEWS.find((view) => view === state.collectionView) ?? 'row'
}

// Left out for the row, the default.
export function collectionViewForLink(view: CollectionView): string | undefined {
  return view === 'row' ? undefined : view
}

// The width of each preview in the grid, in CSS px, which its Size slider
// sets. A preview never grows wider than the grid.
export const DEFAULT_COLLECTION_PREVIEW_SIZE = 150
export const MIN_COLLECTION_PREVIEW_SIZE = 100
export const MAX_COLLECTION_PREVIEW_SIZE = 600
export const COLLECTION_PREVIEW_SIZE_STEP = 10

// The link's collectionPreviewSize=, within the slider's range; the default
// when it has none.
export function collectionPreviewSizeFromLink(state: ShareableState): number {
  const size = state.collectionPreviewSize
  if (size === undefined) return DEFAULT_COLLECTION_PREVIEW_SIZE

  return Math.min(
    MAX_COLLECTION_PREVIEW_SIZE,
    Math.max(MIN_COLLECTION_PREVIEW_SIZE, size),
  )
}

// Left out at the default.
export function collectionPreviewSizeForLink(size: number): number | undefined {
  return size === DEFAULT_COLLECTION_PREVIEW_SIZE ? undefined : size
}

// How a collection dataset opens: the state its load restores, like a shared
// link's. Version 2, so the colour mode is taken as written.
export interface CollectionDatasetOpening {
  readonly linkState: ShareableState
  // Class colours from the dataset before, so each class keeps its colour.
  // A link does not carry them.
  readonly annotationColors?: Readonly<Record<string, string>>
  // Defaults the collection sets to values the controls do not have.
  readonly ignored: readonly string[]
}

export function collectionEntryLabel(entry: DatasetCollectionEntry): string {
  return entry.name ?? datasetDisplayName(entry.url, undefined) ?? entry.path
}

// The first dataset opened from a collection starts from its defaults.
export function collectionFirstOpening(
  defaults: DatasetCollectionDefaults | undefined,
): CollectionDatasetOpening {
  const { state, ignored } = manifestDefaultsToShareableState(defaults)

  return { linkState: { ...state, linkVersion: 2 }, ignored }
}

// The datasets of a collection share their genes and annotations, so every
// colour mode means the same in each. Switching to another dataset keeps the
// selected genes, the loaded annotation set with its hidden classes and
// colours and whether the set is hidden, the metadata column, and how cells
// are coloured. The gene colour scale stays anyway.
export function collectionSwitchOpening(current: {
  readonly selectedGenes: readonly string[]
  readonly observationColorMode: ObservationColorMode
  readonly geneExpressionScoreMode: string
  // The loaded annotation set, if any.
  readonly annotationGroupId: string | null
  readonly hiddenAnnotationIds: readonly string[]
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly annotationColors: Readonly<Record<string, string>>
  readonly cellMetadataTrackId: string | null
}): CollectionDatasetOpening {
  return {
    linkState: {
      linkVersion: 2,
      selectedGenes: current.selectedGenes,
      observationColorMode: current.observationColorMode,
      geneExpressionScoreMode: current.geneExpressionScoreMode,
      ...(current.annotationGroupId === null
        ? {}
        : {
            annotationGroupIds: [current.annotationGroupId],
            hiddenAnnotationIds: current.hiddenAnnotationIds,
            hiddenAnnotationSetIds: current.hiddenAnnotationSetIds,
          }),
      ...(current.cellMetadataTrackId === null
        ? {}
        : { cellMetadataTrackId: current.cellMetadataTrackId }),
    },
    annotationColors: current.annotationColors,
    ignored: [],
  }
}
