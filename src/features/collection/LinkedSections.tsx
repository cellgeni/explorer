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
  type RefObject,
} from 'react'
import type { LinkedViewChannel, LinkedViewState } from '../../components/linkedView'
import {
  MorphologyCanvas,
  type MorphologyCanvasChannel,
} from '../../components/MorphologyCanvas'
import {
  BoundariesIcon,
  Button,
  ChannelsIcon,
  Checkbox,
  CloseIcon,
  FitIcon,
  IconButton,
  ImageIcon,
  LinkIcon,
  Popover,
  TargetIcon,
  UnlinkIcon,
} from '../../components/ui'
import { placedImageExtent } from '../../data/imagePyramid'
import { removeDeckFromTabOrder } from '../../components/deckTabOrder'
import { PointerTooltip } from '../../components/PointerTooltip'
import { ReleasingDeck } from '../../components/releasingDeck'
import type { DatasetCollectionEntry } from '../../datasets/datasetCollection'
import { BOUNDARY_VIEWPORT_CELL_LIMIT } from '../../rendering/boundaryViewport'
import { CELL_BOUNDARY_HIT_AREA_LAYER_ID } from '../../rendering/cellBoundaryRenderer'
import {
  overviewCellRadiusMaxPixels,
  UNCAPPED_RADIUS_PIXELS,
} from '../../rendering/cellPointRenderer'
import type {
  CellBoundaryDatum,
  GeneExpressionColorScale,
} from '../../rendering/deckLayerTypes'
import {
  DEFAULT_CELL_BOUNDARY_OPACITY,
  DEFAULT_CELL_FILL_OPACITY,
} from '../../rendering/layerOpacity'
import { fitExtentViewState } from '../../rendering/overviewViewState'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import { MorphologyChannelControls } from '../morphology/MorphologyChannelControls'
import { normalizeChannelContrast } from '../morphology/morphologyChannels'
import {
  geneScaleBounds,
  geneScalePercentile,
  geneScoreSpread,
  type GeneScaleRange,
} from '../genes/geneScaleRange'
import type { CollectionBarAnnotations } from './CollectionBar'
import { sameDatasetUrl } from '../../datasets/datasetCollection'
import { collectionEntryLabel } from './collectionModel'
import type { PreviewBounds, PreviewMetadataTrack } from './collectionPreviewData'
import type { PreviewOverlay } from './collectionPreviewRaster'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import {
  LINKED_CELLS_LAYER_ID,
  LINKED_SCORES_LAYER_ID,
  LINKED_SECTION_VIEW,
  linkedSectionLayers,
  linkedSectionOutlines,
  linkedSectionOutlineStyle,
  outlinedScoreIndexes,
  scoredCells,
  sectionOverlay,
  valueLabel,
  type LinkedSectionOutlineLayers,
} from './linkedSectionLayers'
import {
  hasOffset,
  LINKED,
  mainViewForPanel,
  NO_OFFSET,
  offsetBetween,
  shownPanelView,
  type PanelImageMode,
  type PanelLink,
  type ResolvedPanel,
  type ShownPanel,
} from './linkedSectionsModel'
import type { PanelBoundaryLoaders, PanelSize } from './panelBoundaries'
import { useCollectionPreviewUpdates } from './useCollectionPreviews'
import { useFocusHandOff } from './useFocusHandOff'
import { usePanelBoundaries, type PanelBoundaryState } from './usePanelBoundaries'
import {
  usePanelImage,
  type MainImageChannels,
  type PanelImageLoaders,
} from './usePanelImage'

// The panels of sections shown beside the main view, each a viewer of one
// section's cells from its collection preview, over its image when asked
// (plan 30-D4). A linked panel shares the main view's camera through the
// linked view channel, at its offset: pan or zoom any linked viewer and the
// rest follow. An unlinked one pans and zooms on its own. Cells are coloured
// as the main view colours them: by the selected genes, on the Gene scale, by
// the annotation set's classes, or by a metadata track. Each panel's image
// channels are its own. A panel draws its section's cell boundaries when
// asked (plan 30-D9), read for its own view by the main view's rules.

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
  // The open dataset, whose own panels (its image beside, plan 30-D8) have
  // no Open.
  readonly openUrl?: string | null
  // Opens the section in the main view, in place of the open dataset.
  readonly onOpen: (entry: DatasetCollectionEntry) => void
  readonly onClose: (panel: ResolvedPanel) => void
  // Links or unlinks a panel, or resets its offset.
  readonly onLinkChange: (panel: ResolvedPanel, link: PanelLink) => void
  // An unlinked panel's view, once it has stopped moving, for the address:
  // by the link it has moved under.
  readonly onViewReport: (link: PanelLink, view: LinkedViewState | null) => void
  // Shows or hides a panel's image, cells or boundaries, or records its
  // shown channels.
  readonly onPanelChange?: (
    panel: ResolvedPanel,
    patch: Pick<Partial<ResolvedPanel>, 'image' | 'channels' | 'boundaries'>,
  ) => void
  // Reads a panel's image; without them, panels show cells only.
  readonly imageLoaders?: PanelImageLoaders | null
  // The main view's image channels, which a panel's image starts from.
  readonly mainChannels?: MainImageChannels | null
  // Reads a panel's cell boundaries; without them, panels offer none.
  readonly boundaryLoaders?: PanelBoundaryLoaders | null
  // The main view's Boundary limit, Cell fill and Boundary opacities, which
  // panels draw their outlines by.
  readonly boundaryCellLimit?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
}

const MemoDeckGL = memo(DeckGL) as typeof DeckGL
const NO_CLASS_COLORS: Readonly<Record<string, string>> = {}
// Points can be a pixel or two across, so hovering picks the nearest within
// this distance.
const PICKING_RADIUS_PIXELS = 6
// How long an unlinked panel's view rests before the address takes it, as
// the main view's does.
const VIEW_REPORT_DELAY_MS = 180
// Decoded tiles a panel keeps: fewer than the main view's 120, as up to
// three panels draw images beside it (plan 30-D7).
const PANEL_TILE_CACHE_MAX_TILES = 48
const NO_IMAGE_LOADERS: PanelImageLoaders = {
  loadPanelImage: () => Promise.resolve(null),
  retainDataset: () => () => {},
  computeAutoChannelContrast: () => Promise.reject(new Error('No image')),
}
const NO_PANEL_CHANGE = () => {}
const NO_BOUNDARY_LOADERS: PanelBoundaryLoaders = {
  hasCellBoundaries: () => Promise.resolve(false),
  loadBoundaryElements: () => Promise.resolve({ elements: [] }),
  retainDataset: () => () => {},
}
const NO_SCORE_INDEXES: ReadonlyMap<string, number> = new Map()

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
  onPanelChange = NO_PANEL_CHANGE,
  imageLoaders = null,
  mainChannels = null,
  boundaryLoaders = null,
  boundaryCellLimit = BOUNDARY_VIEWPORT_CELL_LIMIT,
  cellFillOpacity = DEFAULT_CELL_FILL_OPACITY,
  cellBoundaryOpacity = DEFAULT_CELL_BOUNDARY_OPACITY,
  openUrl = null,
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

  // The open dataset's own panels are told apart by a number after the
  // first, as their regions need names of their own.
  let ownCount = 0

  return (
    <>
      {panels.map(({ entry, panel }) => {
        const own = openUrl !== null && sameDatasetUrl(entry.url, openUrl)
        const ownNumber = own ? ++ownCount : 0
        const label = collectionEntryLabel(entry)

        return (
          <LinkedSectionPanel
            key={own ? `own:${ownNumber}` : entry.url}
            entry={entry}
            panel={panel}
            label={
              own ? `${label}, beside${ownNumber > 1 ? ` ${ownNumber}` : ''}` : label
            }
            isOwn={own}
            link={panel.link}
            image={panel.image ?? null}
            channels={panel.channels ?? null}
            boundaries={panel.boundaries === true}
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
            onPanelChange={onPanelChange}
            imageLoaders={imageLoaders}
            mainChannels={mainChannels}
            boundaryLoaders={boundaryLoaders}
            boundaryCellLimit={boundaryCellLimit}
            cellFillOpacity={cellFillOpacity}
            cellBoundaryOpacity={cellBoundaryOpacity}
          />
        )
      })}
    </>
  )
}

interface MainSectionHeaderProps {
  readonly name: string | null
  // The Layers drawer's Image eye, as the panels' own image toggles show
  // theirs; null without an image.
  readonly image: {
    readonly visible: boolean
    readonly onVisibleChange: (visible: boolean) => void
  } | null
}

// The main view's pill while panels are beside it: its dataset's name, and
// its image shown or hidden, the Layers drawer's Image eye.
export function MainSectionHeader({ name, image }: MainSectionHeaderProps) {
  const label = name ?? 'the main view'

  return (
    <div className="viewer-tile-header">
      <span className="viewer-tile-name" title={name ?? undefined}>
        {name}
      </span>
      {image === null ? null : (
        <IconButton
          className="viewer-tile-action"
          title={
            image.visible
              ? `Hide the image of ${label} in the main view`
              : `Show the image of ${label} in the main view`
          }
          aria-label={`Show the image of ${label} in the main view`}
          aria-pressed={image.visible}
          icon={<ImageIcon />}
          onClick={() => {
            image.onVisibleChange(!image.visible)
          }}
        />
      )}
    </div>
  )
}

interface LinkedSectionPanelProps {
  readonly entry: DatasetCollectionEntry
  readonly panel: ResolvedPanel
  readonly label: string
  // A panel of the open dataset itself.
  readonly isOwn: boolean
  readonly link: PanelLink
  readonly image: PanelImageMode
  readonly channels: readonly string[] | null
  readonly boundaries: boolean
  readonly preview: PreviewEntry | null
  readonly channel: LinkedViewChannel
  readonly coloring: LinkedSectionsColoring
  readonly classColors: Readonly<Record<string, string>>
  readonly cellPointScale: number
  readonly pointSizeFullViewScale: number
  readonly hoverTooltips: boolean
  readonly onOpen: (entry: DatasetCollectionEntry) => void
  readonly onClose: (panel: ResolvedPanel) => void
  readonly onLinkChange: (panel: ResolvedPanel, link: PanelLink) => void
  readonly onViewReport: (link: PanelLink, view: LinkedViewState | null) => void
  readonly onPanelChange: NonNullable<LinkedSectionsProps['onPanelChange']>
  readonly imageLoaders: PanelImageLoaders | null
  readonly mainChannels: MainImageChannels | null
  readonly boundaryLoaders: PanelBoundaryLoaders | null
  readonly boundaryCellLimit: number
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
}

interface PanelHover {
  readonly x: number
  readonly y: number
  readonly text: string
}

function LinkedSectionPanel({
  entry,
  panel,
  label,
  isOwn,
  link,
  image,
  channels,
  boundaries,
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
  onPanelChange,
  imageLoaders,
  mainChannels,
  boundaryLoaders,
  boundaryCellLimit,
  cellFillOpacity,
  cellBoundaryOpacity,
}: LinkedSectionPanelProps) {
  const source = useId()
  const panelRef = useRef<HTMLElement>(null)
  useFocusHandOff(panelRef)
  const size = usePanelSize(panelRef)
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
  // A section without cells has only its image to show, so it loads at once.
  const noCells = preview !== null && preview.unavailable !== null && cells === null
  const imageMode: PanelImageMode = noCells ? 'only' : image
  const panelImage = usePanelImage({
    url: entry.url,
    enabled: imageMode !== null && imageLoaders !== null,
    loaders: imageLoaders ?? NO_IMAGE_LOADERS,
    channelSelection: channels,
    mainChannels,
  })
  const pyramid = panelImage.image?.kind === 'pyramid' ? panelImage.image : null
  const flat = panelImage.image?.kind === 'flat' ? panelImage.image.image : null
  const canvasChannels = useMemo<readonly MorphologyCanvasChannel[]>(
    () =>
      (pyramid?.image.channelLoaders ?? []).map((imageChannel) => {
        const setting = panelImage.settings.find(
          (candidate) => candidate.id === imageChannel.info.id,
        )

        return {
          id: imageChannel.info.id,
          loader: imageChannel.loader,
          enabled: setting?.enabled ?? false,
          color: setting?.color ?? imageChannel.info.color,
          contrast: normalizeChannelContrast({
            min: setting?.contrastMin ?? imageChannel.info.contrast.min,
            max: setting?.contrastMax ?? imageChannel.info.contrast.max,
          }),
          ...(imageChannel.info.alphaFromIntensity === undefined
            ? {}
            : { alphaFromIntensity: imageChannel.info.alphaFromIntensity }),
        }
      }),
    [panelImage.settings, pyramid],
  )
  // The address keeps the channels a panel shows.
  const shownChannelsKey =
    pyramid === null
      ? null
      : JSON.stringify(
          panelImage.settings
            .filter((setting) => setting.enabled)
            .map((setting) => setting.id),
        )
  useEffect(() => {
    if (shownChannelsKey === null || shownChannelsKey === JSON.stringify(channels)) return

    onPanelChange(panel, { channels: JSON.parse(shownChannelsKey) as string[] })
  }, [channels, onPanelChange, panel, shownChannelsKey])
  // Where the image lies, to fit a section without cells to it.
  const imageBounds = useMemo((): PreviewBounds | null => {
    if (cells !== null) return null
    if (pyramid !== null) return placedImageExtent(pyramid.image.loader)
    if (flat?.size === undefined) return null

    return {
      minX: 0,
      minY: 0,
      maxX: (flat.size[0] / flat.scaleFactor) * flat.micrometersPerPixel,
      maxY: (flat.size[1] / flat.scaleFactor) * flat.micrometersPerPixel,
    }
  }, [cells, flat, pyramid])
  const sectionBounds = cells?.bounds ?? imageBounds
  // The zoom at which the section fills a 720 px canvas, from which the main
  // view sizes its points.
  const fittedZoom = useMemo(
    () => (cells === null ? 0 : fitExtentViewState(deckExtent(cells.bounds)).zoom),
    [cells],
  )
  const fittedView = useMemo(
    () =>
      sectionBounds === null
        ? null
        : { ...fitExtentViewState(deckExtent(sectionBounds)), minZoom: -10, maxZoom: 10 },
    [sectionBounds],
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
  // Visium spots keep their size at every zoom, as in the main view.
  const radiusMaxPixels =
    cells?.trueSize === true
      ? UNCAPPED_RADIUS_PIXELS
      : overviewCellRadiusMaxPixels(
          (viewState?.zoom ?? fittedZoom) - fittedZoom,
          pointSizeFullViewScale,
        )
  const showsCells = imageMode !== 'only'
  // Outlines are read while they can be drawn: over the cells.
  const boundariesShown = boundaries && boundaryLoaders !== null && !noCells && showsCells
  const boundaryState = usePanelBoundaries({
    url: entry.url,
    enabled: boundariesShown,
    loaders: boundaryLoaders ?? NO_BOUNDARY_LOADERS,
    positions: cells?.positions ?? null,
    view:
      viewState === null
        ? null
        : { target: [viewState.target[0], viewState.target[1]], zoom: viewState.zoom },
    size,
    cellLimit: boundaryCellLimit,
  })
  const boundaryElements = boundaryState.elements
  const outlines = useMemo(
    () =>
      !boundariesShown || cells === null
        ? null
        : linkedSectionOutlines(boundaryElements, cells),
    [boundariesShown, boundaryElements, cells],
  )
  const outlineScores = overlay?.kind === 'scores' ? overlay.scores : null
  const scoreIndexById = useMemo(
    () =>
      outlines === null
        ? NO_SCORE_INDEXES
        : outlinedScoreIndexes(outlines, outlineScores),
    [outlineScores, outlines],
  )
  const outlineStyle = useMemo(
    () =>
      outlines === null
        ? null
        : linkedSectionOutlineStyle(outlines, overlay, scoreIndexById, {
            colorScale,
            scaleMin,
            scaleMax,
          }),
    [colorScale, outlines, overlay, scaleMax, scaleMin, scoreIndexById],
  )
  const outlineLayers = useMemo(
    (): LinkedSectionOutlineLayers | null =>
      outlines === null || outlineStyle === null
        ? null
        : {
            outlines,
            scoreIndexById,
            style: outlineStyle,
            filled: overlay !== null,
            fillOpacity: cellFillOpacity,
            lineOpacity: cellBoundaryOpacity,
          },
    [
      cellBoundaryOpacity,
      cellFillOpacity,
      outlineStyle,
      outlines,
      overlay,
      scoreIndexById,
    ],
  )
  const layers = useMemo(
    () =>
      cells === null || !showsCells
        ? []
        : linkedSectionLayers(
            cells,
            overlay,
            {
              colorScale,
              scaleMin,
              scaleMax,
              radiusScale: cellPointScale,
              radiusMaxPixels,
            },
            outlineLayers,
          ),
    [
      cellPointScale,
      cells,
      colorScale,
      outlineLayers,
      overlay,
      radiusMaxPixels,
      scaleMax,
      scaleMin,
      showsCells,
    ],
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
      onViewReport(link, ownView)
    }, VIEW_REPORT_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [link, onViewReport, ownView])
  // What the panel shows now: its view, else fitted to its section.
  const currentView = (): LinkedViewState | null =>
    shownView ??
    (fittedView === null
      ? null
      : { target: [fittedView.target[0], fittedView.target[1]], zoom: fittedView.zoom })
  const toggleLink = () => {
    const view = currentView()

    if (link.linked) {
      onLinkChange(panel, { linked: false, view })
    } else {
      onLinkChange(panel, {
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

      const text = hoverText(
        info,
        preview,
        overlay,
        showsGenes ? coloring.genes : [],
        { colorScale, scaleMin, scaleMax },
        outlineLayers,
      )
      setHover(text === null ? null : { x: info.x, y: info.y, text })
    },
    [
      colorScale,
      coloring.genes,
      hoverTooltips,
      outlineLayers,
      overlay,
      preview,
      scaleMax,
      scaleMin,
      showsGenes,
    ],
  )
  const imageStatus =
    panelImage.status === 'loading'
      ? 'Loading the image…'
      : panelImage.status === 'error'
        ? 'The image could not be read'
        : panelImage.status === 'none'
          ? `${preview?.unavailable ?? 'No cells'}, and no image`
          : null
  const status = noCells
    ? imageStatus
    : preview === null
      ? 'Loading…'
      : (preview.unavailable ??
        (preview.error === null ? null : 'Could not be read') ??
        (cells === null ? 'Loading…' : null))
  const imageTitle =
    panelImage.status === 'none'
      ? `${label} has no image. Click to stop showing it`
      : panelImage.status === 'error'
        ? `The image of ${label} could not be read: ${panelImage.error ?? ''}. Click to stop showing it`
        : imageMode === null
          ? `Show the image of ${label} under its cells, without opening it`
          : `Hide the image of ${label}`
  const boundaryTitle = panelBoundaryTitle(
    label,
    boundariesShown ? boundaryState : null,
    boundaryCellLimit,
  )
  const boundaryNote = boundariesShown
    ? panelBoundaryNote(label, boundaryState, boundaryCellLimit)
    : null
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
      data-loading={
        preview?.loading === true ||
        panelImage.status === 'loading' ||
        (boundariesShown &&
          (boundaryState.status === 'checking' || boundaryState.status === 'loading')) ||
        undefined
      }
      onPointerLeave={() => {
        setHover(null)
      }}
    >
      {panelImage.status !== 'ready' || viewState === null ? null : (
        <MorphologyCanvas
          loader={pyramid?.image.loader ?? null}
          channels={canvasChannels}
          flatImage={flat}
          viewState={viewState}
          tileCacheMaxTiles={PANEL_TILE_CACHE_MAX_TILES}
        />
      )}
      {viewState === null || (cells === null && panelImage.status !== 'ready') ? null : (
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
        {stat === null || !showsCells ? null : (
          <span className="viewer-tile-stat">{stat}</span>
        )}
        {noCells || imageLoaders === null ? null : (
          <IconButton
            className="viewer-tile-action"
            title={imageTitle}
            aria-label={`Show the image of ${label}`}
            aria-pressed={imageMode !== null}
            icon={<ImageIcon />}
            onClick={() => {
              onPanelChange(panel, { image: imageMode === null ? 'cells' : null })
            }}
          />
        )}
        {panelImage.status !== 'ready' ? null : (
          <Popover
            title={`Image of ${label}`}
            triggerLabel={`Channels of ${label}`}
            trigger={<ChannelsIcon />}
            triggerClassName="ui-icon-button viewer-tile-action"
            align="end"
            className="linked-section-channels"
          >
            {noCells || cells === null ? null : (
              <Checkbox
                title={`Show the cells of ${label} over its image`}
                label="Cells"
                checked={showsCells}
                onChange={(checked) => {
                  onPanelChange(panel, { image: checked ? 'cells' : 'only' })
                }}
              />
            )}
            {pyramid === null ? null : (
              <MorphologyChannelControls
                autoContrastChannelIds={panelImage.autoContrastChannelIds}
                channels={pyramid.image.channelLoaders}
                settings={panelImage.settings}
                onUpdate={panelImage.updateChannel}
                onAutoContrast={panelImage.autoContrast}
              />
            )}
          </Popover>
        )}
        {noCells || boundaryLoaders === null ? null : (
          <IconButton
            className="viewer-tile-action"
            title={boundaryTitle}
            aria-label={`Show the cell boundaries of ${label}`}
            aria-pressed={boundaries}
            icon={<BoundariesIcon />}
            onClick={() => {
              onPanelChange(panel, { boundaries: !boundaries })
            }}
          />
        )}
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
              onLinkChange(panel, LINKED)
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
        {isOwn ? null : (
          <Button
            className="viewer-tile-action"
            variant="ghost"
            title={`Open ${label} in the main view, with every tool; the open dataset takes its place here`}
            onClick={() => {
              onOpen(entry)
            }}
          >
            Open
          </Button>
        )}
        <IconButton
          className="viewer-tile-action"
          title={`Close ${label}`}
          icon={<CloseIcon />}
          onClick={() => {
            onClose(panel)
          }}
        />
      </div>
      {status === null ? null : (
        <p className="linked-section-status" title={preview?.error ?? undefined}>
          {status}
        </p>
      )}
      {status !== null || boundaryNote === null ? null : (
        <p className="linked-section-note">{boundaryNote}</p>
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

// The hovered cell or outline: its ID and class or value, or its score for
// the genes.
function hoverText(
  info: PickingInfo,
  preview: PreviewEntry | null,
  overlay: PreviewOverlay | null,
  genes: readonly string[],
  scale: Parameters<typeof scoredCells>[1],
  outlineLayers: LinkedSectionOutlineLayers | null,
): string | null {
  if (info.index < 0 || preview === null || preview.cells === null) return null

  const layerId = info.layer?.id

  if (layerId === CELL_BOUNDARY_HIT_AREA_LAYER_ID) {
    const id = (info.object as CellBoundaryDatum | undefined)?.id
    if (id === undefined || outlineLayers === null) return null

    const scoreIndex = outlineLayers.scoreIndexById.get(id)
    const score =
      overlay?.kind === 'scores' && scoreIndex !== undefined
        ? overlay.scores.scores[scoreIndex]
        : undefined
    if (score !== undefined && Number.isFinite(score) && score > 0) {
      return scoreText(genes, score)
    }

    const cellIndex = outlineLayers.outlines.cellIndexById.get(id)
    return cellIndex === undefined ? id : cellText(preview, overlay, cellIndex)
  }

  if (layerId === LINKED_SCORES_LAYER_ID && overlay?.kind === 'scores') {
    const scoreIndex = scoredCells(overlay.scores, scale).order[info.index]
    const score = scoreIndex === undefined ? undefined : overlay.scores.scores[scoreIndex]
    if (score === undefined) return null

    return scoreText(genes, score)
  }

  if (layerId !== LINKED_CELLS_LAYER_ID) return null

  return cellText(preview, overlay, info.index)
}

function scoreText(genes: readonly string[], score: number): string {
  return `${genes.length === 1 ? genes[0] : 'Score'} ${formatGeneScaleValue(score)}`
}

// A cell's ID, and its class or value.
function cellText(
  preview: PreviewEntry,
  overlay: PreviewOverlay | null,
  index: number,
): string | null {
  const cellId = preview.cells?.cellIds[index] ?? ''
  // The class it is drawn in, else its first, hidden, class.
  const shownClass = overlay?.kind === 'classes' ? (overlay.classOf[index] ?? -1) : -1
  const classIndex =
    shownClass >= 0 ? shownClass : (preview.classes?.classOf[index] ?? -1)
  const classLabel =
    overlay?.kind === 'classes' ? preview.classes?.classes[classIndex]?.label : undefined
  const parts = [cellId, classLabel, valueLabel(overlay, index)].filter(
    (part): part is string => part !== undefined && part !== '',
  )

  return parts.length === 0 ? null : parts.join(' · ')
}

// The boundaries button's tooltip: what it does, or why nothing is drawn.
function panelBoundaryTitle(
  label: string,
  state: PanelBoundaryState | null,
  cellLimit: number,
): string {
  if (state === null) {
    return `Draw the cell boundaries of ${label}, once fewer than ${cellLimit.toLocaleString()} cells are in view`
  }

  if (state.status === 'none') {
    return `${label} has no cell boundaries. Click to stop showing them`
  }

  if (state.status === 'error') {
    return `The cell boundaries of ${label} could not be read: ${state.error ?? ''}. Click to stop showing them`
  }

  return `Hide the cell boundaries of ${label}`
}

// Why a panel asked for its boundaries draws none: too many cells in view,
// none to draw, or a failed read.
function panelBoundaryNote(
  label: string,
  state: PanelBoundaryState,
  cellLimit: number,
): string | null {
  switch (state.status) {
    case 'zoom':
      return `Zoom in for cell boundaries: ${state.visibleCellCount.toLocaleString()} cells in view, over the Boundary limit of ${cellLimit.toLocaleString()}`
    case 'none':
      return `${label} has no cell boundaries`
    case 'error':
      return 'The cell boundaries could not be read'
    default:
      return null
  }
}

// A panel's size on screen, followed as it changes; null until measured.
function usePanelSize(ref: RefObject<HTMLElement | null>): PanelSize | null {
  const [size, setSize] = useState<PanelSize | null>(null)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return

      const { width, height } = entry.contentRect
      setSize((current) =>
        current !== null && current.width === width && current.height === height
          ? current
          : { width, height },
      )
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])

  return size
}
