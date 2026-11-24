import type { ActiveTool } from '../app-shell/activeToolModel'

// Keyboard shortcuts (plan 15.2-B). The key handlers and the
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

// Fits the data to the view (15.2-E); Home returns to the first view.
export const FIT_KEY = 'F'

// Opens or closes Help (15.3-B).
export const HELP_KEY = '?'

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
  // The keys as typed: '-', not the '−' sign the zoom buttons show.
  { keys: ['+', '-'], action: 'Zoom in or out', group: 'View' },
  { keys: ['Home'], action: 'Return to the first view', group: 'View' },
  // A ring marks the centre while the canvas has focus (15.5-D).
  {
    keys: ['Enter'],
    action: 'Open the cell at the centre; with Box selection, select the view',
    group: 'View',
  },
  // F works anywhere, like the tool letters (useToolShortcuts).
  { keys: [FIT_KEY], action: 'Fit the data to the view', group: 'View' },
  { keys: [LAYER_PANEL_KEY], action: 'Hide or show the layer panel', group: 'View' },
  { keys: [HELP_KEY], action: 'Show or hide this help', group: 'View' },
]

export interface ShortcutKeyEvent {
  readonly key: string
  // The key's place, as on a US keyboard ("KeyP"), whatever it types.
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

// The letter a press is: the one typed, else, where the layout types another
// script (Cyrillic, Greek) or an input method has the key (key "Process"),
// the letter at its place on a US keyboard. A layout's own Latin letters win,
// so the keys move with AZERTY and Dvorak.
function shortcutLetter(event: ShortcutKeyEvent): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase()
  return /^Key([A-Z])$/.exec(event.code ?? '')?.[1] ?? null
}

// The tool a key press picks, or null. Modifier keys are left to the browser.
export function toolForShortcutKey(event: ShortcutKeyEvent): ActiveTool | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null

  const letter = shortcutLetter(event)
  return TOOL_ORDER.find((tool) => TOOL_SHORTCUT_KEYS[tool] === letter) ?? null
}

// `\` is typed with AltGr on German, French, Spanish, Italian, Nordic and
// Portuguese layouts (Ctrl and Alt on Windows) and with Option on a Mac, so
// only Ctrl alone and Cmd leave it to the browser.
export function isLayerPanelKey(event: ShortcutKeyEvent): boolean {
  return (
    event.key === LAYER_PANEL_KEY && !event.metaKey && !(event.ctrlKey && !event.altKey)
  )
}

// '?' needs Shift on most layouts, so only Ctrl, Alt and Cmd rule it out.
export function isHelpKey(event: ShortcutKeyEvent): boolean {
  return event.key === HELP_KEY && !event.altKey && !event.ctrlKey && !event.metaKey
}

export function isFitKey(event: ShortcutKeyEvent): boolean {
  return (
    shortcutLetter(event) === FIT_KEY && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}
