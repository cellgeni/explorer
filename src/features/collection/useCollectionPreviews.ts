import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { DatasetCollection } from '../../datasets/datasetCollection'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { CollectionPreviewStore } from './collectionPreviewStore'

interface UseCollectionPreviewStoreOptions {
  // Null while there is nothing to preview.
  readonly collection: DatasetCollection | null
  readonly loaders: CollectionPreviewLoaders
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotationGroupId: string | null
  readonly paused: boolean
}

// The previews of a collection's datasets, which the bar and the panels of
// sections shown side by side read from. Each marks the datasets it shows;
// only those are read. The caller is not re-rendered as previews arrive:
// what draws them subscribes with useCollectionPreviewUpdates.
export function useCollectionPreviewStore({
  collection,
  loaders,
  genes,
  scoreMode,
  annotationGroupId,
  paused,
}: UseCollectionPreviewStoreOptions): CollectionPreviewStore | null {
  const store = useMemo(
    () =>
      collection === null
        ? null
        : new CollectionPreviewStore(
            collection.datasets.map((entry) => entry.url),
            loaders,
          ),
    [collection, loaders],
  )
  const genesKey = genes.join('\u0000')

  // The request and pause come first, so the start reads nothing before
  // them. What shows the previews is a child, whose effects run before these
  // and mark the datasets it shows.
  useEffect(() => {
    store?.setPaused(paused)
  }, [paused, store])

  useEffect(() => {
    store?.setRequest({
      genes: genesKey === '' ? [] : genesKey.split('\u0000'),
      scoreMode,
      annotationGroupId,
    })
  }, [annotationGroupId, genesKey, scoreMode, store])

  useEffect(() => {
    if (store === null) return

    store.start()
    return () => {
      store.stop()
    }
  }, [store])

  return store
}

// Re-renders the caller whenever a preview changes.
export function useCollectionPreviewUpdates(store: CollectionPreviewStore | null): void {
  useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getVersion ?? noVersion)
}

function noSubscription(): () => void {
  return () => {}
}

function noVersion(): number {
  return 0
}
