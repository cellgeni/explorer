import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../../data/coords'
import type { GridCellDatum } from '../../rendering/deckLayerTypes'
import { useSelectedGridCellScore } from './useSelectedGridCellScore'

// A 4 µm bin centred at (10, 5) µm; deck draws y up, so its polygon is at -5.
const BIN: GridCellDatum = {
  id: 'BC-1',
  gridId: 'visium-hd-8um',
  row: 0,
  col: 0,
  polygon: [
    [8, -3],
    [12, -3],
    [12, -7],
    [8, -7],
  ],
  fillColor: [0, 0, 0, 0],
  lineColor: [0, 0, 0, 0],
}

function box(minX: number, maxX: number, minY: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function scored(count: number, genes: readonly string[] = ['A2M']): GridCellDatum {
  return { ...BIN, expressionCount: count, expressionGenes: genes }
}

const AROUND_BIN = box(0, 20, 0, 20)
const FAR_CORNER = box(30, 40, 10, 20)

describe('useSelectedGridCellScore', () => {
  it('keeps the last score read over the bin while the latest batch leaves it out', () => {
    const view = renderHook((props) => useSelectedGridCellScore(props), {
      initialProps: {
        selected: BIN,
        scored: scored(7),
        readBox: AROUND_BIN as BBox | undefined,
        selectedGenes: ['A2M'] as readonly string[],
      },
    })
    expect(view.result.current).toEqual({ cell: scored(7), outsideRead: false })

    // The view moves away: the latest batch has no score for the bin, so it
    // gives 0.
    view.rerender({
      selected: BIN,
      scored: scored(0),
      readBox: FAR_CORNER,
      selectedGenes: ['A2M'],
    })
    expect(view.result.current).toEqual({ cell: scored(7), outsideRead: true })

    // Back over the bin, the latest batch scores it again.
    view.rerender({
      selected: BIN,
      scored: scored(5),
      readBox: AROUND_BIN,
      selectedGenes: ['A2M'],
    })
    expect(view.result.current.cell?.expressionCount).toBe(5)
  })

  it('has no score outside the read area for genes it was not read for', () => {
    const view = renderHook((props) => useSelectedGridCellScore(props), {
      initialProps: {
        selected: BIN,
        scored: scored(7),
        readBox: AROUND_BIN,
        selectedGenes: ['A2M'] as readonly string[],
      },
    })

    view.rerender({
      selected: BIN,
      scored: scored(0, ['Actb']),
      readBox: FAR_CORNER,
      selectedGenes: ['Actb'],
    })

    expect(view.result.current.outsideRead).toBe(true)
    expect(view.result.current.cell?.expressionCount).toBeUndefined()
    expect(view.result.current.cell?.id).toBe('BC-1')
  })

  it('scores from the latest batch when it was read for no view', () => {
    const { result } = renderHook(() =>
      useSelectedGridCellScore({
        selected: BIN,
        scored: scored(3),
        readBox: undefined,
        selectedGenes: ['A2M'],
      }),
    )

    expect(result.current).toEqual({ cell: scored(3), outsideRead: false })
  })
})
