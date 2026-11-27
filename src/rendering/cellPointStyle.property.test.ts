import type { Color } from '@deck.gl/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lazyIdLookup } from '../data/lazyIdLookup'
import {
  cellPointLayerColors,
  createCellPointStyler,
  expressionCellPointColors,
  packCellPointColors,
} from './cellPointStyle'
import { GENE_EXPRESSION_ZERO_FILL_COLOR } from './deckLayerColors'
import type { OverviewCellDatum } from './deckLayerTypes'
import { createGeneExpressionElementStyleIndex } from './geneExpressionRenderer'

// Each expression batch used to style every cell (packCellPointColors) and
// make the layer's colours from all of them. Since O3 a batch writes its cells
// over a copy of the colours without expression, or of the zero colour, and
// the layer's colours the same way. They must be the full pass's colours.

const IDS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
// Expression for a cell that is not drawn.
const ALL_IDS = [...IDS, 'z0']

const colorArb: fc.Arbitrary<Color> = fc.oneof(
  fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    // Faded cells (alpha 16 or less) take another layer alpha.
    fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 255 })),
  ),
  fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  ),
)
const batchArb = fc.record({
  elements: fc.array(
    fc.record({ id: fc.constantFrom(...ALL_IDS), fillColor: colorArb }),
    {
      maxLength: 10,
    },
  ),
  styleUnmatchedCells: fc.boolean(),
})
const cellArb = fc.record({ id: fc.constantFrom(...IDS), fillColor: colorArb })
const caseArb = fc.record({
  // Cells that share an ID take the full pass.
  cells: fc.oneof(
    fc.uniqueArray(cellArb, {
      minLength: 1,
      maxLength: IDS.length,
      selector: (cell) => cell.id,
    }),
    fc.array(cellArb, { minLength: 1, maxLength: 12 }),
  ),
  observationColors: fc.option(colorArb, { nil: null }),
  // Bin sizes match expression by position, which a patch by ID cannot.
  binMicrometers: fc.option(fc.constantFrom(8, 16), { nil: null }),
  batches: fc.array(batchArb, { minLength: 1, maxLength: 4 }),
  fillOpacity: fc.double({ min: 0, max: 1, noNaN: true }),
  lineOpacity: fc.double({ min: 0, max: 1, noNaN: true }),
})

function overviewCells(
  cells: readonly { readonly id: string; readonly fillColor: Color }[],
): readonly OverviewCellDatum[] {
  return cells.map((cell, index) => ({
    id: cell.id,
    position: [index * 5, -index * 5],
    radiusPixels: 3,
    fillColor: cell.fillColor,
  }))
}

describe('expression cell point colours (O3)', () => {
  it('are the full pass colours, and so are their layer colours', () => {
    fc.assert(
      fc.property(caseArb, (example) => {
        const cells = overviewCells(example.cells)
        // An observation colouring, as annotations: a colour of the cell's own.
        const observationColor =
          example.observationColors === null
            ? null
            : (cell: OverviewCellDatum): Color => [
                example.observationColors![0],
                cell.id.charCodeAt(1) * 20,
                example.observationColors![2],
              ]
        const observationColors = packCellPointColors(
          cells,
          createCellPointStyler({
            observationColor,
            expressionIndex: createGeneExpressionElementStyleIndex([]),
            styleUnmatchedCells: false,
          }),
        )
        const cellIndexById = lazyIdLookup(
          cells,
          (cell) => cell.id,
          (_, index) => index,
        )
        // Base layer colours are kept between batches, as deckLayers does.
        const baseLayerColors = new Map<
          Uint8Array,
          ReturnType<typeof cellPointLayerColors>
        >()

        for (const batch of example.batches) {
          const expressionIndex = createGeneExpressionElementStyleIndex(
            batch.elements.map((element, index) => ({
              id: element.id,
              position: [index * 5, -index * 5],
              radiusPixels: 3,
              fillColor: element.fillColor,
              expressionCount: index + 1,
            })),
            example.binMicrometers === null
              ? {}
              : { binMicrometers: example.binMicrometers },
          )
          const styler = createCellPointStyler({
            observationColor,
            expressionIndex,
            styleUnmatchedCells: batch.styleUnmatchedCells,
          })
          const full = packCellPointColors(cells, styler)
          const patched = expressionCellPointColors({
            cells,
            styler,
            expressionIndex,
            styleUnmatchedCells: batch.styleUnmatchedCells,
            observationColors,
            cellIndexById,
          })

          expect(Array.from(patched)).toEqual(Array.from(full))

          const expected = cellPointLayerColors(
            full,
            example.fillOpacity,
            example.lineOpacity,
          )
          const layerColors = cellPointLayerColors(
            patched,
            example.fillOpacity,
            example.lineOpacity,
            (base) => {
              let colors = baseLayerColors.get(base)

              if (colors === undefined) {
                colors = cellPointLayerColors(
                  base,
                  example.fillOpacity,
                  example.lineOpacity,
                )
                baseLayerColors.set(base, colors)
              }

              return colors
            },
          )

          expect(Array.from(layerColors.fill)).toEqual(Array.from(expected.fill))
          expect(Array.from(layerColors.line)).toEqual(Array.from(expected.line))
        }

        // The bases were not written to.
        expect(Array.from(observationColors)).toEqual(
          Array.from(
            packCellPointColors(
              cells,
              createCellPointStyler({
                observationColor,
                expressionIndex: createGeneExpressionElementStyleIndex([]),
                styleUnmatchedCells: false,
              }),
            ),
          ),
        )
      }),
    )
  })

  it('style every cell for the first batch only, then the batch cells by ID', () => {
    const cells = overviewCells(
      Array.from({ length: 1_000 }, (_, index) => ({
        id: `cell-${index}`,
        fillColor: [index % 256, 20, 30, 200],
      })),
    )
    const cellIndexById = lazyIdLookup(
      cells,
      (cell) => cell.id,
      (_, index) => index,
    )
    let styled = 0
    const colorsFor = (elements: readonly OverviewCellDatum[]) => {
      const expressionIndex = createGeneExpressionElementStyleIndex(elements)
      const styler = createCellPointStyler({
        observationColor: null,
        expressionIndex,
        styleUnmatchedCells: true,
      })

      return expressionCellPointColors({
        cells,
        styler: {
          fillColor: (cell) => {
            styled += 1
            return styler.fillColor(cell)
          },
          styledCell: (cell) => styler.styledCell(cell),
        },
        expressionIndex,
        styleUnmatchedCells: true,
        observationColors: packCellPointColors(cells, styler),
        cellIndexById,
      })
    }
    const element = (id: string, fillColor: Color): OverviewCellDatum => ({
      id,
      position: [0, 0],
      radiusPixels: 3,
      fillColor,
    })

    // The first batch hashes every ID, which building the index would too.
    colorsFor([element('cell-3', [1, 2, 3, 255])])
    expect(styled).toBe(1_000)
    expect(cellIndexById.built).toBe(false)

    const colors = colorsFor([
      element('cell-7', [250, 0, 0, 255]),
      element('cell-900', [0, 250, 0, 255]),
    ])

    expect(styled).toBe(1_000)
    expect(cellIndexById.built).toBe(true)
    expect(Array.from(colors.slice(3 * 4, 4 * 4))).toEqual(
      GENE_EXPRESSION_ZERO_FILL_COLOR,
    )
    expect(Array.from(colors.slice(7 * 4, 8 * 4))).toEqual([250, 0, 0, 255])
    expect(Array.from(colors.slice(900 * 4, 901 * 4))).toEqual([0, 250, 0, 255])
  })
})
