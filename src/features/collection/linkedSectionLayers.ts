import type { Color, Layer } from '@deck.gl/core'
import { OrthographicView } from '@deck.gl/core'
import { DataFilterExtension } from '@deck.gl/extensions'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { SpatialElement } from '../../datasets/spatialDataset'
import {
  boundaryElementsToLayerData,
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayers,
  createCellBoundaryLayerStyle,
  EMPTY_CELL_BOUNDARY_LAYER_STYLE,
} from '../../rendering/cellBoundaryRenderer'
import { metadataColor } from '../../rendering/cellStyling'
import {
  DEFAULT_OVERVIEW_CELL_FILL_RGB,
  geneExpressionColor,
  geneExpressionIntensity,
} from '../../rendering/deckLayerColors'
import type {
  CellBoundaryLayerGeometry,
  CellBoundaryLayerStyle,
  GeneExpressionColorScale,
} from '../../rendering/deckLayerTypes'
import { metadataValueText } from '../annotations/annotationModel'
import type { CollectionBarAnnotations } from './CollectionBar'
import {
  PREVIEW_CELL_RADIUS_MICROMETERS,
  shownClassOf,
  type PreviewBounds,
  type PreviewCells,
  type PreviewMetadataTrack,
  type PreviewRadius,
  type PreviewScores,
  type PreviewValues,
} from './collectionPreviewData'
import { hexRgb, type PreviewOverlay } from './collectionPreviewRaster'
import type { PreviewEntry } from './collectionPreviewStore'

// The layers of a panel beside the main view: a registered section's cells
// from its collection preview, coloured as the main view colours them. Each
// cell is a point the size of its area, as in the main view (10 µm across
// without one), kept between a minimum and a maximum size on screen. Data y
// grows downwards; deck.gl's y is its negative, as in the main view. With
// its `Cell boundaries` on (plan 30-D9), the outlines read for the panel's
// view are drawn as the main view draws them: under the points, each in its
// cell's colour and filled while cells are coloured, in place of the point.

export const LINKED_SECTION_VIEW = new OrthographicView({
  id: 'linked-section',
  flipY: false,
})

const CELL_RADIUS_MIN_PIXELS = 0.5
const SCORED_CELL_RADIUS_MIN_PIXELS = 1

export const LINKED_CELLS_LAYER_ID = 'linked-section-cells'
export const LINKED_SCORES_LAYER_ID = 'linked-section-scores'

// Cells without a score or class, as the main view draws them.
const CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 200] as const
// Cells scoring 0, behind those that score, like GENE_EXPRESSION_ZERO_FILL_COLOR
// but a little stronger, as the panel has no image under it.
const UNSCORED_CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 120] as const
// Cells in no shown class, or without a value of the track, a faint outline
// of the tissue.
const FADED_CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 48] as const
const SCORED_CELL_ALPHA = 235

// A panel's outlines, matched to its cells.
export interface LinkedSectionOutlines {
  readonly geometry: CellBoundaryLayerGeometry
  // Each outlined cell's index in the section's cells, by its ID.
  readonly cellIndexById: ReadonlyMap<string, number>
  // 1 for each outlined cell, whose point is not drawn; 0 for the rest.
  readonly cellFilter: Float32Array
  // Where the outlines lie, in the dataset's coordinates; null for none.
  readonly bounds: PreviewBounds | null
}

// How the outlines are drawn.
export interface LinkedSectionOutlineLayers {
  readonly outlines: LinkedSectionOutlines
  // Each outlined cell's index in the scores, by its ID.
  readonly scoreIndexById: ReadonlyMap<string, number>
  readonly style: CellBoundaryLayerStyle
  // Filled while cells are coloured, as in the main view.
  readonly filled: boolean
  // The main view's Cell fill and Boundary opacities.
  readonly fillOpacity: number
  readonly lineOpacity: number
}

// Shared so the layers' extensions stay the same between renders.
const OUTLINED_POINT_FILTER = new DataFilterExtension({ filterSize: 1 })
// The points kept: those whose filter value is 0, without an outline.
const OUTLINED_POINT_FILTER_RANGE: [number, number] = [0, 0.5]

export interface LinkedSectionLayerOptions {
  readonly colorScale: GeneExpressionColorScale
  // The scores drawn at the bottom and top of the gene scale.
  readonly scaleMin: number
  readonly scaleMax: number
  // The Cell point size multiplier.
  readonly radiusScale: number
  // The largest a point gets on screen, before radiusScale
  // (UNCAPPED_RADIUS_PIXELS for points that keep their physical size).
  readonly radiusMaxPixels: number
}

// The scored cells drawn over the others, highest last so they stay on top.
export interface LinkedScoredCells {
  readonly positions: Float32Array
  readonly colors: Uint8Array
  // Each drawn cell's index in PreviewScores.
  readonly order: Uint32Array
  // Their radii, in drawn order when one per cell.
  readonly radius: PreviewRadius
}

// What a section's cells are coloured by: the annotation set's classes in
// `classColors` (the preview store's, one per class across the collection),
// the hidden ones faded, else a metadata track's values, or else the genes'
// scores. Null draws the cells only, as while what they are coloured by is
// read.
export function sectionOverlay(
  preview: Pick<PreviewEntry, 'scores' | 'classes' | 'values'> | null,
  coloring: {
    readonly genes: readonly string[]
    readonly annotations: CollectionBarAnnotations | null
    readonly metadata: PreviewMetadataTrack | null
    readonly classColors: Readonly<Record<string, string>>
  },
): PreviewOverlay | null {
  const { annotations, metadata } = coloring

  if (annotations !== null) {
    const classes = preview?.classes ?? null
    if (classes === null) return null

    const colors = coloring.classColors
    return {
      kind: 'classes',
      classOf: shownClassOf(classes, annotations.hiddenIds),
      colors: classes.classes.map(({ id }) =>
        annotations.hiddenIds.has(id) ? null : (colors[id] ?? null),
      ),
    }
  }

  if (metadata !== null) {
    const values = preview?.values ?? null
    return values === null ? null : { kind: 'values', values, track: metadata }
  }

  const scores = preview?.scores ?? null
  return coloring.genes.length > 0 && scores !== null ? { kind: 'scores', scores } : null
}

export function linkedSectionLayers(
  cells: PreviewCells,
  overlay: PreviewOverlay | null,
  options: LinkedSectionLayerOptions,
  outlineLayers: LinkedSectionOutlineLayers | null = null,
): Layer[] {
  const radius = {
    radiusUnits: 'common',
    radiusScale: options.radiusScale,
    radiusMaxPixels: options.radiusMaxPixels * options.radiusScale,
  } as const
  const cellRadius = cells.radius ?? PREVIEW_CELL_RADIUS_MICROMETERS
  const cellCount = cells.positions.length / 2
  const classColors =
    overlay?.kind === 'classes'
      ? classColorAttribute(overlay)
      : overlay?.kind === 'values'
        ? valueColorAttribute(overlay)
        : null
  // Outlined cells' points are left out. The filter is there with or
  // without outlines: deck.gl sets up an extension only for a new layer, so
  // one added when outlines first come would filter nothing.
  const filter = {
    extensions: [OUTLINED_POINT_FILTER],
    filterRange: OUTLINED_POINT_FILTER_RANGE,
  }
  const layers: Layer[] =
    outlineLayers === null
      ? []
      : (createCellBoundaryLayers({
          geometry: outlineLayers.outlines.geometry,
          style: outlineLayers.style,
          fillEnabled: outlineLayers.filled,
          cellFillOpacity: outlineLayers.fillOpacity,
          cellBoundaryOpacity: outlineLayers.lineOpacity,
          pickable: true,
        }) as Layer[])

  layers.push(
    new ScatterplotLayer({
      id: LINKED_CELLS_LAYER_ID,
      data: {
        length: cellCount,
        attributes: {
          getPosition: { value: deckPositions(cells.positions), size: 2 },
          ...radiusAttribute(cellRadius),
          ...(classColors === null
            ? {}
            : { getFillColor: { value: classColors, size: 4, normalized: true } }),
          getFilterValue: {
            value:
              outlineLayers?.outlines.cellFilter ??
              noOutlines(cells.positions, cellCount),
            size: 1,
          },
        },
      },
      ...radius,
      ...radiusProp(cellRadius),
      radiusMinPixels: CELL_RADIUS_MIN_PIXELS * options.radiusScale,
      ...(classColors === null
        ? { getFillColor: overlay?.kind === 'scores' ? UNSCORED_CELL_RGBA : CELL_RGBA }
        : {}),
      ...filter,
      pickable: true,
      stroked: false,
      filled: true,
    }) as Layer,
  )

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
              ...radiusAttribute(scored.radius),
              getFilterValue: {
                value:
                  outlineLayers === null
                    ? noOutlines(scored, scored.order.length)
                    : scoredCellFilter(scored, outlineLayers.scoreIndexById),
                size: 1,
              },
            },
          },
          ...radius,
          ...radiusProp(scored.radius),
          radiusMinPixels: SCORED_CELL_RADIUS_MIN_PIXELS * options.radiusScale,
          ...filter,
          pickable: true,
          stroked: false,
          filled: true,
        }) as Layer,
      )
    }
  }

  return layers
}

// A radius as deck.gl takes it: one for every point as the getRadius prop
// (radiusProp), or one per point as an attribute (radiusAttribute).
export function radiusAttribute(radius: PreviewRadius): {
  readonly getRadius?: { readonly value: Float32Array; readonly size: 1 }
} {
  return typeof radius === 'number' ? {} : { getRadius: { value: radius, size: 1 } }
}

export function radiusProp(radius: PreviewRadius): { readonly getRadius?: number } {
  return typeof radius === 'number' ? { getRadius: radius } : {}
}

// The outlines read for a panel, each matched to its cell by ID. Only cells
// where the outlines lie are looked at.
export function linkedSectionOutlines(
  elements: readonly SpatialElement[],
  cells: PreviewCells,
): LinkedSectionOutlines {
  const geometry = createCellBoundaryLayerGeometry(boundaryElementsToLayerData(elements))
  const ids = geometry.boundaryCellIds
  const cellFilter = new Float32Array(cells.positions.length / 2)
  const cellIndexById = new Map<string, number>()
  const bounds = outlineBounds(geometry)

  if (bounds !== null) {
    forEachPointIn(cells.positions, bounds, (index) => {
      const id = cells.cellIds[index]

      if (id !== undefined && ids.has(id)) {
        cellIndexById.set(id, index)
        cellFilter[index] = 1
      }
    })
  }

  return { geometry, cellIndexById, cellFilter, bounds }
}

// Each outlined cell's index in the scores, by its ID.
export function outlinedScoreIndexes(
  outlines: LinkedSectionOutlines,
  scores: PreviewScores | null,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>()
  if (scores === null || outlines.bounds === null) return found

  const ids = outlines.geometry.boundaryCellIds

  forEachPointIn(scores.positions, outlines.bounds, (index) => {
    const id = scores.ids[index]
    if (id !== undefined && ids.has(id)) found.set(id, index)
  })

  return found
}

// Each outline in its cell's colour, as the overlay colours its point; with
// no overlay, outlines keep the main view's grey.
export function linkedSectionOutlineStyle(
  outlines: LinkedSectionOutlines,
  overlay: PreviewOverlay | null,
  scoreIndexById: ReadonlyMap<string, number>,
  scale: Pick<LinkedSectionLayerOptions, 'colorScale' | 'scaleMin' | 'scaleMax'>,
): CellBoundaryLayerStyle {
  if (overlay === null) return EMPTY_CELL_BOUNDARY_LAYER_STYLE

  if (overlay.kind === 'scores') {
    return createCellBoundaryLayerStyle(outlines.geometry, {
      cellColor: (cellId) => {
        const scoreIndex = scoreIndexById.get(cellId)
        const score =
          scoreIndex === undefined ? undefined : overlay.scores.scores[scoreIndex]

        if (score === undefined || !Number.isFinite(score) || score <= 0) {
          return outlines.cellIndexById.has(cellId) ? [...UNSCORED_CELL_RGBA] : undefined
        }

        const color = geneExpressionColor(
          scale.colorScale,
          geneExpressionIntensity(score, scale.scaleMin, scale.scaleMax),
        )
        return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, SCORED_CELL_ALPHA]
      },
    })
  }

  const colors =
    overlay.kind === 'classes'
      ? classColorAttribute(overlay)
      : valueColorAttribute(overlay)

  return createCellBoundaryLayerStyle(outlines.geometry, {
    cellColor: (cellId): Color | undefined => {
      const index = outlines.cellIndexById.get(cellId)
      if (index === undefined) return undefined

      const offset = index * 4
      return [
        colors[offset] ?? 0,
        colors[offset + 1] ?? 0,
        colors[offset + 2] ?? 0,
        colors[offset + 3] ?? 0,
      ]
    },
  })
}

// Where the outlines lie: their vertices' extent, with y back in the
// dataset's direction.
function outlineBounds(geometry: CellBoundaryLayerGeometry): PreviewBounds | null {
  const path = geometry.pathLayerData.attributes.getPath.value as Float32Array | undefined
  if (path === undefined || path.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let index = 0; index < path.length; index += 3) {
    const x = path[index] ?? Number.NaN
    const y = -(path[index + 1] ?? Number.NaN)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return minX <= maxX && minY <= maxY ? { minX, maxX, minY, maxY } : null
}

// Calls `visit` with the index of each point (interleaved x, y) in `bounds`.
function forEachPointIn(
  positions: Float32Array,
  bounds: PreviewBounds,
  visit: (index: number) => void,
): void {
  for (let index = 0; index < positions.length / 2; index += 1) {
    const x = positions[index * 2] ?? Number.NaN
    const y = positions[index * 2 + 1] ?? Number.NaN

    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
      visit(index)
    }
  }
}

// Cached per array, so a pan or zoom hands deck.gl the same attribute arrays
// and nothing is uploaded again.
const deckPositionsCache = new WeakMap<Float32Array, Float32Array>()
const classColorsCache = new WeakMap<
  Int32Array,
  { readonly key: string; readonly colors: Uint8Array }
>()
const valueColorsCache = new WeakMap<
  PreviewValues,
  { readonly key: string; readonly colors: Uint8Array }
>()
const scoredCellsCache = new WeakMap<
  PreviewScores,
  { readonly key: string; readonly cells: LinkedScoredCells }
>()
const noOutlinesCache = new WeakMap<object, Float32Array>()
const scoredFilterCache = new WeakMap<
  LinkedScoredCells,
  { readonly outlined: ReadonlyMap<string, number>; readonly filter: Float32Array }
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

// A cell's value of the track colouring it, as "qv 21.5"; undefined without
// one.
export function valueLabel(
  overlay: PreviewOverlay | null,
  cell: number,
): string | undefined {
  if (overlay?.kind !== 'values') return undefined

  const value = overlay.values.values[cell] ?? Number.NaN
  return Number.isFinite(value)
    ? `${overlay.track.label} ${metadataValueText(value)}`
    : undefined
}

// Each cell in the metadata colour of its value, or faded without one.
function valueColorAttribute(
  overlay: Extract<PreviewOverlay, { readonly kind: 'values' }>,
): Uint8Array {
  const { values, track } = overlay
  const key = `${track.min}|${track.max}`
  const cached = valueColorsCache.get(values)
  if (cached?.key === key) return cached.colors

  const colors = new Uint8Array(values.values.length * 4)

  values.values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      colors.set(FADED_CELL_RGBA, index * 4)
      return
    }
    const color = metadataColor(value, track.min, track.max)
    colors.set([color[0], color[1], color[2], SCORED_CELL_ALPHA], index * 4)
  })

  valueColorsCache.set(values, { key, colors })
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

  // A stored NaN or infinity is no score, as in the main view.
  scores.scores.forEach((score, index) => {
    if (Number.isFinite(score) && score > 0) indices.push(index)
  })
  indices.sort((left, right) => (scores.scores[left] ?? 0) - (scores.scores[right] ?? 0))

  const order = Uint32Array.from(indices)
  const positions = new Float32Array(order.length * 2)
  const colors = new Uint8Array(order.length * 4)
  const scoreRadii = scores.radius instanceof Float32Array ? scores.radius : null
  const radii = scoreRadii === null ? null : new Float32Array(order.length)

  order.forEach((scoreIndex, index) => {
    if (radii !== null) {
      radii[index] = scoreRadii?.[scoreIndex] ?? PREVIEW_CELL_RADIUS_MICROMETERS
    }
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

  const radius =
    radii ??
    (typeof scores.radius === 'number' ? scores.radius : PREVIEW_CELL_RADIUS_MICROMETERS)
  const cells = { positions, colors, order, radius }
  scoredCellsCache.set(scores, { key, cells })
  return cells
}

// 1 for each drawn scored cell that is outlined, in draw order.
function scoredCellFilter(
  scored: LinkedScoredCells,
  outlined: ReadonlyMap<string, number>,
): Float32Array {
  const cached = scoredFilterCache.get(scored)
  if (cached?.outlined === outlined) return cached.filter

  const outlinedScores = new Set(outlined.values())
  const filter = new Float32Array(scored.order.length)

  scored.order.forEach((scoreIndex, index) => {
    if (outlinedScores.has(scoreIndex)) filter[index] = 1
  })

  scoredFilterCache.set(scored, { outlined, filter })
  return filter
}

// A filter that keeps every point, one per array of points.
function noOutlines(points: object, length: number): Float32Array {
  const cached = noOutlinesCache.get(points)
  if (cached?.length === length) return cached

  const filter = new Float32Array(length)
  noOutlinesCache.set(points, filter)
  return filter
}
