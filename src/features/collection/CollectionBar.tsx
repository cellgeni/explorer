import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  IconButton,
  ImageIcon,
} from '../../components/ui'
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
import { colorsForAnnotations } from '../annotations/annotationModel'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import {
  AUTO_GENE_SCALE_RANGE,
  geneScaleBounds,
  type GeneScaleRange,
} from '../genes/geneScaleRange'
import { collectionEntryLabel, type CollectionState } from './collectionModel'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { rasterizePreview, type PreviewOverlay } from './collectionPreviewRaster'
import type { PreviewEntry } from './collectionPreviewStore'
import { useCollectionPreviews } from './useCollectionPreviews'

// The preview's size in CSS px.
export const PREVIEW_WIDTH = 112
export const PREVIEW_HEIGHT = 64
// Datasets this far beyond the bar's ends, or below and above the grid,
// are read ahead of a scroll.
const PREVIEW_READ_AHEAD = '0px 240px'
const GRID_READ_AHEAD = '240px 0px'

export interface CollectionBarPreviews {
  readonly loaders: CollectionPreviewLoaders
  // The genes the cells are coloured by; none shows the tissue only.
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  readonly colorScale: GeneExpressionColorScale
  // The Gene scale's range; Auto ends use the highest score among previews.
  readonly scaleRange?: GeneScaleRange
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotations: CollectionBarAnnotations | null
  // While the main view loads a dataset, previews wait.
  readonly paused: boolean
}

export interface CollectionBarAnnotations {
  readonly groupId: string
  readonly label: string
  // The main view's class colours. A class it has not coloured yet takes
  // the colour it will have when its dataset opens.
  readonly colors: Readonly<Record<string, string>>
  // Hidden classes are drawn grey, so the shown ones stand out.
  readonly hiddenIds: ReadonlySet<string>
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
// genes or annotation set. Choosing one opens it in place of the current dataset.
// Expanded, the previews fill the canvas as a grid, until one is chosen.
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
  const [expandedState, setExpanded] = useState(false)
  const previewsShown = previews !== undefined && showPreviews
  const expanded = expandedState && previewsShown && collection !== null
  const store = useCollectionPreviews({
    collection: previewsShown ? collection : null,
    loaders: previews?.loaders ?? NO_LOADERS,
    genes: previews?.genes ?? NO_GENES,
    scoreMode: previews?.scoreMode ?? 'sum',
    annotationGroupId: previews?.annotations?.groupId ?? null,
    paused: previews?.paused ?? false,
  })
  const groupsRef = useRef<HTMLDivElement>(null)
  const scaleRange = previews?.scaleRange ?? AUTO_GENE_SCALE_RANGE
  const scaleBounds = geneScaleBounds(scaleRange, store?.scaleMax() ?? 0)
  const annotations = previews?.annotations ?? null
  const genes = annotations === null ? (previews?.genes ?? NO_GENES) : NO_GENES

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
        {
          root: container,
          rootMargin: expanded ? GRID_READ_AHEAD : PREVIEW_READ_AHEAD,
        },
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
  }, [expanded, store])

  return (
    <nav
      className={[
        'collection-bar',
        previewsShown ? 'has-previews' : '',
        expanded ? 'is-expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Collection"
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape') {
          event.stopPropagation()
          setExpanded(false)
        }
      }}
    >
      <div className="collection-bar-heading">
        <div className="collection-bar-title">
          <span className="collection-bar-kicker">Collection</span>
          {previews === undefined || collection === null ? null : (
            <span className="collection-bar-actions">
              <IconButton
                className="collection-bar-action"
                title={
                  expanded
                    ? 'Collapse: back to the view, with the datasets in a row under it (Escape)'
                    : previewsShown
                      ? 'Expand: show every dataset as a larger preview, in a grid over the view'
                      : 'Expand: turn Previews on to show the datasets as a grid'
                }
                aria-label={expanded ? 'Collapse' : 'Expand'}
                aria-expanded={expanded}
                disabled={!previewsShown}
                icon={expanded ? <CollapseIcon /> : <ExpandIcon />}
                onClick={() => {
                  setExpanded((current) => !current)
                }}
              />
              <IconButton
                className="collection-bar-action"
                title={
                  showPreviews
                    ? 'Previews: each dataset shows its cells, coloured by the selected genes or annotation set. Click to list names only'
                    : "Previews: off. Click to show each dataset's cells, coloured by the selected genes or annotation set"
                }
                aria-label="Previews"
                aria-pressed={showPreviews}
                icon={<ImageIcon />}
                onClick={() => {
                  setShowPreviews((current) => !current)
                }}
              />
            </span>
          )}
        </div>
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
            title={
              scaleRange.max === null
                ? 'Every preview uses this scale, up to the highest score among them'
                : 'Every preview uses this scale, the range set in Gene scale'
            }
          >
            <span className="collection-bar-scale-genes">
              {genes.length === 1 ? genes[0] : `${genes.length.toLocaleString()} genes`}
            </span>
            <span className="collection-bar-scale-range">
              <span>{formatGeneScaleValue(scaleBounds.min)}</span>
              <span
                className="collection-bar-scale-ramp"
                style={{ background: geneExpressionScaleGradient(previews.colorScale) }}
                aria-hidden="true"
              />
              <span>
                {scaleBounds.max > scaleBounds.min
                  ? formatGeneScaleValue(scaleBounds.max)
                  : '…'}
              </span>
            </span>
          </span>
        ) : null}
        {previewsShown && annotations !== null ? (
          <span
            className="collection-bar-scale"
            title="Hidden classes are grey in every preview"
          >
            <span className="collection-bar-scale-genes">{annotations.label}</span>
            {annotations.hiddenIds.size === 0 ? null : (
              <span className="collection-bar-scale-range">
                {annotations.hiddenIds.size.toLocaleString()} hidden
              </span>
            )}
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
                const shownCells =
                  annotations === null || annotations.hiddenIds.size === 0
                    ? undefined
                    : shownClassCellCount(preview?.classes ?? null, annotations)
                const stat =
                  maxScore !== undefined && genes.length > 0
                    ? {
                        text: `max ${formatGeneScaleValue(maxScore)}`,
                        title: `highest score ${formatGeneScaleValue(maxScore)}`,
                      }
                    : shownCells !== undefined
                      ? {
                          text: cellCountText(shownCells),
                          title: `${cellCountText(shownCells)} in the shown classes`,
                        }
                      : null

                return (
                  <button
                    key={entry.url}
                    type="button"
                    className="collection-bar-dataset"
                    title={`${isLoaded ? `${label} is open` : `Open ${label}`}${
                      stat === null ? '' : `; ${stat.title}`
                    }`}
                    aria-label={label}
                    aria-current={isLoaded ? 'true' : undefined}
                    aria-busy={isPending || undefined}
                    data-preview-url={store === null ? undefined : entry.url}
                    onClick={() => {
                      if (!isLoaded && !isPending) onSelect(entry)
                      setExpanded(false)
                    }}
                  >
                    {store === null || previews === undefined ? (
                      label
                    ) : (
                      <>
                        <CollectionPreview
                          entry={preview ?? null}
                          colorScale={previews.colorScale}
                          scaleMin={scaleBounds.min}
                          scaleMax={scaleBounds.max}
                          annotations={annotations}
                        />
                        <span className="collection-bar-dataset-name">{label}</span>
                        {stat === null ? null : (
                          <span className="collection-bar-dataset-max">{stat.text}</span>
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
  scaleMin,
  scaleMax,
  annotations,
}: {
  readonly entry: PreviewEntry | null
  readonly colorScale: GeneExpressionColorScale
  readonly scaleMin: number
  readonly scaleMax: number
  readonly annotations: CollectionBarAnnotations | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = usePreviewSize(canvasRef)
  const cells = entry?.cells ?? null
  const scores = entry?.scores ?? null
  const classes = entry?.classes ?? null
  const overlay = useMemo((): PreviewOverlay | null => {
    if (annotations !== null) {
      if (classes === null) return null

      const colors = colorsForAnnotations(classes.classes, annotations.colors)
      return {
        kind: 'classes',
        classOf: classes.classOf,
        colors: classes.classes.map(({ id }) =>
          annotations.hiddenIds.has(id) ? null : (colors[id] ?? null),
        ),
      }
    }

    return scores === null ? null : { kind: 'scores', scores }
  }, [annotations, classes, scores])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || cells === null) return

    const context = canvas.getContext('2d')
    if (context === null) return

    const pixelRatio = window.devicePixelRatio || 1
    const width = Math.round(size.width * pixelRatio)
    const height = Math.round(size.height * pixelRatio)
    canvas.width = width
    canvas.height = height
    const pixels = rasterizePreview(cells, overlay, {
      width,
      height,
      pointSize: pixelRatio,
      padding: Math.round(3 * pixelRatio),
      colorScale,
      scaleMin,
      scaleMax,
    })
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
  }, [cells, colorScale, overlay, scaleMax, scaleMin, size])

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

// The canvas's size in CSS px, which the bar sets and the grid stretches.
function usePreviewSize(canvasRef: RefObject<HTMLCanvasElement | null>): PreviewSize {
  const [size, setSize] = useState<PreviewSize>(DEFAULT_PREVIEW_SIZE)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width === 0 || height === 0) return
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      )
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
    }
  }, [canvasRef])

  return size
}

interface PreviewSize {
  readonly width: number
  readonly height: number
}

const DEFAULT_PREVIEW_SIZE: PreviewSize = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }

// The cells of the classes not hidden, of every cell in the dataset.
function shownClassCellCount(
  classes: PreviewEntry['classes'],
  annotations: CollectionBarAnnotations,
): number | undefined {
  if (classes === null) return undefined

  let count = 0
  for (const entry of classes.classes) {
    if (!annotations.hiddenIds.has(entry.id)) count += entry.cellCount
  }
  return count
}

function cellCountText(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'cell' : 'cells'}`
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
  loadAnnotations: () => Promise.reject(new Error('No preview loaders.')),
}
