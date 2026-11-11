import { useState, type ReactNode } from 'react'
import { Drawer } from '../../components/ui'
import {
  DatasetAbout,
  DatasetDiagnostics,
  DatasetViewOptions,
} from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel } from '../sections/datasetInfoModel'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'
import { TopBar } from './TopBar'
import type { TopBarModel } from './topBarModel'

interface ShellLayoutProps {
  readonly topBar: TopBarModel
  readonly info: DatasetInfoModel
  readonly settings: ViewSettingsModel
  // The canvas, and the panels that sit over it.
  readonly children: ReactNode
}

// The new shell (UNIFIED_PLAN.md, 15.2), shown with ?shell=2 until 15.2-J
// makes it the default: the top bar over the canvas, and ⓘ's dataset info
// drawer. The drawer's sections and issue badge come in 15.2-F.
export function ShellLayout({ topBar, info, settings, children }: ShellLayoutProps) {
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <>
      <TopBar
        model={topBar}
        info={info}
        settings={settings}
        infoOpen={infoOpen}
        onInfoOpenChange={setInfoOpen}
      />
      <div className="shell-body">
        <Drawer
          title="Dataset info"
          open={infoOpen}
          onClose={() => {
            setInfoOpen(false)
          }}
          className="shell-info-drawer"
        >
          {info.about === null ? null : <DatasetAbout about={info.about} />}
          <DatasetViewOptions viewOptions={info.viewOptions} />
          <DatasetDiagnostics diagnostics={info.diagnostics} />
        </Drawer>
        {children}
      </div>
    </>
  )
}
