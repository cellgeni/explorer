import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { testCellQueryModel } from '../../test/sectionModels'
import { CELL_PICTURE_ROW_HEIGHT, CELL_PICTURE_SETTLE_MS } from './cellPictureModel'
import { CellQueryTable } from './CellQueryTable'
import type { CellQueryPictures, CellQueryTableModel } from './useCellQueryModel'

function cell(index: number): OverviewCellDatum {
  return {
    id: `c${index.toString()}`,
    position: [index * 100, 0, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
  }
}

function pictureTable(
  readOutlines: CellQueryPictures['readOutlines'],
): CellQueryTableModel {
  const { table } = testCellQueryModel({ rowCount: 100 })
  return {
    ...table,
    cellAt: (index) => (index < 100 ? cell(index) : null),
    pictureField: 40,
    pictures: {
      key: 'dataset',
      field: 40,
      spots: false,
      image: { loader: null, channels: [], flatImage: null },
      readOutlines,
    },
  }
}

function hasCanvas(name: string): boolean {
  return screen.getByRole('img', { name }).querySelector('canvas') !== null
}

describe('Cell Query table pictures (plan 23-D12)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the pictures of rows that come into view once they stop moving', () => {
    vi.useFakeTimers()
    const readOutlines = vi.fn(async () => {})
    render(<CellQueryTable table={pictureTable(readOutlines)} noun="cells" />)

    // The first rows are still: their pictures and outlines are read at once.
    // jsdom has no layout, so the body is 240 px: rows 0 to 3 at 72 px.
    expect(hasCanvas('c0, 40 µm across')).toBe(true)
    expect(readOutlines).toHaveBeenLastCalledWith(
      0,
      4,
      expect.any(AbortSignal),
      expect.any(Function),
    )

    const table = screen.getByRole('table', { name: 'Matching cells' })
    table.scrollTop = 10 * CELL_PICTURE_ROW_HEIGHT
    fireEvent.scroll(table)

    // Rows 10 to 13 are in view, but still moving; rows out of view (and in
    // the overscan) have no picture.
    expect(hasCanvas('c10, 40 µm across')).toBe(false)
    expect(screen.queryByRole('img', { name: 'c0, 40 µm across' })).toBeNull()
    expect(readOutlines).toHaveBeenCalledOnce()

    act(() => {
      vi.advanceTimersByTime(CELL_PICTURE_SETTLE_MS)
    })

    expect(hasCanvas('c10, 40 µm across')).toBe(true)
    expect(readOutlines).toHaveBeenLastCalledWith(
      10,
      14,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    // The first page's read was stopped when its rows left the view.
    const firstSignal = (readOutlines.mock.calls[0] as unknown[])[2] as AbortSignal
    expect(firstSignal.aborted).toBe(true)
  })
})
