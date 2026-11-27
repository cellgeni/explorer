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
  MorphologyCanvas,
  type MorphologyCanvasChannel,
} from '../../components/MorphologyCanvas'
import {
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
import {
  overviewCellRadiusMaxPixels,
  UNCAPPED_RADIUS_PIXELS,
} from '../../rendering/cellPointRenderer'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
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
  type PanelImageMode,
  type PanelLink,
  type ResolvedPanel,
  type ShownPanel,
} from './linkedSectionsModel'
import { useCollectionPreviewUpdates } from './useCollectionPreviews'
import { useFocusHandOff } from './useFocusHandOff'
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
// channels are its own.

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
  // Shows or hides a panel's image or cells, or records its shown channels.
  readonly onPanelChange?: (
    panel: ResolvedPanel,
    patch: Pick<Partial<ResolvedPanel>, 'image' | 'channels'>,
  ) => void
  // Reads a panel's image; without them, panels show cells only.
  readonly imageLoaders?: PanelImageLoaders | null
  // The main view's image channels, which a panel's image starts from.
  readonly mainChannels?: MainImageChannels | null
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
}: LinkedSectionPanelProps) {
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
  const layers = useMemo(
    () =>
      cells === null || !showsCells
        ? []
        : linkedSectionLayers(cells, overlay, {
            colorScale,
            scaleMin,
            scaleMax,
            radiusScale: cellPointScale,
            radiusMaxPixels,
          }),
    [
      cellPointScale,
      cells,
      colorScale,
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
        preview?.loading === true || panelImage.status === 'loading' || undefined
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
