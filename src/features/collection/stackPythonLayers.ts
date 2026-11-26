import type { ComposedPythonOverlay } from '../../rendering/pythonOverlay'
import type { PreviewCells } from './collectionPreviewData'

// The Python console's layers (plan 29-D7, D10) for the 3D cell view, whose
// cells are the open dataset's, read again as a section is: matched to
// Python's overview rows by cell ID.

export interface StackPythonLayers {
  // RGBA per preview cell: alpha 255 where a colour layer holds it, else 0.
  // Null without colour layers.
  readonly colors: Uint8Array | null
  // 1 per preview cell not drawn; null when none is hidden.
  readonly hidden: Uint8Array | null
  readonly highlights: readonly {
    readonly name: string
    readonly color: readonly [number, number, number]
    // Preview cell indices, hidden ones left out.
    readonly cells: Uint32Array
  }[]
}

export interface StackPythonSource {
  readonly composed: ComposedPythonOverlay
  // The layers' names, earlier first, for the view's toolbar.
  readonly names: readonly string[]
  // A cell ID's overview row, or undefined for a cell Python does not have.
  readonly rowOf: (cellId: string) => number | undefined
}

const cache = new WeakMap<
  ComposedPythonOverlay,
  WeakMap<PreviewCells, StackPythonLayers | null>
>()

// Null when Python has drawn nothing.
export function stackPythonLayers(
  source: StackPythonSource,
  cells: PreviewCells,
): StackPythonLayers | null {
  const { composed, rowOf } = source
  if (
    composed.colors === null &&
    composed.hidden === null &&
    composed.highlights.length === 0
  ) {
    return null
  }
  let byCells = cache.get(composed)
  if (byCells === undefined) {
    byCells = new WeakMap()
    cache.set(composed, byCells)
  }
  if (byCells.has(cells)) return byCells.get(cells) ?? null

  const count = cells.cellIds.length
  const rows = new Int32Array(count)
  for (let cell = 0; cell < count; cell += 1) {
    rows[cell] = rowOf(cells.cellIds[cell] ?? '') ?? -1
  }

  let colors: Uint8Array | null = null
  if (composed.colors !== null) {
    const rowColors = composed.colors
    colors = new Uint8Array(count * 4)
    for (let cell = 0; cell < count; cell += 1) {
      const row = rows[cell] ?? -1
      if (row < 0) continue
      colors.set(rowColors.subarray(row * 4, row * 4 + 4), cell * 4)
    }
  }

  let hidden: Uint8Array | null = null
  if (composed.hidden !== null) {
    const rowHidden = composed.hidden
    hidden = new Uint8Array(count)
    for (let cell = 0; cell < count; cell += 1) {
      const row = rows[cell] ?? -1
      // A cell Python does not have is not one it shows.
      hidden[cell] = row < 0 ? 1 : (rowHidden[row] ?? 0)
    }
  }

  const cellsByRow = new Map<number, number[]>()
  rows.forEach((row, cell) => {
    if (row < 0) return
    const list = cellsByRow.get(row)
    if (list === undefined) cellsByRow.set(row, [cell])
    else list.push(cell)
  })
  const highlights = composed.highlights.map((highlight) => ({
    name: highlight.name,
    color: highlight.color,
    cells: Uint32Array.from(
      [...highlight.rows].flatMap((row) => cellsByRow.get(row) ?? []),
    ),
  }))

  const layers = { colors, hidden, highlights }
  byCells.set(cells, layers)
  return layers
}
