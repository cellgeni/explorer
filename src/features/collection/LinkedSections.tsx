import type { PickingInfo, ViewStateChangeParameters } from '@deck.gl/core'
import { DeckGL } from '@deck.gl/react'
import { memo, useCallback, useId, useMemo, useState, useSyncExternalStore } from 'react'
import type { LinkedViewChannel } from '../../components/linkedView'
import { Button, CloseIcon, IconButton } from '../../components/ui'
import { removeDeckFromTabOrder } from '../../components/deckTabOrder'
import { ReleasingDeck } from '../../components/releasingDeck'
import type { DatasetCollectionEntry } from '../../datasets/datasetCollection'
import { overviewCellRadiusMaxPixels } from '../../rendering/cellPointRenderer'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import { fitExtentViewState } from '../../rendering/overviewViewState'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import {
  geneScaleBounds,
  geneScalePercentile,
  geneScoreSpread,
  type GeneScaleRange,
} from '../genes/geneScaleRange'
import type { CollectionBarAnnotations } from './CollectionBar'
import { collectionEntryLabel } from './collectionModel'
import type { PreviewBounds } from './collectionPreviewData'
import type { PreviewOverlay } from './collectionPreviewRaster'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import {
  LINKED_CELLS_LAYER_ID,
  LINKED_SCORES_LAYER_ID,
  LINKED_SECTION_VIEW,
  linkedSectionLayers,
  scoredCells,
  sectionOverlay,
} from './linkedSectionLayers'
import { useCollectionPreviewUpdates } from './useCollectionPreviews'

// The panels of registered sections shown beside the main view, each a
// viewer of one section's cells from its collection preview. They share the
// main view's camera through the linked view channel: pan or zoom any and the
// rest follow. Cells are coloured as the main view colours them: by the
// selected genes, on the Gene scale, or by the annotation set's classes.

export interface LinkedSectionsColoring {
  // The genes cells are coloured by; none draws the cells only.
  readonly genes: readonly string[]
  readonly colorScale: GeneExpressionColorScale
  readonly scaleRange: GeneScaleRange
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotations: CollectionBarAnnotations | null
}

interface LinkedSectionsProps {
  readonly entries: readonly DatasetCollectionEntry[]
  readonly store: CollectionPreviewStore | null
  readonly channel: LinkedViewChannel
  readonly coloring: LinkedSectionsColoring
  readonly cellPointScale: number
  readonly pointSizeFullViewScale: number
  // Settings › Hover tooltips.
  readonly hoverTooltips: boolean
  // Opens the section in the main view, in place of the open dataset.
  readonly onOpen: (entry: DatasetCollectionEntry) => void
  readonly onClose: (entry: DatasetCollectionEntry) => void
}

const MemoDeckGL = memo(DeckGL) as typeof DeckGL
// Points can be a pixel or two across, so hovering picks the nearest within
// this distance.
const PICKING_RADIUS_PIXELS = 6

export function LinkedSections({
  entries,
  store,
  channel,
  coloring,
  cellPointScale,
  pointSizeFullViewScale,
  hoverTooltips,
  onOpen,
  onClose,
}: LinkedSectionsProps) {
  useCollectionPreviewUpdates(store)

  return (
    <>
      {entries.map((entry) => (
        <LinkedSectionPanel
          key={entry.url}
          entry={entry}
          preview={store?.entry(entry.url) ?? null}
          channel={channel}
          coloring={coloring}
          cellPointScale={cellPointScale}
          pointSizeFullViewScale={pointSizeFullViewScale}
          hoverTooltips={hoverTooltips}
          onOpen={onOpen}
          onClose={onClose}
        />
      ))}
    </>
  )
}

interface LinkedSectionPanelProps {
  readonly entry: DatasetCollectionEntry
  readonly preview: PreviewEntry | null
  readonly channel: LinkedViewChannel
  readonly coloring: LinkedSectionsColoring
  readonly cellPointScale: number
  readonly pointSizeFullViewScale: number
  readonly hoverTooltips: boolean
  readonly onOpen: (entry: DatasetCollectionEntry) => void
  readonly onClose: (entry: DatasetCollectionEntry) => void
}

interface PanelHover {
  readonly x: number
  readonly y: number
  readonly text: string
}

function LinkedSectionPanel({
  entry,
  preview,
  channel,
  coloring,
  cellPointScale,
  pointSizeFullViewScale,
  hoverTooltips,
  onOpen,
  onClose,
}: LinkedSectionPanelProps) {
  const label = collectionEntryLabel(entry)
  const source = useId()
  const linkedView = useSyncExternalStore(channel.subscribe, channel.getView)
  const cells = preview?.cells ?? null
  const scores = preview?.scores ?? null
  const classes = preview?.classes ?? null
  const { annotations, colorScale, scaleRange } = coloring
  const showsGenes = annotations === null && coloring.genes.length > 0
  // The zoom at which the section fills a 720 px canvas, from which the main
  // view sizes its points.
  const fittedZoom = useMemo(
    () => (cells === null ? 0 : fitExtentViewState(deckExtent(cells.bounds)).zoom),
    [cells],
  )
  const viewState = useMemo(() => {
    if (linkedView === null) {
      return cells === null
        ? null
        : { ...fitExtentViewState(deckExtent(cells.bounds)), minZoom: -10, maxZoom: 10 }
    }

    return {
      target: [linkedView.target[0], linkedView.target[1], 0] as [number, number, number],
      zoom: linkedView.zoom,
      minZoom: -10,
      maxZoom: 10,
    }
  }, [cells, linkedView])
  const overlay = useMemo(
    () => sectionOverlay({ scores, classes }, { genes: coloring.genes, annotations }),
    [annotations, classes, coloring.genes, scores],
  )
  // On Auto or a percentile top, each section tops out at that percentile of
  // its own scores above 0, as the main view does; a typed top is shared.
  const percentile = geneScalePercentile(scaleRange)
  const ownTop = useMemo(
    () => (scores === null ? 0 : geneScoreSpread(scores.scores, percentile).top),
    [percentile, scores],
  )
  const { min: scaleMin, max: scaleMax } = geneScaleBounds(scaleRange, ownTop)
  const radiusMaxPixels = overviewCellRadiusMaxPixels(
    (viewState?.zoom ?? fittedZoom) - fittedZoom,
    pointSizeFullViewScale,
  )
  const layers = useMemo(
    () =>
      cells === null
        ? []
        : linkedSectionLayers(cells, overlay, {
            colorScale,
            scaleMin,
            scaleMax,
            radiusScale: cellPointScale,
            radiusMaxPixels,
          }),
    [cellPointScale, cells, colorScale, overlay, radiusMaxPixels, scaleMax, scaleMin],
  )
  const handleViewStateChange = useCallback(
    ({ viewState: next }: ViewStateChangeParameters) => {
      const { target, zoom } = next as { target?: readonly number[]; zoom?: number }
      if (target === undefined || zoom === undefined) return

      channel.publish({ target: [target[0] ?? 0, target[1] ?? 0], zoom }, source)
    },
    [channel, source],
  )
  const [hover, setHover] = useState<PanelHover | null>(null)
  const handleHover = useCallback(
    (info: PickingInfo) => {
      if (!hoverTooltips) return

      const text = hoverText(info, preview, overlay, showsGenes ? coloring.genes : [], {
        colorScale,
        scaleMin,
        scaleMax,
      })
      setHover(text === null ? null : { x: info.x, y: info.y, text })
    },
    [
      colorScale,
      coloring.genes,
      hoverTooltips,
      overlay,
      preview,
      scaleMax,
      scaleMin,
      showsGenes,
    ],
  )
  const status =
    preview === null
      ? 'Loading…'
      : (preview.unavailable ??
        (preview.error === null ? null : 'Could not be read') ??
        (cells === null ? 'Loading…' : null))
  const stat =
    showsGenes && scores !== null
      ? typeof scaleRange.max === 'number'
        ? `max ${formatGeneScaleValue(scores.maxScore)}`
        : `top ${formatGeneScaleValue(ownTop)}`
      : null

  return (
    <section
      className="viewer-tile linked-section"
      aria-label={label}
      data-loading={preview?.loading === true || undefined}
      onPointerLeave={() => {
        setHover(null)
      }}
    >
      {cells === null || viewState === null ? null : (
        <div className="deckgl-host" aria-hidden="true">
          <MemoDeckGL
            Deck={ReleasingDeck}
            views={LINKED_SECTION_VIEW}
            viewState={viewState}
            onViewStateChange={handleViewStateChange}
            onHover={handleHover}
            pickingRadius={PICKING_RADIUS_PIXELS}
            controller
            layers={layers}
            onLoad={removeDeckFromTabOrder}
          />
        </div>
      )}
      <div className="viewer-tile-header">
        <span className="viewer-tile-name" title={label}>
          {label}
        </span>
        {stat === null ? null : <span className="viewer-tile-stat">{stat}</span>}
        <Button
          className="viewer-tile-action"
          variant="ghost"
          title={`Open ${label} in the main view, with the image and every tool; the open dataset takes its place here`}
          onClick={() => {
            onOpen(entry)
          }}
        >
          Open
        </Button>
        <IconButton
          className="viewer-tile-action"
          title={`Close ${label}`}
          icon={<CloseIcon />}
          onClick={() => {
            onClose(entry)
          }}
        />
      </div>
      {status === null ? null : (
        <p className="linked-section-status" title={preview?.error ?? undefined}>
          {status}
        </p>
      )}
      {hover === null || !hoverTooltips ? null : (
        <div
          className="linked-section-tooltip"
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          {hover.text}
        </div>
      )}
    </section>
  )
}

function deckExtent(bounds: PreviewBounds) {
  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: -bounds.maxY,
    maxY: -bounds.minY,
  }
}

// The hovered cell: its ID and class, or its score for the genes.
function hoverText(
  info: PickingInfo,
  preview: PreviewEntry | null,
  overlay: PreviewOverlay | null,
  genes: readonly string[],
  scale: Parameters<typeof scoredCells>[1],
): string | null {
  if (info.index < 0 || preview === null || preview.cells === null) return null

  const layerId = info.layer?.id

  if (layerId === LINKED_SCORES_LAYER_ID && overlay?.kind === 'scores') {
    const scoreIndex = scoredCells(overlay.scores, scale).order[info.index]
    const score = scoreIndex === undefined ? undefined : overlay.scores.scores[scoreIndex]
    if (score === undefined) return null

    return `${genes.length === 1 ? genes[0] : 'Score'} ${formatGeneScaleValue(score)}`
  }

  if (layerId !== LINKED_CELLS_LAYER_ID) return null

  const cellId = preview.cells.cellIds[info.index] ?? ''
  // The class it is drawn in, else its first, hidden, class.
  const shownClass =
    overlay?.kind === 'classes' ? (overlay.classOf[info.index] ?? -1) : -1
  const classIndex =
    shownClass >= 0 ? shownClass : (preview.classes?.classOf[info.index] ?? -1)
  const classLabel =
    overlay?.kind === 'classes' ? preview.classes?.classes[classIndex]?.label : undefined
  const parts = [cellId, classLabel].filter(
    (part): part is string => part !== undefined && part !== '',
  )

  return parts.length === 0 ? null : parts.join(' · ')
}
