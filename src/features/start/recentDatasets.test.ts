import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../test/memoryStorage'
import {
  MAX_RECENT_DATASETS,
  readRecentDatasets,
  recentDatasetEntry,
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

  it('keeps no signature or token from an address (EXP-026)', () => {
    const storage = memoryStorage()
    const { result } = renderHook(() => useRecentDatasets(storage))
    const presigned =
      'https://bucket.s3.amazonaws.com/run.h5ad?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261120&X-Amz-Signature=abc123#cell=7'

    act(() => {
      result.current.add({ url: presigned, name: 'run', platform: 'h5ad' })
    })

    expect(storage.getItem(RECENT_DATASETS_KEY)).not.toMatch(
      /Signature|Credential|abc123/,
    )
    expect(result.current.recent).toEqual([
      {
        url: 'https://bucket.s3.amazonaws.com/run.h5ad#cell=7',
        name: 'run',
        platform: 'h5ad',
        signed: true,
      },
    ])
    expect(
      [
        'https://storage.googleapis.com/b/run.zarr?X-Goog-Signature=1&X-Goog-Date=2',
        'https://acct.blob.core.windows.net/c/run.h5ad?sv=2024&se=2026&sig=abc',
        'https://data.example.org/run.h5ad?token=abc',
      ].map((url) => recentDatasetEntry({ url, name: 'run' }).url),
    ).toEqual([
      'https://storage.googleapis.com/b/run.zarr',
      'https://acct.blob.core.windows.net/c/run.h5ad',
      'https://data.example.org/run.h5ad',
    ])
    // Other query strings are part of the address and stay.
    const zenodo = {
      url: 'https://zenodo.org/records/1/files/run.h5ad?download=1',
      name: 'run',
    }
    expect(recentDatasetEntry(zenodo)).toBe(zenodo)
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
