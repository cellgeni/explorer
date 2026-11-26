import type { PythonHistoryStorage } from './pythonHistory'

// The height the console's input is dragged to, in CSS pixels, or null to
// grow with its text. Kept in localStorage across visits, read with
// try/catch as the history is.

const KEY = 'explorer.python.promptHeight'

// About two lines, so the input never disappears.
export const MIN_PROMPT_HEIGHT = 40
// What the output and the buttons keep when the input is dragged up.
export const PROMPT_ROOM_LEFT = 120
// One arrow key press.
export const PROMPT_HEIGHT_STEP = 24

function defaultStorage(): PythonHistoryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// `height` within what the console's `available` height leaves.
export function clampPromptHeight(height: number, available: number): number {
  const max = Math.max(MIN_PROMPT_HEIGHT, available - PROMPT_ROOM_LEFT)
  return Math.round(Math.min(max, Math.max(MIN_PROMPT_HEIGHT, height)))
}

export function readPromptHeight(
  storage: PythonHistoryStorage | null = defaultStorage(),
): number | null {
  try {
    const value = Number(storage?.getItem(KEY) ?? '')
    return Number.isFinite(value) && value >= MIN_PROMPT_HEIGHT ? value : null
  } catch {
    return null
  }
}

export function writePromptHeight(
  height: number | null,
  storage: PythonHistoryStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, height === null ? '' : String(height))
  } catch {
    // The height lasts as long as the page.
  }
}
