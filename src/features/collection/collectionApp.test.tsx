import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { imagePixels, micrometers } from '../../data/coords'
import { clearDatasetImages } from '../../data/datasetFiles'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  createSpatialDatasetLoaderMock,
  openControls,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'
import type { SpatialDatasetDetector } from '../app-shell/appDependencies'

interface MockViewState {
  readonly target?: readonly number[]
  readonly zoom?: number
}
type MockViewStateChange = (info: { readonly viewState: MockViewState }) => void

// The camera ViewerCore gives deck.gl, and that of a section shown beside it.
const deckView = vi.hoisted(() => ({
  current: undefined as MockViewState | undefined,
  onChange: undefined as MockViewStateChange | undefined,
  linked: undefined as MockViewState | undefined,
  onLinkedChange: undefined as MockViewStateChange | undefined,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    viewState,
    views,
    onViewStateChange,
  }: {
    readonly viewState?: MockViewState
    readonly views?: { readonly id?: string }
    readonly onViewStateChange?: MockViewStateChange
  }) => {
    if (views?.id === 'linked-section') {
      deckView.linked = viewState
      deckView.onLinkedChange = onViewStateChange
    } else {
      deckView.current = viewState
      deckView.onChange = onViewStateChange
    }
    return <div data-testid="deckgl" />
  },
}))

const COLLECTION_URL = 'https://example.test/injury/collection.json'
const SHAM_A = 'https://example.test/injury/sham-a.h5ad'
const DPI_A = 'https://example.test/injury/1dpi-a.h5ad'
const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    name: 'Injury time course',
    datasets: [
      { dataset: 'sham-a.h5ad', name: 'Sham A', group: 'Sham' },
      { dataset: '1dpi-a.h5ad', name: '1 dpi A', group: '1 dpi' },
    ],
    defaults: { genes: ['Aqp4'] },
  },
  COLLECTION_URL,
)

function TestApp(props: AppTestDependencyProps) {
  return <App dependencies={appTestDependencies(props)} />
}

// An H5AD with two cells and a two-gene panel.
function h5adDataset() {
  return {
    overview: vi.fn(async () => [
      { cellId: 'cell-a', position: { x: micrometers(0), y: micrometers(0) } },
      { cellId: 'cell-b', position: { x: micrometers(10), y: micrometers(10) } },
    ]),
    genePanel: vi.fn(async () => ['Aqp4', 'Gfap']),
    annotationGroups: vi.fn(async () => []),
    annotations: vi.fn(async () => []),
    metadataTracks: vi.fn(async () => []),
    embeddingOptions: vi.fn(async () => []),
    embeddings: vi.fn(async () => []),
    // Each selected gene counts 1 in the first cell.
    geneExpression: vi.fn(async (_bbox: unknown, genes: readonly string[]) => ({
      genes,
      maxCount: genes.length,
      elements: [
        {
          id: 'cell-a',
          position: { x: micrometers(0), y: micrometers(0) },
          count: genes.length,
        },
      ],
    })),
  }
}

const detectSpatialDataset: SpatialDatasetDetector = async (baseUrl) => ({
  platform: 'h5ad',
  baseUrl,
  h5adUrl: baseUrl,
  checked: [],
})

describe('App with a dataset collection', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useViewerStore.setState(initialViewerState)
    // Previews ask a plain .h5ad for its size; never the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { headers: { 'content-length': '1000' } })),
    )
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    vi.unstubAllGlobals()
    clearDatasetImages()
  })

  it('opens the first dataset with the defaults and keeps the genes when switching', async () => {
    window.history.replaceState(null, '', `/?collection=${COLLECTION_URL}`)
    const loadCollection = vi.fn(async () => COLLECTION)

    render(
      <TestApp
        loadCollection={loadCollection}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
      />,
    )

    const bar = await screen.findByRole('navigation', { name: 'Collection' })
    // The link opens a dataset, so the start screen stays away.
    expect(
      screen.queryByRole('heading', { name: 'Open a dataset' }),
    ).not.toBeInTheDocument()
    expect(await within(bar).findByRole('button', { name: 'Sham A' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(loadCollection).toHaveBeenCalledWith(COLLECTION_URL, expect.anything())
    expect(useViewerStore.getState().datasetUrl).toBe(SHAM_A)
    expect(await screen.findByRole('button', { name: 'Remove Aqp4' })).toBeInTheDocument()

    // Each dataset is previewed with the selected gene.
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        'top 1',
      ),
    ).toBeInTheDocument()

    // The user adds a gene, then steps to the next section.
    openControls('genes')
    fireEvent.click(screen.getByRole('button', { name: 'Gfap' }))
    expect(await screen.findByRole('button', { name: 'Remove Gfap' })).toBeInTheDocument()
    // The previews follow: both genes count in the first cell.
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        'top 2',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))

    expect(await within(bar).findByRole('button', { name: '1 dpi A' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(useViewerStore.getState().datasetUrl).toBe(DPI_A)
    expect(screen.getByRole('button', { name: 'Remove Aqp4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Gfap' })).toBeInTheDocument()
    // The top bar names the entry, which has no manifest.
    await waitFor(() => {
      expect(document.title).toBe('1 dpi A · Spatial Omics Explorer')
    })

    // The address keeps the collection with the open dataset.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    const hash = new URLSearchParams(window.location.hash.slice(1))
    expect(hash.get('collection')).toBe(COLLECTION_URL)
    expect(hash.get('dataset')).toBe(DPI_A)
    expect(hash.get('genes')).toBe('Aqp4,Gfap')
    expect(window.location.search).toBe('')

    // Closing the bar keeps the dataset.
    fireEvent.click(within(bar).getByRole('button', { name: 'Close Collection' }))
    expect(
      screen.queryByRole('navigation', { name: 'Collection' }),
    ).not.toBeInTheDocument()
    expect(document.title).toBe('1dpi-a.h5ad · Spatial Omics Explorer')
  })

  it('keeps the dataset shown open, and lets it go once another is shown', async () => {
    window.history.replaceState(null, '', `/?collection=${COLLECTION_URL}`)
    const retained = new Map<string, number>()
    const retainDataset = vi.fn((url: string) => {
      retained.set(url, (retained.get(url) ?? 0) + 1)
      return () => retained.set(url, (retained.get(url) ?? 0) - 1)
    })

    render(
      <TestApp
        loadCollection={async () => COLLECTION}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        retainDataset={retainDataset}
      />,
    )

    const bar = await screen.findByRole('navigation', { name: 'Collection' })
    expect(await within(bar).findByRole('button', { name: 'Sham A' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await waitFor(() => expect(retained.get(SHAM_A)).toBe(1))

    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))

    expect(await within(bar).findByRole('button', { name: '1 dpi A' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    // Previews retain only while they read, so only the shown one stays.
    await waitFor(() => {
      expect(retained.get(DPI_A)).toBe(1)
      expect(retained.get(SHAM_A)).toBe(0)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(retained.get(DPI_A)).toBe(1)
  })

  it('fits the next dataset rather than keeping the link view', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}&view=900%2C900%2C0%2C3`,
    )

    render(
      <TestApp
        loadCollection={async () => COLLECTION}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
      />,
    )

    const bar = await screen.findByRole('navigation', { name: 'Collection' })
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: 'Sham A' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    // The link's view is for the dataset it names.
    expect(deckView.current?.target?.slice(0, 2)).toEqual([900, 900])

    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: '1 dpi A' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })

    // The two cells span 0 to 10 µm, so the fitted view centres on them.
    await waitFor(() => {
      expect(deckView.current?.target?.[0]).toBeCloseTo(5)
    })
  })

  it("keeps the bar's grid and previews in the address", async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}&collectionView=grid`,
    )

    render(
      <TestApp
        loadCollection={async () => COLLECTION}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
      />,
    )

    const bar = await screen.findByRole('navigation', { name: 'Collection' })
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: 'Sham A' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    // The link's grid, kept while the dataset loads.
    expect(bar).toHaveClass('is-expanded')
    const hashAfterWrite = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      return new URLSearchParams(window.location.hash.slice(1))
    }
    expect((await hashAfterWrite()).get('collectionView')).toBe('grid')

    // The row is the default, so the link leaves it out.
    fireEvent.click(within(bar).getByRole('button', { name: 'Collapse' }))
    expect(bar).not.toHaveClass('is-expanded')
    expect((await hashAfterWrite()).has('collectionView')).toBe(false)

    fireEvent.click(within(bar).getByRole('button', { name: 'Previews' }))
    expect((await hashAfterWrite()).get('collectionView')).toBe('names')

    // Closed, the collection leaves the link with its view.
    fireEvent.click(within(bar).getByRole('button', { name: 'Close Collection' }))
    const closed = await hashAfterWrite()
    expect(closed.has('collection')).toBe(false)
    expect(closed.has('collectionView')).toBe(false)
  })

  it('keeps the annotation set, its hidden classes and colours when switching', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}&cellColor=annotations&groups=analysis%3Atype&hiddenClasses=analysis%3Atype%3Aneuron`,
    )
    const astro = { id: 'analysis:type:astro', label: 'type: astro' }
    const neuron = { id: 'analysis:type:neuron', label: 'type: neuron' }
    const datasetFor = (url: string) => ({
      ...h5adDataset(),
      annotationGroups: vi.fn(async () => [
        { id: 'analysis:type', label: 'type', groupingName: 'type', groupCount: 2 },
      ]),
      // The second section lists its classes the other way round, so its
      // own colours would swap.
      annotations: vi.fn(async () =>
        url === SHAM_A
          ? [
              { ...astro, cellIds: ['cell-a'] },
              { ...neuron, cellIds: ['cell-b'] },
            ]
          : [
              { ...neuron, cellIds: ['cell-a'] },
              { ...astro, cellIds: ['cell-b'] },
            ],
      ),
    })
    const datasets = new Map([SHAM_A, DPI_A].map((url) => [url, datasetFor(url)]))

    render(
      <TestApp
        loadCollection={async () => COLLECTION}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={vi.fn(async (url: string) => datasets.get(url) as never)}
      />,
    )

    const bar = await screen.findByRole('navigation', { name: 'Collection' })
    openControls('clusters')
    // Wait for the load with a cheap check. A label query walks the whole
    // document for each element, and repeated on every change while the
    // dataset loads it took most of the 1 s limit.
    await waitFor(() => {
      expect(datasets.get(SHAM_A)?.annotations).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'analysis:type' }),
      )
    })
    const astroColor = await screen.findByLabelText('type: astro color')
    await waitFor(() => {
      expect(screen.getByLabelText('type: neuron visible')).not.toBeChecked()
    })
    fireEvent.change(astroColor, { target: { value: '#123456' } })
    const neuronColor = (screen.getByLabelText('type: neuron color') as HTMLInputElement)
      .value
    // The previews colour by the set, counting the cells of the shown class.
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        '1 cell',
      ),
    ).toBeInTheDocument()

    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: '1 dpi A' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    await waitFor(() => {
      expect(datasets.get(DPI_A)?.annotations).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'analysis:type' }),
      )
    })

    openControls('clusters')
    await waitFor(() => {
      expect(screen.getByLabelText('type: astro color')).toHaveValue('#123456')
    })
    expect(screen.getByLabelText('type: neuron color')).toHaveValue(neuronColor)
    expect(screen.getByLabelText('type: neuron visible')).not.toBeChecked()
    expect(screen.getByLabelText('type: astro visible')).toBeChecked()
    await waitFor(() => {
      const hash = new URLSearchParams(window.location.hash.slice(1))
      expect(hash.get('dataset')).toBe(DPI_A)
      expect(hash.get('cellColor')).toBe('annotations')
      expect(hash.get('groups')).toBe('analysis:type')
      expect(hash.get('hiddenClasses')).toBe('analysis:type:neuron')
    })

    // An Alt-click on the only class shown shows every class again, and on
    // another class shows only that one.
    fireEvent.click(screen.getByLabelText('type: astro visible'), { altKey: true })
    expect(screen.getByLabelText('type: neuron visible')).toBeChecked()
    expect(screen.getByLabelText('type: astro visible')).toBeChecked()
    fireEvent.click(screen.getByLabelText('type: neuron visible'), { altKey: true })
    expect(screen.getByLabelText('type: neuron visible')).toBeChecked()
    expect(screen.getByLabelText('type: astro visible')).not.toBeChecked()
  })

  describe('with registered sections', () => {
    const SECTION_1 = 'https://example.test/cord/s1.h5ad'
    const SECTION_2 = 'https://example.test/cord/s2.h5ad'
    const REGISTERED = parseDatasetCollection(
      {
        version: 1,
        datasets: [
          { dataset: 's1.h5ad', name: 'Section 1', coordinateSystem: 'cord' },
          { dataset: 's2.h5ad', name: 'Section 2', coordinateSystem: 'cord' },
          { dataset: 'atlas.h5ad', name: 'Atlas' },
        ],
      },
      'https://example.test/cord/collection.json',
    )
    const hashAfterWrite = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      return new URLSearchParams(window.location.hash.slice(1))
    }

    afterEach(() => {
      deckView.linked = undefined
      deckView.onLinkedChange = undefined
    })

    it('shows a section beside the open one, with one view, and swaps them', async () => {
      window.history.replaceState(
        null,
        '',
        `/?collection=${encodeURIComponent(REGISTERED.url)}`,
      )

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      const bar = await screen.findByRole('navigation', { name: 'Collection' })
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Section 1' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      // Only a section registered to the open one can be shown beside it.
      expect(
        within(bar).queryByRole('button', { name: 'Show Atlas beside' }),
      ).not.toBeInTheDocument()
      const toggle = within(bar).getByRole('button', { name: 'Show Section 2 beside' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      // The panel draws once its cells are read, at the main view's camera.
      await waitFor(() => {
        expect(deckView.linked?.target).toEqual(deckView.current?.target)
      })
      expect(deckView.linked?.zoom).toBe(deckView.current?.zoom)

      // Panning the main view moves the panel, and the other way round.
      act(() => {
        deckView.onChange?.({ viewState: { target: [3, -4, 0], zoom: 2 } })
      })
      expect(deckView.linked).toMatchObject({ target: [3, -4, 0], zoom: 2 })
      act(() => {
        deckView.onLinkedChange?.({ viewState: { target: [7, -1, 0], zoom: 3 } })
      })
      expect(deckView.current).toMatchObject({ target: [7, -1, 0], zoom: 3 })

      expect((await hashAfterWrite()).getAll('compare')).toEqual([SECTION_2])

      // Opening the panel's section swaps it with the open one, at the same
      // view: the sections are registered.
      fireEvent.click(within(panel).getByRole('button', { name: 'Open' }))
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Section 2' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      expect(await screen.findByRole('region', { name: 'Section 1' })).toBeInTheDocument()
      expect(deckView.current).toMatchObject({ target: [7, -1, 0], zoom: 3 })
      const swapped = await hashAfterWrite()
      expect(swapped.get('dataset')).toBe(SECTION_2)
      expect(swapped.getAll('compare')).toEqual([SECTION_1])

      // A dataset outside the coordinate system closes the panels and fits.
      fireEvent.click(within(bar).getByRole('button', { name: 'Atlas' }))
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Atlas' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      expect(screen.queryByRole('region', { name: 'Section 1' })).not.toBeInTheDocument()
      await waitFor(() => {
        expect(deckView.current?.target?.[0]).toBeCloseTo(5)
      })
      expect((await hashAfterWrite()).has('compare')).toBe(false)
    })

    it("opens the link's sections side by side at its view, and closes one", async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}&view=900%2C900%2C0%2C3`,
      )

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      await waitFor(() => {
        expect(deckView.linked).toMatchObject({ target: [900, 900, 0], zoom: 3 })
      })

      fireEvent.click(within(panel).getByRole('button', { name: 'Close Section 2' }))
      expect(screen.queryByRole('region', { name: 'Section 2' })).not.toBeInTheDocument()
      const bar = screen.getByRole('navigation', { name: 'Collection' })
      expect(
        within(bar).getByRole('button', { name: 'Show Section 2 beside' }),
      ).toHaveAttribute('aria-pressed', 'false')
      expect((await hashAfterWrite()).has('compare')).toBe(false)
    })

    it('keeps a section closed on reload when the query string named it', async () => {
      window.history.replaceState(
        null,
        '',
        `/?collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}&debug=1`,
      )
      const app = (
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />
      )
      const { unmount } = render(app)

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      fireEvent.click(within(panel).getByRole('button', { name: 'Close Section 2' }))
      expect((await hashAfterWrite()).has('compare')).toBe(false)
      // The hash holds the link; the query string keeps only what it is not.
      expect(window.location.search).toBe('?debug=1')

      // Reload.
      unmount()
      useViewerStore.setState(initialViewerState)
      render(app)

      const bar = await screen.findByRole('navigation', { name: 'Collection' })
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Section 1' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      expect(
        within(bar).getByRole('button', { name: 'Show Section 2 beside' }),
      ).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('region', { name: 'Section 2' })).not.toBeInTheDocument()
    })
  })

  it('opens a linked dataset over the image and labels its entry names', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}`,
    )
    const imageUrl = 'https://example.test/injury/sham-a-raw.zarr'
    const collection = parseDatasetCollection(
      {
        version: 1,
        datasets: [
          {
            dataset: 'sham-a.h5ad',
            image: 'sham-a-raw.zarr',
            labels: 'sham-a-label.zarr',
            coordinates: 'image-pixels',
            name: 'Sham A',
          },
          { dataset: '1dpi-a.h5ad', name: '1 dpi A' },
        ],
      },
      COLLECTION_URL,
    )
    let readCollection: (value: typeof collection) => void = () => undefined
    const loadCollection = vi.fn(
      () =>
        new Promise<typeof collection>((resolve) => {
          readCollection = resolve
        }),
    )
    const loader = imageLoaderFixture(imageUrl)
    const dataset = {
      ...h5adDataset(),
      image: vi.fn(async () => ({ kind: 'pyramid' as const, loader })),
    }
    const detect = vi.fn(detectSpatialDataset)

    render(
      <TestApp
        loadCollection={loadCollection}
        detectSpatialDataset={detect}
        getSpatialDataset={createSpatialDatasetLoaderMock(dataset)}
        computeAutoChannelContrast={vi.fn(async () => ({
          min: 0,
          max: 255,
          histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
        }))}
      />,
    )

    // The dataset waits for the collection that pairs it with an image.
    await waitFor(() => {
      expect(loadCollection).toHaveBeenCalled()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(detect).not.toHaveBeenCalled()

    act(() => {
      readCollection(collection)
    })

    await waitFor(() => {
      expect(dataset.image).toHaveBeenCalledTimes(1)
    })
    openControls('image')
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'DAPI' })).toBeChecked()
    })
    // Its labels are its cell boundaries, shown by default.
    openControls('cell-appearance')
    expect(screen.getByLabelText('Cell boundaries')).toBeChecked()

    // The next section has no image.
    const bar = screen.getByRole('navigation', { name: 'Collection' })
    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: '1 dpi A' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'DAPI' })).not.toBeInTheDocument()
    })
    expect(dataset.image).toHaveBeenCalledTimes(1)
    openControls('cell-appearance')
    expect(screen.getByLabelText('Cell boundaries')).not.toBeChecked()
  })

  it('shows the start screen when the collection cannot be read', async () => {
    window.history.replaceState(null, '', `/?collection=${COLLECTION_URL}`)

    render(
      <TestApp
        loadCollection={async () => {
          throw new Error('collection.json: the file answered HTTP 404.')
        }}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The collection could not be opened. collection.json: the file answered HTTP 404.',
    )
    expect(screen.getByRole('heading', { name: 'Open a dataset' })).toBeInTheDocument()
  })
})

function imageLoaderFixture(url: string): ImagePyramidLoader {
  return {
    url,
    imageWidth: imagePixels(160),
    imageHeight: imagePixels(80),
    tileWidth: imagePixels(256),
    tileHeight: imagePixels(256),
    numLevels: 1,
    tilesForLevel: () => [{ col: 0, row: 0 }],
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(0.5),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    channels: [
      {
        id: 'Channel:0',
        index: 0,
        name: 'DAPI',
        color: [88, 144, 255],
        contrast: { min: 0, max: 255 },
      },
    ],
  } as unknown as ImagePyramidLoader
}
