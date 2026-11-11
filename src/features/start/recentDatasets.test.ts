import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../test/memoryStorage'
import {
  MAX_RECENT_DATASETS,
  readRecentDatasets,
  RECENT_DATASETS_KEY,
  useRecentDatasets,
  withoutRecentDataset,
  withRecentDataset,
  writeRecentDatasets,
  type RecentDataset,
} from './recentDatasets'

function dataset(index: number): RecentDataset {
  return { url: `https://example.test/run-${index}`, name: `run-${index}` }
}

describe('recent datasets', () => {
  it('puts the newest first, once, and keeps eight', () => {
    let recent: readonly RecentDataset[] = []
    for (let index = 1; index <= 10; index += 1) {
      recent = withRecentDataset(recent, dataset(index))
    }

    expect(recent).toHaveLength(MAX_RECENT_DATASETS)
    expect(recent.map((entry) => entry.name)).toEqual([
      'run-10',
      'run-9',
      'run-8',
      'run-7',
      'run-6',
      'run-5',
      'run-4',
      'run-3',
    ])

    recent = withRecentDataset(recent, { ...dataset(5), name: 'Renamed run 5' })
    expect(recent.map((entry) => entry.name).slice(0, 3)).toEqual([
      'Renamed run 5',
      'run-10',
      'run-9',
    ])
    expect(recent).toHaveLength(MAX_RECENT_DATASETS)
    expect(withoutRecentDataset(recent, dataset(10).url)).toHaveLength(7)
  })

  it('reads only well-formed entries, and survives storage that refuses', () => {
    const storage = memoryStorage()
    storage.setItem(
      RECENT_DATASETS_KEY,
      JSON.stringify([dataset(1), { url: '' }, { name: 'no url' }, 'run', dataset(2)]),
    )
    expect(readRecentDatasets(storage)).toEqual([dataset(1), dataset(2)])

    storage.setItem(RECENT_DATASETS_KEY, '{oops')
    expect(readRecentDatasets(storage)).toEqual([])
    expect(readRecentDatasets(null)).toEqual([])

    const refusing = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError')
      },
    }
    expect(readRecentDatasets(refusing)).toEqual([])
    expect(() => {
      writeRecentDatasets(refusing, [dataset(1)])
    }).not.toThrow()
  })

  it('remembers datasets in storage', () => {
    const storage = memoryStorage()
    const { result, unmount } = renderHook(() => useRecentDatasets(storage))

    act(() => {
      result.current.add({ ...dataset(1), platform: 'xenium' })
      result.current.add(dataset(2))
    })
    expect(result.current.recent.map((entry) => entry.name)).toEqual(['run-2', 'run-1'])
    const { add } = result.current
    act(() => {
      result.current.add(dataset(2))
    })
    // Adding the newest again changes nothing.
    expect(result.current.add).toBe(add)
    unmount()

    const reopened = renderHook(() => useRecentDatasets(storage))
    expect(reopened.result.current.recent).toEqual([
      dataset(2),
      { ...dataset(1), platform: 'xenium' },
    ])

    act(() => {
      reopened.result.current.remove(dataset(2).url)
    })
    expect(readRecentDatasets(storage)).toEqual([{ ...dataset(1), platform: 'xenium' }])
  })

  it('keeps the list for the page when storage refuses', () => {
    const refusing = memoryStorage()
    refusing.getItem = () => {
      throw new DOMException('Denied', 'SecurityError')
    }
    const { result } = renderHook(() => useRecentDatasets(refusing))

    act(() => {
      result.current.add(dataset(1))
      result.current.add(dataset(2))
    })
    expect(result.current.recent.map((entry) => entry.name)).toEqual(['run-2', 'run-1'])
  })
})
