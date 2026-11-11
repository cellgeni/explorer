import type { SetStateAction } from 'react'
import type { RoiDrawMode } from '../../components/ViewerCore'

// One canvas tool at a time (UNIFIED_PLAN.md, D8). Pan is the default; Esc
// and finishing a shape return to it.
export type ActiveTool = 'pan' | 'box' | 'lasso' | 'measure' | 'magic-lens'

export function roiModeForTool(tool: ActiveTool): RoiDrawMode {
  return tool === 'box' || tool === 'lasso' ? tool : 'idle'
}

// The workflows still turn tools on and off with the setters they had, so
// each one maps onto the single tool. Turning a tool on replaces the others;
// turning it off returns to Pan only if it was the active one.
export function toolAfterRoiMode(tool: ActiveTool, mode: RoiDrawMode): ActiveTool {
  if (mode !== 'idle') return mode
  return tool === 'box' || tool === 'lasso' ? 'pan' : tool
}

export function toolAfterMeasurement(tool: ActiveTool, enabled: boolean): ActiveTool {
  if (enabled) return 'measure'
  return tool === 'measure' ? 'pan' : tool
}

export function toolAfterMagicLens(tool: ActiveTool, active: boolean): ActiveTool {
  if (active) return 'magic-lens'
  return tool === 'magic-lens' ? 'pan' : tool
}

export function resolveStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === 'function' ? (action as (value: T) => T)(current) : action
}

// Esc returns to Pan unless the user is typing, where Esc belongs to the field.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(target.type)
  )
}
