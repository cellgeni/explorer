import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { useDatasetCollection } from './useDatasetCollection'

const COLLECTION_URL = 'https://example.test/injury/collection.json'
const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    name: 'Injury time course',
    datasets: [
      { dataset: 'sham-a.zarr', name: 'Sham A' },
      { dataset: 'sham b.zarr', name: 'Sham B' },
    ],
  },
  COLLECTION_URL,
)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// A link with collection= and no dataset=, whose collection is read slowly.
function renderReading(onOpenDataset = vi.fn()) {
  const pending = deferred<typeof COLLECTION>()
  const view = renderHook(
    ({ loadedDatasetUrl }: { loadedDatasetUrl: string | null }) =>
      useDatasetCollection({
        initialUrl: COLLECTION_URL,
        linkOpensDataset: false,
        loadCollection: () => pending.promise,
        loadedDatasetUrl,
        onOpenDataset,
      }),
    { initialProps: { loadedDatasetUrl: null as string | null } },
  )
  const arrive = async () => {
    await act(async () => {
      pending.resolve(COLLECTION)
      await pending.promise
    })
  }
  return { ...view, arrive, onOpenDataset }
}

describe('useDatasetCollection', () => {
  it('opens the first dataset once the collection is read', async () => {
    const { result, arrive, onOpenDataset } = renderReading()

    await arrive()

    expect(result.current.state.status).toBe('ready')
    expect(onOpenDataset).toHaveBeenCalledWith(
      'https://example.test/injury/sham-a.zarr',
      expect.anything(),
    )
  })

  // The first entry opened over a dataset the user opened while the
  // collection was read (EXP-244).
  it('keeps a dataset opened while the collection is read', async () => {
    const outside = renderReading()
    outside.rerender({ loadedDatasetUrl: 'https://example.test/elsewhere.zarr' })
    await outside.arrive()

    expect(outside.onOpenDataset).not.toHaveBeenCalled()
    expect(outside.result.current.state.status).toBe('idle')

    const inside = renderReading()
    inside.rerender({ loadedDatasetUrl: 'https://example.test/injury/sham%20b.zarr' })
    await inside.arrive()

    expect(inside.onOpenDataset).not.toHaveBeenCalled()
    expect(inside.result.current.state.status).toBe('ready')
  })

  // Another spelling of an entry's address counted as outside the
  // collection and closed it (EXP-244).
  it.each([
    'https://example.test/injury/sham b.zarr',
    'https://EXAMPLE.test/injury/sham-a.zarr/',
  ])('keeps the collection open for %s', async (spelling) => {
    const { result, rerender } = renderHook(
      ({ loadedDatasetUrl }: { loadedDatasetUrl: string | null }) =>
        useDatasetCollection({
          initialUrl: COLLECTION_URL,
          linkOpensDataset: true,
          loadCollection: async () => COLLECTION,
          loadedDatasetUrl,
          onOpenDataset: vi.fn(),
        }),
      { initialProps: { loadedDatasetUrl: null as string | null } },
    )
    await act(async () => {})

    rerender({ loadedDatasetUrl: spelling })
    expect(result.current.state.status).toBe('ready')
  })
})
