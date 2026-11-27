import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { DatasetCollection } from '../../datasets/datasetCollection'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { CollectionPreviewStore, type OpenTrackValues } from './collectionPreviewStore'

interface PreviewStoreRequestOptions {
  readonly loaders: CollectionPreviewLoaders
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotationGroupId: string | null
  // The metadata track the cells are coloured by, in place of the genes.
  readonly metadataTrackId: string | null
  // The open dataset's values of that track, as the main view has them.
  readonly openTrack: OpenTrackValues | null
  readonly paused: boolean
}

interface UseCollectionPreviewStoreOptions extends PreviewStoreRequestOptions {
  // Null while there is nothing to preview.
  readonly collection: DatasetCollection | null
}

// The previews of a collection's datasets, which the bar and the panels of
// sections shown side by side read from. Each marks the datasets it shows,
// which are read first; the bar asks for the rest after them. The caller is
// not re-rendered as previews arrive: what draws them subscribes with
// useCollectionPreviewUpdates.
export function useCollectionPreviewStore({
  collection,
  loaders,
  genes,
  scoreMode,
  annotationGroupId,
  metadataTrackId,
  openTrack,
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

  usePreviewStoreRequest(store, {
    genes,
    scoreMode,
    annotationGroupId,
    metadataTrackId,
    openTrack,
    paused,
  })
  return store
}

// The open dataset read as a collection preview is, for the 3D view of its
// cells: every cell, and the scores, classes or values that colour them.
// Null reads nothing.
export function useOpenDatasetPreviewStore({
  url,
  loaders,
  genes,
  scoreMode,
  annotationGroupId,
  metadataTrackId,
  openTrack,
  paused,
}: PreviewStoreRequestOptions & {
  readonly url: string | null
}): CollectionPreviewStore | null {
  const store = useMemo(
    () =>
      url === null ? null : new CollectionPreviewStore([url], loaders, { open: true }),
    [loaders, url],
  )

  useEffect(() => {
    if (url !== null) store?.setLinked([url])
  }, [store, url])
  usePreviewStoreRequest(store, {
    genes,
    scoreMode,
    annotationGroupId,
    metadataTrackId,
    openTrack,
    paused,
  })
  return store
}

function usePreviewStoreRequest(
  store: CollectionPreviewStore | null,
  {
    genes,
    scoreMode,
    annotationGroupId,
    metadataTrackId,
    openTrack,
    paused,
  }: Omit<PreviewStoreRequestOptions, 'loaders'>,
): void {
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
      metadataTrackId,
    })
  }, [annotationGroupId, genesKey, metadataTrackId, scoreMode, store])

  useEffect(() => {
    store?.setOpenTrack(openTrack)
  }, [openTrack, store])

  useEffect(() => {
    if (store === null) return

    store.start()
    return () => {
      store.stop()
    }
  }, [store])
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
