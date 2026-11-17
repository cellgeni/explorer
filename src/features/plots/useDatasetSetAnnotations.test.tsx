import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { Annotation } from '../../datasets/spatialDataset'
import type { AnnotationLoader } from '../app-shell/appDependencies'
import { useDatasetSetAnnotations } from './useDatasetSetAnnotations'

const URL = 'https://example.org/data.h5ad'

const leiden: readonly Annotation[] = [
  {
    id: 'analysis:leiden:0',
    label: 'leiden: 0',
    cellIds: [asCellId('aaaaaaaa-1')],
    color: '#1f77b4',
  },
  { id: 'analysis:leiden:1', label: 'leiden: 1', cellIds: [asCellId('aaaaaaab-1')] },
]

describe('useDatasetSetAnnotations', () => {
  it('reads the chosen set once, with stored colours and the palette', async () => {
    const loadAnnotations = vi.fn<AnnotationLoader>(async () => leiden)
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useDatasetSetAnnotations({
          enabled,
          datasetUrl: URL,
          groupId: 'obs:leiden',
          loadAnnotations,
          appendDebugEvent: vi.fn(),
        }),
      { initialProps: { enabled: false } },
    )

    expect(result.current).toEqual({ groupId: 'obs:leiden', status: 'loading' })
    expect(loadAnnotations).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => {
      expect(result.current?.status).toBe('ready')
    })

    const state = result.current
    if (state?.status !== 'ready') throw new Error('Expected the set.')
    expect(state.annotations).toBe(leiden)
    expect(state.colors['analysis:leiden:0']).toBe('#1f77b4')
    expect(state.colors['analysis:leiden:1']).toMatch(/^#[0-9a-f]{6}$/i)
    expect(loadAnnotations).toHaveBeenCalledWith(URL, {
      signal: expect.any(AbortSignal),
      groupId: 'obs:leiden',
    })

    rerender({ enabled: true })
    expect(loadAnnotations).toHaveBeenCalledTimes(1)
  })

  it('stops a read when another set is chosen, and reports failures', async () => {
    const signals: AbortSignal[] = []
    const loadAnnotations = vi.fn<AnnotationLoader>((_url, options) => {
      if (options?.signal !== undefined) signals.push(options.signal)
      return options?.groupId === 'obs:sample'
        ? Promise.reject(new Error('Column sample is not categorical.'))
        : new Promise(() => {})
    })
    const { result, rerender } = renderHook(
      ({ groupId }) =>
        useDatasetSetAnnotations({
          enabled: true,
          datasetUrl: URL,
          groupId,
          loadAnnotations,
          appendDebugEvent: vi.fn(),
        }),
      { initialProps: { groupId: 'obs:leiden' as string | null } },
    )

    rerender({ groupId: 'obs:sample' })
    expect(signals[0]?.aborted).toBe(true)
    await waitFor(() => {
      expect(result.current).toEqual({
        groupId: 'obs:sample',
        status: 'error',
        message: 'Column sample is not categorical.',
      })
    })

    rerender({ groupId: null })
    expect(result.current).toBeNull()
  })
})
