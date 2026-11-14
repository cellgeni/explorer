import { CloseIcon, IconButton } from '../../components/ui'
import {
  collectionEntryFor,
  collectionGroups,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import { collectionEntryLabel, type CollectionState } from './collectionModel'

interface CollectionBarProps {
  readonly state: Exclude<CollectionState, { readonly status: 'idle' }>
  // The dataset shown, and the one loading in its place.
  readonly loadedUrl: string | null
  readonly pendingUrl: string | null
  readonly onSelect: (entry: DatasetCollectionEntry) => void
  readonly onClose: () => void
}

// The open collection's datasets under the canvas, grouped as the collection
// groups them. Choosing one opens it in place of the current dataset.
export function CollectionBar({
  state,
  loadedUrl,
  pendingUrl,
  onSelect,
  onClose,
}: CollectionBarProps) {
  const collection = state.status === 'ready' ? state.collection : null
  const loadedEntry =
    collection === null ? undefined : collectionEntryFor(collection, loadedUrl)
  const pendingEntry =
    collection === null ? undefined : collectionEntryFor(collection, pendingUrl)

  return (
    <nav className="collection-bar" aria-label="Collection">
      <div className="collection-bar-heading">
        <span className="collection-bar-kicker">Collection</span>
        <span className="collection-bar-name">
          {collection?.name ?? collectionFileName(state.url)}
        </span>
        {collection === null ? null : (
          <span className="collection-bar-count">
            {collection.datasets.length.toLocaleString()}{' '}
            {collection.datasets.length === 1 ? 'dataset' : 'datasets'}
          </span>
        )}
      </div>
      {state.status === 'loading' ? (
        <p className="collection-bar-status" role="status">
          Reading the collection…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="collection-bar-status is-error" role="alert">
          The collection could not be opened. {state.message}
        </p>
      ) : null}
      {collection === null ? null : (
        <div className="collection-bar-groups">
          {collectionGroups(collection).map((group, index) => (
            <div
              key={group.name ?? `ungrouped-${index}`}
              className="collection-bar-group"
              role="group"
              aria-label={group.name ?? 'Datasets'}
            >
              {group.name === undefined ? null : (
                <span className="collection-bar-group-name" aria-hidden="true">
                  {group.name}
                </span>
              )}
              {group.datasets.map((entry) => {
                const label = collectionEntryLabel(entry)
                const isLoaded = entry === loadedEntry
                const isPending = entry === pendingEntry && !isLoaded

                return (
                  <button
                    key={entry.url}
                    type="button"
                    className="collection-bar-dataset"
                    title={isLoaded ? `${label} is open` : `Open ${label}`}
                    aria-current={isLoaded ? 'true' : undefined}
                    aria-busy={isPending || undefined}
                    onClick={() => {
                      if (!isLoaded && !isPending) onSelect(entry)
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
      <IconButton
        className="collection-bar-close"
        title="Close Collection"
        icon={<CloseIcon />}
        onClick={onClose}
      />
    </nav>
  )
}

function collectionFileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}
