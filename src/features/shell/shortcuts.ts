import type { ActiveTool } from '../app-shell/activeToolModel'

// Keyboard shortcuts (UNIFIED_PLAN.md, 15.2-B). The key handlers and the
// Help list (15.3-B) both read this table, so they cannot disagree.

export interface Shortcut {
  // As printed on the key, such as "R" or "Esc".
  readonly keys: readonly string[]
  readonly action: string
  readonly group: 'Tools' | 'View'
}

export const TOOL_LABELS: Readonly<Record<ActiveTool, string>> = {
  pan: 'Pan',
  box: 'Box selection',
  lasso: 'Lasso selection',
  measure: 'Measure',
  'magic-lens': 'Magic Lens',
}

// One letter per tool, as in 10x Explorer where it has the tool.
export const TOOL_SHORTCUT_KEYS: Readonly<Record<ActiveTool, string>> = {
  pan: 'P',
  box: 'R',
  lasso: 'L',
  measure: 'M',
  'magic-lens': 'O',
}

// Hides or shows the layer panel (15.2-C), as in 10x Explorer.
export const LAYER_PANEL_KEY = '\\'

export const TOOL_ORDER: readonly ActiveTool[] = [
  'pan',
  'box',
  'lasso',
  'measure',
  'magic-lens',
]

export const SHORTCUTS: readonly Shortcut[] = [
  ...TOOL_ORDER.map(
    (tool): Shortcut => ({
      keys: [TOOL_SHORTCUT_KEYS[tool]],
      action: `${TOOL_LABELS[tool]} tool`,
      group: 'Tools',
    }),
  ),
  { keys: ['Esc'], action: 'Back to Pan, or clear the selection', group: 'Tools' },
  // ViewerCore handles these while the canvas has focus (viewerNavigation.ts).
  {
    keys: ['←', '↑', '→', '↓'],
    action: 'Move the view; Shift moves further',
    group: 'View',
  },
  { keys: ['+', '−'], action: 'Zoom in or out', group: 'View' },
  { keys: ['Home'], action: 'Return to the first view', group: 'View' },
  { keys: [LAYER_PANEL_KEY], action: 'Hide or show the layer panel', group: 'View' },
]

export interface ShortcutKeyEvent {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

// The tool a key press picks, or null. Modifier keys are left to the browser.
export function toolForShortcutKey(event: ShortcutKeyEvent): ActiveTool | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null

  const key = event.key.toUpperCase()
  return TOOL_ORDER.find((tool) => TOOL_SHORTCUT_KEYS[tool] === key) ?? null
}

export function isLayerPanelKey(event: ShortcutKeyEvent): boolean {
  return (
    event.key === LAYER_PANEL_KEY && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}
