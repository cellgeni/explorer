import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { isTextEntryTarget } from '../app-shell/activeToolModel'
import { CardStack } from '../cards/CardStack'
import type { CardStackModel } from '../cards/cardModels'
import type { AnnotationsSectionModel } from '../sections/annotationsSectionModel'
import type { CellsSectionModel } from '../sections/cellsSectionModel'
import type { SegmentationSectionModel } from '../sections/segmentationSectionModel'
import type { DatasetInfoModel } from '../sections/datasetInfoModel'
import type { EmbeddingModel } from '../sections/embeddingModel'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import type { TranscriptsSectionModel } from '../sections/transcriptsSectionModel'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'
import type { PlotsModel } from '../plots/usePlotsModel'
import type { CellQueryModel } from '../query/useCellQueryModel'
import type { DatasetLibraryModel } from '../start/datasetLibraryModel'
import { EmbeddingWindow } from './EmbeddingWindow'
import {
  EMBEDDING_WINDOW_SIZE,
  PLOTS_WINDOW_SIZE,
  plotsWindowRightOffset,
  QUERY_WINDOW_SIZE,
  queryWindowRightOffset,
  windowOpensUnderDrawer,
} from './floatingWindowModel'
import { InfoDrawer } from './InfoDrawer'
import { LayerPanel } from './LayerPanel'
import { PlotsWindow } from './PlotsWindow'
import { QueryWindow } from './QueryWindow'
import type { LayerPanelModel, LayerReveal } from './layerPanelModel'
import type { ShellPanelState } from './shellLinkModel'
import { isLayerPanelKey } from './shortcuts'
import { TopBar } from './TopBar'
import { useNarrowScreen } from './useNarrowScreen'
import type { PanelToggle, TopBarModel } from './topBarModel'

interface ShellLayoutProps {
  readonly topBar: TopBarModel
  readonly info: DatasetInfoModel
  // Examples and recent datasets, in the dataset name's menu (15.3-A).
  readonly library: DatasetLibraryModel
  readonly settings: ViewSettingsModel
  readonly layerPanel: LayerPanelModel
  readonly image: ImageSectionModel
  readonly cells: CellsSectionModel
  readonly transcripts: TranscriptsSectionModel
  readonly annotations: AnnotationsSectionModel
  // An image's imported segmentation (plan 25); null elsewhere.
  readonly segmentation?: SegmentationSectionModel | null
  readonly cards: CardStackModel
  // Null where the platform has no cells (images).
  readonly embedding: EmbeddingModel | null
  // Null where the cells have no annotation sets (images, Visium HD).
  readonly plots?: PlotsModel | null
  // Null where the cells cannot be queried (images, Visium HD).
  readonly query?: CellQueryModel | null
  // Open sections, the info drawer and the Embedding, Plots and Cell Query
  // windows, which the link keeps (15.2-H, 22-D8, 23-D9).
  readonly panels: ShellPanelState
  readonly onPanelsChange: (panels: ShellPanelState) => void
  // The open collection's datasets, under the canvas.
  readonly collection?: ReactNode
  // Brings part of the layer panel into view, such as from the legend.
  readonly layerReveal?: LayerReveal | null
  // Browse Store's drawer, over the right of the canvas.
  readonly storeStructure?: ReactNode
  // The canvas, and the panels that sit over it.
  readonly children: ReactNode
}

// The shell (plan 15.2): the top bar, the canvas with ⓘ's
// dataset info drawer and the cards over it, the Embedding, Plots and Cell
// Query windows at its top right, opened from the top bar, the collection bar
// under it when a collection is open, and the layer panel docked on the
// right. Under 860 px the panel is a bottom sheet and the
// cards dock at the bottom (15.2-I).
export function ShellLayout({
  topBar,
  info,
  library,
  settings,
  layerPanel,
  image,
  cells,
  transcripts,
  annotations,
  segmentation = null,
  cards,
  embedding,
  plots = null,
  query = null,
  panels,
  onPanelsChange,
  collection,
  layerReveal = null,
  storeStructure,
  children,
}: ShellLayoutProps) {
  const { infoOpen, embeddingOpen, plotsOpen, queryOpen } = panels
  const narrow = useNarrowScreen()
  const setInfoOpen = (open: boolean) => {
    onPanelsChange({ ...panels, infoOpen: open })
  }
  // Under 860 px each window is full width, so opening one closes the
  // others (22-D8, 23-D9).
  const narrowClosed = {
    embeddingOpen: false,
    plotsOpen: false,
    queryOpen: false,
  }
  const [embeddingWidth, setEmbeddingWidth] = useState(EMBEDDING_WINDOW_SIZE.width)
  const handleEmbeddingSizeChange = useCallback((size: { readonly width: number }) => {
    setEmbeddingWidth(size.width)
  }, [])
  const [plotsWidth, setPlotsWidth] = useState(PLOTS_WINDOW_SIZE.width)
  const handlePlotsSizeChange = useCallback((size: { readonly width: number }) => {
    setPlotsWidth(size.width)
  }, [])
  const embeddingShown = embedding !== null && embeddingOpen
  const plotsShown = plots !== null && plotsOpen
  const plotsRightOffset = plotsWindowRightOffset(embeddingShown, embeddingWidth, narrow)
  const queryRightOffset = queryWindowRightOffset(
    [...(embeddingShown ? [embeddingWidth] : []), ...(plotsShown ? [plotsWidth] : [])],
    narrow,
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  // A window opening where the open Dataset info drawer would cover it
  // closes the drawer (EXP-029). Windows already open keep their place.
  const drawerClosedFor = (rightOffset: number | undefined, width: number) => {
    // Read when a window opens, from the one canvas the shell draws.
    const canvas = document.querySelector('.shell-canvas')
    const drawer = canvas?.querySelector('.shell-info-drawer')

    if (!infoOpen || narrow || canvas == null || drawer == null) return {}

    const canvasBox = canvas.getBoundingClientRect()
    // Not laid out yet: nothing to measure.
    if (canvasBox.width === 0) return {}
    return windowOpensUnderDrawer({
      canvasWidth: canvasBox.width,
      drawerRight: drawer.getBoundingClientRect().right - canvasBox.left,
      rightOffset,
      width,
    })
      ? { infoOpen: false }
      : {}
  }
  const setEmbeddingOpen = (open: boolean) => {
    onPanelsChange({
      ...panels,
      ...(open && narrow ? narrowClosed : {}),
      ...(open && !embeddingOpen ? drawerClosedFor(undefined, embeddingWidth) : {}),
      embeddingOpen: open,
    })
  }
  const setPlotsOpen = (open: boolean) => {
    onPanelsChange({
      ...panels,
      ...(open && narrow ? narrowClosed : {}),
      ...(open && !plotsOpen ? drawerClosedFor(plotsRightOffset, plotsWidth) : {}),
      plotsOpen: open,
    })
  }
  const setQueryOpen = (open: boolean) => {
    onPanelsChange({
      ...panels,
      ...(open && narrow ? narrowClosed : {}),
      ...(open && !queryOpen
        ? drawerClosedFor(queryRightOffset, QUERY_WINDOW_SIZE.width)
        : {}),
      queryOpen: open,
    })
  }
  // The window last clicked or focused is drawn over the others, which
  // overlap once moved.
  const [frontWindow, setFrontWindow] = useState<PanelToggle['panel'] | null>(null)
  // The Cell Query window mounts the first time it opens, so a session that
  // never uses it does not render it with every update, then stays mounted
  // to keep its size.
  const [queryMounted, setQueryMounted] = useState(queryOpen)
  if (queryOpen && !queryMounted) setQueryMounted(true)
  useCanvasCornerSizes(canvasRef, narrow)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  // On narrow screens the panel is a bottom sheet that starts as a 56 px
  // handle (15.2-I).
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const togglePanel = useEffectEvent(() => {
    if (narrow) setSheetExpanded((current) => !current)
    else setPanelCollapsed((current) => !current)
  })

  // \ hides or shows the layer panel, except while typing.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) {
        return
      }

      if (!isLayerPanelKey(event)) return

      event.preventDefault()
      togglePanel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // The top bar opens and closes the windows the dataset has.
  const panelToggles: PanelToggle[] = []
  if (embedding !== null) {
    panelToggles.push({
      panel: 'embedding',
      open: embeddingOpen,
      onOpenChange: setEmbeddingOpen,
    })
  }
  if (plots !== null) {
    panelToggles.push({ panel: 'plots', open: plotsOpen, onOpenChange: setPlotsOpen })
  }
  if (query !== null) {
    panelToggles.push({ panel: 'query', open: queryOpen, onOpenChange: setQueryOpen })
  }

  // The same element whatever the width, so the sections keep their state.
  const layerPanelContent = (
    <LayerPanel
      panel={layerPanel}
      collapsed={panelCollapsed}
      onCollapsedChange={setPanelCollapsed}
      image={image}
      cells={cells}
      transcripts={transcripts}
      annotations={annotations}
      segmentation={segmentation}
      viewOptions={info.viewOptions}
      expanded={panels.expanded}
      onExpandedChange={(expanded) => {
        onPanelsChange({ ...panels, expanded })
      }}
      reveal={layerReveal}
      sheet={
        narrow
          ? {
              expanded: sheetExpanded,
              onExpandedChange: setSheetExpanded,
              summary: sheetSummary(layerPanel),
            }
          : undefined
      }
    />
  )

  return (
    <>
      <TopBar
        model={topBar}
        info={info}
        library={library}
        settings={settings}
        infoOpen={infoOpen}
        onInfoOpenChange={setInfoOpen}
        panels={panelToggles}
        narrow={narrow}
      />
      <div
        className={
          narrow
            ? 'shell-body is-narrow'
            : panelCollapsed
              ? 'shell-body is-panel-collapsed'
              : 'shell-body'
        }
      >
        <div className="shell-main">
          <div
            ref={canvasRef}
            className={infoOpen ? 'shell-canvas has-info-drawer' : 'shell-canvas'}
          >
            <InfoDrawer
              info={info}
              open={infoOpen}
              onClose={() => {
                setInfoOpen(false)
              }}
            />
            {children}
            {storeStructure}
            <CardStack cards={cards} />
            {embedding === null ? null : (
              <EmbeddingWindow
                embedding={embedding}
                fullWidth={narrow}
                open={embeddingOpen}
                onClose={() => {
                  setEmbeddingOpen(false)
                }}
                front={frontWindow === 'embedding'}
                onActivate={() => {
                  setFrontWindow('embedding')
                }}
                onSizeChange={handleEmbeddingSizeChange}
              />
            )}
            {plots === null ? null : (
              <PlotsWindow
                plots={plots}
                fullWidth={narrow}
                rightOffset={plotsRightOffset}
                open={plotsOpen}
                onClose={() => {
                  setPlotsOpen(false)
                }}
                front={frontWindow === 'plots'}
                onActivate={() => {
                  setFrontWindow('plots')
                }}
                onSizeChange={handlePlotsSizeChange}
              />
            )}
            {query === null || !queryMounted ? null : (
              <QueryWindow
                query={query}
                fullWidth={narrow}
                rightOffset={queryRightOffset}
                open={queryOpen}
                onClose={() => {
                  setQueryOpen(false)
                }}
                front={frontWindow === 'query'}
                onActivate={() => {
                  setFrontWindow('query')
                }}
              />
            )}
          </div>
          {collection}
        </div>
        {layerPanelContent}
      </div>
    </>
  )
}

// A toast is at least 280 px wide, with 12 px clear on each side (shell.css).
const TOAST_MIN_WIDTH = 280
const TOAST_MARGIN = 12

// The cards stop above the legend and loading list at the bottom left, so a
// tall card never covers them; the card stack scrolls instead. Toasts centre
// between that stack and the minimap at the bottom right (15.5-E), or rise
// above both where the gap is too narrow for a toast. Under 860 px an open
// card docks at the bottom as a sheet, and the zoom buttons, scale bar and
// legend rise above it. The sizes go to CSS as custom properties on the
// canvas, without a render.
function useCanvasCornerSizes(
  canvasRef: RefObject<HTMLDivElement | null>,
  narrow: boolean,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof ResizeObserver === 'undefined') return

    let bottomLeft: Element | null = null
    let bottomRight: Element | null = null
    let cards: Element | null = null
    let toasts: Element | null = null
    const update = () => {
      const bounds = canvas.getBoundingClientRect()
      const left = bottomLeft?.getBoundingClientRect()
      const right = bottomRight?.getBoundingClientRect()
      const leftWidth = bottomLeft === null ? 0 : contentRight(bottomLeft) - bounds.left
      const rightWidth = right === undefined ? 0 : bounds.right - right.left
      canvas.style.setProperty('--canvas-bottom-left-height', pixels(left?.height ?? 0))
      canvas.style.setProperty('--canvas-bottom-left-width', pixels(leftWidth))
      if (right === undefined) {
        canvas.style.removeProperty('--canvas-bottom-right-width')
      } else {
        canvas.style.setProperty('--canvas-bottom-right-width', pixels(rightWidth))
      }

      // How far up the canvas a docked card reaches; the canvas runs on
      // under it.
      const sheetTop = narrow ? cards?.getBoundingClientRect().top : undefined
      canvas.style.setProperty(
        '--canvas-bottom-sheet-height',
        pixels(sheetTop === undefined ? 0 : bounds.bottom - sheetTop),
      )

      // A gap too narrow for a toast, as at 1024 px with the loading list
      // showing, sends toasts above both corners, though never off the top.
      const raised =
        !narrow &&
        bounds.width - leftWidth - rightWidth < TOAST_MIN_WIDTH + 2 * TOAST_MARGIN
      canvas.toggleAttribute('data-toast-raised', raised)
      if (raised) {
        const clear =
          Math.max(
            left === undefined ? 0 : bounds.bottom - left.top,
            right === undefined ? 0 : bounds.bottom - right.top,
          ) + TOAST_MARGIN
        const highest =
          bounds.height - (toasts?.getBoundingClientRect().height ?? 0) - TOAST_MARGIN
        canvas.style.setProperty('--toast-bottom', pixels(Math.min(clear, highest)))
      } else {
        canvas.style.removeProperty('--toast-bottom')
      }
    }
    const resize = new ResizeObserver(update)
    resize.observe(canvas)
    // The legend and loading list come and go, and so do the minimap, the
    // cards and the toasts.
    const track = () => {
      const previous = [bottomLeft, bottomRight, cards, toasts]
      bottomLeft = canvas.querySelector('.viewport-notification-stack')
      bottomRight = canvas.querySelector('.viewer-minimap')
      cards = canvas.querySelector('.shell-card-stack')
      toasts = canvas.querySelector('.viewer-toasts')
      const next = [bottomLeft, bottomRight, cards, toasts]
      if (next.every((element, index) => element === previous[index])) return
      for (const element of previous) {
        if (element !== null) resize.unobserve(element)
      }
      for (const element of next) {
        if (element !== null) resize.observe(element)
      }
      update()
    }
    const mutation = new MutationObserver(track)
    mutation.observe(canvas, { childList: true, subtree: true })
    track()

    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [canvasRef, narrow])
}

// The stack is a fixed-width column; what covers the canvas is its widest
// child, such as a 260 px legend without the loading list.
function contentRight(element: Element): number {
  return Math.max(
    element.getBoundingClientRect().left,
    ...Array.from(element.children, (child) => child.getBoundingClientRect().right),
  )
}

function pixels(size: number): string {
  return `${Math.max(0, Math.ceil(size))}px`
}

// The sheet's handle names what colours the cells, or else the first layer.
function sheetSummary(panel: LayerPanelModel): string | undefined {
  const section =
    panel.sections.find((candidate) => candidate.id === 'cells') ?? panel.sections[0]
  return section === undefined ? undefined : `${section.title}: ${section.summary}`
}
