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

// The shell (UNIFIED_PLAN.md, 15.2): the top bar, the canvas with ⓘ's
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
  useCanvasCornerSizes(canvasRef)
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

// The cards stop above the legend and loading list at the bottom left, so a
// tall card never covers them; the card stack scrolls instead. Toasts centre
// between that stack and the minimap at the bottom right (15.5-E). The sizes
// go to CSS as custom properties on the canvas, without a render.
function useCanvasCornerSizes(canvasRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof ResizeObserver === 'undefined') return

    let bottomLeft: Element | null = null
    let bottomRight: Element | null = null
    const update = () => {
      const bounds = canvas.getBoundingClientRect()
      const left = bottomLeft?.getBoundingClientRect()
      const right = bottomRight?.getBoundingClientRect()
      canvas.style.setProperty('--canvas-bottom-left-height', pixels(left?.height ?? 0))
      canvas.style.setProperty(
        '--canvas-bottom-left-width',
        pixels(bottomLeft === null ? 0 : contentRight(bottomLeft) - bounds.left),
      )
      if (right === undefined) {
        canvas.style.removeProperty('--canvas-bottom-right-width')
      } else {
        const width = pixels(bounds.right - right.left)
        canvas.style.setProperty('--canvas-bottom-right-width', width)
      }
    }
    const resize = new ResizeObserver(update)
    resize.observe(canvas)
    // The legend and loading list come and go, and so does the minimap.
    const track = () => {
      const nextLeft = canvas.querySelector('.viewport-notification-stack')
      const nextRight = canvas.querySelector('.viewer-minimap')
      if (nextLeft === bottomLeft && nextRight === bottomRight) return
      for (const element of [bottomLeft, bottomRight]) {
        if (element !== null) resize.unobserve(element)
      }
      bottomLeft = nextLeft
      bottomRight = nextRight
      for (const element of [bottomLeft, bottomRight]) {
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
  }, [canvasRef])
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
