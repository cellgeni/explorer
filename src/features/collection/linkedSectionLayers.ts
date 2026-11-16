import type { Layer } from '@deck.gl/core'
import { OrthographicView } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import {
  DEFAULT_OVERVIEW_CELL_FILL_RGB,
  geneExpressionColor,
  geneExpressionIntensity,
} from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import type { PreviewCells, PreviewScores } from './collectionPreviewData'
import { hexRgb, type PreviewOverlay } from './collectionPreviewRaster'

// The layers of a panel beside the main view: a registered section's cells
// from its collection preview, coloured as the main view colours them. Each
// cell is a point 10 µm across, like a cell without an area in the main view,
// kept between a minimum and a maximum size on screen. Data y grows
// downwards; deck.gl's y is its negative, as in the main view.

export const LINKED_SECTION_VIEW = new OrthographicView({
  id: 'linked-section',
  flipY: false,
})

export const LINKED_SECTION_CELL_RADIUS_MICROMETERS = 5
const CELL_RADIUS_MIN_PIXELS = 0.5
const SCORED_CELL_RADIUS_MIN_PIXELS = 1

export const LINKED_CELLS_LAYER_ID = 'linked-section-cells'
export const LINKED_SCORES_LAYER_ID = 'linked-section-scores'

// Cells without a score or class, as the main view draws them.
const CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 200] as const
// Cells scoring 0, behind those that score, like GENE_EXPRESSION_ZERO_FILL_COLOR
// but a little stronger, as the panel has no image under it.
const UNSCORED_CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 120] as const
// Cells in no shown class, a faint outline of the tissue.
const FADED_CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 48] as const
const SCORED_CELL_ALPHA = 235

export interface LinkedSectionLayerOptions {
  readonly colorScale: GeneExpressionColorScale
  // The scores drawn at the bottom and top of the gene scale.
  readonly scaleMin: number
  readonly scaleMax: number
  // The Cell point size multiplier.
  readonly radiusScale: number
  // The largest a point gets on screen, before radiusScale.
  readonly radiusMaxPixels: number
}

// The scored cells drawn over the others, highest last so they stay on top.
export interface LinkedScoredCells {
  readonly positions: Float32Array
  readonly colors: Uint8Array
  // Each drawn cell's index in PreviewScores.
  readonly order: Uint32Array
}

export function linkedSectionLayers(
  cells: PreviewCells,
  overlay: PreviewOverlay | null,
  options: LinkedSectionLayerOptions,
): Layer[] {
  const radius = {
    radiusUnits: 'common',
    radiusScale: options.radiusScale,
    radiusMaxPixels: options.radiusMaxPixels * options.radiusScale,
    getRadius: LINKED_SECTION_CELL_RADIUS_MICROMETERS,
  } as const
  const cellCount = cells.positions.length / 2
  const classColors = overlay?.kind === 'classes' ? classColorAttribute(overlay) : null
  const layers: Layer[] = [
    new ScatterplotLayer({
      id: LINKED_CELLS_LAYER_ID,
      data: {
        length: cellCount,
        attributes: {
          getPosition: { value: deckPositions(cells.positions), size: 2 },
          ...(classColors === null
            ? {}
            : { getFillColor: { value: classColors, size: 4, normalized: true } }),
        },
      },
      ...radius,
      radiusMinPixels: CELL_RADIUS_MIN_PIXELS * options.radiusScale,
      ...(classColors === null
        ? { getFillColor: overlay?.kind === 'scores' ? UNSCORED_CELL_RGBA : CELL_RGBA }
        : {}),
      pickable: true,
      stroked: false,
      filled: true,
    }) as Layer,
  ]

  if (overlay?.kind === 'scores') {
    const scored = scoredCells(overlay.scores, options)

    if (scored.order.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: LINKED_SCORES_LAYER_ID,
          data: {
            length: scored.order.length,
            attributes: {
              getPosition: { value: scored.positions, size: 2 },
              getFillColor: { value: scored.colors, size: 4, normalized: true },
            },
          },
          ...radius,
          radiusMinPixels: SCORED_CELL_RADIUS_MIN_PIXELS * options.radiusScale,
          pickable: true,
          stroked: false,
          filled: true,
        }) as Layer,
      )
    }
  }

  return layers
}

// Cached per array, so a pan or zoom hands deck.gl the same attribute arrays
// and nothing is uploaded again.
const deckPositionsCache = new WeakMap<Float32Array, Float32Array>()
const classColorsCache = new WeakMap<
  Int32Array,
  { readonly key: string; readonly colors: Uint8Array }
>()
const scoredCellsCache = new WeakMap<
  PreviewScores,
  { readonly key: string; readonly cells: LinkedScoredCells }
>()

export function deckPositions(positions: Float32Array): Float32Array {
  const cached = deckPositionsCache.get(positions)
  if (cached !== undefined) return cached

  const flipped = new Float32Array(positions.length)

  for (let index = 0; index < positions.length; index += 2) {
    flipped[index] = positions[index] ?? 0
    flipped[index + 1] = -(positions[index + 1] ?? 0)
  }

  deckPositionsCache.set(positions, flipped)
  return flipped
}

function classColorAttribute(
  overlay: Extract<PreviewOverlay, { readonly kind: 'classes' }>,
): Uint8Array {
  const key = overlay.colors.join('|')
  const cached = classColorsCache.get(overlay.classOf)
  if (cached?.key === key) return cached.colors

  const rgb = overlay.colors.map(hexRgb)
  const colors = new Uint8Array(overlay.classOf.length * 4)

  overlay.classOf.forEach((classIndex, index) => {
    const color = rgb[classIndex]
    colors.set(
      color === undefined || color === null ? FADED_CELL_RGBA : [...color, 255],
      index * 4,
    )
  })

  classColorsCache.set(overlay.classOf, { key, colors })
  return colors
}

export function scoredCells(
  scores: PreviewScores,
  options: Pick<LinkedSectionLayerOptions, 'colorScale' | 'scaleMin' | 'scaleMax'>,
): LinkedScoredCells {
  const key = `${options.colorScale}|${options.scaleMin}|${options.scaleMax}`
  const cached = scoredCellsCache.get(scores)
  if (cached?.key === key) return cached.cells

  const indices: number[] = []

  scores.scores.forEach((score, index) => {
    if (score > 0) indices.push(index)
  })
  indices.sort((left, right) => (scores.scores[left] ?? 0) - (scores.scores[right] ?? 0))

  const order = Uint32Array.from(indices)
  const positions = new Float32Array(order.length * 2)
  const colors = new Uint8Array(order.length * 4)

  order.forEach((scoreIndex, index) => {
    positions[index * 2] = scores.positions[scoreIndex * 2] ?? 0
    positions[index * 2 + 1] = -(scores.positions[scoreIndex * 2 + 1] ?? 0)
    const color = geneExpressionColor(
      options.colorScale,
      geneExpressionIntensity(
        scores.scores[scoreIndex] ?? 0,
        options.scaleMin,
        options.scaleMax,
      ),
    )
    colors[index * 4] = color[0] ?? 0
    colors[index * 4 + 1] = color[1] ?? 0
    colors[index * 4 + 2] = color[2] ?? 0
    colors[index * 4 + 3] = SCORED_CELL_ALPHA
  })

  const cells = { positions, colors, order }
  scoredCellsCache.set(scores, { key, cells })
  return cells
}
