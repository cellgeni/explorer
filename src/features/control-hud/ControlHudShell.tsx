import type { ReactNode } from 'react'
import { LoadingIndicator } from '../../components/AppStatusPanels'
import { CONTROL_HUD_TABS, type ControlHudTab } from '../app-shell/appShellModel'
import type { LoadingTask } from '../app-shell/appRuntimeModel'

interface ControlHudShellProps {
  readonly collapsed: boolean
  readonly activeTab: ControlHudTab
  readonly loadingTabIds: ReadonlySet<ControlHudTab>
  readonly loadingTasks: readonly LoadingTask[]
  readonly children: ReactNode
  readonly onCollapsedChange: (collapsed: boolean) => void
  readonly onActiveTabChange: (tabId: ControlHudTab, tabLabel: string) => void
}

export function ControlHudShell({
  collapsed,
  activeTab,
  loadingTabIds,
  loadingTasks,
  children,
  onCollapsedChange,
  onActiveTabChange,
}: ControlHudShellProps) {
  return (
    <aside
      className={`control-hud${collapsed ? ' is-collapsed' : ''}`}
      aria-label="Dataset controls"
    >
      <div className="hud-top-bar">
        <LoadingIndicator tasks={loadingTasks} />
        <button
          type="button"
          className="hud-toggle"
          aria-controls="control-hud-content"
          aria-expanded={!collapsed}
          title={collapsed ? 'Show controls' : 'Hide controls'}
          onClick={() => {
            onCollapsedChange(!collapsed)
          }}
        >
          {collapsed ? 'Show Controls' : 'Hide Controls'}
        </button>
      </div>
      <div id="control-hud-content" className="control-hud-content" hidden={collapsed}>
        <div className="hud-tab-list" role="tablist" aria-label="Control categories">
          {CONTROL_HUD_TABS.map((tab) => (
            <button
              key={tab.id}
              id={`hud-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`hud-panel-${tab.id}`}
              aria-busy={loadingTabIds.has(tab.id)}
              title={`Show ${tab.label.toLowerCase()} controls`}
              className={
                [
                  activeTab === tab.id ? 'active' : '',
                  loadingTabIds.has(tab.id) ? 'is-loading' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onClick={() => {
                onActiveTabChange(tab.id, tab.label)
              }}
            >
              <span>{tab.label}</span>
              {loadingTabIds.has(tab.id) ? (
                <span className="tab-loading-dot" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="hud-tab-panels">{children}</div>
      </div>
    </aside>
  )
}
