import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { CollectionBar, type CollectionBarPreviews } from './CollectionBar'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
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
const SHAM_B = 'https://example.test/injury/sham-b.zarr'
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

describe('CollectionBar previews', () => {
  // Sham A has two cells and scores 3; Sham B scores 8; 1 dpi A is an image.
  function previewLoaders(): CollectionPreviewLoaders {
    const scoreByUrl: Record<string, number> = { [SHAM_A]: 3, [SHAM_B]: 8 }

    return {
      detectSpatialDataset: vi.fn(async (baseUrl: string) =>
        baseUrl === DPI_A
          ? { platform: 'image' as const, baseUrl, imageUrl: baseUrl, checked: [] }
          : {
              platform: 'h5ad' as const,
              baseUrl,
              h5adUrl: baseUrl,
              source: 'zarr' as const,
              checked: [],
            },
      ),
      getSpatialDataset: vi.fn(async (url: string) => ({
        overview: async () => [
          {
            cellId: 'c0',
            position: { x: micrometers(0), y: micrometers(0) },
            transcriptCount: 0,
          },
          {
            cellId: 'c1',
            position: { x: micrometers(5), y: micrometers(5) },
            transcriptCount: 0,
          },
        ],
        // Sham B has two astrocytes; the others one astrocyte, one neuron.
        annotations: async () =>
          url === SHAM_B
            ? [{ id: 'analysis:type:astro', label: 'type: astro', cellIds: ['c0', 'c1'] }]
            : [
                { id: 'analysis:type:astro', label: 'type: astro', cellIds: ['c0'] },
                { id: 'analysis:type:neuron', label: 'type: neuron', cellIds: ['c1'] },
              ],
        geneExpression: async (_bbox: unknown, genes: readonly string[]) => ({
          genes,
          maxCount: scoreByUrl[url] ?? 0,
          elements: [
            {
              id: 'a',
              position: { x: micrometers(0), y: micrometers(0) },
              count: scoreByUrl[url] ?? 0,
            },
          ],
        }),
      })) as unknown as CollectionPreviewLoaders['getSpatialDataset'],
      loadDatasetOverview: vi.fn(),
      loadGeneExpression: vi.fn(),
      loadAnnotations: vi.fn(),
    }
  }

  function renderBar(previews: CollectionBarPreviews) {
    return render(
      <CollectionBar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        previews={previews}
      />,
    )
  }

  it('previews each dataset on one scale for the selected genes', async () => {
    const loaders = previewLoaders()
    renderBar({
      loaders,
      genes: ['Aqp4'],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: null,
      paused: false,
    })
    const bar = screen.getByRole('navigation', { name: 'Collection' })
    const shamA = within(bar).getByRole('button', { name: 'Sham A' })

    expect(await within(shamA).findByText('max 3')).toBeInTheDocument()
    expect(
      await within(within(bar).getByRole('button', { name: 'Sham B' })).findByText(
        'max 8',
      ),
    ).toBeInTheDocument()
    expect(shamA).toHaveAttribute('title', 'Sham A is open; highest score 3')
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        'No cells to preview',
      ),
    ).toBeInTheDocument()

    const scale = bar.querySelector('.collection-bar-scale')
    expect(scale).toHaveTextContent('Aqp4')
    await waitFor(() => {
      expect(scale).toHaveTextContent('08')
    })
  })

  it('shows the tissue only without genes, and names only when turned off', async () => {
    const loaders = previewLoaders()
    renderBar({
      loaders,
      genes: [],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: null,
      paused: false,
    })
    const bar = screen.getByRole('navigation', { name: 'Collection' })

    await waitFor(() => {
      expect(loaders.getSpatialDataset).toHaveBeenCalledTimes(3)
    })
    expect(bar.querySelector('.collection-bar-scale')).toBe(null)
    expect(within(bar).queryByText(/^max /)).toBe(null)

    const toggle = within(bar).getByRole('button', { name: 'Previews' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(bar.querySelector('canvas')).toBe(null)
    expect(within(bar).getByRole('button', { name: 'Sham B' })).toHaveTextContent(
      /^Sham B$/,
    )
  })

  it('expands into a grid over the view until a dataset is chosen', async () => {
    const onSelect = vi.fn()
    render(
      <CollectionBar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={onSelect}
        onClose={vi.fn()}
        previews={{
          loaders: previewLoaders(),
          genes: ['Aqp4'],
          scoreMode: 'sum',
          colorScale: 'plasma',
          annotations: null,
          paused: false,
        }}
      />,
    )
    const bar = screen.getByRole('navigation', { name: 'Collection' })
    const expand = within(bar).getByRole('button', { name: 'Expand' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(expand)

    expect(bar).toHaveClass('is-expanded')
    const collapse = within(bar).getByRole('button', { name: 'Collapse' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(await within(bar).findByText('max 8')).toBeInTheDocument()

    fireEvent.keyDown(collapse, { key: 'Escape' })
    expect(bar).not.toHaveClass('is-expanded')

    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }))
    fireEvent.click(within(bar).getByRole('button', { name: 'Sham B' }))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ url: SHAM_B }))
    expect(bar).not.toHaveClass('is-expanded')

    // Without previews there is no grid.
    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }))
    fireEvent.click(within(bar).getByRole('button', { name: 'Previews' }))
    expect(bar).not.toHaveClass('is-expanded')
    expect(within(bar).queryByRole('button', { name: /^(Expand|Collapse)$/ })).toBe(null)
  })

  it('previews the classes of an annotation set, counting the shown ones', async () => {
    const loaders = previewLoaders()
    renderBar({
      loaders,
      genes: ['Aqp4'],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: {
        groupId: 'analysis:type',
        label: 'type',
        colors: {},
        hiddenIds: new Set(['analysis:type:neuron']),
      },
      paused: false,
    })
    const bar = screen.getByRole('navigation', { name: 'Collection' })
    const shamB = within(bar).getByRole('button', { name: 'Sham B' })

    expect(await within(shamB).findByText('2 cells')).toBeInTheDocument()
    expect(shamB).toHaveAttribute('title', 'Open Sham B; 2 cells in the shown classes')
    expect(
      await within(within(bar).getByRole('button', { name: 'Sham A' })).findByText(
        '1 cell',
      ),
    ).toBeInTheDocument()
    expect(bar.querySelector('.collection-bar-scale')).toHaveTextContent('type1 hidden')
    // The genes are not read while the cells are coloured by the set.
    expect(within(bar).queryByText(/^max /)).toBe(null)
  })

  it('waits while the main view loads a dataset', async () => {
    const loaders = previewLoaders()
    const { rerender } = renderBar({
      loaders,
      genes: ['Aqp4'],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: null,
      paused: true,
    })
    await act(async () => {})
    expect(loaders.detectSpatialDataset).not.toHaveBeenCalled()

    rerender(
      <CollectionBar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        previews={{
          loaders,
          genes: ['Aqp4'],
          scoreMode: 'sum',
          colorScale: 'plasma',
          annotations: null,
          paused: false,
        }}
      />,
    )
    expect(await screen.findByText('max 3')).toBeInTheDocument()
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
