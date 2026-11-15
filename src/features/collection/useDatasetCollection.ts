import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { registerCollectionImages } from '../../data/datasetFiles'
import {
  collectionEntryFor,
  type DatasetCollection,
} from '../../datasets/datasetCollection'
import {
  collectionFirstOpening,
  IDLE_COLLECTION_STATE,
  type CollectionDatasetOpening,
  type CollectionState,
} from './collectionModel'

export type CollectionLoader = (
  url: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<DatasetCollection>

interface UseDatasetCollectionOptions {
  // The link's collection=.
  readonly initialUrl: string | undefined
  // The link also names a dataset, which loads as usual; otherwise the
  // collection's first dataset opens once the collection is read.
  readonly linkOpensDataset: boolean
  readonly loadCollection: CollectionLoader
  readonly loadedDatasetUrl: string | null
  readonly onOpenDataset: (url: string, opening: CollectionDatasetOpening) => void
}

export interface DatasetCollectionModel {
  readonly state: CollectionState
  readonly close: () => void
}

// Reads the link's collection and opens its first dataset. Loading a dataset
// that is not in the collection closes it, as does a collection that could
// not be read once any dataset loads.
export function useDatasetCollection({
  initialUrl,
  linkOpensDataset,
  loadCollection,
  loadedDatasetUrl,
  onOpenDataset,
}: UseDatasetCollectionOptions): DatasetCollectionModel {
  const [state, setState] = useState<CollectionState>(() => {
    const url = initialUrl?.trim()
    return url === undefined || url === ''
      ? IDLE_COLLECTION_STATE
      : { status: 'loading', url }
  })
  const [opensFirstDataset] = useState(!linkOpensDataset)
  const [seenLoadedUrl, setSeenLoadedUrl] = useState(loadedDatasetUrl)
  const openDataset = useEffectEvent(onOpenDataset)
  const loadingUrl = state.status === 'loading' ? state.url : null

  if (loadedDatasetUrl !== seenLoadedUrl) {
    setSeenLoadedUrl(loadedDatasetUrl)

    if (
      loadedDatasetUrl !== null &&
      (state.status === 'error' ||
        (state.status === 'ready' &&
          collectionEntryFor(state.collection, loadedDatasetUrl) === undefined))
    ) {
      setState(IDLE_COLLECTION_STATE)
    }
  }

  useEffect(() => {
    if (loadingUrl === null) return

    const controller = new AbortController()

    loadCollection(loadingUrl, { signal: controller.signal }).then(
      (collection) => {
        if (controller.signal.aborted) return

        // Before any of its datasets opens, previews included.
        registerCollectionImages(collection)
        setState({ status: 'ready', url: loadingUrl, collection })
        const first = collection.datasets[0]

        if (opensFirstDataset && first !== undefined) {
          openDataset(first.url, collectionFirstOpening(collection.defaults))
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return

        setState({
          status: 'error',
          url: loadingUrl,
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )

    return () => {
      controller.abort()
    }
  }, [loadCollection, loadingUrl, opensFirstDataset])

  const close = useCallback(() => {
    setState(IDLE_COLLECTION_STATE)
  }, [])

  return { state, close }
}
