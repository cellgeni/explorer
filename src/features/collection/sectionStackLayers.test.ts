import type { PickingInfo } from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import {
  previewBounds,
  type PreviewCells,
  type PreviewClasses,
  type PreviewScores,
  type PreviewValues,
} from './collectionPreviewData'
import {
  sectionStackLayers,
  stackPick,
  stackPickDepth,
  stackPickText,
  type SectionStackLayerOptions,
  type StackSectionInput,
} from './sectionStackLayers'
import { stackPythonLayers } from './stackPythonLayers'
import type { ComposedPythonOverlay } from '../../rendering/pythonOverlay'

const OPTIONS: SectionStackLayerOptions = {
  colorScale: 'plasma',
  radiusScale: 2,
  showContext: true,
}

const CELLS: PreviewCells = (() => {
  const positions = new Float32Array([0, 0, 10, 20, 30, 5])
  const bounds = previewBounds(positions)
  if (bounds === null) throw new Error('Expected cells.')
  return { positions, cellIds: ['cell-0', 'cell-1', 'cell-2'], bounds }
})()
const SCORES: PreviewScores = {
  positions: CELLS.positions,
  scores: new Float32Array([3, 0, 1]),
  maxScore: 3,
}
const CLASSES: PreviewClasses = {
  classes: [
    { id: 'neuron', label: 'Neuron', cellCount: 2 },
    { id: 'glia', label: 'Glia', cellCount: 1 },
  ],
  classOf: Int32Array.from([0, 1, 0]),
  members: [Uint32Array.of(0, 2), Uint32Array.of(1)],
}
// Cell 1 has no value.
const VALUES: PreviewValues = {
  values: Float64Array.of(0, Number.NaN, 10),
  count: 2,
  min: 0,
  max: 10,
}
const TRACK = { id: 'h5ad:qv', label: 'qv', min: 0, max: 10 }
// The same cells placed in 3D, and their scores with each one's z.
const DEEP_CELLS: PreviewCells = {
  ...CELLS,
  depths: { values: Float32Array.of(4, 8, 12), min: 4, max: 12 },
}
const DEEP_SCORES: PreviewScores = { ...SCORES, depths: Float32Array.of(4, 8, 12) }
const MATRIX = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -15, 10, 40, 1)

function section(overrides: Partial<StackSectionInput> = {}): StackSectionInput {
  return {
    cells: CELLS,
    classes: null,
    overlay: null,
    modelMatrix: MATRIX,
    scaleMin: 0,
    scaleMax: 4,
    ...overrides,
  }
}

interface LayerProps {
  readonly id: string
  readonly data: {
    readonly length: number
    readonly attributes: Readonly<
      Record<string, { readonly value: Float32Array | Uint8Array; readonly size: number }>
    >
  }
  readonly modelMatrix: Float32Array
  readonly getRadius?: number
  readonly billboard: boolean
  readonly pickable: boolean
  readonly parameters?: { readonly depthWriteEnabled?: boolean }
}

function props(layer: unknown): LayerProps {
  return (layer as { readonly props: LayerProps }).props
}

function pick(id: string, index: number): PickingInfo {
  return { layer: { id }, index } as unknown as PickingInfo
}

describe('sectionStackLayers', () => {
  it('lifts each section’s cells to its depth with its model matrix', () => {
    const { layers, targets } = sectionStackLayers([section(), null], OPTIONS)

    expect(layers).toHaveLength(1)
    const cells = props(layers[0])
    expect(cells.id).toBe('section-stack-0-cells')
    expect(cells.modelMatrix).toBe(MATRIX)
    expect(cells.billboard).toBe(true)
    expect(cells.pickable).toBe(true)
    expect([...cells.data.attributes.getPosition!.value]).toEqual([
      0, -0, 10, -20, 30, -5,
    ])
    expect(stackPick(pick('section-stack-0-cells', 2), targets)).toEqual({
      section: 0,
      kind: 'cell',
      index: 2,
    })
  })

  it('draws scoring cells solid, highest last, over a faint outline that hides nothing', () => {
    const input = section({ overlay: { kind: 'scores', scores: SCORES } })
    const { layers, targets } = sectionStackLayers([input], OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-scored',
      'section-stack-0-context',
    ])
    const scored = props(layers[0])
    expect([...scored.data.attributes.getPosition!.value]).toEqual([30, -5, 0, -0])
    const context = props(layers[1])
    expect(context.data.length).toBe(3)
    expect(context.pickable).toBe(false)
    expect(context.parameters?.depthWriteEnabled).toBe(false)

    // The second point drawn is the highest score, cell 0's.
    const picked = stackPick(pick('section-stack-0-scored', 1), targets)
    expect(picked).toEqual({ section: 0, kind: 'score', index: 0 })
    expect(stackPickText(picked!, 'S1', input, ['Aqp4'])).toBe('S1 · Aqp4 3')
    expect(stackPickText(picked!, 'S1', input, ['Aqp4', 'Gfap'])).toBe('S1 · Score 3')

    expect(
      sectionStackLayers([input], { ...OPTIONS, showContext: false }).layers.map(
        (layer) => props(layer).id,
      ),
    ).toEqual(['section-stack-0-scored'])
  })

  it('draws shown classes solid and hidden ones as the outline', () => {
    const input = section({
      classes: CLASSES,
      overlay: { kind: 'classes', classOf: CLASSES.classOf, colors: ['#ff0000', null] },
    })
    const { layers, targets } = sectionStackLayers([input], OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-classes',
      'section-stack-0-context',
    ])
    const shown = props(layers[0])
    expect([...shown.data.attributes.getPosition!.value]).toEqual([0, -0, 30, -5])
    expect([...shown.data.attributes.getFillColor!.value]).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255,
    ])
    expect([...props(layers[1]).data.attributes.getPosition!.value]).toEqual([10, -20])

    const picked = stackPick(pick('section-stack-0-classes', 1), targets)
    expect(picked).toEqual({ section: 0, kind: 'cell', index: 2 })
    expect(stackPickText(picked!, 'S1', input, [])).toBe('S1 · cell-2 · Neuron')
  })

  it('sizes cells by their radii, gathered with the cells each layer draws', () => {
    const radius = Float32Array.of(4, 5, 6)
    const input = section({
      cells: { ...CELLS, radius },
      classes: CLASSES,
      overlay: { kind: 'classes', classOf: CLASSES.classOf, colors: ['#ff0000', null] },
    })
    const { layers } = sectionStackLayers([input], OPTIONS)

    expect([...props(layers[0]).data.attributes.getRadius!.value]).toEqual([4, 6])
    expect([...props(layers[1]).data.attributes.getRadius!.value]).toEqual([5])

    // Visium spots share one radius; cells without an area are 10 µm across.
    const spots = props(
      sectionStackLayers([section({ cells: { ...CELLS, radius: 27.5 } })], OPTIONS)
        .layers[0],
    )
    expect(spots.getRadius).toBe(27.5)
    expect(spots.data.attributes.getRadius).toBeUndefined()
    expect(props(sectionStackLayers([section()], OPTIONS).layers[0]).getRadius).toBe(5)
  })

  it('draws cells with a value of the track solid, those without as the outline', () => {
    const input = section({ overlay: { kind: 'values', values: VALUES, track: TRACK } })
    const { layers, targets } = sectionStackLayers([input], OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-values',
      'section-stack-0-context',
    ])
    const shown = props(layers[0])
    expect([...shown.data.attributes.getPosition!.value]).toEqual([0, -0, 30, -5])
    // The main view's metadata colours, lowest to highest.
    expect([...shown.data.attributes.getFillColor!.value]).toEqual([
      68, 1, 84, 255, 253, 231, 37, 255,
    ])
    expect([...props(layers[1]).data.attributes.getPosition!.value]).toEqual([10, -20])

    const picked = stackPick(pick('section-stack-0-values', 1), targets)
    expect(picked).toEqual({ section: 0, kind: 'cell', index: 2 })
    expect(stackPickText(picked!, 'S1', input, [])).toBe('S1 · cell-2 · qv 10')

    // Another range recolours the same cells.
    const wider = sectionStackLayers(
      [
        section({
          overlay: { kind: 'values', values: VALUES, track: { ...TRACK, max: 20 } },
        }),
      ],
      OPTIONS,
    )
    expect([...props(wider.layers[0]).data.attributes.getFillColor!.value]).toEqual([
      68, 1, 84, 255, 33, 145, 140, 255,
    ])
  })

  it('hands deck.gl the same data while only the depth changes', () => {
    const input = section({ overlay: { kind: 'scores', scores: SCORES } })
    const first = sectionStackLayers([input], OPTIONS).layers
    const second = sectionStackLayers(
      [{ ...input, modelMatrix: Float32Array.of(...MATRIX.slice(0, 14), 80, 1) }],
      OPTIONS,
    ).layers

    expect(props(second[0]).data).toBe(props(first[0]).data)
    expect(props(second[1]).data).toBe(props(first[1]).data)
  })

  it('draws cells placed in 3D at their own z', () => {
    const plain = sectionStackLayers([section({ cells: DEEP_CELLS })], OPTIONS)
    const cells = props(plain.layers[0])

    expect(cells.data.attributes.getPosition!.size).toBe(3)
    expect([...cells.data.attributes.getPosition!.value]).toEqual([
      0, -0, 4, 10, -20, 8, 30, -5, 12,
    ])
    const picked = stackPick(pick('section-stack-0-cells', 1), plain.targets)
    expect(stackPickDepth(picked!, section({ cells: DEEP_CELLS }))).toBe(8)

    // Scores keep their cells' z, highest last.
    const scoredInput = section({
      cells: DEEP_CELLS,
      overlay: { kind: 'scores', scores: DEEP_SCORES },
    })
    const scored = sectionStackLayers([scoredInput], OPTIONS)
    expect([...props(scored.layers[0]).data.attributes.getPosition!.value]).toEqual([
      30, -5, 12, 0, -0, 4,
    ])
    expect([...props(scored.layers[1]).data.attributes.getPosition!.value]).toHaveLength(
      9,
    )
    const pickedScore = stackPick(pick('section-stack-0-scored', 0), scored.targets)
    expect(stackPickDepth(pickedScore!, scoredInput)).toBe(12)

    // Shown and hidden classes alike.
    const classes = sectionStackLayers(
      [
        section({
          cells: DEEP_CELLS,
          classes: CLASSES,
          overlay: {
            kind: 'classes',
            classOf: CLASSES.classOf,
            colors: ['#ff0000', null],
          },
        }),
      ],
      OPTIONS,
    )
    expect([...props(classes.layers[0]).data.attributes.getPosition!.value]).toEqual([
      0, -0, 4, 30, -5, 12,
    ])
    expect([...props(classes.layers[1]).data.attributes.getPosition!.value]).toEqual([
      10, -20, 8,
    ])

    // Cells in their section's plane have no depth of their own.
    expect(stackPickDepth(picked!, section())).toBeNull()
  })

  it('picks nothing from the outline or outside the cells', () => {
    const { targets } = sectionStackLayers([section()], OPTIONS)

    expect(stackPick(pick('section-stack-0-context', 0), targets)).toBeNull()
    expect(stackPick(pick('section-stack-0-cells', -1), targets)).toBeNull()
  })
})

describe('Python layers in the 3D cell view (plan 29)', () => {
  // Overview rows by cell ID: cell-2 is row 0, cell-0 row 2, cell-1 row 1.
  const ROWS: Readonly<Record<string, number>> = { 'cell-2': 0, 'cell-1': 1, 'cell-0': 2 }
  const rowOf = (cellId: string) => ROWS[cellId]

  function composed(change: Partial<ComposedPythonOverlay>): ComposedPythonOverlay {
    return { colors: null, hidden: null, highlights: [], ...change }
  }

  it('matches Python’s rows to the cells by ID', () => {
    // Row 0 (cell-2) red; row 1 (cell-1) hidden.
    const layers = stackPythonLayers(
      {
        composed: composed({
          colors: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0),
          hidden: Uint8Array.of(0, 1, 0),
          highlights: [
            { name: 'Ring', color: [255, 255, 255], rows: Uint32Array.of(0, 2) },
          ],
        }),
        names: ['Result', 'Ring'],
        rowOf,
      },
      CELLS,
    )

    expect([...(layers?.colors ?? [])]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255])
    expect([...(layers?.hidden ?? [])]).toEqual([0, 1, 0])
    expect([...(layers?.highlights[0]?.cells ?? [])]).toEqual([2, 0])
  })

  it('has nothing to draw when Python has drawn nothing', () => {
    expect(
      stackPythonLayers({ composed: composed({}), names: [], rowOf }, CELLS),
    ).toBeNull()
  })

  it('draws coloured cells solid, the rest faint, rings above, and hidden cells nowhere', () => {
    const python = stackPythonLayers(
      {
        composed: composed({
          colors: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0),
          hidden: Uint8Array.of(0, 1, 0),
          highlights: [{ name: 'Ring', color: [255, 255, 255], rows: Uint32Array.of(0) }],
        }),
        names: ['Result', 'Ring'],
        rowOf,
      },
      CELLS,
    )
    // The class colouring it takes over.
    const input = section({
      classes: CLASSES,
      overlay: {
        kind: 'classes',
        classOf: CLASSES.classOf,
        colors: ['#00ff00', '#0000ff'],
      },
      python,
    })
    const { layers, targets } = sectionStackLayers([input], OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-python',
      'section-stack-0-python-ring-Ring',
      'section-stack-0-context',
    ])
    const solid = props(layers[0])
    // Cell 2 (row 0) in red; cell 0 faint; cell 1 hidden.
    expect([...solid.data.attributes.getPosition!.value]).toEqual([30, -5])
    expect([...solid.data.attributes.getFillColor!.value]).toEqual([255, 0, 0, 255])
    expect([...props(layers[2]).data.attributes.getPosition!.value]).toEqual([0, -0])
    expect(props(layers[1]).pickable).toBe(false)
    expect(stackPick(pick('section-stack-0-python', 0), targets)).toEqual({
      section: 0,
      kind: 'cell',
      index: 2,
    })

    // Other cells off: only the coloured one and its ring.
    const hidden = sectionStackLayers([input], { ...OPTIONS, showContext: false })
    expect(hidden.layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-python',
      'section-stack-0-python-ring-Ring',
    ])
  })

  it('keeps the section’s own colouring under rings alone', () => {
    const python = stackPythonLayers(
      {
        composed: composed({
          highlights: [{ name: 'Ring', color: [255, 255, 255], rows: Uint32Array.of(1) }],
        }),
        names: ['Ring'],
        rowOf,
      },
      CELLS,
    )
    const { layers } = sectionStackLayers([section({ python })], OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      'section-stack-0-cells',
      'section-stack-0-python-ring-Ring',
    ])
  })
})
