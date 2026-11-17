import type { Color } from '@deck.gl/core'
import {
  boundaryLineColor,
  GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY,
} from './deckLayerColors'
import type { GeneExpressionElementStyleIndex, GridCellDatum } from './deckLayerTypes'
import {
  gridCellExpressionStyle,
  hasGeneExpressionElementStyles,
  type GridCellExpressionStyle,
} from './geneExpressionRenderer'
import { GridBinLayer } from './gridBinLayer'
import {
  DEFAULT_GRID_CELL_FILL_COLOR,
  DEFAULT_GRID_CELL_LINE_COLOR,
  gridCellAt,
  gridCellCenterXAt,
  gridCellCenterYAt,
  type GridCellColumns,
} from './gridCellColumns'
import {
  DEFAULT_CELL_FILL_OPACITY,
  DEFAULT_LAYER_OPACITY,
  normalizeLayerOpacity,
} from './layerOpacity'
import { attributeDescriptor, samePackedLayerData } from './packedLayerData'

// The bins drawn: every bin of `columns`, or those at `indices`.
export interface GridCellRenderSelection {
  readonly columns: GridCellColumns
  readonly indices: Uint32Array | null
  readonly length: number
}

export function gridCellRenderSelection(
  columns: GridCellColumns,
  indices: Uint32Array | null = null,
): GridCellRenderSelection {
  return { columns, indices, length: indices?.length ?? columns.length }
}

// A drawn bin's colour and score, from its ID and centre (data µm, y down);
// null leaves it in the default colours.
export type GridCellStyler = (
  id: string,
  x: number,
  y: number,
) => GridCellExpressionStyle | null

// Bins take an annotation or metadata colour by their barcode, as cells do by
// their ID; gene expression colours over it. Null when neither applies.
export function createGridCellStyler(options: {
  readonly observationColor: ((element: { readonly id: string }) => Color) | null
  readonly expressionIndex: GeneExpressionElementStyleIndex
  readonly styleUnmatchedCells: boolean
}): GridCellStyler | null {
  const { observationColor, expressionIndex, styleUnmatchedCells } = options
  const styleExpression =
    styleUnmatchedCells || hasGeneExpressionElementStyles(expressionIndex)

  if (observationColor === null && !styleExpression) {
    return null
  }

  return (id, x, y) => {
    const expressionStyle = styleExpression
      ? gridCellExpressionStyle(expressionIndex, id, x, y, styleUnmatchedCells)
      : null

    if (expressionStyle !== null || observationColor === null) {
      return expressionStyle
    }

    const fillColor = observationColor({ id })
    return { fillColor, lineColor: boundaryLineColor(fillColor) }
  }
}

// The drawn bins' centres in deck.gl coordinates (y negated), x and y per bin.
export function packGridCellCenters(selection: GridCellRenderSelection): Float64Array {
  const { columns, indices } = selection
  const { rows, cols } = columns
  const { origin, rowStep, colStep } = columns.basis
  const centers = new Float64Array(selection.length * 2)

  for (let position = 0; position < selection.length; position += 1) {
    const index = indices === null ? position : (indices[position] ?? 0)
    const row = rows[index] ?? 0
    const col = cols[index] ?? 0
    centers[position * 2] = origin.x + row * rowStep.x + col * colStep.x
    centers[position * 2 + 1] = -(origin.y + row * rowStep.y + col * colStep.y)
  }

  return centers
}

export interface GridCellColors {
  readonly fill: Uint8Array
  readonly line: Uint8Array
}

// RGBA fill and line colours of the drawn bins, before layer opacity.
export function packGridCellColors(
  selection: GridCellRenderSelection,
  styler: GridCellStyler | null,
): GridCellColors {
  const { columns, indices } = selection
  const { ids, rows, cols } = columns
  const { origin, rowStep, colStep } = columns.basis
  const fill = new Uint8Array(selection.length * 4)
  const line = new Uint8Array(selection.length * 4)

  for (let position = 0; position < selection.length; position += 1) {
    let fillColor = DEFAULT_GRID_CELL_FILL_COLOR
    let lineColor = DEFAULT_GRID_CELL_LINE_COLOR

    if (styler !== null) {
      const index = indices === null ? position : (indices[position] ?? 0)
      const row = rows[index] ?? 0
      const col = cols[index] ?? 0
      const style = styler(
        ids[index] ?? '',
        origin.x + row * rowStep.x + col * colStep.x,
        origin.y + row * rowStep.y + col * colStep.y,
      )

      if (style !== null) {
        fillColor = style.fillColor
        lineColor = style.lineColor
      }
    }

    writeColor(fill, position, fillColor)
    writeColor(line, position, lineColor)
  }

  return { fill, line }
}

function writeColor(target: Uint8Array, position: number, color: Color): void {
  target[position * 4] = color[0]
  target[position * 4 + 1] = color[1]
  target[position * 4 + 2] = color[2]
  target[position * 4 + 3] = color[3] ?? 255
}

// The drawn bins packed for the GPU, and each one as an object for picking.
export interface GridCellPacking {
  readonly selection: GridCellRenderSelection
  readonly centers: Float64Array
  readonly colors: GridCellColors
  // From a bin's corner to its column and row neighbours, in deck.gl
  // coordinates: the same for every bin of a grid.
  readonly columnVector: readonly [number, number]
  readonly rowVector: readonly [number, number]
  // The drawn bin at `position`, styled as drawn.
  readonly cellAt: (position: number) => GridCellDatum
}

export function packGridCells(
  selection: GridCellRenderSelection,
  centers: Float64Array,
  colors: GridCellColors,
  styler: GridCellStyler | null,
): GridCellPacking {
  const { columns, indices } = selection
  const { rowStep, colStep } = columns.basis

  return {
    selection,
    centers,
    colors,
    columnVector: deckVector(colStep),
    rowVector: deckVector(rowStep),
    cellAt: (position) => {
      const index = indices === null ? position : (indices[position] ?? 0)
      const cell = gridCellAt(columns, index)
      const style =
        styler === null
          ? null
          : styler(
              cell.id,
              gridCellCenterXAt(columns, index),
              gridCellCenterYAt(columns, index),
            )

      return style === null ? cell : { ...cell, ...style }
    },
  }
}

// A data vector in deck.gl coordinates, y negated (without a -0).
function deckVector(vector: {
  readonly x: number
  readonly y: number
}): readonly [number, number] {
  return [vector.x, vector.y === 0 ? 0 : -vector.y]
}

export function createGridCellLayer(
  packing: GridCellPacking | null,
  options: {
    readonly opacity?: number
    readonly fillOpacity?: number
    readonly lineOpacity?: number
    readonly geneExpressionActive: boolean
  },
): GridBinLayer<GridCellDatum> | null {
  if (packing === null || packing.selection.length === 0) {
    return null
  }

  const gridCellFillOpacity = normalizeLayerOpacity(
    options.fillOpacity ?? options.opacity ?? DEFAULT_CELL_FILL_OPACITY,
  )
  const gridCellLineOpacity = normalizeLayerOpacity(
    options.lineOpacity ?? options.opacity ?? DEFAULT_LAYER_OPACITY,
  )
  const effectiveGridCellFillOpacity = options.geneExpressionActive
    ? Math.max(gridCellFillOpacity, GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY)
    : gridCellFillOpacity
  const colors = gridCellLayerColorsWithCache(
    packing.colors,
    effectiveGridCellFillOpacity,
    gridCellLineOpacity,
  )

  return new GridBinLayer<GridCellDatum>({
    id: 'spatial-grid-cells',
    data: {
      length: packing.selection.length,
      attributes: {
        getCenter: attributeDescriptor(packing.centers, 2),
        getFillColor: attributeDescriptor(colors.fill, 4, true),
        getLineColor: attributeDescriptor(colors.line, 4, true),
      },
    } as unknown as GridCellDatum[],
    dataComparator: samePackedLayerData,
    pickObject: packing.cellAt,
    pickable: true,
    stroked: true,
    filled: true,
    opacity: 1,
    lineWidthPixels: GRID_CELL_LINE_WIDTH_PIXELS,
    getColumnVector: packing.columnVector,
    getRowVector: packing.rowVector,
  })
}

const GRID_CELL_LINE_WIDTH_PIXELS = 0.25

// Colours with the layer's opacity in their alpha, kept per packed colours so
// a render that changes neither builds no new arrays.
const gridCellLayerColorsCache = new WeakMap<
  GridCellColors,
  { readonly fillOpacity: number; readonly lineOpacity: number; colors: GridCellColors }
>()

function gridCellLayerColorsWithCache(
  colors: GridCellColors,
  fillOpacity: number,
  lineOpacity: number,
): GridCellColors {
  const cached = gridCellLayerColorsCache.get(colors)

  if (cached?.fillOpacity === fillOpacity && cached.lineOpacity === lineOpacity) {
    return cached.colors
  }

  const layerColors = {
    fill: colorsWithOpacity(colors.fill, fillOpacity),
    line: colorsWithOpacity(colors.line, lineOpacity),
  }
  gridCellLayerColorsCache.set(colors, { fillOpacity, lineOpacity, colors: layerColors })
  return layerColors
}

// As colorWithOpacity, for each packed colour.
function colorsWithOpacity(colors: Uint8Array, opacity: number): Uint8Array {
  const result = new Uint8Array(colors)

  for (let offset = 3; offset < result.length; offset += 4) {
    result[offset] = Math.round((colors[offset] ?? 255) * opacity)
  }

  return result
}
