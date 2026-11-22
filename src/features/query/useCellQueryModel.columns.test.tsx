import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import type { RoiSelection } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/spatialDataset'
import {
  CELL_QUERY_TEST_CELLS,
  testCellIds as ids,
  useCellQueryHarness,
  type CellQueryHarnessProps,
} from '../../test/cellQueryHarness'
import { SELECTIONS_SET_ID } from '../plots/plotsPanelModel'
import type { SavedSelection } from '../roi/selectionListModel'

type Harness = { current: ReturnType<typeof useCellQueryHarness> }

function order(result: Harness): string[] {
  return Array.from({ length: result.current.table.rowCount }, (_, index) =>
    result.current.table.cellIdAt(index),
  )
}

const TRANSCRIPTS = {
  kind: 'number',
  columnId: 'cell:transcripts',
  operator: 'between',
  min: 5,
  max: 40,
} as const

describe('Cell Query columns', () => {
  it('goes back to cell order when the sorted condition is removed', async () => {
    const { result } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      { initialProps: { initial: [TRANSCRIPTS] } as CellQueryHarnessProps },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('4 of 4 cells match')
    })
    act(() => {
      result.current.table.onSort('cell:transcripts')
    })
    await waitFor(() => {
      expect(order(result)).toEqual(['c4', 'c1', 'c2', 'c3'])
    })

    act(() => {
      result.current.onRemoveCondition(0)
    })
    await waitFor(() => {
      expect(order(result)).toEqual(['c1', 'c2', 'c3', 'c4'])
    })
    expect(result.current.table.columns.map((column) => column.sort)).toEqual([null])
  })

  it('keeps the sort on a condition whose column changes', async () => {
    // Areas 30, 12, 50 and 8.
    const cells = CELL_QUERY_TEST_CELLS.map((cell, index) => ({
      ...cell,
      cellArea: [30, 12, 50, 8][index],
    }))
    const { result } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      {
        initialProps: {
          initial: [TRANSCRIPTS],
          overrides: { cells },
        } as CellQueryHarnessProps,
      },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('4 of 4 cells match')
    })
    act(() => {
      result.current.table.onSort('cell:transcripts')
    })
    await waitFor(() => {
      expect(order(result)).toEqual(['c4', 'c1', 'c2', 'c3'])
    })

    // The condition moves to another column, as an image condition does when
    // its threshold, level or radius changes: the sort moves with it.
    act(() => {
      result.current.onConditionChange(0, {
        ...TRANSCRIPTS,
        columnId: 'cell:area',
        min: 0,
        max: 100,
      })
    })
    await waitFor(() => {
      expect(order(result)).toEqual(['c4', 'c2', 'c1', 'c3'])
    })
    expect(result.current.table.columns.map((column) => column.sort)).toEqual([
      null,
      'ascending',
    ])
  })

  it('shows a renamed selection by its new name', async () => {
    const selection = { kind: 'box' } as unknown as RoiSelection
    const saved = (name: string): readonly SavedSelection[] => [
      { id: 'roi:1', name, color: '#f0c84b', visible: true, selection },
    ]
    const loadSelectionCells = vi.fn(
      async () => [{ id: 'c1' }, { id: 'c2' }] as unknown as readonly DatasetCell[],
    )
    const column = `set:${SELECTIONS_SET_ID}`
    const { result, rerender } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      {
        initialProps: {
          initial: [
            {
              kind: 'category',
              columnId: column,
              operator: 'in',
              classIds: ['selection:roi:1'],
            },
          ],
          overrides: { savedSelections: saved('Tumour'), loadSelectionCells },
        } as CellQueryHarnessProps,
      },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('2 of 4 cells match')
    })

    rerender({ overrides: { savedSelections: saved('Tumour core'), loadSelectionCells } })

    await waitFor(async () => {
      expect(await result.current.table.readValues(0, 1)).toEqual([
        { [column]: 'Tumour core' },
      ])
    })
    expect(loadSelectionCells).toHaveBeenCalledOnce()
  })

  it("counts a class's cells on the map, as Clusters does", async () => {
    // Class A lists two cells on the map and three that are not (off-tissue
    // Visium spots, say).
    const annotations: readonly Annotation<string>[] = [
      {
        id: 'analysis:cluster:a',
        label: 'cluster: A',
        cellIds: ids('c1', 'c2', 'x1', 'x2', 'x3'),
      },
      { id: 'analysis:cluster:b', label: 'cluster: B', cellIds: ids('c3', 'c4') },
    ]
    const { result } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      {
        initialProps: {
          initial: [
            {
              kind: 'category',
              columnId: 'set:analysis:cluster',
              operator: 'in',
              classIds: ['analysis:cluster:a'],
            },
          ],
          overrides: { annotations },
        } as CellQueryHarnessProps,
      },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('2 of 4 cells match')
    })

    expect(result.current.conditions[0]?.classes.map((option) => option.count)).toEqual([
      2, 2,
    ])
  })
})
