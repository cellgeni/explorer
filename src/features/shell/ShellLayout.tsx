import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { Sheet } from '../../components/ui'
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

  function layerPanelContent(variant: 'docked' | 'sheet') {
    return (
      <LayerPanel
        variant={variant}
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
      />
    )
  }

  return (
    <>
      <TopBar
        model={topBar}
        info={info}
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
        <div className={infoOpen ? 'shell-canvas has-info-drawer' : 'shell-canvas'}>
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
        {narrow ? (
          <Sheet
            title="Layers"
            summary={sheetSummary(layerPanel)}
            expanded={sheetExpanded}
            onExpandedChange={setSheetExpanded}
            className="shell-layer-sheet"
          >
            {layerPanelContent('sheet')}
          </Sheet>
        ) : (
          layerPanelContent('docked')
        )}
      </div>
    </>
  )
}

// The sheet's handle names what colours the cells, or else the first layer.
function sheetSummary(panel: LayerPanelModel): string | undefined {
  const section =
    panel.sections.find((candidate) => candidate.id === 'cells') ?? panel.sections[0]
  return section === undefined ? undefined : `${section.title}: ${section.summary}`
}
