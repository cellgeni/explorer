import type { Color } from '@deck.gl/core'
import {
  FADED_CELL_ALPHA,
  FADED_CELL_OPACITY,
  GENE_EXPRESSION_ZERO_FILL_COLOR,
} from './deckLayerColors'
import type { GeneExpressionElementStyleIndex, OverviewCellDatum } from './deckLayerTypes'
import {
  geneExpressionElementForCell,
  hasGeneExpressionElementStyles,
} from './geneExpressionRenderer'
import type { IdLookup } from '../data/lazyIdLookup'
import { normalizeLayerOpacity } from './layerOpacity'

// Styling for the overview cell point layer, which keeps every cell on the GPU
// and takes its colours and sampling from packed per-cell arrays. Colours match
// styleCellsForObservation followed by styleCellsByGeneExpression.

export interface CellPointStyler {
  fillColor(cell: OverviewCellDatum): Color
  // The cell as the styled point list used to hold it, for hover details.
  styledCell(cell: OverviewCellDatum): OverviewCellDatum
}

export function createCellPointStyler(options: {
  readonly observationColor: ((cell: OverviewCellDatum) => Color) | null
  readonly expressionIndex: GeneExpressionElementStyleIndex
  readonly styleUnmatchedCells: boolean
}): CellPointStyler {
  const { observationColor, expressionIndex, styleUnmatchedCells } = options
  const expressionStyled =
    styleUnmatchedCells || hasGeneExpressionElementStyles(expressionIndex)

  return {
    fillColor(cell) {
      if (expressionStyled) {
        const element = geneExpressionElementForCell(expressionIndex, cell)

        if (element !== undefined) {
          return element.fillColor
        }

        if (styleUnmatchedCells) {
          return GENE_EXPRESSION_ZERO_FILL_COLOR
        }
      }

      return observationColor?.(cell) ?? cell.fillColor
    },
    styledCell(cell) {
      const observed =
        observationColor === null ? cell : { ...cell, fillColor: observationColor(cell) }

      if (!expressionStyled) {
        return observed
      }

      const element = geneExpressionElementForCell(expressionIndex, cell)

      if (element === undefined) {
        return styleUnmatchedCells
          ? {
              ...observed,
              fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
              expressionCount: 0,
            }
          : observed
      }

      return {
        ...observed,
        fillColor: element.fillColor,
        ...(element.expressionCount === undefined
          ? {}
          : { expressionCount: element.expressionCount }),
        ...(element.expressionGenes === undefined
          ? {}
          : { expressionGenes: element.expressionGenes }),
      }
    },
  }
}

// Multiplier on cell point radii and their screen-pixel limits, set by the
// Cells section's point size slider. The steps are roughly logarithmic: a
// dataset whose coordinates are image pixels needs 10x or more before its
// cells show at the full view.
export const DEFAULT_CELL_POINT_SCALE = 1
export const CELL_POINT_SCALE_STEPS = [
  0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32,
] as const

// The slider step nearest to a scale.
export function cellPointScaleStepIndex(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return CELL_POINT_SCALE_STEPS.indexOf(DEFAULT_CELL_POINT_SCALE)
  }

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  CELL_POINT_SCALE_STEPS.forEach((step, index) => {
    const distance = Math.abs(Math.log(value / step))

    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  })

  return nearestIndex
}

export function normalizeCellPointScale(value: number): number {
  return (
    CELL_POINT_SCALE_STEPS[cellPointScaleStepIndex(value)] ?? DEFAULT_CELL_POINT_SCALE
  )
}

export interface CellPointGeometry {
  // x and y (deck orientation) per cell.
  readonly positions: Float64Array
  readonly radii: Float32Array
}

export function packCellPointGeometry(
  cells: readonly OverviewCellDatum[],
): CellPointGeometry {
  const positions = new Float64Array(cells.length * 2)
  const radii = new Float32Array(cells.length)

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]

    if (cell === undefined) {
      continue
    }

    positions[index * 2] = cell.position[0] ?? 0
    positions[index * 2 + 1] = cell.position[1] ?? 0
    radii[index] = cell.radiusMicrometers ?? cell.radiusPixels
  }

  return { positions, radii }
}

// Alpha used for the outline of a colour without one, as cellPointOutlineColor.
const DEFAULT_OUTLINE_ALPHA = 210

function writeCellPointColor(colors: Uint8Array, index: number, color: Color): void {
  const offset = index * 4
  colors[offset] = color[0] ?? 0
  colors[offset + 1] = color[1] ?? 0
  colors[offset + 2] = color[2] ?? 0
  colors[offset + 3] = color[3] ?? DEFAULT_OUTLINE_ALPHA
}

// RGBA fill per cell, before layer opacity.
export function packCellPointColors(
  cells: readonly OverviewCellDatum[],
  styler: CellPointStyler,
): Uint8Array {
  const colors = new Uint8Array(cells.length * 4)

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]

    if (cell !== undefined) {
      writeCellPointColor(colors, index, styler.fillColor(cell))
    }
  }

  return colors
}

// Colours made by writing some cells over a base array, so that the layer's
// fill and line colours can be written over the base's the same way.
interface CellPointColorPatch {
  readonly base: Uint8Array
  readonly indices: Int32Array
}

const cellPointColorPatches = new WeakMap<Uint8Array, CellPointColorPatch>()
const unmatchedCellPointColorsCache = new WeakMap<
  readonly OverviewCellDatum[],
  Uint8Array
>()

// Every cell in the colour of a cell without expression, made once per cells.
function unmatchedCellPointColors(cells: readonly OverviewCellDatum[]): Uint8Array {
  let colors = unmatchedCellPointColorsCache.get(cells)

  if (colors === undefined) {
    colors = new Uint8Array(cells.length * 4)

    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] !== undefined) {
        writeCellPointColor(colors, index, GENE_EXPRESSION_ZERO_FILL_COLOR)
      }
    }

    unmatchedCellPointColorsCache.set(cells, colors)
  }

  return colors
}

// Cells whose IDs a full pass has looked up. V8 keeps a string's hash once it
// is first used as a Map key, and on 1.4 million cells that first use was
// most of the cost of building the cell index: 220-250 ms from fresh IDs,
// 60-90 ms after a full pass.
const cellsWithHashedIds = new WeakSet<readonly OverviewCellDatum[]>()

// packCellPointColors for a styler with expression, without styling every
// cell for each batch (optimization pass, O3). `observationColors` are the
// cells' colours without expression; the batch's cells are written over a
// copy of them, or of every cell in the zero colour once unmatched cells are
// styled, found by `cellIndexById`. Until that index is built, the first
// batch takes the full pass, which hashes the IDs for it. Expression matched
// by bin position, and cells that share an ID, take the full pass, which a
// patch cannot match.
export function expressionCellPointColors(options: {
  readonly cells: readonly OverviewCellDatum[]
  readonly styler: CellPointStyler
  readonly expressionIndex: GeneExpressionElementStyleIndex
  readonly styleUnmatchedCells: boolean
  readonly observationColors: Uint8Array
  readonly cellIndexById: Pick<IdLookup<number>, 'get' | 'size' | 'built'>
}): Uint8Array {
  const { cells, expressionIndex, styleUnmatchedCells, cellIndexById } = options
  const { expressionByElementId } = expressionIndex

  if (expressionIndex.expressionByBinKey !== undefined) {
    return packCellPointColors(cells, options.styler)
  }

  const base = styleUnmatchedCells
    ? unmatchedCellPointColors(cells)
    : options.observationColors

  if (expressionByElementId.size === 0) {
    return base
  }

  if (!cellIndexById.built && !cellsWithHashedIds.has(cells)) {
    cellsWithHashedIds.add(cells)
    return packCellPointColors(cells, options.styler)
  }

  if (cellIndexById.size !== cells.length) {
    return packCellPointColors(cells, options.styler)
  }

  const colors = base.slice()
  const indices = new Int32Array(expressionByElementId.size)
  let count = 0

  for (const [id, element] of expressionByElementId) {
    const index = cellIndexById.get(id)

    if (index !== undefined) {
      writeCellPointColor(colors, index, element.fillColor)
      indices[count] = index
      count += 1
    }
  }

  cellPointColorPatches.set(colors, { base, indices: indices.subarray(0, count) })
  return colors
}

export interface CellPointLayerColors {
  readonly fill: Uint8Array
  readonly line: Uint8Array
}

function writeCellPointLayerColor(
  colors: Uint8Array,
  offset: number,
  layerColors: CellPointLayerColors,
  fillAlpha: number,
  lineOpacity: number,
): void {
  const { fill, line } = layerColors
  const red = colors[offset] ?? 0
  const green = colors[offset + 1] ?? 0
  const blue = colors[offset + 2] ?? 0
  const alpha = colors[offset + 3] ?? DEFAULT_OUTLINE_ALPHA
  const faded = alpha <= FADED_CELL_ALPHA
  fill[offset] = red
  fill[offset + 1] = green
  fill[offset + 2] = blue
  fill[offset + 3] = faded ? Math.round(fillAlpha * FADED_CELL_OPACITY) : fillAlpha
  line[offset] = red
  line[offset + 1] = green
  line[offset + 2] = blue
  line[offset + 3] = Math.round(
    (faded ? Math.round(160 * FADED_CELL_OPACITY) : Math.min(245, Math.max(160, alpha))) *
      lineOpacity,
  )
}

// Applies layer opacities the way colorWithFillOpacity and
// colorWithOpacity(cellPointOutlineColor(...)) do: fills take their alpha from
// the opacity alone, outlines clamp the cell alpha to 160-245 first. Faded
// cells keep a share of both. Colours from expressionCellPointColors are
// written over the base's layer colours, which `baseLayerColors` gives.
export function cellPointLayerColors(
  colors: Uint8Array,
  fillOpacity: number,
  lineOpacity: number,
  baseLayerColors?: (base: Uint8Array) => CellPointLayerColors,
): CellPointLayerColors {
  const fillAlpha = Math.round(255 * normalizeLayerOpacity(fillOpacity))
  const normalizedLineOpacity = normalizeLayerOpacity(lineOpacity)
  const patch = cellPointColorPatches.get(colors)

  if (patch !== undefined) {
    const base = (baseLayerColors ?? defaultBaseLayerColors(fillOpacity, lineOpacity))(
      patch.base,
    )
    const layerColors = { fill: base.fill.slice(), line: base.line.slice() }

    for (const index of patch.indices) {
      writeCellPointLayerColor(
        colors,
        index * 4,
        layerColors,
        fillAlpha,
        normalizedLineOpacity,
      )
    }

    return layerColors
  }

  const layerColors = {
    fill: new Uint8Array(colors.length),
    line: new Uint8Array(colors.length),
  }

  for (let offset = 0; offset < colors.length; offset += 4) {
    writeCellPointLayerColor(
      colors,
      offset,
      layerColors,
      fillAlpha,
      normalizedLineOpacity,
    )
  }

  return layerColors
}

function defaultBaseLayerColors(
  fillOpacity: number,
  lineOpacity: number,
): (base: Uint8Array) => CellPointLayerColors {
  return (base) => cellPointLayerColors(base, fillOpacity, lineOpacity)
}

const GOLDEN_RATIO_FRACTION = 0.6180339887498949

// A fixed rank per cell. Cells ranked below a fraction form an evenly spread
// sample of that size, and lowering the fraction only removes cells, so the
// sample does not change as the view moves.
export function cellPointRanks(count: number): Float32Array {
  const ranks = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    ranks[index] = (index * GOLDEN_RATIO_FRACTION) % 1
  }

  return ranks
}

// GPU filter values per cell: its rank, and 1 when an outline is drawn for it
// instead.
export function cellPointFilterValues(
  ranks: Float32Array,
  outlinedCellIndices: Iterable<number>,
): Float32Array {
  const values = new Float32Array(ranks.length * 2)

  for (let index = 0; index < ranks.length; index += 1) {
    values[index * 2] = ranks[index] ?? 0
  }

  for (const index of outlinedCellIndices) {
    if (index >= 0 && index < ranks.length) {
      values[index * 2 + 1] = 1
    }
  }

  return values
}

// Fraction of cells to draw so that `limit` of `sourceCount` cells show.
export function cellPointSampleFraction(
  limit: number | null,
  sourceCount: number,
): number {
  if (limit === null || sourceCount <= limit) {
    return 1
  }

  return Math.max(1, Math.round(limit)) / sourceCount
}
