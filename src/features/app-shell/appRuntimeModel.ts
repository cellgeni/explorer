import type { ControlHudTab } from './appShellModel'

const DEBUG_LOG_LIMIT = 32

export interface DebugLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
  readonly coalesceKey?: string
}

export interface DebugLogAppendOptions {
  readonly coalesceKey?: string
}

export interface LoadingTask {
  readonly id: string
  readonly tabId: ControlHudTab
  readonly label: string
  readonly detail?: string
}

export function createDebugLogEntry(
  id: number,
  message: string,
  options: DebugLogAppendOptions = {},
): DebugLogEntry {
  return {
    id,
    timestamp: readTimestamp(),
    message,
    ...(options.coalesceKey === undefined ? {} : { coalesceKey: options.coalesceKey }),
  }
}

export function appendDebugLogEntry(
  current: readonly DebugLogEntry[],
  entry: DebugLogEntry,
): readonly DebugLogEntry[] {
  const first = current[0]

  if (
    first !== undefined &&
    entry.coalesceKey !== undefined &&
    first.coalesceKey === entry.coalesceKey
  ) {
    return [entry, ...current.slice(1)]
  }

  return [entry, ...current].slice(0, DEBUG_LOG_LIMIT)
}

export function readTimestamp(): number {
  return Date.now()
}

export function formatElapsed(startedAt: number): string {
  const elapsedMs = Math.max(0, readTimestamp() - startedAt)

  if (elapsedMs < 1_000) {
    return `${Math.round(elapsedMs)} ms`
  }

  return `${(elapsedMs / 1_000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} s`
}

export function shortDatasetLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const lastPathSegment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return shortIdentifier(lastPathSegment ?? parsed.host)
  } catch {
    return shortIdentifier(url)
  }
}

export function shortIdentifier(value: string): string {
  const normalized = value.trim()

  if (normalized.length <= 24) {
    return normalized
  }

  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

export function abortActiveRequest(ref: { current: AbortController | null }): void {
  ref.current?.abort()
  ref.current = null
}

export function clearTimeoutRef(ref: { current: number | null }): void {
  if (ref.current !== null && typeof window !== 'undefined') {
    window.clearTimeout(ref.current)
  }

  ref.current = null
}

export function throwAbortError(message: string): never {
  const error = new Error(message)
  error.name = 'AbortError'
  throw error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
