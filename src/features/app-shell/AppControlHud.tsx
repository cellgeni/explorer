import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { ControlHudShell } from '../control-hud/ControlHudShell'
import type { DebugLogAppendOptions } from './appRuntimeModel'
import type { ControlHudTab } from './appShellModel'

interface AppControlHudProps {
  readonly activeControlHudTab: ControlHudTab
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly children: ReactNode
  // Logs HUD tab switches, which only help when debugging.
  readonly debugMode?: boolean | undefined
  readonly hiddenTabIds?: ReadonlySet<ControlHudTab> | undefined
  readonly isControlHudCollapsed: boolean
  readonly loadingTabIds: ReadonlySet<ControlHudTab>
  readonly setActiveControlHudTab: Dispatch<SetStateAction<ControlHudTab>>
  readonly setIsControlHudCollapsed: Dispatch<SetStateAction<boolean>>
}

export function AppControlHud({
  activeControlHudTab,
  appendDebugEvent,
  children,
  debugMode = false,
  hiddenTabIds,
  isControlHudCollapsed,
  loadingTabIds,
  setActiveControlHudTab,
  setIsControlHudCollapsed,
}: AppControlHudProps) {
  return (
    <ControlHudShell
      collapsed={isControlHudCollapsed}
      activeTab={activeControlHudTab}
      hiddenTabIds={hiddenTabIds}
      loadingTabIds={loadingTabIds}
      onCollapsedChange={(nextCollapsed) => {
        setIsControlHudCollapsed(nextCollapsed)
        appendDebugEvent(nextCollapsed ? 'HUD collapsed' : 'HUD expanded')
      }}
      onActiveTabChange={(tabId, tabLabel) => {
        setActiveControlHudTab(tabId)
        if (debugMode) {
          appendDebugEvent(`HUD tab: ${tabLabel}`, {
            coalesceKey: 'hud-tab',
          })
        }
      }}
    >
      {children}
    </ControlHudShell>
  )
}
