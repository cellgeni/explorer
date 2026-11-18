import type { PickingInfo } from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import {
  previewBounds,
  type PreviewCells,
  type PreviewClasses,
  type PreviewScores,
} from './collectionPreviewData'
import {
  sectionStackLayers,
  stackPick,
  stackPickText,
  type SectionStackLayerOptions,
  type StackSectionInput,
} from './sectionStackLayers'

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
}
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

  it('picks nothing from the outline or outside the cells', () => {
    const { targets } = sectionStackLayers([section()], OPTIONS)

    expect(stackPick(pick('section-stack-0-context', 0), targets)).toBeNull()
    expect(stackPick(pick('section-stack-0-cells', -1), targets)).toBeNull()
  })
})
