import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { genePanelLoadReady, type GenePanelState } from './geneControlsModel'
import { useGeneSearchColumn, type GeneSearchAliasesLoader } from './useGeneSearchColumn'

const URL = 'https://example.test/cellxgene.h5ad'
const COLUMNS = [
  { key: '_index', index: true },
  { key: 'feature_biotype', index: false },
  { key: 'feature_type', index: false },
]

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderSearchColumn(loadGeneSearchAliases: GeneSearchAliasesLoader) {
  const appendDebugEvent = vi.fn()
  const hook = renderHook(() => {
    const [genePanelState, setGenePanelState] = useState<
      GenePanelState<StructuredLoadError>
    >(
      genePanelLoadReady(URL, ['MYH7'], new Map([['MYH7', 'ENSG00000092054']]), {
        columns: COLUMNS,
        column: '_index',
      }),
    )
    const change = useGeneSearchColumn({
      appendDebugEvent,
      genePanelState,
      loadGeneSearchAliases,
      setGenePanelState,
    })
    return { change, genePanelState, setGenePanelState }
  })
  return { ...hook, appendDebugEvent }
}

describe('useGeneSearchColumn', () => {
  it('matches a column once read, and only the last one picked', async () => {
    const reads = new Map<
      string,
      ReturnType<typeof deferred<ReadonlyMap<string, string>>>
    >()
    const signals = new Map<string, AbortSignal | undefined>()
    const load = vi.fn<GeneSearchAliasesLoader>((_url, column, options) => {
      const read = deferred<ReadonlyMap<string, string>>()
      reads.set(column, read)
      signals.set(column, options?.signal)
      return read.promise
    })
    const { result } = renderSearchColumn(load)

    act(() => {
      result.current.change('feature_biotype')
    })
    act(() => {
      result.current.change('feature_type')
    })

    expect(signals.get('feature_biotype')?.aborted).toBe(true)
    expect(result.current.genePanelState).toMatchObject({
      aliases: new Map([['MYH7', 'ENSG00000092054']]),
      search: { column: '_index', pending: 'feature_type' },
    })

    await act(async () => {
      reads.get('feature_biotype')?.resolve(new Map([['MYH7', 'protein_coding']]))
      reads.get('feature_type')?.resolve(new Map([['MYH7', 'gene']]))
      await Promise.resolve()
    })

    expect(result.current.genePanelState).toEqual({
      status: 'ready',
      url: URL,
      genes: ['MYH7'],
      aliases: new Map([['MYH7', 'gene']]),
      search: { columns: COLUMNS, column: 'feature_type' },
    })
  })

  it('keeps the last column when a read fails, and says why', async () => {
    const { result, appendDebugEvent } = renderSearchColumn(() =>
      Promise.reject(new Error('Failed to fetch')),
    )

    await act(async () => {
      result.current.change('feature_biotype')
      await Promise.resolve()
    })

    expect(result.current.genePanelState).toMatchObject({
      aliases: new Map([['MYH7', 'ENSG00000092054']]),
      search: {
        column: '_index',
        error: 'Could not read feature_biotype: Failed to fetch',
      },
    })
    expect(result.current.genePanelState).not.toHaveProperty('search.pending')
    expect(appendDebugEvent).toHaveBeenCalledWith(
      'Gene search column failed: feature_biotype: Failed to fetch',
    )
  })

  it('stops the read when another panel loads', () => {
    let signal: AbortSignal | undefined
    const { result } = renderSearchColumn((_url, _column, options) => {
      signal = options?.signal
      return new Promise(() => undefined)
    })

    act(() => {
      result.current.change('feature_biotype')
    })
    act(() => {
      result.current.setGenePanelState({ status: 'loading', url: URL })
    })

    expect(signal?.aborted).toBe(true)
  })
})
