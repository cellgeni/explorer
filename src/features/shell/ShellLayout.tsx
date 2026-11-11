import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
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
import { isLayerPanelKey } from './shortcuts'
import { TopBar } from './TopBar'
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
  // The canvas, and the panels that sit over it.
  readonly children: ReactNode
}

// The new shell (UNIFIED_PLAN.md, 15.2), shown with ?shell=2 until 15.2-J
// makes it the default: the top bar, the canvas with ⓘ's dataset info drawer
// and the cards over it, the Embedding panel at its top right, and the layer
// panel docked on the right.
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
  children,
}: ShellLayoutProps) {
  const [infoOpen, setInfoOpen] = useState(false)
  const [embeddingOpen, setEmbeddingOpen] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const togglePanel = useEffectEvent(() => {
    setPanelCollapsed((current) => !current)
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

  return (
    <>
      <TopBar
        model={topBar}
        info={info}
        settings={settings}
        infoOpen={infoOpen}
        onInfoOpenChange={setInfoOpen}
      />
      <div className={panelCollapsed ? 'shell-body is-panel-collapsed' : 'shell-body'}>
        <div className="shell-canvas">
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
              open={embeddingOpen}
              onClose={() => {
                setEmbeddingOpen(false)
              }}
            />
          )}
        </div>
        <LayerPanel
          panel={layerPanel}
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
          image={image}
          cells={cells}
          transcripts={transcripts}
          annotations={annotations}
          viewOptions={info.viewOptions}
          embeddingOpen={embeddingOpen}
          onEmbeddingOpenChange={setEmbeddingOpen}
        />
      </div>
    </>
  )
}
