import {
  EMPTY_PYTHON_OVERLAY,
  type PythonLayer,
  type PythonOthersMode,
  type PythonOverlay,
} from '../../rendering/pythonOverlay'
import type { PythonDrawCommand } from '../../workers/pythonMessages'
import {
  isPythonColorMap,
  parseHexColor,
  pythonRampColors,
  pythonRampGradient,
  pythonRampStops,
  type PythonRgb,
} from './pythonColors'

// The Python console's layers on the canvas (plan 29-D8). They live in the
// app, not in Python, so a restart keeps them. Draw calls change a draft;
// `flush` publishes it once an input has run, so an input that draws
// several layers redraws the canvas once, and one that draws nothing does
// not redraw it at all.
//
// A call without name= makes Result, then Result 2, Result 3 and so on in
// the same input, so a loop keeps every mask; the next input's first
// unnamed call of that kind replaces them, so running an input again
// replaces its results.

interface Draft {
  readonly cellCount: number
  readonly layers: readonly PythonLayer[]
  readonly shown: Uint32Array | null
  readonly others: PythonOthersMode
}

// A legend item's id: a layer's kind and name, or the `show` rows.
export const PYTHON_SHOWN_ITEM_ID = 'shown'

export function pythonLayerItemId(layer: Pick<PythonLayer, 'kind' | 'name'>): string {
  return `${layer.kind}:${layer.name}`
}

export class PythonLayerStore {
  readonly #listeners = new Set<() => void>()
  #snapshot: PythonOverlay = EMPTY_PYTHON_OVERLAY
  #draft: Draft | null = null
  // The kinds this input has made unnamed layers of.
  readonly #unnamedThisInput = new Set<PythonLayer['kind']>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): PythonOverlay => this.#snapshot

  // One draw call, for a dataset of `cellCount` cells. Layers drawn for
  // another number of cells are dropped first. Throws on a command the
  // canvas cannot draw, which Python raises.
  apply(command: PythonDrawCommand, cellCount: number): void {
    const current = this.#current()
    const draft: Draft =
      current.cellCount === cellCount
        ? current
        : { cellCount, layers: [], shown: null, others: 'fade' }

    switch (command.op) {
      case 'color':
      case 'highlight': {
        checkRows(command.rows, cellCount)
        let layers = draft.layers
        let name = command.name
        if (name === null) {
          if (!this.#unnamedThisInput.has(command.op)) {
            this.#unnamedThisInput.add(command.op)
            layers = layers.filter(
              (each) => !(each.kind === command.op && each.unnamed === true),
            )
          }
          name = freeName(layers, command.op)
        }
        const layer = {
          ...(command.op === 'color'
            ? colorLayer(command, name)
            : highlightLayer(command, name)),
          ...(command.name === null ? { unnamed: true } : {}),
        }
        const id = pythonLayerItemId(layer)
        this.#draft = {
          ...draft,
          // A redrawn layer goes on top (later over earlier).
          layers: [...layers.filter((each) => pythonLayerItemId(each) !== id), layer],
        }
        return
      }
      case 'show':
        if (command.rows !== null) checkRows(command.rows, cellCount)
        this.#draft = { ...draft, shown: command.rows }
        return
      case 'others':
        this.#draft = { ...draft, others: command.mode }
        return
      case 'clear':
        // clear() starts over; clear(name) removes that name's layers.
        this.#draft =
          command.name === null
            ? { cellCount, layers: [], shown: null, others: 'fade' }
            : {
                ...draft,
                layers: draft.layers.filter((layer) => layer.name !== command.name),
              }
        return
    }
  }

  // Publishes the draft, if any draw call changed it. An input has ended.
  flush(): void {
    this.#unnamedThisInput.clear()
    const draft = this.#draft
    if (draft === null) return
    this.#draft = null
    this.#publish(draft)
  }

  // The legend's clear button: a layer, or the `show` rows.
  clearItem(id: string): void {
    this.flush()
    const current = this.#snapshot
    if (id === PYTHON_SHOWN_ITEM_ID) {
      if (current.shown !== null) this.#publish({ ...current, shown: null })
      return
    }
    const layers = current.layers.filter((layer) => pythonLayerItemId(layer) !== id)
    if (layers.length !== current.layers.length) this.#publish({ ...current, layers })
  }

  // Another dataset: its rows are other cells.
  reset(): void {
    this.#draft = null
    this.#unnamedThisInput.clear()
    if (this.#snapshot !== EMPTY_PYTHON_OVERLAY) this.#publish(EMPTY_PYTHON_OVERLAY)
  }

  #current(): Draft {
    return this.#draft ?? this.#snapshot
  }

  #publish(draft: Draft): void {
    const empty = draft.layers.length === 0 && draft.shown === null
    this.#snapshot =
      empty && draft.others === 'fade'
        ? EMPTY_PYTHON_OVERLAY
        : {
            version: this.#snapshot.version + 1,
            cellCount: draft.cellCount,
            layers: draft.layers,
            shown: draft.shown,
            others: draft.others,
          }
    for (const listener of this.#listeners) listener()
  }
}

// Result, else the first of Result 2, Result 3, … no layer of the kind has.
function freeName(layers: readonly PythonLayer[], kind: PythonLayer['kind']): string {
  const taken = new Set(
    layers.filter((layer) => layer.kind === kind).map((layer) => layer.name),
  )
  if (!taken.has(UNNAMED)) return UNNAMED
  let number = 2
  while (taken.has(`${UNNAMED} ${number.toString()}`)) number += 1
  return `${UNNAMED} ${number.toString()}`
}

const UNNAMED = 'Result'

function checkRows(rows: Uint32Array, cellCount: number): void {
  for (const row of rows) {
    if (row >= cellCount) {
      throw new Error(
        `Row ${row.toLocaleString()} is not a cell of the open dataset, which has ${cellCount.toLocaleString()}.`,
      )
    }
  }
}

function hexColor(hex: string): PythonRgb {
  const rgb = parseHexColor(hex)
  if (rgb === null) throw new Error(`The canvas cannot draw the colour ${hex}.`)
  return rgb
}

function colorLayer(
  command: Extract<PythonDrawCommand, { op: 'color' }>,
  name: string,
): PythonLayer {
  const { rows, values } = command

  if (values === null) {
    if (command.color === null) throw new Error('A colour layer needs a colour.')
    const rgb = hexColor(command.color)
    const colors = new Uint8Array(rows.length * 3)
    for (let index = 0; index < rows.length; index += 1) colors.set(rgb, index * 3)
    return {
      kind: 'color',
      name,
      rows,
      colors,
      legend: { kind: 'color', color: command.color },
    }
  }

  if (values.length !== rows.length) {
    throw new Error(`by= has ${values.length} values for ${rows.length} cells.`)
  }
  if (command.cmap !== null && !isPythonColorMap(command.cmap)) {
    throw new Error(`The canvas has no colour map ${command.cmap}.`)
  }
  const stops = pythonRampStops(
    command.cmap === null
      ? { color: hexColor(command.color ?? '') }
      : { cmap: command.cmap },
  )
  const vmin = command.vmin ?? 0
  const vmax = command.vmax ?? 1
  return {
    kind: 'color',
    name,
    rows,
    colors: pythonRampColors(values, stops, { vmin, vmax, reverse: command.reverse }),
    legend: {
      kind: 'ramp',
      gradient: pythonRampGradient(stops, command.reverse),
      min: vmin,
      max: vmax,
    },
  }
}

function highlightLayer(
  command: Extract<PythonDrawCommand, { op: 'highlight' }>,
  name: string,
): PythonLayer {
  return {
    kind: 'highlight',
    name,
    rows: command.rows,
    color: hexColor(command.color),
  }
}
