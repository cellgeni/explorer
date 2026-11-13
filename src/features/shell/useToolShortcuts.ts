import { useEffect, useEffectEvent } from 'react'
import { isTextEntryTarget, type ActiveTool } from '../app-shell/activeToolModel'
import { isFitKey, toolForShortcutKey } from './shortcuts'

// Picks a tool from its letter anywhere on the page except while typing
// (plan 15.2-B). Disabled tools ignore their key. F fits the
// view (15.2-E).
export function useToolShortcuts(
  enabled: boolean,
  onSelectTool: (tool: ActiveTool) => void,
  onFit: () => void = noop,
): void {
  // Always the latest tool list, even for a key pressed just after a render.
  const selectTool = useEffectEvent(onSelectTool)
  const fit = useEffectEvent(onFit)

  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) {
        return
      }

      if (isFitKey(event)) {
        event.preventDefault()
        fit()
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

function noop(): void {}
