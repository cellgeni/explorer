import {
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
import type { DatasetInfoModel } from '../sections/datasetInfoModel'
import type { EmbeddingModel } from '../sections/embeddingModel'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import type { TranscriptsSectionModel } from '../sections/transcriptsSectionModel'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'
import type { DatasetLibraryModel } from '../start/datasetLibraryModel'
import { EmbeddingWindow } from './EmbeddingWindow'
import { InfoDrawer } from './InfoDrawer'
import { LayerPanel } from './LayerPanel'
import type { LayerPanelModel } from './layerPanelModel'
import type { ShellPanelState } from './shellLinkModel'
import { isLayerPanelKey } from './shortcuts'
import { TopBar } from './TopBar'
import { useNarrowScreen } from './useNarrowScreen'
import type { TopBarModel } from './topBarModel'

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
  readonly cards: CardStackModel
  // Null where the platform has no cells (images).
  readonly embedding: EmbeddingModel | null
  // Open sections, the info drawer and the Embedding panel, which the link
  // keeps (15.2-H).
  readonly panels: ShellPanelState
  readonly onPanelsChange: (panels: ShellPanelState) => void
  // The canvas, and the panels that sit over it.
  readonly children: ReactNode
}

// The shell (plan 15.2): the top bar, the canvas with ⓘ's
// dataset info drawer and the cards over it, the Embedding panel at its top
// right, and the layer panel docked on the right. Under 860 px the panel is a bottom sheet and the
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
  cards,
  embedding,
  panels,
  onPanelsChange,
  children,
}: ShellLayoutProps) {
  const { infoOpen, embeddingOpen } = panels
  const setInfoOpen = (open: boolean) => {
    onPanelsChange({ ...panels, infoOpen: open })
  }
  const setEmbeddingOpen = (open: boolean) => {
    onPanelsChange({ ...panels, embeddingOpen: open })
  }
  const narrow = useNarrowScreen()
  const canvasRef = useRef<HTMLDivElement>(null)
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
      viewOptions={info.viewOptions}
      expanded={panels.expanded}
      onExpandedChange={(expanded) => {
        onPanelsChange({ ...panels, expanded })
      }}
      embeddingOpen={embeddingOpen}
      onEmbeddingOpenChange={setEmbeddingOpen}
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
          <CardStack cards={cards} />
          {embedding === null ? null : (
            <EmbeddingWindow
              embedding={embedding}
              fullWidth={narrow}
              open={embeddingOpen}
              onClose={() => {
                setEmbeddingOpen(false)
              }}
            />
          )}
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
