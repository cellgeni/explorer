import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { DatasetCollection } from '../../datasets/datasetCollection'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { CollectionPreviewStore } from './collectionPreviewStore'

interface UseCollectionPreviewsOptions {
  // Null while there is nothing to preview.
  readonly collection: DatasetCollection | null
  readonly loaders: CollectionPreviewLoaders
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotationGroupId: string | null
  readonly paused: boolean
}

// The previews of a collection's datasets, read while the bar shows them.
export function useCollectionPreviews({
  collection,
  loaders,
  genes,
  scoreMode,
  annotationGroupId,
  paused,
}: UseCollectionPreviewsOptions): CollectionPreviewStore | null {
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

  useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getVersion ?? noVersion)

  useEffect(() => {
    if (store === null) return

    store.start()
    return () => {
      store.stop()
    }
  }, [store])

  useEffect(() => {
    store?.setRequest({
      genes: genesKey === '' ? [] : genesKey.split('\u0000'),
      scoreMode,
      annotationGroupId,
    })
  }, [annotationGroupId, genesKey, scoreMode, store])

  useEffect(() => {
    store?.setPaused(paused)
  }, [paused, store])

  return store
}

function noSubscription(): () => void {
  return () => {}
}

function noVersion(): number {
  return 0
}
