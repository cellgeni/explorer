import { describe, expect, it, vi } from 'vitest'
import { EMPTY_PYTHON_OVERLAY } from '../../rendering/pythonOverlay'
import type { PythonDrawCommand } from '../../workers/pythonMessages'
import { pythonLegendSection } from './pythonLegend'
import { PYTHON_SHOWN_ITEM_ID, PythonLayerStore } from './pythonLayerStore'

const NOUN = { singular: 'cell', plural: 'cells' }

function color(
  rows: readonly number[],
  change: Partial<Extract<PythonDrawCommand, { op: 'color' }>> = {},
): PythonDrawCommand {
  return {
    op: 'color',
    name: 'Result',
    rows: Uint32Array.from(rows),
    color: '#008000',
    cmap: null,
    values: null,
    vmin: null,
    vmax: null,
    reverse: false,
    ...change,
  }
}

function highlight(rows: readonly number[], name = 'Result'): PythonDrawCommand {
  return { op: 'highlight', name, rows: Uint32Array.from(rows), color: '#ffffff' }
}

describe('PythonLayerStore', () => {
  it('publishes an input’s draw calls once, when it ends (29-D8)', () => {
    const store = new PythonLayerStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.apply(color([0, 1]), 4)
    store.apply(highlight([2]), 4)
    store.apply({ op: 'others', mode: 'hide' }, 4)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(EMPTY_PYTHON_OVERLAY)

    store.flush()
    expect(listener).toHaveBeenCalledTimes(1)
    const snapshot = store.getSnapshot()
    expect(snapshot.version).toBe(1)
    expect(snapshot.cellCount).toBe(4)
    expect(snapshot.layers.map((layer) => `${layer.kind}:${layer.name}`)).toEqual([
      'color:Result',
      'highlight:Result',
    ])
    expect(snapshot.others).toBe('hide')
  })

  it('does not publish an input that drew nothing', () => {
    const store = new PythonLayerStore()
    store.apply(color([0]), 4)
    store.flush()
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.flush()

    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toBe(before)
  })

  it('replaces a layer of the same kind and name, and draws it on top', () => {
    const store = new PythonLayerStore()
    store.apply(color([0], { name: 'A' }), 4)
    store.apply(color([1], { name: 'B' }), 4)
    store.flush()
    store.apply(color([2], { name: 'A', color: '#ff0000' }), 4)
    store.flush()

    const layers = store.getSnapshot().layers
    expect(layers.map((layer) => layer.name)).toEqual(['B', 'A'])
    expect(Array.from(layers[1]?.rows ?? [])).toEqual([2])
    expect(layers[1]?.kind === 'color' && Array.from(layers[1].colors)).toEqual([
      255, 0, 0,
    ])
  })

  it('keeps every unnamed layer of an input, and replaces them with the next input’s', () => {
    const store = new PythonLayerStore()
    // A loop of unnamed calls: each mask stays coloured.
    for (const row of [0, 1, 2]) store.apply(color([row], { name: null }), 4)
    store.apply(highlight([3], 'Result'), 4)
    store.apply(color([3], { name: 'Kept' }), 4)
    store.flush()
    expect(
      store.getSnapshot().layers.map((layer) => `${layer.kind}:${layer.name}`),
    ).toEqual([
      'color:Result',
      'color:Result 2',
      'color:Result 3',
      'highlight:Result',
      'color:Kept',
    ])

    // The next input's unnamed colour replaces them, and only them.
    store.apply(color([1], { name: null }), 4)
    store.flush()
    expect(
      store.getSnapshot().layers.map((layer) => `${layer.kind}:${layer.name}`),
    ).toEqual(['highlight:Result', 'color:Kept', 'color:Result'])

    // An input that draws nothing unnamed leaves them.
    store.apply(color([2], { name: 'Other' }), 4)
    store.flush()
    expect(store.getSnapshot().layers.map((layer) => layer.name)).toContain('Result')
  })

  it('skips names a named layer has taken', () => {
    const store = new PythonLayerStore()
    store.apply(color([0], { name: 'Result' }), 4)
    store.apply(color([1], { name: 'Result 2' }), 4)
    store.flush()
    store.apply(color([2], { name: null }), 4)
    store.flush()

    // A layer named Result is the user's: an unnamed call does not replace it.
    expect(store.getSnapshot().layers.map((layer) => layer.name)).toEqual([
      'Result',
      'Result 2',
      'Result 3',
    ])
  })

  it('colours a ramp per value and keeps its range for the legend', () => {
    const store = new PythonLayerStore()
    store.apply(
      color([0, 1], {
        values: Float32Array.of(0, 10),
        vmin: 0,
        vmax: 10,
        color: null,
        cmap: 'magma',
      }),
      2,
    )
    store.flush()

    const layer = store.getSnapshot().layers[0]
    expect(layer?.kind === 'color' && Array.from(layer.colors)).toEqual([
      0, 0, 4, 252, 253, 191,
    ])
    expect(layer?.kind === 'color' && layer.legend).toMatchObject({
      kind: 'ramp',
      min: 0,
      max: 10,
    })
  })

  it('shows only some cells, and shows every cell again', () => {
    const store = new PythonLayerStore()
    store.apply({ op: 'show', rows: Uint32Array.of(1, 3) }, 4)
    store.flush()
    expect(Array.from(store.getSnapshot().shown ?? [])).toEqual([1, 3])

    store.apply({ op: 'show', rows: null }, 4)
    store.flush()
    expect(store.getSnapshot()).toBe(EMPTY_PYTHON_OVERLAY)
  })

  it('clears a name’s layers, or starts over with clear()', () => {
    const store = new PythonLayerStore()
    store.apply(color([0], { name: 'A' }), 4)
    store.apply(highlight([1], 'A'), 4)
    store.apply(color([2], { name: 'B' }), 4)
    store.apply({ op: 'show', rows: Uint32Array.of(2) }, 4)
    store.apply({ op: 'clear', name: 'A' }, 4)
    store.flush()
    expect(store.getSnapshot().layers.map((layer) => layer.name)).toEqual(['B'])

    store.apply({ op: 'others', mode: 'hide' }, 4)
    store.apply({ op: 'clear', name: null }, 4)
    store.flush()
    expect(store.getSnapshot()).toBe(EMPTY_PYTHON_OVERLAY)
  })

  it('clears an item from the legend at once', () => {
    const store = new PythonLayerStore()
    store.apply(color([0]), 4)
    store.apply(highlight([1]), 4)
    store.apply({ op: 'show', rows: Uint32Array.of(0, 1) }, 4)
    store.flush()

    store.clearItem('highlight:Result')
    expect(store.getSnapshot().layers.map((layer) => layer.kind)).toEqual(['color'])
    store.clearItem(PYTHON_SHOWN_ITEM_ID)
    expect(store.getSnapshot().shown).toBeNull()
  })

  it('drops layers drawn for other cells', () => {
    const store = new PythonLayerStore()
    store.apply(color([0]), 4)
    store.flush()

    store.apply(color([5], { name: 'B' }), 6)
    store.flush()
    expect(store.getSnapshot().layers.map((layer) => layer.name)).toEqual(['B'])

    store.reset()
    expect(store.getSnapshot()).toBe(EMPTY_PYTHON_OVERLAY)
  })

  it('refuses rows outside the dataset and colours it cannot draw', () => {
    const store = new PythonLayerStore()

    expect(() => {
      store.apply(color([4]), 4)
    }).toThrow('Row 4 is not a cell of the open dataset, which has 4.')
    expect(() => {
      store.apply(color([0], { color: 'green' }), 4)
    }).toThrow('The canvas cannot draw the colour green.')
    expect(() => {
      store.apply(color([0], { values: Float32Array.of(1), color: null, cmap: 'jet' }), 4)
    }).toThrow('The canvas has no colour map jet.')
  })
})

describe('pythonLegendSection', () => {
  it('lists each layer with its swatch, and the shown cells', () => {
    const store = new PythonLayerStore()
    store.apply(color([0, 1], { name: 'Picks' }), 4)
    store.apply(
      color([2], { name: 'Near', values: Float32Array.of(5), vmin: 0, vmax: 250 }),
      4,
    )
    store.apply(highlight([3], 'Ring'), 4)
    store.apply({ op: 'show', rows: Uint32Array.of(0, 1, 2) }, 4)
    store.apply({ op: 'others', mode: 'hide' }, 4)
    store.flush()

    const section = pythonLegendSection(store.getSnapshot(), 4, NOUN)

    expect(section).toMatchObject({
      kind: 'python',
      title: 'Python',
      detail: 'Other cells hidden',
      items: [
        {
          id: 'color:Picks',
          label: 'Picks',
          count: 2,
          swatch: { kind: 'color', color: '#008000' },
        },
        {
          id: 'color:Near',
          label: 'Near',
          count: 1,
          swatch: { kind: 'ramp', min: '0', max: '250' },
        },
        {
          id: 'highlight:Ring',
          count: 1,
          swatch: { kind: 'ring', color: 'rgb(255, 255, 255)' },
        },
        { id: PYTHON_SHOWN_ITEM_ID, label: 'Shown: 3 of 4', swatch: { kind: 'shown' } },
      ],
    })
  })

  it('has no section without layers, or for other cells', () => {
    const store = new PythonLayerStore()
    expect(pythonLegendSection(store.getSnapshot(), 4, NOUN)).toBeNull()

    store.apply(highlight([0]), 4)
    store.flush()
    expect(pythonLegendSection(store.getSnapshot(), 4, NOUN)?.detail).toBeUndefined()
    expect(pythonLegendSection(store.getSnapshot(), 5, NOUN)).toBeNull()
  })
})
