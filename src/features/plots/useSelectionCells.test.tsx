import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { ROI_CELL_EXPORT_LIMIT, roiCellsWithin } from '../../data/roiCells'
import type { RoiSelection } from '../../data/roiSelection'
import type { RoiCellsLoader } from '../app-shell/appDependencies'
import type { SavedSelection } from '../roi/selectionListModel'
import { useSelectionCells } from './useSelectionCells'
import type { DatasetCell } from '../../datasets/spatialDataset'

const URL = 'https://example.org/run'

function box(minX: number): RoiSelection {
  return {
    kind: 'box',
    bbox: {
      minX: micrometers(minX),
      maxX: micrometers(minX + 10),
      minY: micrometers(0),
      maxY: micrometers(10),
    },
  }
}

function savedSelection(id: string, selection: RoiSelection): SavedSelection {
  return { id, name: `ROI ${id}`, color: '#f0c84b', visible: true, selection }
}

function cells(...ids: string[]): readonly DatasetCell[] {
  return ids.map(
    (id) => ({ id, position: { x: micrometers(0), y: micrometers(0) } }) as DatasetCell,
  )
}

describe('useSelectionCells', () => {
  it('looks up each outline once, keeping it through a rename', async () => {
    const first = box(0)
    const second = box(20)
    const loadCells = vi.fn<RoiCellsLoader>(async (_url, selection) =>
      selection === first ? cells('a', 'b') : cells('c'),
    )
    const { result, rerender } = renderHook(
      ({ selections, enabled }) =>
        useSelectionCells({
          enabled,
          datasetUrl: URL,
          selections,
          loadCells,
          appendDebugEvent: vi.fn(),
        }),
      {
        initialProps: {
          enabled: false,
          selections: [savedSelection('1', first), savedSelection('2', second)],
        },
      },
    )

    // Nothing is read until Group by › Selections is shown.
    expect(loadCells).not.toHaveBeenCalled()
    expect(result.current.map((saved) => saved.cells.status)).toEqual([
      'loading',
      'loading',
    ])

    rerender({
      enabled: true,
      selections: [savedSelection('1', first), savedSelection('2', second)],
    })

    await waitFor(() => {
      expect(result.current.map((saved) => saved.cells)).toEqual([
        { status: 'ready', cellIds: ['a', 'b'], hitCellLimit: false },
        { status: 'ready', cellIds: ['c'], hitCellLimit: false },
      ])
    })

    rerender({
      enabled: true,
      selections: [
        { ...savedSelection('1', first), name: 'Tumour edge' },
        savedSelection('2', second),
      ],
    })

    expect(result.current[0]?.name).toBe('Tumour edge')
    expect(result.current[0]?.cells.status).toBe('ready')
    expect(loadCells).toHaveBeenCalledTimes(2)
  })

  it('says a selection stopped at its limit only when the reader did', async () => {
    const complete = box(0)
    const cut = box(20)
    const many = cells(...Array.from({ length: ROI_CELL_EXPORT_LIMIT + 1 }, String))
    const loadCells = vi.fn<RoiCellsLoader>(async (_url, selection) =>
      selection === complete ? many : roiCellsWithin(many, ROI_CELL_EXPORT_LIMIT),
    )
    const { result } = renderHook(() =>
      useSelectionCells({
        enabled: true,
        datasetUrl: URL,
        selections: [savedSelection('1', complete), savedSelection('2', cut)],
        loadCells,
        appendDebugEvent: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(
        result.current.map(({ cells }) =>
          cells.status === 'ready' ? [cells.cellIds.length, cells.hitCellLimit] : null,
        ),
      ).toEqual([
        [ROI_CELL_EXPORT_LIMIT + 1, false],
        [ROI_CELL_EXPORT_LIMIT, true],
      ])
    })
  })

  it('reports a failed lookup for that selection only', async () => {
    const first = box(0)
    const second = box(20)
    const loadCells = vi.fn<RoiCellsLoader>(async (_url, selection) => {
      if (selection === second) throw new Error('Range requests are not supported.')
      return cells('a')
    })
    const { result } = renderHook(() =>
      useSelectionCells({
        enabled: true,
        datasetUrl: URL,
        selections: [savedSelection('1', first), savedSelection('2', second)],
        loadCells,
        appendDebugEvent: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current[1]?.cells).toEqual({
        status: 'error',
        message: 'Range requests are not supported.',
      })
    })
    expect(result.current[0]?.cells.status).toBe('ready')
  })

  it('stops lookups for a dataset that is closed', async () => {
    const selection = box(0)
    let signal: AbortSignal | undefined
    const loadCells = vi.fn<RoiCellsLoader>(
      (_url, _selection, options) =>
        new Promise(() => {
          signal = options?.signal
        }),
    )
    const { rerender } = renderHook(
      ({ datasetUrl }) =>
        useSelectionCells({
          enabled: true,
          datasetUrl,
          selections: [savedSelection('1', selection)],
          loadCells,
          appendDebugEvent: vi.fn(),
        }),
      { initialProps: { datasetUrl: URL as string | null } },
    )

    await waitFor(() => {
      expect(signal).toBeDefined()
    })
    act(() => {
      rerender({ datasetUrl: null })
    })

    expect(signal?.aborted).toBe(true)
  })

  it('looks a failed outline up again when shown again, or on Try again', async () => {
    const selection = box(0)
    let fail = true
    const loadCells = vi.fn<RoiCellsLoader>(async () => {
      if (fail) throw new Error('Failed to fetch')
      return cells('a')
    })
    const selections = [savedSelection('1', selection)]
    const { result, rerender } = renderHook(
      ({ enabled, retryCount }) =>
        useSelectionCells({
          enabled,
          datasetUrl: URL,
          selections,
          loadCells,
          appendDebugEvent: vi.fn(),
          retryCount,
        }),
      { initialProps: { enabled: true, retryCount: 0 } },
    )
    await waitFor(() => {
      expect(result.current[0]?.cells.status).toBe('error')
    })

    // Group by moves away and back.
    rerender({ enabled: false, retryCount: 0 })
    rerender({ enabled: true, retryCount: 0 })
    await waitFor(() => {
      expect(loadCells).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(result.current[0]?.cells.status).toBe('error')
    })

    // Try again, once the network is back.
    fail = false
    rerender({ enabled: true, retryCount: 1 })
    await waitFor(() => {
      expect(result.current[0]?.cells.status).toBe('ready')
    })
    expect(loadCells).toHaveBeenCalledTimes(3)
  })
})
