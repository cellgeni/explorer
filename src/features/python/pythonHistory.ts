// The Python console's inputs, newest last, kept in localStorage across
// visits (plan 29-D11). Storage can be missing or refuse a write, as in a
// private window; the history then lasts as long as the page.

const KEY = 'explorer.python.history'
const MAX_ENTRIES = 200

export interface PythonHistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): PythonHistoryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readPythonHistory(
  storage: PythonHistoryStorage | null = defaultStorage(),
): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(-MAX_ENTRIES)
      : []
  } catch {
    return []
  }
}

// The history with `input` added, unless it repeats the last entry.
export function addPythonHistory(
  history: readonly string[],
  input: string,
  storage: PythonHistoryStorage | null = defaultStorage(),
): readonly string[] {
  if (input.trim() === '' || history.at(-1) === input) return history
  const next = [...history, input].slice(-MAX_ENTRIES)
  try {
    storage?.setItem(KEY, JSON.stringify(next))
  } catch {
    // Kept for the page only.
  }
  return next
}

// Walks the history from the prompt: `index` is the entry shown, or
// `history.length` for the input being written, kept as `draft`.
export interface PythonHistoryCursor {
  readonly index: number
  readonly draft: string
}

export function stepPythonHistory(
  history: readonly string[],
  cursor: PythonHistoryCursor,
  current: string,
  direction: -1 | 1,
): { readonly cursor: PythonHistoryCursor; readonly text: string } | null {
  const index = cursor.index + direction
  if (index < 0 || index > history.length) return null
  const draft = cursor.index === history.length ? current : cursor.draft
  return {
    cursor: { index, draft },
    text: index === history.length ? draft : (history[index] ?? ''),
  }
}
