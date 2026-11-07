import type { Color } from '@deck.gl/core'
import { GENE_EXPRESSION_ZERO_FILL_COLOR } from './deckLayerColors'
import type { GeneExpressionElementStyleIndex, OverviewCellDatum } from './deckLayerTypes'
import {
  geneExpressionElementForCell,
  hasGeneExpressionElementStyles,
} from './geneExpressionRenderer'
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

// RGBA fill per cell, before layer opacity.
export function packCellPointColors(
  cells: readonly OverviewCellDatum[],
  styler: CellPointStyler,
): Uint8Array {
  const colors = new Uint8Array(cells.length * 4)

  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]

    if (cell === undefined) {
      continue
    }

    const color = styler.fillColor(cell)
    const offset = index * 4
    colors[offset] = color[0] ?? 0
    colors[offset + 1] = color[1] ?? 0
    colors[offset + 2] = color[2] ?? 0
    colors[offset + 3] = color[3] ?? DEFAULT_OUTLINE_ALPHA
  }

  return colors
}

export interface CellPointLayerColors {
  readonly fill: Uint8Array
  readonly line: Uint8Array
}

// Applies layer opacities the way colorWithFillOpacity and
// colorWithOpacity(cellPointOutlineColor(...)) do: fills take their alpha from
// the opacity alone, outlines clamp the cell alpha to 160-245 first.
export function cellPointLayerColors(
  colors: Uint8Array,
  fillOpacity: number,
  lineOpacity: number,
): CellPointLayerColors {
  const fill = new Uint8Array(colors.length)
  const line = new Uint8Array(colors.length)
  const fillAlpha = Math.round(255 * normalizeLayerOpacity(fillOpacity))
  const normalizedLineOpacity = normalizeLayerOpacity(lineOpacity)

  for (let offset = 0; offset < colors.length; offset += 4) {
    const red = colors[offset] ?? 0
    const green = colors[offset + 1] ?? 0
    const blue = colors[offset + 2] ?? 0
    const alpha = colors[offset + 3] ?? DEFAULT_OUTLINE_ALPHA
    fill[offset] = red
    fill[offset + 1] = green
    fill[offset + 2] = blue
    fill[offset + 3] = fillAlpha
    line[offset] = red
    line[offset + 1] = green
    line[offset + 2] = blue
    line[offset + 3] = Math.round(
      Math.min(245, Math.max(160, alpha)) * normalizedLineOpacity,
    )
  }

  return { fill, line }
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
