import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  IconButton,
  ImageIcon,
  SideBySideIcon,
  StackIcon,
} from '../../components/ui'
import {
  collectionEntryFor,
  collectionGroups,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import { geneExpressionScaleGradient } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import {
  AUTO_GENE_SCALE_RANGE,
  formatPercentile,
  geneScaleBounds,
  geneScalePercentile,
  type GeneScaleRange,
} from '../genes/geneScaleRange'
import {
  COLLECTION_PREVIEW_SIZE_STEP,
  collectionEntryLabel,
  MAX_COLLECTION_PREVIEW_SIZE,
  MIN_COLLECTION_PREVIEW_SIZE,
  type CollectionState,
  type CollectionView,
} from './collectionModel'
import { shownClassOf } from './collectionPreviewData'
import { rasterizePreview, type PreviewOverlay } from './collectionPreviewRaster'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import { canShowBeside, MAX_LINKED_SECTIONS } from './linkedSectionsModel'
import { useCollectionPreviewUpdates } from './useCollectionPreviews'

// The preview's size in CSS px.
export const PREVIEW_WIDTH = 112
export const PREVIEW_HEIGHT = 64
// Datasets this far beyond the bar's ends, or below and above the grid,
// are read ahead of a scroll.
const PREVIEW_READ_AHEAD = '0px 240px'
const GRID_READ_AHEAD = '240px 0px'
// A preview is redrawn at a new size once it has kept it this many ms, so
// dragging the Size slider does not redraw every preview at each step.
const PREVIEW_RESIZE_SETTLE_MS = 150

export interface CollectionBarPreviews {
  // Shared with the panels of sections shown side by side; null until the
  // collection is read. The bar marks the datasets in view, which it reads.
  readonly store: CollectionPreviewStore | null
  // The genes the cells are coloured by; none shows the tissue only.
  readonly genes: readonly string[]
  readonly colorScale: GeneExpressionColorScale
  // The Gene scale's range; Auto ends use the highest score among previews.
  readonly scaleRange?: GeneScaleRange
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotations: CollectionBarAnnotations | null
}

// The width of each preview in the grid, in CSS px, set by its Size slider.
export interface CollectionBarPreviewSize {
  readonly value: number
  readonly onChange: (size: number) => void
}

// Registered sections shown side by side with the open dataset.
export interface CollectionBarBeside {
  readonly shown: readonly DatasetCollectionEntry[]
  readonly onToggle: (entry: DatasetCollectionEntry) => void
}

// Serial sections stacked in 3D: the open dataset's coordinate system, when
// the collection gives its sections depths.
export interface CollectionBarStack {
  readonly sectionCount: number
  readonly shown: boolean
  readonly onToggle: () => void
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
  // Previews in a row, in a grid, or names only; kept in the link.
  readonly view: CollectionView
  readonly onViewChange: (view: CollectionView) => void
  // Without it, the bar lists names only.
  readonly previews?: CollectionBarPreviews
  // Without it, the grid's previews keep their default size.
  readonly previewSize?: CollectionBarPreviewSize
  // Without it, no section can be shown beside the open one.
  readonly beside?: CollectionBarBeside
  // Without it, the open dataset's sections cannot be stacked.
  readonly stack?: CollectionBarStack
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
  view,
  onViewChange,
  previews,
  previewSize,
  beside,
  stack,
}: CollectionBarProps) {
  const collection = state.status === 'ready' ? state.collection : null
  const loadedEntry =
    collection === null ? undefined : collectionEntryFor(collection, loadedUrl)
  const pendingEntry =
    collection === null ? undefined : collectionEntryFor(collection, pendingUrl)
  const showPreviews = view !== 'names'
  const previewsShown = previews !== undefined && showPreviews
  const expanded = view === 'grid' && previewsShown && collection !== null
  const store = previewsShown && collection !== null ? (previews.store ?? null) : null
  useCollectionPreviewUpdates(store)
  const shownBeside = beside?.shown ?? NO_ENTRIES
  const besideFull = shownBeside.length >= MAX_LINKED_SECTIONS
  const groupsRef = useRef<HTMLDivElement>(null)
  const scaleRange = previews?.scaleRange ?? AUTO_GENE_SCALE_RANGE
  // A top score puts every preview on one scale, to compare levels; a top
  // that follows the data (Auto, a percentile) gives each its own, to show
  // where a gene is high within each section.
  const sharedScale = typeof scaleRange.max === 'number'
  const scalePercentile = geneScalePercentile(scaleRange)
  const { min: scaleMin, max: sharedScaleMax } = geneScaleBounds(scaleRange, 0)
  // Each preview's top as drawn, for its label.
  const [drawnTops, setDrawnTops] = useState<ReadonlyMap<string, number>>(() => new Map())
  const reportDrawnTop = useCallback((url: string, top: number) => {
    setDrawnTops((current) =>
      current.get(url) === top ? current : new Map(current).set(url, top),
    )
  }, [])
  const annotations = previews?.annotations ?? null
  const classColors =
    annotations === null
      ? NO_CLASS_COLORS
      : (store?.classColors(annotations.colors) ?? annotations.colors)
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
      style={
        previewSize === undefined
          ? undefined
          : ({
              '--collection-preview-size': `${previewSize.value.toString()}px`,
            } as CSSProperties)
      }
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape') {
          event.stopPropagation()
          onViewChange('row')
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
                  onViewChange(expanded ? 'row' : 'grid')
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
                  onViewChange(showPreviews ? 'names' : 'row')
                }}
              />
              {stack === undefined ? null : (
                <IconButton
                  className="collection-bar-action"
                  title={
                    stack.shown
                      ? 'Stacked in 3D. Click to return to the 2D view'
                      : `Stack in 3D: show the ${stack.sectionCount.toLocaleString()} serial sections of the open dataset at their depths, coloured by the selected genes or annotation set`
                  }
                  aria-label="Stack in 3D"
                  aria-pressed={stack.shown}
                  icon={<StackIcon />}
                  onClick={stack.onToggle}
                />
              )}
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
              sharedScale
                ? 'Every preview uses this scale, the range set in Gene scale'
                : `Each preview runs up to its own ${formatPercentile(scalePercentile)} percentile of the scores above 0, shown under it; cells above it get the top colour. Type a top score in Gene scale to put every preview on one scale`
            }
          >
            <span className="collection-bar-scale-genes">
              {genes.length === 1 ? genes[0] : `${genes.length.toLocaleString()} genes`}
            </span>
            <span className="collection-bar-scale-range">
              <span>{formatGeneScaleValue(scaleMin)}</span>
              <span
                className="collection-bar-scale-ramp"
                style={{ background: geneExpressionScaleGradient(previews.colorScale) }}
                aria-hidden="true"
              />
              <span>
                {sharedScale
                  ? formatGeneScaleValue(sharedScaleMax)
                  : `p${scalePercentile}`}
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
      {expanded && previewSize !== undefined ? (
        <label className="collection-bar-size">
          <span className="collection-bar-size-label">Size</span>
          <input
            type="range"
            title="Size: drag to make the previews larger or smaller"
            aria-label="Preview size"
            min={MIN_COLLECTION_PREVIEW_SIZE}
            max={MAX_COLLECTION_PREVIEW_SIZE}
            step={COLLECTION_PREVIEW_SIZE_STEP}
            value={previewSize.value}
            aria-valuetext={`${previewSize.value.toString()} px wide`}
            onChange={(event) => {
              previewSize.onChange(event.currentTarget.valueAsNumber)
            }}
          />
        </label>
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
                const drawnTop = drawnTops.get(entry.url) ?? 0
                const shownCells =
                  annotations === null || annotations.hiddenIds.size === 0
                    ? undefined
                    : shownClassCellCount(preview?.classes ?? null, annotations)
                const stat =
                  maxScore !== undefined && genes.length > 0
                    ? sharedScale || drawnTop <= 0
                      ? {
                          text: `max ${formatGeneScaleValue(maxScore)}`,
                          title: `highest score ${formatGeneScaleValue(maxScore)}`,
                        }
                      : {
                          text: `top ${formatGeneScaleValue(drawnTop)}`,
                          title: `top colour from ${formatGeneScaleValue(drawnTop)}, the ${formatPercentile(scalePercentile)} percentile of the preview's pixels; highest score ${formatGeneScaleValue(maxScore)}`,
                        }
                    : shownCells !== undefined
                      ? {
                          text: cellCountText(shownCells),
                          title: `${cellCountText(shownCells)} in the shown classes`,
                        }
                      : null

                const canBeside =
                  beside !== undefined && canShowBeside(loadedEntry, entry)
                const isBeside = canBeside && shownBeside.includes(entry)
                // Every dataset keeps its wrapper, so its button is not remounted
                // when the open dataset changes which can be shown beside it: a
                // remount lost keyboard focus, and its preview was never read, as
                // the observer above went on watching the old button.
                return (
                  <span key={entry.url} className="collection-bar-item">
                    <button
                      type="button"
                      className="collection-bar-dataset"
                      title={`${isLoaded ? `${label} is open` : `Open ${label}`}${
                        stat === null ? '' : `; ${stat.title}`
                      }`}
                      aria-label={label}
                      aria-current={isLoaded ? 'true' : undefined}
                      aria-busy={isPending || undefined}
                      data-beside={isBeside || undefined}
                      data-preview-url={store === null ? undefined : entry.url}
                      onClick={() => {
                        if (!isLoaded && !isPending) onSelect(entry)
                        if (view === 'grid') onViewChange('row')
                      }}
                    >
                      {store === null || previews === undefined ? (
                        label
                      ) : (
                        <>
                          <CollectionPreview
                            entry={preview ?? null}
                            colorScale={previews.colorScale}
                            url={entry.url}
                            scaleMin={scaleMin}
                            scaleMax={sharedScaleMax}
                            scalePercentile={sharedScale ? null : scalePercentile}
                            onDrawnTop={reportDrawnTop}
                            annotations={annotations}
                            classColors={classColors}
                          />
                          <span className="collection-bar-dataset-name">{label}</span>
                          {stat === null ? null : (
                            <span className="collection-bar-dataset-max">
                              {stat.text}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                    {canBeside ? (
                      <IconButton
                        className="collection-bar-beside"
                        title={
                          isBeside
                            ? `${label} is shown beside the open dataset, with one view. Click to close it`
                            : besideFull
                              ? `Up to ${MAX_LINKED_SECTIONS} sections can be shown beside the open dataset; close one first`
                              : `Show ${label} beside the open dataset, with one view: it is registered to it`
                        }
                        aria-label={`Show ${label} beside`}
                        aria-pressed={isBeside}
                        disabled={!isBeside && besideFull}
                        icon={<SideBySideIcon />}
                        onClick={() => {
                          beside.onToggle(entry)
                        }}
                      />
                    ) : null}
                  </span>
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
  url,
  colorScale,
  scaleMin,
  scaleMax,
  scalePercentile,
  onDrawnTop,
  annotations,
  classColors,
}: {
  readonly entry: PreviewEntry | null
  readonly url: string
  readonly colorScale: GeneExpressionColorScale
  readonly scaleMin: number
  // The top on a shared scale; with scalePercentile, each preview's top is
  // that percentile of its own drawn pixels, reported through onDrawnTop.
  readonly scaleMax: number
  readonly scalePercentile: number | null
  readonly onDrawnTop: (url: string, top: number) => void
  readonly annotations: CollectionBarAnnotations | null
  readonly classColors: Readonly<Record<string, string>>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = usePreviewSize(canvasRef)
  const cells = entry?.cells ?? null
  const scores = entry?.scores ?? null
  const classes = entry?.classes ?? null
  const overlay = useMemo((): PreviewOverlay | null => {
    if (annotations !== null) {
      if (classes === null) return null

      return {
        kind: 'classes',
        classOf: shownClassOf(classes, annotations.hiddenIds),
        colors: classes.classes.map(({ id }) =>
          annotations.hiddenIds.has(id) ? null : (classColors[id] ?? null),
        ),
      }
    }

    return scores === null ? null : { kind: 'scores', scores }
  }, [annotations, classColors, classes, scores])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || cells === null) return

    const pixelRatio = window.devicePixelRatio || 1
    const width = Math.round(size.width * pixelRatio)
    const height = Math.round(size.height * pixelRatio)
    const raster = rasterizePreview(cells, overlay, {
      width,
      height,
      pointSize: pixelRatio,
      padding: Math.round(3 * pixelRatio),
      colorScale,
      scaleMin,
      scaleMax,
      ...(scalePercentile === null ? {} : { scalePercentile }),
    })
    // Reported even where the canvas cannot draw, so the label matches.
    onDrawnTop(url, raster.scaleMax)

    const context = canvas.getContext('2d')
    if (context === null) return

    canvas.width = width
    canvas.height = height
    context.putImageData(new ImageData(raster.pixels, width, height), 0, 0)
  }, [
    cells,
    colorScale,
    onDrawnTop,
    overlay,
    scaleMax,
    scaleMin,
    scalePercentile,
    size,
    url,
  ])

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
// After the first, a size is taken once the canvas stops resizing; until
// then the old pixels are stretched to fit.
function usePreviewSize(canvasRef: RefObject<HTMLCanvasElement | null>): PreviewSize {
  const [size, setSize] = useState<PreviewSize>(DEFAULT_PREVIEW_SIZE)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof ResizeObserver === 'undefined') return

    let measured = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width === 0 || height === 0) return
      const apply = () => {
        setSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        )
      }
      clearTimeout(timeout)
      if (measured) {
        timeout = setTimeout(apply, PREVIEW_RESIZE_SETTLE_MS)
      } else {
        measured = true
        apply()
      }
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      clearTimeout(timeout)
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
// The cells drawn in a shown class, each once, whatever other classes list it.
function shownClassCellCount(
  classes: PreviewEntry['classes'],
  annotations: CollectionBarAnnotations,
): number | undefined {
  if (classes === null) return undefined

  let count = 0
  for (const classIndex of shownClassOf(classes, annotations.hiddenIds)) {
    if (classIndex >= 0) count += 1
  }
  return count
}

function cellCountText(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'cell' : 'cells'}`
}

// The file name as it reads, not as the address encodes it: `spinal cord.json`.
function collectionFileName(url: string): string {
  let name: string

  try {
    name = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
  } catch {
    return url
  }

  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

const NO_ENTRIES: readonly DatasetCollectionEntry[] = []
const NO_CLASS_COLORS: Readonly<Record<string, string>> = {}
