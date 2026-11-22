import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { testCellQueryModel } from '../../test/sectionModels'
import { CELL_PICTURE_ROW_HEIGHT, CELL_PICTURE_SETTLE_MS } from './cellPictureModel'
import {
  CELL_QUERY_MAX_BODY_HEIGHT,
  CELL_QUERY_ROW_HEIGHT,
  CellQueryTable,
} from './CellQueryTable'
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

describe('Cell Query table with more rows than a browser lays out', () => {
  it('keeps the body under the layout limit and reaches the last row', () => {
    const rowCount = 1_400_000
    const { table } = testCellQueryModel({ rowCount })
    render(<CellQueryTable table={table} noun="cells" />)
    const scroller = screen.getByRole('table', { name: 'Matching cells' })
    const body = scroller.querySelector<HTMLElement>('.cell-query-body')

    // 1.4 million rows of 28 px are 39.2 million px, past Chromium's
    // 33.5 million px.
    expect(Number.parseFloat(body?.style.height ?? '')).toBe(CELL_QUERY_MAX_BODY_HEIGHT)

    // The end of the scroll bar is the last row (jsdom's body is 240 px).
    scroller.scrollTop = CELL_QUERY_MAX_BODY_HEIGHT - 240
    fireEvent.scroll(scroller)
    const last = scroller.querySelector(`[data-row-index="${(rowCount - 1).toString()}"]`)
    expect(last?.closest('[role="row"]')).toHaveAttribute(
      'aria-rowindex',
      String(rowCount + 1),
    )

    // Home and End move there by keyboard too.
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    const first = scroller.querySelector<HTMLButtonElement>('[data-row-index="0"]')
    fireEvent.keyDown(first!, { key: 'End' })
    expect(
      scroller.querySelector(`[data-row-index="${(rowCount - 1).toString()}"]`),
    ).toHaveFocus()
  })
})

describe('Cell Query table keyboard entry', () => {
  it('keeps a drawn row in the tab order once the active row scrolls away', () => {
    const { table } = testCellQueryModel({ rowCount: 1000 })
    render(<CellQueryTable table={table} noun="cells" />)
    fireEvent.click(screen.getByRole('button', { name: 'c3' }))
    const scroller = screen.getByRole('table', { name: 'Matching cells' })

    scroller.scrollTop = 500 * CELL_QUERY_ROW_HEIGHT
    fireEvent.scroll(scroller)

    const tabbable = screen
      .getAllByRole('button', { name: /^c\d+$/ })
      .filter((button) => button.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
  })
})
