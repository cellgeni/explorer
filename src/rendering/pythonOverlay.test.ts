import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FADED_CELL_ALPHA } from './deckLayerColors'
import {
  composePythonOverlay,
  EMPTY_PYTHON_OVERLAY,
  hidePythonCells,
  overlayCellPointColors,
  type PythonLayer,
  type PythonOverlay,
} from './pythonOverlay'

function colorLayer(name: string, rows: readonly number[], rgb: number[]): PythonLayer {
  return {
    kind: 'color',
    name,
    rows: Uint32Array.from(rows),
    colors: Uint8Array.from(rows.flatMap(() => rgb)),
    legend: { kind: 'color', color: '#000000' },
  }
}

function overlay(change: Partial<PythonOverlay>): PythonOverlay {
  return { ...EMPTY_PYTHON_OVERLAY, version: 1, cellCount: 4, ...change }
}

const layerArbitrary = (cellCount: number) =>
  fc.record({
    kind: fc.constantFrom<'color' | 'highlight'>('color', 'highlight'),
    rows: fc.uniqueArray(fc.integer({ min: 0, max: cellCount - 1 }), {
      maxLength: cellCount,
    }),
    rgb: fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255)),
  })

describe('composePythonOverlay', () => {
  it('gives each cell the last colour layer holding it, as a plain loop does', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }).chain((cellCount) =>
          fc.record({
            cellCount: fc.constant(cellCount),
            layers: fc.array(layerArbitrary(cellCount), { maxLength: 6 }),
            shown: fc.option(
              fc.uniqueArray(fc.integer({ min: 0, max: cellCount - 1 }), {
                maxLength: cellCount,
              }),
            ),
            others: fc.constantFrom<'fade' | 'hide'>('fade', 'hide'),
          }),
        ),
        ({ cellCount, layers, shown, others }) => {
          const pythonLayers: PythonLayer[] = layers.map((layer, index) => {
            const rows = [...layer.rows].sort((a, b) => a - b)
            return layer.kind === 'color'
              ? colorLayer(`layer ${String(index)}`, rows, [...layer.rgb])
              : {
                  kind: 'highlight',
                  name: `layer ${String(index)}`,
                  rows: Uint32Array.from(rows),
                  color: layer.rgb,
                }
          })
          const composed = composePythonOverlay(
            {
              version: 1,
              cellCount,
              layers: pythonLayers,
              shown: shown === null ? null : Uint32Array.from(shown),
              others,
            },
            cellCount,
          )
          const anyColor = layers.some((layer) => layer.kind === 'color')

          for (let row = 0; row < cellCount; row += 1) {
            let expected: readonly number[] | null = null
            for (const layer of layers) {
              if (layer.kind === 'color' && layer.rows.includes(row)) expected = layer.rgb
            }
            const color = composed.colors?.slice(row * 4, row * 4 + 4)
            if (expected === null) {
              expect(color === undefined || color[3] === 0).toBe(true)
            } else {
              expect(Array.from(color ?? [])).toEqual([...expected, 255])
            }

            const hidden =
              (shown !== null && !shown.includes(row)) ||
              (others === 'hide' && anyColor && expected === null)
            expect(composed.hidden?.[row] === 1).toBe(hidden)
          }

          // Rings leave out the cells that are hidden.
          composed.highlights.forEach((highlight) => {
            for (const row of highlight.rows) expect(composed.hidden?.[row] ?? 0).toBe(0)
          })
        },
      ),
    )
  })

  it('leaves out layers drawn for another number of cells', () => {
    const drawn = overlay({ layers: [colorLayer('Result', [0], [1, 2, 3])] })

    expect(composePythonOverlay(drawn, 5)).toEqual({
      colors: null,
      hidden: null,
      highlights: [],
    })
    expect(composePythonOverlay(drawn, 4).colors).not.toBeNull()
  })

  it('changes nothing with others("hide") and no colour layer (29-D7)', () => {
    expect(composePythonOverlay(overlay({ others: 'hide' }), 4)).toEqual({
      colors: null,
      hidden: null,
      highlights: [],
    })
  })

  it('composes an overlay once', () => {
    const drawn = overlay({ layers: [colorLayer('Result', [1], [9, 9, 9])] })

    expect(composePythonOverlay(drawn, 4)).toBe(composePythonOverlay(drawn, 4))
  })
})

describe('overlayCellPointColors', () => {
  const base = Uint8Array.from([10, 20, 30, 200, 40, 50, 60, 220])

  it('colours the layers’ cells and fades the rest, keeping their own colour', () => {
    const composed = composePythonOverlay(
      overlay({ cellCount: 2, layers: [colorLayer('Result', [1], [0, 128, 0])] }),
      2,
    )

    expect(Array.from(overlayCellPointColors(base, composed))).toEqual([
      10,
      20,
      30,
      FADED_CELL_ALPHA,
      0,
      128,
      0,
      255,
    ])
  })

  it('returns the colours themselves without colour layers', () => {
    const composed = composePythonOverlay(
      overlay({ cellCount: 2, shown: Uint32Array.of(0) }),
      2,
    )

    expect(overlayCellPointColors(base, composed)).toBe(base)
  })
})

describe('hidePythonCells', () => {
  it('filters hidden cells out as outlined cells are, keeping ranks', () => {
    const values = Float32Array.from([0.1, 0, 0.2, 0, 0.3, 1])
    const composed = composePythonOverlay(
      overlay({ cellCount: 3, shown: Uint32Array.of(2) }),
      3,
    )

    expect(Array.from(hidePythonCells(values, composed))).toEqual(
      [0.1, 1, 0.2, 1, 0.3, 1].map((value) => Math.fround(value)),
    )
    expect(Array.from(values)).toEqual(
      [0.1, 0, 0.2, 0, 0.3, 1].map((value) => Math.fround(value)),
    )
  })

  it('returns the values themselves when no cell is hidden', () => {
    const values = new Float32Array(4)

    expect(hidePythonCells(values, composePythonOverlay(EMPTY_PYTHON_OVERLAY, 2))).toBe(
      values,
    )
  })
})
