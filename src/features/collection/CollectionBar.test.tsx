import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { CollectionBar } from './CollectionBar'
import { useDatasetCollection } from './useDatasetCollection'

const COLLECTION_URL = 'https://example.test/injury/collection.json'
const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    name: 'Injury time course',
    datasets: [
      { dataset: 'sham-a.zarr', name: 'Sham A', group: 'Sham' },
      { dataset: 'sham-b.zarr', name: 'Sham B', group: 'Sham' },
      { dataset: '1dpi-a.zarr', name: '1 dpi A', group: '1 dpi' },
      { dataset: 'atlas.zarr' },
    ],
    defaults: { genes: ['Aqp4'] },
  },
  COLLECTION_URL,
)
const SHAM_A = 'https://example.test/injury/sham-a.zarr'
const DPI_A = 'https://example.test/injury/1dpi-a.zarr'

describe('CollectionBar', () => {
  it('lists the datasets by group and marks the open and loading ones', () => {
    const onSelect = vi.fn()
    render(
      <CollectionBar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={DPI_A}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )

    const bar = screen.getByRole('navigation', { name: 'Collection' })
    expect(within(bar).getByText('Injury time course')).toBeTruthy()
    expect(within(bar).getByText('4 datasets')).toBeTruthy()

    const sham = within(bar).getByRole('group', { name: 'Sham' })
    expect(
      within(sham)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Sham A', 'Sham B'])
    expect(within(bar).getByRole('group', { name: 'Datasets' }).textContent).toBe(
      'atlas.zarr',
    )

    const open = within(sham).getByRole('button', { name: 'Sham A' })
    expect(open.getAttribute('aria-current')).toBe('true')
    expect(open.getAttribute('title')).toBe('Sham A is open')
    const loading = within(bar).getByRole('button', { name: '1 dpi A' })
    expect(loading.getAttribute('aria-busy')).toBe('true')

    // The open and loading datasets do nothing; another one opens.
    fireEvent.click(open)
    fireEvent.click(loading)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(within(sham).getByRole('button', { name: 'Sham B' }))
    expect(onSelect).toHaveBeenCalledWith(COLLECTION.datasets[1])
  })

  it('says when the collection is being read or cannot be opened', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <CollectionBar
        state={{ status: 'loading', url: COLLECTION_URL }}
        loadedUrl={null}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('Reading the collection…')
    expect(screen.getByText('collection.json')).toBeTruthy()

    rerender(
      <CollectionBar
        state={{
          status: 'error',
          url: COLLECTION_URL,
          message: 'collection.json: the file answered HTTP 404.',
        }}
        loadedUrl={null}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe(
      'The collection could not be opened. collection.json: the file answered HTTP 404.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close Collection' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('useDatasetCollection', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('reads the link collection and opens its first dataset with the defaults', async () => {
    const pending = deferred<typeof COLLECTION>()
    const loadCollection = vi.fn(() => pending.promise)
    const onOpenDataset = vi.fn()
    const { result } = renderHook(() =>
      useDatasetCollection({
        initialUrl: COLLECTION_URL,
        linkOpensDataset: false,
        loadCollection,
        loadedDatasetUrl: null,
        onOpenDataset,
      }),
    )

    expect(result.current.state).toEqual({ status: 'loading', url: COLLECTION_URL })
    expect(loadCollection).toHaveBeenCalledWith(COLLECTION_URL, {
      signal: expect.any(AbortSignal),
    })

    await act(async () => {
      pending.resolve(COLLECTION)
      await pending.promise
    })

    expect(result.current.state).toEqual({
      status: 'ready',
      url: COLLECTION_URL,
      collection: COLLECTION,
    })
    expect(onOpenDataset).toHaveBeenCalledWith(SHAM_A, {
      linkState: {
        linkVersion: 2,
        selectedGenes: ['Aqp4'],
        observationColorMode: 'gene-expression',
      },
      ignored: [],
    })
  })

  it('leaves the dataset a link names to the usual load', async () => {
    const onOpenDataset = vi.fn()
    const { result } = renderHook(() =>
      useDatasetCollection({
        initialUrl: COLLECTION_URL,
        linkOpensDataset: true,
        loadCollection: async () => COLLECTION,
        loadedDatasetUrl: null,
        onOpenDataset,
      }),
    )

    await act(async () => {})

    expect(result.current.state.status).toBe('ready')
    expect(onOpenDataset).not.toHaveBeenCalled()
  })

  it('does nothing without a collection in the link', () => {
    const loadCollection = vi.fn(async () => COLLECTION)
    const { result } = renderHook(() =>
      useDatasetCollection({
        initialUrl: undefined,
        linkOpensDataset: false,
        loadCollection,
        loadedDatasetUrl: null,
        onOpenDataset: vi.fn(),
      }),
    )

    expect(result.current.state).toEqual({ status: 'idle' })
    expect(loadCollection).not.toHaveBeenCalled()
  })

  it('closes when a dataset outside the collection loads, or on request', async () => {
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

    rerender({ loadedDatasetUrl: SHAM_A })
    rerender({ loadedDatasetUrl: DPI_A })
    expect(result.current.state.status).toBe('ready')

    rerender({ loadedDatasetUrl: 'https://example.test/elsewhere.h5ad' })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('reports a collection that cannot be read, until a dataset loads', async () => {
    const { result, rerender } = renderHook(
      ({ loadedDatasetUrl }: { loadedDatasetUrl: string | null }) =>
        useDatasetCollection({
          initialUrl: COLLECTION_URL,
          linkOpensDataset: false,
          loadCollection: async () => {
            throw new Error('collection.json: the file answered HTTP 404.')
          },
          loadedDatasetUrl,
          onOpenDataset: vi.fn(),
        }),
      { initialProps: { loadedDatasetUrl: null as string | null } },
    )
    await act(async () => {})

    expect(result.current.state).toEqual({
      status: 'error',
      url: COLLECTION_URL,
      message: 'collection.json: the file answered HTTP 404.',
    })

    rerender({ loadedDatasetUrl: SHAM_A })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('stops reading when closed', async () => {
    const pending = deferred<typeof COLLECTION>()
    let signal: AbortSignal | undefined
    const onOpenDataset = vi.fn()
    const { result } = renderHook(() =>
      useDatasetCollection({
        initialUrl: COLLECTION_URL,
        linkOpensDataset: false,
        loadCollection: (_url, options) => {
          signal = options?.signal
          return pending.promise
        },
        loadedDatasetUrl: null,
        onOpenDataset,
      }),
    )

    act(() => {
      result.current.close()
    })
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(COLLECTION)
      await pending.promise
    })
    expect(result.current.state).toEqual({ status: 'idle' })
    expect(onOpenDataset).not.toHaveBeenCalled()
  })
})
