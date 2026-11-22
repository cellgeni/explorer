import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import type { CellId } from '../../data/cellid'
import {
  CELL_QUERY_TEST_CELLS,
  testCellIds as ids,
  useCellQueryHarness,
  type CellQueryHarnessProps,
} from '../../test/cellQueryHarness'
import { createCellQuerySession, type CellQuerySession } from './cellQuerySession'
import type { CellQueryModelInput } from './useCellQueryModel'

const SETS: CellQueryModelInput['datasetSets'] = [
  { groupId: 'kmeans', label: 'kmeans', classCount: 2 },
]
const GROUPS: CellQueryModelInput['annotationGroups'] = [
  { id: 'kmeans', label: 'kmeans' },
]
const KMEANS: readonly Annotation<CellId>[] = [
  { id: 'analysis:kmeans:a', label: 'kmeans: A', cellIds: ids('c4') },
  { id: 'analysis:kmeans:b', label: 'kmeans: B', cellIds: ids('c1', 'c2', 'c3') },
]

describe('Cell Query reads and exports', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a failed dataset set again once a condition uses it again', async () => {
    const loadSetAnnotations = vi
      .fn<CellQueryModelInput['loadSetAnnotations']>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(KMEANS)
    const { result } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      {
        initialProps: {
          overrides: { datasetSets: SETS, annotationGroups: GROUPS, loadSetAnnotations },
        } as CellQueryHarnessProps,
      },
    )
    act(() => {
      result.current.onAddCondition('set:dataset-set:kmeans')
    })
    await waitFor(() => {
      expect(result.current.conditions[0]?.status).toBe('error')
    })

    act(() => {
      result.current.onRemoveCondition(0)
    })
    act(() => {
      result.current.onAddCondition('set:dataset-set:kmeans')
    })

    await waitFor(() => {
      expect(result.current.conditions[0]?.status).toBe('ready')
    })
    expect(loadSetAnnotations).toHaveBeenCalledTimes(2)
  })

  it('says why an added column is blank, and that the CSV leaves it out', async () => {
    const loadSetAnnotations = vi.fn<CellQueryModelInput['loadSetAnnotations']>(
      async () => {
        throw new Error('HTTP 503')
      },
    )
    const { result } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      {
        initialProps: {
          overrides: { datasetSets: SETS, annotationGroups: GROUPS, loadSetAnnotations },
        } as CellQueryHarnessProps,
      },
    )
    act(() => {
      result.current.table.onAddColumn('set:dataset-set:kmeans')
    })
    // Reading: the window says it is busy.
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.errors).toEqual([
        'The kmeans column could not be read, so it is blank and the CSV leaves it out: HTTP 503',
      ])
    })
  })

  it("does not show a closed export's failure on the next dataset", async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:cell-query')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // The export waits for the worker's values until released.
    const createSession = (): CellQuerySession => {
      const session = createCellQuerySession(null)
      return {
        ...session,
        values: async (rows, columnIds) => {
          await gate
          return session.values(rows, columnIds)
        },
      }
    }
    const { result, rerender } = renderHook(
      (props: CellQueryHarnessProps) => useCellQueryHarness(props),
      { initialProps: { overrides: { createSession } } as CellQueryHarnessProps },
    )
    await waitFor(() => {
      expect(result.current.canExport).toBe(true)
    })
    act(() => {
      result.current.onExportCsv()
    })

    // Another dataset opens while the export waits.
    rerender({
      overrides: {
        createSession,
        datasetUrl: 'https://example.test/other.h5ad',
        cells: CELL_QUERY_TEST_CELLS.slice(0, 2),
      },
    })
    await waitFor(() => {
      expect(result.current.status).toBe('2 cells, no conditions')
    })
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(result.current.exporting).toBe(false)
    expect(result.current.errors).toEqual([])
  })
})
