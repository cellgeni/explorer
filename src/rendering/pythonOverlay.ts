import { FADED_CELL_ALPHA } from './deckLayerColors'

// The Python console's layers on the canvas (plan 29-D7, D8, D10), by
// overview row. Colour layers draw over the colour mode, later layers over
// earlier ones; cells in no colour layer fade or hide; `show` hides every
// cell outside its rows; highlights ring their cells. The store in
// features/python builds these; the canvas only reads them.

export type PythonLayerLegend =
  | { readonly kind: 'color'; readonly color: string }
  | {
      readonly kind: 'ramp'
      // CSS gradient, low on the left.
      readonly gradient: string
      readonly min: number
      readonly max: number
    }

export interface PythonColorLayer {
  readonly kind: 'color'
  readonly name: string
  // Sorted, unique overview rows.
  readonly rows: Uint32Array
  // RGB for each entry of rows.
  readonly colors: Uint8Array
  readonly legend: PythonLayerLegend
}

export interface PythonHighlightLayer {
  readonly kind: 'highlight'
  readonly name: string
  readonly rows: Uint32Array
  readonly color: readonly [number, number, number]
}

export type PythonLayer = PythonColorLayer | PythonHighlightLayer

export type PythonOthersMode = 'fade' | 'hide'

export interface PythonOverlay {
  // Bumped once per input run that changed the layers.
  readonly version: number
  // The overview rows the layers were drawn for.
  readonly cellCount: number
  // Earlier first.
  readonly layers: readonly PythonLayer[]
  // Rows `show` keeps, or null for every cell.
  readonly shown: Uint32Array | null
  readonly others: PythonOthersMode
}

export const EMPTY_PYTHON_OVERLAY: PythonOverlay = {
  version: 0,
  cellCount: 0,
  layers: [],
  shown: null,
  others: 'fade',
}

export interface PythonHighlightDraw {
  readonly name: string
  readonly color: readonly [number, number, number]
  // The highlighted rows that are drawn.
  readonly rows: Uint32Array
}

export interface ComposedPythonOverlay {
  // RGBA per cell: alpha 255 where a colour layer holds the cell, else 0.
  // Null without colour layers.
  readonly colors: Uint8Array | null
  // 1 per cell that is not drawn, picked or hovered; null when none is.
  readonly hidden: Uint8Array | null
  readonly highlights: readonly PythonHighlightDraw[]
}

const NO_OVERLAY: ComposedPythonOverlay = { colors: null, hidden: null, highlights: [] }
const composedCache = new WeakMap<PythonOverlay, ComposedPythonOverlay>()

// The layers as one colour and one hidden flag per cell, for `cellCount`
// cells. Layers drawn for another number of cells are left out.
export function composePythonOverlay(
  overlay: PythonOverlay,
  cellCount: number,
): ComposedPythonOverlay {
  if (overlay.cellCount !== cellCount || cellCount === 0) return NO_OVERLAY
  if (overlay.layers.length === 0 && overlay.shown === null) return NO_OVERLAY
  const cached = composedCache.get(overlay)
  if (cached !== undefined) return cached

  const colorLayers = overlay.layers.filter(
    (layer): layer is PythonColorLayer => layer.kind === 'color',
  )
  let colors: Uint8Array | null = null

  if (colorLayers.length > 0) {
    colors = new Uint8Array(cellCount * 4)
    for (const layer of colorLayers) {
      const { rows, colors: rgb } = layer
      for (let index = 0; index < rows.length; index += 1) {
        const offset = (rows[index] ?? 0) * 4
        colors[offset] = rgb[index * 3] ?? 0
        colors[offset + 1] = rgb[index * 3 + 1] ?? 0
        colors[offset + 2] = rgb[index * 3 + 2] ?? 0
        colors[offset + 3] = 255
      }
    }
  }

  let hidden: Uint8Array | null = null

  if (overlay.shown !== null) {
    hidden = new Uint8Array(cellCount).fill(1)
    for (const row of overlay.shown) hidden[row] = 0
  }

  // Others hide only where a colour layer says what the others are.
  if (overlay.others === 'hide' && colors !== null) {
    hidden ??= new Uint8Array(cellCount)
    for (let row = 0; row < cellCount; row += 1) {
      if (colors[row * 4 + 3] === 0) hidden[row] = 1
    }
  }

  const highlights = overlay.layers
    .filter((layer): layer is PythonHighlightLayer => layer.kind === 'highlight')
    .map((layer) => ({
      name: layer.name,
      color: layer.color,
      rows: hidden === null ? layer.rows : layer.rows.filter((row) => hidden[row] === 0),
    }))

  const composed = { colors, hidden, highlights }
  composedCache.set(overlay, composed)
  return composed
}

// The canvas's packed cell colours with the colour layers over them: a
// layer's colour where one holds the cell, the cell's own colour faded where
// none does. Without colour layers, `base` itself.
export function overlayCellPointColors(
  base: Uint8Array,
  composed: ComposedPythonOverlay,
): Uint8Array {
  const overlay = composed.colors
  if (overlay === null || overlay.length !== base.length) return base
  const colors = new Uint8Array(base.length)

  for (let offset = 0; offset < base.length; offset += 4) {
    if (overlay[offset + 3] === 0) {
      colors[offset] = base[offset] ?? 0
      colors[offset + 1] = base[offset + 1] ?? 0
      colors[offset + 2] = base[offset + 2] ?? 0
      colors[offset + 3] = Math.min(base[offset + 3] ?? 0, FADED_CELL_ALPHA)
    } else {
      colors[offset] = overlay[offset] ?? 0
      colors[offset + 1] = overlay[offset + 1] ?? 0
      colors[offset + 2] = overlay[offset + 2] ?? 0
      colors[offset + 3] = 255
    }
  }

  return colors
}

// GPU filter values (cellPointFilterValues) with hidden cells filtered out,
// as outlined cells are. Without hidden cells, `values` itself.
export function hidePythonCells(
  values: Float32Array,
  composed: ComposedPythonOverlay,
): Float32Array {
  const hidden = composed.hidden
  if (hidden === null || hidden.length * 2 !== values.length) return values
  const filtered = values.slice()

  for (let row = 0; row < hidden.length; row += 1) {
    if (hidden[row] === 1) filtered[row * 2 + 1] = 1
  }

  return filtered
}

export function pythonCellHidden(
  composed: ComposedPythonOverlay,
  row: number | undefined,
): boolean {
  return row !== undefined && composed.hidden?.[row] === 1
}
