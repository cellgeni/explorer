import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import { CollectionBar, type CollectionBarPreviews } from './CollectionBar'
import type { CollectionView } from './collectionModel'
import type { CollectionPreviewLoaders } from './collectionPreviewData'
import { useCollectionPreviewStore } from './useCollectionPreviews'
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

// The previews as the tests give them: the bar's, and what App reads them
// with.
type TestPreviews = Omit<CollectionBarPreviews, 'store'> & {
  readonly loaders: CollectionPreviewLoaders
  readonly scoreMode: GeneExpressionScoreMode
  // While the main view loads a dataset, previews wait.
  readonly paused: boolean
}

type BarProps = Omit<
  ComponentProps<typeof CollectionBar>,
  'view' | 'onViewChange' | 'previews' | 'previewSize'
> & {
  readonly initialView?: CollectionView
  readonly onViewChange?: (view: CollectionView) => void
  readonly previews?: TestPreviews
  readonly initialPreviewSize?: number
  readonly onPreviewSizeChange?: (size: number) => void
}

const NO_LOADERS = {} as CollectionPreviewLoaders

// The bar with its view, preview size and previews' store in state, as App
// keeps them.
function Bar({
  initialView = 'row',
  onViewChange,
  previews,
  initialPreviewSize = 150,
  onPreviewSizeChange,
  ...props
}: BarProps) {
  const [view, setView] = useState(initialView)
  const [previewSize, setPreviewSize] = useState(initialPreviewSize)
  const store = useCollectionPreviewStore({
    collection:
      previews !== undefined && props.state.status === 'ready'
        ? props.state.collection
        : null,
    loaders: previews?.loaders ?? NO_LOADERS,
    genes: previews?.genes ?? [],
    scoreMode: previews?.scoreMode ?? 'sum',
    annotationGroupId: previews?.annotations?.groupId ?? null,
    paused: previews?.paused ?? false,
  })

  return (
    <CollectionBar
      {...props}
      view={view}
      onViewChange={(next) => {
        setView(next)
        onViewChange?.(next)
      }}
      previewSize={{
        value: previewSize,
        onChange: (next) => {
          setPreviewSize(next)
          onPreviewSizeChange?.(next)
        },
      }}
      {...(previews === undefined
        ? {}
        : {
            previews: {
              store,
              genes: previews.genes,
              colorScale: previews.colorScale,
              ...(previews.scaleRange === undefined
                ? {}
                : { scaleRange: previews.scaleRange }),
              annotations: previews.annotations,
            },
          })}
    />
  )
}

describe('CollectionBar', () => {
  it('lists the datasets by group and marks the open and loading ones', () => {
    const onSelect = vi.fn()
    render(
      <Bar
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

  it('offers registered sections beside the open one, up to the limit', () => {
    const registered = parseDatasetCollection(
      {
        version: 1,
        datasets: ['s1', 's2', 's3', 's4', 's5'].map((name) => ({
          dataset: `${name}.zarr`,
          name,
          coordinateSystem: 'cord',
        })),
      },
      COLLECTION_URL,
    )
    const [s1, s2, s3, s4, s5] = registered.datasets
    const onToggle = vi.fn()
    const { rerender } = render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: registered }}
        loadedUrl={s1!.url}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        beside={{ shown: [s2!], onToggle }}
      />,
    )

    const bar = screen.getByRole('navigation', { name: 'Collection' })
    // Not on the open section itself.
    expect(
      within(bar).queryByRole('button', { name: 'Show s1 beside' }),
    ).not.toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Show s2 beside' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(bar).getByRole('button', { name: 's2' })).toHaveAttribute(
      'data-beside',
      'true',
    )
    fireEvent.click(within(bar).getByRole('button', { name: 'Show s3 beside' }))
    expect(onToggle).toHaveBeenCalledWith(s3)

    // With three shown, the others wait until one closes.
    rerender(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: registered }}
        loadedUrl={s1!.url}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        beside={{ shown: [s2!, s3!, s4!], onToggle }}
      />,
    )
    const full = within(bar).getByRole('button', { name: 'Show s5 beside' })
    expect(full).toBeDisabled()
    expect(full).toHaveAttribute('title', expect.stringContaining('Up to 3 sections'))
    expect(within(bar).getByRole('button', { name: 'Show s4 beside' })).toBeEnabled()
    expect(s5).toBeDefined()
  })

  // A new button would lose focus, and the bar's observer, which marks the
  // previews to read, would go on watching the old one.
  it('keeps each section button, and its focus, as the open section changes', () => {
    const registered = parseDatasetCollection(
      {
        version: 1,
        datasets: ['s1', 's2', 's3'].map((name) => ({
          dataset: `${name}.zarr`,
          name,
          coordinateSystem: 'cord',
        })),
      },
      COLLECTION_URL,
    )
    const [s1, , s3] = registered.datasets
    const bar = (loadedUrl: string | null) => (
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: registered }}
        loadedUrl={loadedUrl}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        beside={{ shown: [], onToggle: vi.fn() }}
      />
    )
    const { rerender } = render(bar(null))
    const button = screen.getByRole('button', { name: 's3' })
    button.focus()

    // s3 can be shown beside s1 once s1 opens, and not once s3 itself opens.
    rerender(bar(s1!.url))
    expect(screen.getByRole('button', { name: 'Show s3 beside' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 's3' })).toBe(button)
    rerender(bar(s3!.url))
    expect(
      screen.queryByRole('button', { name: 'Show s3 beside' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 's3' })).toBe(button)
    expect(button).toHaveFocus()
  })

  // The name was shown as the address encodes it (EXP-246).
  it('names a collection without a name by its file name as it reads', () => {
    render(
      <Bar
        state={{
          status: 'loading',
          url: 'https://example.test/My%20Study/spinal%20cord.json',
        }}
        loadedUrl={null}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('spinal cord.json')).toBeTruthy()
  })

  it('says when the collection is being read or cannot be opened', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Bar
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
      <Bar
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

  function renderBar(previews: TestPreviews) {
    return render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        previews={previews}
      />,
    )
  }

  it('previews each dataset up to its own top for the selected genes', async () => {
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

    expect(await within(shamA).findByText('top 3')).toBeInTheDocument()
    expect(
      await within(within(bar).getByRole('button', { name: 'Sham B' })).findByText(
        'top 8',
      ),
    ).toBeInTheDocument()
    expect(shamA).toHaveAttribute(
      'title',
      "Sham A is open; top colour from 3, the 99th percentile of the preview's pixels; highest score 3",
    )
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        'No cells to preview',
      ),
    ).toBeInTheDocument()

    const scale = bar.querySelector('.collection-bar-scale')
    expect(scale).toHaveTextContent('Aqp4')
    expect(scale).toHaveTextContent('0p99')
    expect(scale?.getAttribute('title')).toMatch(/^Each preview runs up to its own 99th/)
  })

  it('puts every preview on one scale when the top is a score', async () => {
    renderBar({
      loaders: previewLoaders(),
      genes: ['Aqp4'],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: null,
      paused: false,
      scaleRange: { min: null, max: 20 },
    })
    const bar = screen.getByRole('navigation', { name: 'Collection' })
    const shamA = within(bar).getByRole('button', { name: 'Sham A' })

    expect(await within(shamA).findByText('max 3')).toBeInTheDocument()
    expect(shamA).toHaveAttribute('title', 'Sham A is open; highest score 3')
    const scale = bar.querySelector('.collection-bar-scale')
    expect(scale).toHaveTextContent('020')
    expect(scale).toHaveAttribute(
      'title',
      'Every preview uses this scale, the range set in Gene scale',
    )
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

    // Each of the three opens its dataset, then asks for it again to read
    // the cells.
    await waitFor(() => {
      expect(loaders.getSpatialDataset).toHaveBeenCalledTimes(6)
    })
    expect(bar.querySelector('.collection-bar-scale')).toBe(null)
    expect(within(bar).queryByText(/^(max|top) /)).toBe(null)

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
    const onViewChange = vi.fn()
    render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={onSelect}
        onClose={vi.fn()}
        onViewChange={onViewChange}
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
    expect(expand).toHaveAttribute('title', expect.stringContaining('in a grid'))
    // Next to the kicker, as icons.
    expect(bar.querySelector('.collection-bar-title')).toContainElement(expand)
    expect(expand).toHaveTextContent('')

    fireEvent.click(expand)

    expect(bar).toHaveClass('is-expanded')
    const collapse = within(bar).getByRole('button', { name: 'Collapse' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(await within(bar).findByText('top 8')).toBeInTheDocument()

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
    expect(within(bar).getByRole('button', { name: 'Expand' })).toBeDisabled()

    // Each change is reported, for the link.
    expect(onViewChange.mock.calls.map(([view]) => view)).toEqual([
      'grid',
      'row',
      'grid',
      'row',
      'grid',
      'names',
    ])

    // Turned back on, the previews return to the row.
    fireEvent.click(within(bar).getByRole('button', { name: 'Previews' }))
    expect(onViewChange).toHaveBeenLastCalledWith('row')
    expect(bar).not.toHaveClass('is-expanded')
  })

  it('sizes the grid previews with its Size slider', async () => {
    const onPreviewSizeChange = vi.fn()
    render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        initialPreviewSize={240}
        onPreviewSizeChange={onPreviewSizeChange}
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
    // In a row the previews keep their size.
    expect(within(bar).queryByRole('slider')).toBe(null)

    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }))

    const slider = within(bar).getByRole('slider', { name: 'Preview size' })
    expect(slider).toHaveValue('240')
    expect(slider).toHaveAttribute('aria-valuetext', '240 px wide')
    expect(bar.style.getPropertyValue('--collection-preview-size')).toBe('240px')
    expect(await within(bar).findByText('top 8')).toBeInTheDocument()

    fireEvent.change(slider, { target: { value: '400' } })

    expect(onPreviewSizeChange).toHaveBeenLastCalledWith(400)
    expect(slider).toHaveAttribute('aria-valuetext', '400 px wide')
    expect(bar.style.getPropertyValue('--collection-preview-size')).toBe('400px')

    // Collapsed, the slider goes; expanded again, the size is kept.
    fireEvent.click(within(bar).getByRole('button', { name: 'Collapse' }))
    expect(within(bar).queryByRole('slider')).toBe(null)
    fireEvent.click(within(bar).getByRole('button', { name: 'Expand' }))
    expect(within(bar).getByRole('slider', { name: 'Preview size' })).toHaveValue('400')
  })

  it("opens in the link's view", async () => {
    const onSelect = vi.fn()
    const onViewChange = vi.fn()
    const previews: TestPreviews = {
      loaders: previewLoaders(),
      genes: ['Aqp4'],
      scoreMode: 'sum',
      colorScale: 'plasma',
      annotations: null,
      paused: false,
    }
    const { unmount } = render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        initialView="grid"
        previews={previews}
      />,
    )
    const grid = screen.getByRole('navigation', { name: 'Collection' })
    expect(grid).toHaveClass('is-expanded')
    expect(within(grid).getByRole('button', { name: 'Collapse' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(await within(grid).findByText('max 8')).toBeInTheDocument()
    unmount()

    render(
      <Bar
        state={{ status: 'ready', url: COLLECTION_URL, collection: COLLECTION }}
        loadedUrl={SHAM_A}
        pendingUrl={null}
        onSelect={onSelect}
        onClose={vi.fn()}
        initialView="names"
        onViewChange={onViewChange}
        previews={previews}
      />,
    )
    const names = screen.getByRole('navigation', { name: 'Collection' })
    expect(within(names).getByRole('button', { name: 'Previews' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(names).getByRole('button', { name: 'Expand' })).toBeDisabled()
    expect(names.querySelector('canvas')).toBe(null)

    // Choosing a dataset keeps the names.
    fireEvent.click(within(names).getByRole('button', { name: 'Sham B' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ url: SHAM_B }))
    expect(onViewChange).not.toHaveBeenCalled()
    expect(names.querySelector('canvas')).toBe(null)
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
    expect(within(bar).queryByText(/^(max|top) /)).toBe(null)
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
      <Bar
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
    expect(await screen.findByText('top 3')).toBeInTheDocument()
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
