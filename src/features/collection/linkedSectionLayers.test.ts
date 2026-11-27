import { describe, expect, it } from 'vitest'
import { geneExpressionColor } from '../../rendering/deckLayerColors'
import { previewBounds, type PreviewCells } from './collectionPreviewData'
import {
  deckPositions,
  LINKED_CELLS_LAYER_ID,
  LINKED_SCORES_LAYER_ID,
  linkedSectionLayers,
  scoredCells,
  sectionOverlay,
  valueLabel,
  type LinkedSectionLayerOptions,
} from './linkedSectionLayers'

const OPTIONS: LinkedSectionLayerOptions = {
  colorScale: 'plasma',
  scaleMin: 0,
  scaleMax: 4,
  radiusScale: 2,
  radiusMaxPixels: 10,
}

function cells(points: readonly (readonly [number, number])[]): PreviewCells {
  const positions = new Float32Array(points.flat())
  const bounds = previewBounds(positions)
  if (bounds === null) throw new Error('Expected cells.')
  return { positions, cellIds: points.map((_point, index) => `cell-${index}`), bounds }
}

interface LayerProps {
  readonly id: string
  readonly data: {
    readonly length: number
    readonly attributes: Readonly<
      Record<string, { readonly value: Float32Array | Uint8Array; readonly size: number }>
    >
  }
  readonly getFillColor?: readonly number[]
  readonly getRadius?: number
  readonly radiusScale: number
  readonly radiusMaxPixels: number
  readonly radiusMinPixels: number
}

function props(layer: unknown): LayerProps {
  return (layer as { readonly props: LayerProps }).props
}

const section = cells([
  [0, 0],
  [10, 20],
  [30, 5],
])

describe('linkedSectionLayers', () => {
  it('draws every cell in grey with y negated, as the main view does', () => {
    const layers = linkedSectionLayers(section, null, OPTIONS)

    expect(layers).toHaveLength(1)
    const cellLayer = props(layers[0])
    expect(cellLayer.id).toBe(LINKED_CELLS_LAYER_ID)
    expect(cellLayer.data.length).toBe(3)
    expect([...cellLayer.data.attributes.getPosition!.value]).toEqual([
      0, -0, 10, -20, 30, -5,
    ])
    expect(cellLayer.getFillColor?.[3]).toBe(200)
    // The Cell point size multiplier scales the points and their limits.
    expect(cellLayer.radiusScale).toBe(2)
    expect(cellLayer.radiusMaxPixels).toBe(20)
    expect(cellLayer.radiusMinPixels).toBe(1)
  })

  it('draws scored cells over the others, highest last, in the gene scale', () => {
    const scores = {
      positions: new Float32Array([0, 0, 10, 20, 30, 5]),
      scores: new Float32Array([4, 0, 1]),
      maxScore: 4,
    }
    const layers = linkedSectionLayers(section, { kind: 'scores', scores }, OPTIONS)

    expect(layers.map((layer) => props(layer).id)).toEqual([
      LINKED_CELLS_LAYER_ID,
      LINKED_SCORES_LAYER_ID,
    ])
    // Cells scoring 0 fade behind those that score.
    expect(props(layers[0]).getFillColor?.[3]).toBe(120)
    const scored = props(layers[1])
    expect(scored.data.length).toBe(2)
    expect([...scored.data.attributes.getPosition!.value]).toEqual([30, -5, 0, -0])
    const top = geneExpressionColor('plasma', 1)
    expect([...scored.data.attributes.getFillColor!.value].slice(4, 7)).toEqual(
      top.slice(0, 3),
    )
    expect(scoredCells(scores, OPTIONS).order).toEqual(Uint32Array.from([2, 0]))
  })

  it('sizes points by their radii: one for all as a prop, else one each', () => {
    // Cells without an area are points 10 µm across.
    const plain = props(linkedSectionLayers(section, null, OPTIONS)[0])
    expect(plain.getRadius).toBe(5)
    expect(plain.data.attributes.getRadius).toBeUndefined()
    // Visium spots share one radius.
    const spots = props(
      linkedSectionLayers({ ...section, radius: 27.5 }, null, OPTIONS)[0],
    )
    expect(spots.getRadius).toBe(27.5)
    expect(spots.data.attributes.getRadius).toBeUndefined()

    const radius = Float32Array.of(4, 5, 6)
    const scores = {
      positions: new Float32Array([0, 0, 10, 20, 30, 5]),
      scores: new Float32Array([4, 0, 1]),
      maxScore: 4,
      radius,
    }
    const layers = linkedSectionLayers(
      { ...section, radius },
      { kind: 'scores', scores },
      OPTIONS,
    )
    expect(props(layers[0]).data.attributes.getRadius?.value).toBe(radius)
    // The scored cells' radii, in drawn order: highest score last.
    expect([...props(layers[1]).data.attributes.getRadius!.value]).toEqual([6, 4])
  })

  it('draws no cell whose stored score is NaN or infinite (EXP-241)', () => {
    const scores = {
      positions: new Float32Array([0, 0, 10, 20, 30, 5]),
      scores: new Float32Array([Number.POSITIVE_INFINITY, Number.NaN, 2]),
      maxScore: 2,
    }

    expect(scoredCells(scores, OPTIONS).order).toEqual(Uint32Array.from([2]))
  })

  it('leaves out the scores layer when no cell scores', () => {
    const scores = {
      positions: new Float32Array([0, 0]),
      scores: new Float32Array([0]),
      maxScore: 0,
    }

    expect(
      linkedSectionLayers(section, { kind: 'scores', scores }, OPTIONS),
    ).toHaveLength(1)
  })

  it('colours cells by class, fading hidden classes and cells in none', () => {
    const layers = linkedSectionLayers(
      section,
      {
        kind: 'classes',
        classOf: Int32Array.from([0, 1, -1]),
        colors: ['#ff0000', null],
      },
      OPTIONS,
    )

    const colors = [...props(layers[0]).data.attributes.getFillColor!.value]
    expect(colors.slice(0, 4)).toEqual([255, 0, 0, 255])
    expect(colors[7]).toBe(48)
    expect(colors[11]).toBe(48)
  })

  it('colours cells by their value of the track, fading those without one', () => {
    const values = {
      values: Float64Array.of(10, Number.NaN, 5),
      count: 2,
      min: 5,
      max: 10,
    }
    const overlay = {
      kind: 'values' as const,
      values,
      track: { id: 'h5ad:qv', label: 'qv', min: 0, max: 10 },
    }
    const layers = linkedSectionLayers(section, overlay, OPTIONS)

    expect(layers).toHaveLength(1)
    const colors = [...props(layers[0]).data.attributes.getFillColor!.value]
    expect(colors.slice(0, 4)).toEqual([253, 231, 37, 235])
    expect(colors.slice(4, 8)).toEqual([72, 68, 58, 48])
    expect(colors.slice(8, 12)).toEqual([33, 145, 140, 235])
    expect(valueLabel(overlay, 2)).toBe('qv 5')
    expect(valueLabel(overlay, 1)).toBeUndefined()
  })

  it('colours by the track in place of the genes, once its values are read', () => {
    const values = { values: Float64Array.of(1), count: 1, min: 1, max: 1 }
    const metadata = { id: 'h5ad:qv', label: 'qv', min: 0, max: 2 }
    const coloring = { genes: ['Aqp4'], annotations: null, metadata, classColors: {} }
    const scores = {
      positions: new Float32Array(2),
      scores: Float32Array.of(3),
      maxScore: 3,
    }

    expect(sectionOverlay({ scores, classes: null, values }, coloring)).toEqual({
      kind: 'values',
      values,
      track: metadata,
    })
    // While they are read, the cells are drawn uncoloured, not by the genes.
    expect(sectionOverlay({ scores, classes: null, values: null }, coloring)).toBeNull()
  })

  it('reuses the attribute arrays between frames', () => {
    expect(deckPositions(section.positions)).toBe(deckPositions(section.positions))

    const scores = {
      positions: new Float32Array([0, 0]),
      scores: new Float32Array([2]),
      maxScore: 2,
    }
    const first = scoredCells(scores, OPTIONS)
    expect(scoredCells(scores, OPTIONS)).toBe(first)
    // A new scale colours them again.
    expect(scoredCells(scores, { ...OPTIONS, scaleMax: 2 })).not.toBe(first)
  })
})
