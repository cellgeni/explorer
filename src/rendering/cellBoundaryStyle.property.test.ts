import type { Color } from '@deck.gl/core'
import type { PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { EMPTY_CELL_BOUNDARY_LAYER_STYLE } from './cellBoundaryRenderer'
import { createCellPointStyler } from './cellPointStyle'
import { boundaryFillColor, boundaryLineColor } from './deckLayerColors'
import {
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayerStyle,
  createGeneExpressionElementStyleIndex,
  createOverviewLayers,
  styleCellBoundariesByGeneExpression,
  styleCellsByGeneExpression,
  type CellBoundaryDatum,
  type CellBoundaryLayerGeometry,
  type CellBoundaryLayerStyle,
  type OverviewCellDatum,
} from './deckLayers'

// Outlines used to be coloured in two passes: App restyled every outline for
// each expression batch, then ViewerCore built a style from the outlined
// cells' styled copies and the expression elements in view. Since O4 the
// viewer reads both by ID from the outlines it draws. With the whole slide in
// view, the colours must be the same.

const CELL_IDS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']
// Outlines without a cell point (imported or Visium HD segmentations), and an
// expressing cell with no outline.
const OUTLINE_ONLY_IDS = ['s0', 's1']
const ALL_IDS = [...CELL_IDS, ...OUTLINE_ONLY_IDS, 'z0']

const colorArb: fc.Arbitrary<[number, number, number, number]> = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  // Faded cells have an alpha of 16 or less.
  fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 255 })),
)

const pointArb = fc.tuple(
  fc.integer({ min: -50, max: 50 }),
  fc.integer({ min: -50, max: 50 }),
)

const caseArb = fc.record({
  cellColors: fc.array(colorArb, {
    minLength: CELL_IDS.length,
    maxLength: CELL_IDS.length,
  }),
  boundaries: fc.uniqueArray(
    fc.record({
      id: fc.constantFrom(...CELL_IDS, ...OUTLINE_ONLY_IDS),
      polygon: fc.array(pointArb, { minLength: 2, maxLength: 6 }),
      fillColor: colorArb,
      lineColor: colorArb,
    }),
    { selector: (boundary) => boundary.id, maxLength: CELL_IDS.length + 2 },
  ),
  // Repeated IDs keep the last element, in both versions.
  expression: fc.array(
    fc.record({ id: fc.constantFrom(...ALL_IDS), fillColor: colorArb }),
    { maxLength: 10 },
  ),
  observationColors: fc.option(colorArb, { nil: null }),
  geneExpressionActive: fc.boolean(),
  fillEnabled: fc.boolean(),
  cellFillOpacity: fc.double({ min: 0, max: 1, noNaN: true }),
  cellBoundaryOpacity: fc.double({ min: 0, max: 1, noNaN: true }),
})

describe('outline colours (O4)', () => {
  it('are the colours of the restyled copies, read from the outlines by ID', () => {
    fc.assert(
      fc.property(caseArb, (example) => {
        const cells: readonly OverviewCellDatum[] = CELL_IDS.map((id, index) => ({
          id,
          position: [index * 10, -index * 10],
          radiusPixels: 4,
          fillColor: example.cellColors[index]!,
        }))
        const cellById = new Map(cells.map((cell) => [cell.id, cell]))
        const boundaries: readonly CellBoundaryDatum[] = example.boundaries.map(
          (boundary) => ({
            id: boundary.id,
            polygon: boundary.polygon.map(([x, y]) => [x, y, 0]),
            fillColor: boundary.fillColor,
            lineColor: boundary.lineColor,
          }),
        )
        const expressionElements: readonly OverviewCellDatum[] = example.expression.map(
          (element, index) => ({
            id: element.id,
            position: [index, -index],
            radiusPixels: 4,
            fillColor: element.fillColor,
            expressionCount: index + 1,
          }),
        )
        // An observation colouring, as annotations: a colour of the cell's own.
        const observationColor =
          example.observationColors === null
            ? null
            : (cell: OverviewCellDatum): Color => [
                example.observationColors![0],
                cell.id.charCodeAt(1) * 20,
                example.observationColors![2],
                example.observationColors![3],
              ]

        // Now: the outlines as read, coloured by ID.
        const geometry = createCellBoundaryLayerGeometry(boundaries)
        const expressionIndex = createGeneExpressionElementStyleIndex(expressionElements)
        const styler = createCellPointStyler({
          observationColor,
          expressionIndex,
          styleUnmatchedCells: example.geneExpressionActive,
        })
        const style = createCellBoundaryLayerStyle(geometry, {
          ...(example.fillEnabled
            ? {
                cellColor: (cellId: string) => {
                  const cell = cellById.get(cellId)

                  return cell === undefined ? undefined : styler.fillColor(cell)
                },
              }
            : {}),
          expressionByElementId: expressionIndex.expressionByElementId,
        })

        // Before: App's restyled copies, and a style from the outlined cells.
        const styledBoundaries = styleCellBoundariesByGeneExpression(
          boundaries,
          expressionElements,
        )
        const previousGeometry = createCellBoundaryLayerGeometry(styledBoundaries)
        const outlinedCells = [...previousGeometry.boundaryCellIds].flatMap(
          (cellId) => cellById.get(cellId) ?? [],
        )
        const styleCells = styleCellsByGeneExpression(
          observationColor === null
            ? outlinedCells
            : outlinedCells.map((cell) => ({
                ...cell,
                fillColor: observationColor(cell),
              })),
          expressionElements,
          { styleUnmatchedCells: example.geneExpressionActive },
        )
        const previousStyle = previousCellBoundaryLayerStyle(
          previousGeometry,
          example.fillEnabled ? styleCells : [],
          expressionElements,
        )

        expect(outlineColors(boundaries, geometry, style, example)).toEqual(
          outlineColors(styledBoundaries, previousGeometry, previousStyle, example),
        )
      }),
      { numRuns: 500 },
    )
  })
})

function outlineColors(
  boundaries: readonly CellBoundaryDatum[],
  geometry: CellBoundaryLayerGeometry,
  style: CellBoundaryLayerStyle,
  options: { readonly cellFillOpacity: number; readonly cellBoundaryOpacity: number },
): { readonly fill: number[]; readonly line: number[] } {
  const layers = createOverviewLayers([], boundaries, {
    cellBoundaryGeometry: geometry,
    cellBoundaryStyle: style,
    // Fills drawn either way, to compare their colours too.
    cellBoundaryFillEnabled: true,
    cellFillOpacity: options.cellFillOpacity,
    cellBoundaryOpacity: options.cellBoundaryOpacity,
  })
  const fill = layers.find((layer) => layerId(layer) === 'cell-boundary-fills') as
    | SolidPolygonLayer
    | undefined
  const path = layers.find((layer) => layerId(layer) === 'cell-boundary-paths') as
    | PathLayer
    | undefined
  const colors = (layer: SolidPolygonLayer | PathLayer | undefined, name: string) => {
    const data = layer?.props.data as
      | { readonly attributes: Record<string, { readonly value: Uint8Array }> }
      | undefined

    return Array.from(data?.attributes[name]?.value ?? [])
  }

  return { fill: colors(fill, 'getFillColor'), line: colors(path, 'getColor') }
}

function layerId(layer: unknown): string | undefined {
  return (layer as { readonly id?: string } | null)?.id
}

// createCellBoundaryLayerStyle before O4: the outlined cells' styled copies,
// then the expression elements in view.
function previousCellBoundaryLayerStyle(
  geometry: CellBoundaryLayerGeometry,
  cells: readonly OverviewCellDatum[],
  expressionElements: readonly OverviewCellDatum[],
): CellBoundaryLayerStyle {
  if (
    geometry.boundaryCellIds.size === 0 ||
    (cells.length === 0 && expressionElements.length === 0)
  ) {
    return EMPTY_CELL_BOUNDARY_LAYER_STYLE
  }

  const fillColorByCellId = new Map<string, Color>()
  const lineColorByCellId = new Map<string, Color>()

  for (const cell of cells) {
    if (geometry.boundaryCellIds.has(cell.id)) {
      fillColorByCellId.set(cell.id, boundaryFillColor(cell.fillColor))
      lineColorByCellId.set(cell.id, boundaryLineColor(cell.fillColor))
    }
  }

  for (const cell of expressionElements) {
    if (geometry.boundaryCellIds.has(cell.id)) {
      fillColorByCellId.set(cell.id, cell.fillColor)
      lineColorByCellId.set(cell.id, boundaryLineColor(cell.fillColor))
    }
  }

  return fillColorByCellId.size === 0
    ? EMPTY_CELL_BOUNDARY_LAYER_STYLE
    : { fillColorByCellId, lineColorByCellId }
}
