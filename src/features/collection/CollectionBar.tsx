import { useEffect, useRef, useState } from 'react'
import { Button, CloseIcon, IconButton } from '../../components/ui'
import {
  collectionEntryFor,
  collectionGroups,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import { geneExpressionScaleGradient } from '../../rendering/deckLayerColors'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayerTypes'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import { collectionEntryLabel, type CollectionState } from './collectionModel'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { rasterizePreview } from './collectionPreviewRaster'
import type { PreviewEntry } from './collectionPreviewStore'
import { useCollectionPreviews } from './useCollectionPreviews'

// The preview's size in CSS px.
export const PREVIEW_WIDTH = 112
export const PREVIEW_HEIGHT = 64
// Datasets this far beyond the bar's ends are read ahead of a scroll.
const PREVIEW_READ_AHEAD = '0px 240px'

export interface CollectionBarPreviews {
  readonly loaders: CollectionPreviewLoaders
  // The genes the cells are coloured by; none shows the tissue only.
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  readonly colorScale: GeneExpressionColorScale
  // While the main view loads a dataset, previews wait.
  readonly paused: boolean
}

interface CollectionBarProps {
  readonly state: Exclude<CollectionState, { readonly status: 'idle' }>
  // The dataset shown, and the one loading in its place.
  readonly loadedUrl: string | null
  readonly pendingUrl: string | null
  readonly onSelect: (entry: DatasetCollectionEntry) => void
  readonly onClose: () => void
  // Without it, the bar lists names only.
  readonly previews?: CollectionBarPreviews
}

const NO_GENES: readonly string[] = []

// The open collection's datasets under the canvas, grouped as the collection
// groups them, each with a preview of its cells coloured by the selected
// genes. Choosing one opens it in place of the current dataset.
export function CollectionBar({
  state,
  loadedUrl,
  pendingUrl,
  onSelect,
  onClose,
  previews,
}: CollectionBarProps) {
  const collection = state.status === 'ready' ? state.collection : null
  const loadedEntry =
    collection === null ? undefined : collectionEntryFor(collection, loadedUrl)
  const pendingEntry =
    collection === null ? undefined : collectionEntryFor(collection, pendingUrl)
  const [showPreviews, setShowPreviews] = useState(true)
  const previewsShown = previews !== undefined && showPreviews
  const store = useCollectionPreviews({
    collection: previewsShown ? collection : null,
    loaders: previews?.loaders ?? NO_LOADERS,
    genes: previews?.genes ?? NO_GENES,
    scoreMode: previews?.scoreMode ?? 'sum',
    paused: previews?.paused ?? false,
  })
  const groupsRef = useRef<HTMLDivElement>(null)
  const scaleMax = store?.scaleMax() ?? 0
  const genes = previews?.genes ?? NO_GENES

  // Only the previews in view, and a little beyond, are read.
  useEffect(() => {
    const container = groupsRef.current
    if (store === null || container === null) return

    const cards = [...container.querySelectorAll<HTMLElement>('[data-preview-url]')]
    const urlOf = (card: Element) => (card as HTMLElement).dataset.previewUrl ?? ''

    if (typeof IntersectionObserver === 'undefined') {
      for (const card of cards) store.setVisible(urlOf(card), true)
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            store.setVisible(urlOf(entry.target), entry.isIntersecting)
          }
        },
        { root: container, rootMargin: PREVIEW_READ_AHEAD },
      )

      for (const card of cards) observer.observe(card)

      return () => {
        observer.disconnect()
        for (const card of cards) store.setVisible(urlOf(card), false)
      }
    }

    return () => {
      for (const card of cards) store.setVisible(urlOf(card), false)
    }
  }, [store])

  return (
    <nav
      className={previewsShown ? 'collection-bar has-previews' : 'collection-bar'}
      aria-label="Collection"
    >
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
        {previewsShown && previews !== undefined && genes.length > 0 ? (
          <span
            className="collection-bar-scale"
            title="Every preview uses this scale, up to the highest score among them"
          >
            <span className="collection-bar-scale-genes">
              {genes.length === 1 ? genes[0] : `${genes.length.toLocaleString()} genes`}
            </span>
            <span className="collection-bar-scale-range">
              <span>0</span>
              <span
                className="collection-bar-scale-ramp"
                style={{ background: geneExpressionScaleGradient(previews.colorScale) }}
                aria-hidden="true"
              />
              <span>{scaleMax > 0 ? formatGeneScaleValue(scaleMax) : '…'}</span>
            </span>
          </span>
        ) : null}
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
        <div className="collection-bar-groups" ref={groupsRef}>
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
                const preview = store?.entry(entry.url)
                const maxScore = preview?.scores?.maxScore

                return (
                  <button
                    key={entry.url}
                    type="button"
                    className="collection-bar-dataset"
                    title={`${isLoaded ? `${label} is open` : `Open ${label}`}${
                      maxScore === undefined || genes.length === 0
                        ? ''
                        : `; highest score ${formatGeneScaleValue(maxScore)}`
                    }`}
                    aria-label={label}
                    aria-current={isLoaded ? 'true' : undefined}
                    aria-busy={isPending || undefined}
                    data-preview-url={store === null ? undefined : entry.url}
                    onClick={() => {
                      if (!isLoaded && !isPending) onSelect(entry)
                    }}
                  >
                    {store === null || previews === undefined ? (
                      label
                    ) : (
                      <>
                        <CollectionPreview
                          entry={preview ?? null}
                          colorScale={previews.colorScale}
                          scaleMax={scaleMax}
                        />
                        <span className="collection-bar-dataset-name">{label}</span>
                        {maxScore === undefined || genes.length === 0 ? null : (
                          <span className="collection-bar-dataset-max">
                            max {formatGeneScaleValue(maxScore)}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {previews === undefined || collection === null ? null : (
        <Button
          variant="ghost"
          className="collection-bar-toggle"
          title={
            showPreviews
              ? 'Show the datasets by name only'
              : 'Show a preview of each dataset'
          }
          aria-pressed={showPreviews}
          onClick={() => {
            setShowPreviews((current) => !current)
          }}
        >
          Previews
        </Button>
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

function CollectionPreview({
  entry,
  colorScale,
  scaleMax,
}: {
  readonly entry: PreviewEntry | null
  readonly colorScale: GeneExpressionColorScale
  readonly scaleMax: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cells = entry?.cells ?? null
  const scores = entry?.scores ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || cells === null) return

    const context = canvas.getContext('2d')
    if (context === null) return

    const pixelRatio = window.devicePixelRatio || 1
    const width = Math.round(PREVIEW_WIDTH * pixelRatio)
    const height = Math.round(PREVIEW_HEIGHT * pixelRatio)
    canvas.width = width
    canvas.height = height
    const pixels = rasterizePreview(cells, scores, {
      width,
      height,
      pointSize: pixelRatio,
      padding: Math.round(3 * pixelRatio),
      colorScale,
      scaleMax,
    })
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
  }, [cells, colorScale, scaleMax, scores])

  const status =
    entry === null
      ? null
      : (entry.unavailable ??
        (entry.error === null ? null : 'Preview failed') ??
        (entry.loading && cells === null ? 'Loading…' : null))

  return (
    <span
      className="collection-bar-preview"
      data-loading={entry?.loading === true || undefined}
      title={entry?.error ?? undefined}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {status === null ? null : (
        <span className="collection-bar-preview-status">{status}</span>
      )}
    </span>
  )
}

function collectionFileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }
}

const NO_LOADERS: CollectionPreviewLoaders = {
  detectSpatialDataset: () => Promise.reject(new Error('No preview loaders.')),
  getSpatialDataset: () => Promise.reject(new Error('No preview loaders.')),
  loadDatasetOverview: () => Promise.reject(new Error('No preview loaders.')),
  loadGeneExpression: () => Promise.reject(new Error('No preview loaders.')),
}
