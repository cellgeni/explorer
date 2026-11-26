// The Python console's worker and the main thread talk only through these
// messages (plan 29-D4). The worker runs Python; when Python needs data, it
// sends a request and blocks until the reply (29-D5). Arrays go both ways as
// transferred typed arrays. The main thread checks every request with
// `parsePythonDataRequest` and refuses one it does not know.

export type PythonWorkerRequest =
  | {
      readonly type: 'start'
      // Where `pyodide/` is served, ending in "/".
      readonly indexUrl: string
      // Set to 2 to raise KeyboardInterrupt; only where the page is
      // cross-origin isolated (29-D2).
      readonly interruptBuffer: Uint8Array | null
    }
  | { readonly type: 'run'; readonly id: number; readonly code: string }
  | {
      readonly type: 'complete'
      readonly id: number
      readonly code: string
      readonly cursor: number
    }
  // Another dataset, or other cells: cached columns go.
  | { readonly type: 'dataset' }
  | PythonDataReply

export type PythonDataReply =
  | {
      readonly type: 'reply'
      readonly id: number
      readonly ok: true
      readonly value: PythonDataValue
    }
  | {
      readonly type: 'reply'
      readonly id: number
      readonly ok: false
      readonly error: PythonDataError
    }

// Raised in Python as the `explorer` exception of the same name.
export interface PythonDataError {
  readonly name: 'ReadTooLarge' | 'ReadRefused' | 'DataError'
  readonly message: string
  // The read's size, for the first two.
  readonly bytes?: number
}

export type PythonRunStatus = 'ok' | 'error' | 'incomplete'

export type PythonWorkerResponse =
  | { readonly type: 'progress'; readonly message: string }
  | { readonly type: 'ready'; readonly pythonVersion: string }
  | { readonly type: 'failed'; readonly message: string }
  | {
      readonly type: 'output'
      readonly stream: 'stdout' | 'stderr'
      readonly text: string
    }
  // A complete input about to run, so the console logs it above its output.
  | { readonly type: 'started'; readonly id: number }
  | {
      readonly type: 'done'
      readonly id: number
      readonly status: PythonRunStatus
      // The last expression's value as the console prints it, or null.
      readonly display: string | null
      // The traceback, for an error.
      readonly error: string | null
    }
  | {
      readonly type: 'completions'
      readonly id: number
      // Where the text the completions replace starts.
      readonly start: number
      readonly items: readonly string[]
    }
  | { readonly type: 'request'; readonly id: number; readonly request: unknown }

export interface PythonColumnInfo {
  readonly id: string
  readonly label: string
  readonly kind: 'number' | 'category'
  readonly group: 'Cell' | 'Classes' | 'Metadata'
}

export interface PythonRoiInfo {
  readonly key: string
  readonly name: string
  readonly kind: 'selection' | 'feature' | 'current'
  // Each polygon's vertices as x, y pairs in µm (y down).
  readonly polygons: readonly Float64Array[]
  readonly box: boolean
}

export type PythonDrawCommand =
  | {
      readonly op: 'color'
      // Null for an unnamed call: the app names it (Result, Result 2, …).
      readonly name: string | null
      readonly rows: Uint32Array
      readonly color: string | null
      readonly cmap: string | null
      // One per row in `rows`, for a ramp.
      readonly values: Float32Array | null
      readonly vmin: number | null
      readonly vmax: number | null
      readonly reverse: boolean
    }
  | {
      readonly op: 'highlight'
      readonly name: string | null
      readonly rows: Uint32Array
      readonly color: string
    }
  | { readonly op: 'show'; readonly rows: Uint32Array | null }
  | { readonly op: 'others'; readonly mode: 'fade' | 'hide' }
  | { readonly op: 'clear'; readonly name: string | null }

export type PythonDataRequest =
  | { readonly kind: 'dataset' }
  | { readonly kind: 'positions' }
  | { readonly kind: 'cell-ids' }
  | { readonly kind: 'number-column'; readonly columnId: string }
  | { readonly kind: 'category-column'; readonly columnId: string }
  | { readonly kind: 'gene-names' }
  | {
      readonly kind: 'gene'
      readonly name: string
      readonly layer: string | null
      readonly allowLarge: boolean
    }
  | { readonly kind: 'selected' }
  | { readonly kind: 'rois' }
  | { readonly kind: 'contains'; readonly key: string }
  | { readonly kind: 'view' }
  | { readonly kind: 'draw'; readonly command: PythonDrawCommand }

export interface PythonDatasetInfo {
  readonly name: string
  readonly count: number
  readonly noun: string
  readonly columns: readonly PythonColumnInfo[]
  readonly hasGenes: boolean
  readonly layers: readonly string[]
}

export interface PythonCategoryColumn {
  readonly codes: Int32Array
  readonly labels: readonly string[]
  // Further classes of cells listed by more than one.
  readonly extraRows: Int32Array
  readonly extraCodes: Int32Array
}

export interface PythonViewInfo {
  readonly center: readonly [number, number]
  // min x, min y, max x, max y.
  readonly bounds: readonly [number, number, number, number]
}

export type PythonDataValue =
  | PythonDatasetInfo
  | { readonly x: Float64Array; readonly y: Float64Array }
  | readonly string[]
  | Float64Array
  | Float32Array
  | Uint8Array
  | PythonCategoryColumn
  | readonly PythonRoiInfo[]
  | PythonViewInfo
  | number
  | null

const DRAW_OPS = new Set(['color', 'highlight', 'show', 'others', 'clear'])

// The request, if it is one the protocol has; null for anything else.
// Python's None arrives as undefined, and is read as null.
export function parsePythonDataRequest(value: unknown): PythonDataRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  switch (request.kind) {
    case 'dataset':
    case 'positions':
    case 'cell-ids':
    case 'gene-names':
    case 'selected':
    case 'rois':
    case 'view':
      return { kind: request.kind }
    case 'number-column':
    case 'category-column':
      return typeof request.columnId === 'string'
        ? { kind: request.kind, columnId: request.columnId }
        : null
    case 'gene':
      return typeof request.name === 'string' &&
        nullableString(request.layer) &&
        typeof request.allowLarge === 'boolean'
        ? {
            kind: 'gene',
            name: request.name,
            layer: request.layer ?? null,
            allowLarge: request.allowLarge,
          }
        : null
    case 'contains':
      return typeof request.key === 'string'
        ? { kind: 'contains', key: request.key }
        : null
    case 'draw': {
      const command = parseDrawCommand(request.command)
      return command === null ? null : { kind: 'draw', command }
    }
    default:
      return null
  }
}

function parseDrawCommand(value: unknown): PythonDrawCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const command = value as Record<string, unknown>
  if (typeof command.op !== 'string' || !DRAW_OPS.has(command.op)) return null
  const rows = command.rows
  switch (command.op) {
    case 'color':
      return nullableString(command.name) &&
        rows instanceof Uint32Array &&
        nullableString(command.color) &&
        nullableString(command.cmap) &&
        (command.values == null || command.values instanceof Float32Array) &&
        nullableNumber(command.vmin) &&
        nullableNumber(command.vmax) &&
        typeof command.reverse === 'boolean'
        ? {
            op: 'color',
            name: command.name ?? null,
            rows,
            color: command.color ?? null,
            cmap: command.cmap ?? null,
            values: command.values ?? null,
            vmin: command.vmin ?? null,
            vmax: command.vmax ?? null,
            reverse: command.reverse,
          }
        : null
    case 'highlight':
      return nullableString(command.name) &&
        rows instanceof Uint32Array &&
        typeof command.color === 'string'
        ? { op: 'highlight', name: command.name ?? null, rows, color: command.color }
        : null
    case 'show':
      return rows == null || rows instanceof Uint32Array
        ? { op: 'show', rows: rows ?? null }
        : null
    case 'others':
      return command.mode === 'fade' || command.mode === 'hide'
        ? { op: 'others', mode: command.mode }
        : null
    default:
      return nullableString(command.name)
        ? { op: 'clear', name: command.name ?? null }
        : null
  }
}

function nullableString(value: unknown): value is string | null | undefined {
  return value == null || typeof value === 'string'
}

function nullableNumber(value: unknown): value is number | null | undefined {
  return value == null || typeof value === 'number'
}
