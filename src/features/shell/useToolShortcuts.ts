import { useEffect, useEffectEvent } from 'react'
import { isTextEntryTarget, type ActiveTool } from '../app-shell/activeToolModel'
import { toolForShortcutKey } from './shortcuts'

// Picks a tool from its letter anywhere on the page except while typing
// (UNIFIED_PLAN.md, 15.2-B). Disabled tools ignore their key.
export function useToolShortcuts(
  enabled: boolean,
  onSelectTool: (tool: ActiveTool) => void,
): void {
  // Always the latest tool list, even for a key pressed just after a render.
  const selectTool = useEffectEvent(onSelectTool)

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) {
        return
      }

      const tool = toolForShortcutKey(event)
      if (tool === null) return

      event.preventDefault()
      selectTool(tool)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled])
}
