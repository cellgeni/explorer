import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GeneValuesRead, GeneValuesSource } from '../../data/geneValues'
import { createPlotStatsSession } from './plotStatsSession'
import {
  openPlotsSource,
  usePlotsWorkflow,
  type PlotsGroupsRequest,
  type PlotsWorkflowInput,
} from './usePlotsWorkflow'

const ROW_IDS = ['a', 'b', 'c', 'd']

function source(
  geneValues: GeneValuesSource['geneValues'] = async (genes) =>
    genes.map((gene) =>
      gene === 'Bad'
        ? { gene, error: 'Bad is not in the expression matrix.' }
        : { gene, rows: new Uint32Array([0, 2]), values: new Float32Array([2, 4]) },
    ),
): GeneValuesSource & { readonly geneValues: ReturnType<typeof vi.fn> } {
  return {
    geneValuesRowIds: async () => ROW_IDS,
    estimateGeneValuesRead: async () => ({ kind: 'read', bytes: 0 }),
    geneValues: vi.fn(geneValues),
  }
}

const byHalves: PlotsGroupsRequest = {
  key: 'halves',
  input: {
    classes: [
      ['a', 'b'],
      ['c', 'd'],
    ],
    selection: null,
  },
}
const all: PlotsGroupsRequest = {
  key: 'all',
  input: { classes: [ROW_IDS], selection: ['a'] },
}

function input(
  dataset: GeneValuesSource,
  overrides: Partial<PlotsWorkflowInput> = {},
): PlotsWorkflowInput {
  return {
    enabled: true,
    datasetUrl: 'https://example.test/tiny.h5ad',
    openSource: async () => ({ kind: 'ready', source: dataset }),
    genes: ['Actb', 'Gad1'],
    groups: byHalves,
    appendDebugEvent: vi.fn(),
    createSession: () => createPlotStatsSession(null),
    ...overrides,
  }
}

describe('usePlotsWorkflow (plan 22-D12)', () => {
  it('reads the genes once, and regroups them without reading again', async () => {
    const dataset = source()
    const { result, rerender } = renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(dataset),
    })

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.stats.get('Actb')?.groups.map((group) => group.sum)).toEqual([
      2, 4,
    ])
    expect(dataset.geneValues).toHaveBeenCalledTimes(1)
    expect(dataset.geneValues).toHaveBeenCalledWith(['Actb', 'Gad1'], expect.anything())

    rerender(input(dataset, { groups: all }))
    await waitFor(() => {
      expect(result.current.groupsKey).toBe('all')
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.summary?.selectionSize).toBe(1)
    expect(result.current.stats.get('Gad1')?.groups.map((group) => group.sum)).toEqual([
      2, 6,
    ])
    expect(dataset.geneValues).toHaveBeenCalledTimes(1)
  })

  it('reads only genes it has not read, and shows each gene’s error', async () => {
    const dataset = source()
    const { result, rerender } = renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(dataset),
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    rerender(input(dataset, { genes: ['Actb', 'Gad1', 'Bad', 'Vim'] }))
    await waitFor(() => {
      expect(result.current.stats.has('Vim')).toBe(true)
    })

    expect(dataset.geneValues).toHaveBeenLastCalledWith(['Bad', 'Vim'], expect.anything())
    expect(result.current.geneErrors.get('Bad')).toBe(
      'Bad is not in the expression matrix.',
    )
  })

  it('cancels a read, and reads again on retry', async () => {
    let release: (reads: readonly GeneValuesRead[]) => void = () => undefined
    const dataset = source(
      (_, options) =>
        new Promise((resolve, reject) => {
          release = resolve
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const { result } = renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(dataset, { genes: ['Actb'] }),
    })
    await waitFor(() => {
      expect(result.current.status).toBe('reading')
    })

    act(() => {
      result.current.cancel()
    })
    expect(result.current.status).toBe('cancelled')

    act(() => {
      result.current.retry()
    })
    await waitFor(() => {
      expect(dataset.geneValues).toHaveBeenCalledTimes(2)
    })
    act(() => {
      release([
        { gene: 'Actb', rows: new Uint32Array([1]), values: new Float32Array([5]) },
      ])
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.stats.get('Actb')?.groups[0]?.sum).toBe(5)
  })

  it('says why a dataset cannot be plotted, before genes are chosen', async () => {
    const { result } = renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(source(), {
        genes: [],
        openSource: async () => ({ kind: 'unavailable', reason: 'Not in memory.' }),
      }),
    })

    await waitFor(() => {
      expect(result.current.status).toBe('unavailable')
    })
    expect(result.current.message).toBe('Not in memory.')
  })

  it('opens the dataset again on retry when opening it failed', async () => {
    const dataset = source()
    const openSource = vi
      .fn<PlotsWorkflowInput['openSource']>()
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValue({ kind: 'ready', source: dataset })
    const { result } = renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(dataset, { openSource }),
    })
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.message).toBe('Network down')

    act(() => {
      result.current.retry()
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(openSource).toHaveBeenCalledTimes(2)
    expect(result.current.stats.has('Actb')).toBe(true)
  })

  it('reads nothing while the panel is closed', async () => {
    const dataset = source()
    renderHook((props) => usePlotsWorkflow(props), {
      initialProps: input(dataset, { enabled: false }),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(dataset.geneValues).not.toHaveBeenCalled()
  })
})

describe('openPlotsSource', () => {
  it('opens datasets that read gene values, and names the platform otherwise', async () => {
    const dataset = source()

    await expect(
      openPlotsSource(async () => dataset as never, 'https://example.test', 'H5AD'),
    ).resolves.toEqual({ kind: 'ready', source: dataset })
    await expect(
      openPlotsSource(async () => ({}) as never, 'https://example.test', 'Xenium'),
    ).resolves.toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('Plots are not available for Xenium yet.'),
    })
  })
})
