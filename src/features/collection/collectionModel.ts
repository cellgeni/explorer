import type { ShareableState } from '../../data/shareableState'
import type {
  DatasetCollection,
  DatasetCollectionDefaults,
  DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import { manifestObservationColorMode } from '../app-shell/appShellModel'
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

// How a collection dataset opens: the state its load restores, like a shared
// link's. Version 2, so the colour mode is taken as written.
export interface CollectionDatasetOpening {
  readonly linkState: ShareableState
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
  const observationColorMode = manifestObservationColorMode(state)

  return {
    linkState: {
      ...state,
      linkVersion: 2,
      ...(observationColorMode === undefined ? {} : { observationColorMode }),
    },
    ignored,
  }
}

// Colour modes that mean the same in every dataset. Annotations and metadata
// name one dataset's columns, so the next dataset starts with its own.
const KEPT_COLOR_MODES: ReadonlySet<ObservationColorMode> = new Set([
  'gene-expression',
  'transcript-count',
  'cell-area',
])

// Switching to another dataset of the collection keeps the selected genes and
// how cells are coloured. The gene colour scale stays anyway.
export function collectionSwitchOpening(current: {
  readonly selectedGenes: readonly string[]
  readonly observationColorMode: ObservationColorMode
  readonly geneExpressionScoreMode: string
}): CollectionDatasetOpening {
  return {
    linkState: {
      linkVersion: 2,
      selectedGenes: current.selectedGenes,
      ...(KEPT_COLOR_MODES.has(current.observationColorMode)
        ? { observationColorMode: current.observationColorMode }
        : {}),
      geneExpressionScoreMode: current.geneExpressionScoreMode,
    },
    ignored: [],
  }
}
