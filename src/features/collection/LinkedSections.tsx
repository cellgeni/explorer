import type { PickingInfo, ViewStateChangeParameters } from '@deck.gl/core'
import { DeckGL } from '@deck.gl/react'
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { LinkedViewChannel, LinkedViewState } from '../../components/linkedView'
import {
  Button,
  CloseIcon,
  FitIcon,
  IconButton,
  LinkIcon,
  TargetIcon,
  UnlinkIcon,
} from '../../components/ui'
import { removeDeckFromTabOrder } from '../../components/deckTabOrder'
import { PointerTooltip } from '../../components/PointerTooltip'
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
import type { PreviewBounds, PreviewMetadataTrack } from './collectionPreviewData'
import type { PreviewOverlay } from './collectionPreviewRaster'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import {
  LINKED_CELLS_LAYER_ID,
  LINKED_SCORES_LAYER_ID,
  LINKED_SECTION_VIEW,
  linkedSectionLayers,
  scoredCells,
  sectionOverlay,
  valueLabel,
} from './linkedSectionLayers'
import {
  hasOffset,
  LINKED,
  mainViewForPanel,
  NO_OFFSET,
  offsetBetween,
  shownPanelView,
  type PanelLink,
  type ShownPanel,
} from './linkedSectionsModel'
import { useCollectionPreviewUpdates } from './useCollectionPreviews'
import { useFocusHandOff } from './useFocusHandOff'

// The panels of sections shown beside the main view, each a viewer of one
// section's cells from its collection preview. A linked panel shares the main
// view's camera through the linked view channel, at its offset: pan or zoom
// any linked viewer and the rest follow. An unlinked one pans and zooms on
// its own. Cells are coloured as the main view colours them: by the selected
// genes, on the Gene scale, by the annotation set's classes, or by a metadata
// track.

export interface LinkedSectionsColoring {
  // The genes cells are coloured by; none draws the cells only.
  readonly genes: readonly string[]
  readonly colorScale: GeneExpressionColorScale
  readonly scaleRange: GeneScaleRange
  // The annotation set the cells are coloured by, in place of the genes.
  readonly annotations: CollectionBarAnnotations | null
  // The metadata track the cells are coloured by, in place of the genes.
  readonly metadata: PreviewMetadataTrack | null
}

interface LinkedSectionsProps {
  readonly panels: readonly ShownPanel[]
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
  // Links or unlinks a panel, or resets its offset.
  readonly onLinkChange: (url: string, link: PanelLink) => void
  // An unlinked panel's view, once it has stopped moving, for the address.
  readonly onViewReport: (url: string, view: LinkedViewState | null) => void
}

const MemoDeckGL = memo(DeckGL) as typeof DeckGL
const NO_CLASS_COLORS: Readonly<Record<string, string>> = {}
// Points can be a pixel or two across, so hovering picks the nearest within
// this distance.
const PICKING_RADIUS_PIXELS = 6
// How long an unlinked panel's view rests before the address takes it, as
// the main view's does.
const VIEW_REPORT_DELAY_MS = 180

export function LinkedSections({
  panels,
  store,
  channel,
  coloring,
  cellPointScale,
  pointSizeFullViewScale,
  hoverTooltips,
  onOpen,
  onClose,
  onLinkChange,
  onViewReport,
}: LinkedSectionsProps) {
  useCollectionPreviewUpdates(store)
  const classColors =
    coloring.annotations === null
      ? NO_CLASS_COLORS
      : (store?.classColors(coloring.annotations.colors) ?? coloring.annotations.colors)
  // The track over the range the bar and the stack use.
  const metadata =
    coloring.metadata === null
      ? null
      : (store?.valueRange(coloring.metadata) ?? coloring.metadata)
  const shownColoring =
    metadata === coloring.metadata ? coloring : { ...coloring, metadata }

  return (
    <>
      {panels.map(({ entry, panel }) => (
        <LinkedSectionPanel
          key={entry.url}
          entry={entry}
          link={panel.link}
          preview={store?.entry(entry.url) ?? null}
          channel={channel}
          coloring={shownColoring}
          classColors={classColors}
          cellPointScale={cellPointScale}
          pointSizeFullViewScale={pointSizeFullViewScale}
          hoverTooltips={hoverTooltips}
          onOpen={onOpen}
          onClose={onClose}
          onLinkChange={onLinkChange}
          onViewReport={onViewReport}
        />
      ))}
    </>
  )
}

interface LinkedSectionPanelProps {
  readonly entry: DatasetCollectionEntry
  readonly link: PanelLink
  readonly preview: PreviewEntry | null
  readonly channel: LinkedViewChannel
  readonly coloring: LinkedSectionsColoring
  readonly classColors: Readonly<Record<string, string>>
  readonly cellPointScale: number
  readonly pointSizeFullViewScale: number
  readonly hoverTooltips: boolean
  readonly onOpen: (entry: DatasetCollectionEntry) => void
  readonly onClose: (entry: DatasetCollectionEntry) => void
  readonly onLinkChange: (url: string, link: PanelLink) => void
  readonly onViewReport: (url: string, view: LinkedViewState | null) => void
}

interface PanelHover {
  readonly x: number
  readonly y: number
  readonly text: string
}

function LinkedSectionPanel({
  entry,
  link,
  preview,
  channel,
  coloring,
  classColors,
  cellPointScale,
  pointSizeFullViewScale,
  hoverTooltips,
  onOpen,
  onClose,
  onLinkChange,
  onViewReport,
}: LinkedSectionPanelProps) {
  const label = collectionEntryLabel(entry)
  const source = useId()
  const panelRef = useRef<HTMLElement>(null)
  useFocusHandOff(panelRef)
  const mainView = useSyncExternalStore(channel.subscribe, channel.getView)
  // An unlinked panel's view, kept here as it moves; it starts from the
  // link's, again whenever the link changes.
  const [own, setOwn] = useState(() => ({ link, view: unlinkedView(link) }))
  if (own.link !== link) {
    setOwn({ link, view: unlinkedView(link) })
  }
  const shownView = link.linked ? shownPanelView(link, mainView) : own.view
  const cells = preview?.cells ?? null
  const scores = preview?.scores ?? null
  const classes = preview?.classes ?? null
  const values = preview?.values ?? null
  const { annotations, metadata, colorScale, scaleRange } = coloring
  const showsGenes =
    annotations === null && metadata === null && coloring.genes.length > 0
  // The zoom at which the section fills a 720 px canvas, from which the main
  // view sizes its points.
  const fittedZoom = useMemo(
    () => (cells === null ? 0 : fitExtentViewState(deckExtent(cells.bounds)).zoom),
    [cells],
  )
  const fittedView = useMemo(
    () =>
      cells === null
        ? null
        : { ...fitExtentViewState(deckExtent(cells.bounds)), minZoom: -10, maxZoom: 10 },
    [cells],
  )
  const viewState = useMemo(() => {
    if (shownView === null) return fittedView

    return {
      target: [shownView.target[0], shownView.target[1], 0] as [number, number, number],
      zoom: shownView.zoom,
      minZoom: -10,
      maxZoom: 10,
    }
  }, [fittedView, shownView])
  const overlay = useMemo(
    () =>
      sectionOverlay(
        { scores, classes, values },
        { genes: coloring.genes, annotations, metadata, classColors },
      ),
    [annotations, classColors, classes, coloring.genes, metadata, scores, values],
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

      const view: LinkedViewState = { target: [target[0] ?? 0, target[1] ?? 0], zoom }

      if (link.linked) {
        channel.publish(mainViewForPanel(link.offset, view), source)
      } else {
        setOwn({ link, view })
      }
    },
    [channel, link, source],
  )
  // The address takes an unlinked panel's view once it rests.
  const ownView = own.link === link ? own.view : null
  const reportedRef = useRef<LinkedViewState | null>(unlinkedView(link))
  useEffect(() => {
    if (link.linked || ownView === reportedRef.current) return

    const timer = setTimeout(() => {
      reportedRef.current = ownView
      onViewReport(entry.url, ownView)
    }, VIEW_REPORT_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [entry.url, link.linked, onViewReport, ownView])
  // What the panel shows now: its view, else fitted to its section.
  const currentView = (): LinkedViewState | null =>
    shownView ??
    (fittedView === null
      ? null
      : { target: [fittedView.target[0], fittedView.target[1]], zoom: fittedView.zoom })
  const toggleLink = () => {
    const view = currentView()

    if (link.linked) {
      onLinkChange(entry.url, { linked: false, view })
    } else {
      onLinkChange(entry.url, {
        linked: true,
        offset:
          view === null || mainView === null ? NO_OFFSET : offsetBetween(view, mainView),
      })
    }
  }
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
      ref={panelRef}
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
        <IconButton
          className="viewer-tile-action"
          title={
            link.linked
              ? `Linked: ${label} pans and zooms with the main view. Click to unlink it`
              : `Unlinked: ${label} pans and zooms on its own. Click to link it to the main view where it is now`
          }
          aria-label={`Link ${label} to the main view`}
          aria-pressed={link.linked}
          icon={link.linked ? <LinkIcon /> : <UnlinkIcon />}
          onClick={toggleLink}
        />
        {link.linked ? (
          <IconButton
            className="viewer-tile-action"
            title={
              hasOffset(link.offset)
                ? `Reset the offset: show ${label} at the main view's centre and zoom`
                : `${label} is at the main view's centre and zoom`
            }
            aria-label={`Reset the offset of ${label}`}
            disabled={!hasOffset(link.offset)}
            icon={<TargetIcon />}
            onClick={() => {
              onLinkChange(entry.url, LINKED)
            }}
          />
        ) : (
          <IconButton
            className="viewer-tile-action"
            title={`Fit ${label} to the panel`}
            aria-label={`Fit ${label}`}
            disabled={own.view === null}
            icon={<FitIcon />}
            onClick={() => {
              setOwn({ link, view: null })
            }}
          />
        )}
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
        <PointerTooltip x={hover.x} y={hover.y} className="linked-section-tooltip">
          {hover.text}
        </PointerTooltip>
      )}
    </section>
  )
}

function unlinkedView(link: PanelLink): LinkedViewState | null {
  return link.linked ? null : link.view
}

function deckExtent(bounds: PreviewBounds) {
  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: -bounds.maxY,
    maxY: -bounds.minY,
  }
}

// The hovered cell: its ID and class or value, or its score for the genes.
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
  const parts = [cellId, classLabel, valueLabel(overlay, info.index)].filter(
    (part): part is string => part !== undefined && part !== '',
  )

  return parts.length === 0 ? null : parts.join(' · ')
}
