import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { imagePixels, micrometers } from '../../data/coords'
import { clearCollectionDatasets } from '../../data/datasetFiles'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  createSpatialDatasetLoaderMock,
  openControls,
  pendingPromise,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'
import type {
  SpatialDatasetDetector,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'

interface MockViewState {
  readonly target?: readonly number[]
  readonly zoom?: number
}
type MockViewStateChange = (info: { readonly viewState: MockViewState }) => void
type MockHover = (info: {
  readonly index: number
  readonly layer: { readonly id: string }
  readonly object?: { readonly id: string }
  readonly x: number
  readonly y: number
}) => void

// The camera ViewerCore gives deck.gl, and that of a section shown beside it.
const deckView = vi.hoisted(() => ({
  current: undefined as MockViewState | undefined,
  onChange: undefined as MockViewStateChange | undefined,
  linked: undefined as MockViewState | undefined,
  onLinkedChange: undefined as MockViewStateChange | undefined,
  onLinkedHover: undefined as MockHover | null | undefined,
  // The layer IDs of a section beside.
  linkedLayerIds: undefined as readonly string[] | undefined,
  // The layer IDs of the sections stacked in 3D.
  stackLayerIds: undefined as readonly string[] | undefined,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    viewState,
    views,
    layers,
    onViewStateChange,
    onHover,
  }: {
    readonly viewState?: MockViewState
    readonly views?: { readonly id?: string }
    readonly layers?: readonly { readonly id: string }[]
    readonly onViewStateChange?: MockViewStateChange
    readonly onHover?: MockHover | null
  }) => {
    if (views?.id === 'section-stack') {
      deckView.stackLayerIds = layers?.map((layer) => layer.id)
    } else if (views?.id === 'linked-section') {
      deckView.linked = viewState
      deckView.onLinkedChange = onViewStateChange
      deckView.onLinkedHover = onHover
      deckView.linkedLayerIds = layers?.map((layer) => layer.id)
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
    clearCollectionDatasets()
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

  it('applies the link view once, not again when its dataset loads again', async () => {
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

    await waitFor(() => {
      expect(deckView.current?.target?.slice(0, 2)).toEqual([900, 900])
    })

    // Load Dataset again, as a view change reloads the open dataset.
    openControls('open-dataset')
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    // Fitted to the two cells (0 to 10 µm), not the link's view again.
    await waitFor(() => {
      expect(deckView.current?.target?.[0]).toBeCloseTo(5)
    })
  })

  // The bar marked as loading whatever the address field held, and then
  // ignored clicks on it (EXP-244).
  it('marks as loading the dataset being opened, not what the address field holds', async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}`,
    )
    // From the click on, 1 dpi A never answers, as a slow server.
    let hold = false
    const detect: SpatialDatasetDetector = async (baseUrl) =>
      hold && baseUrl === DPI_A ? pendingPromise() : detectSpatialDataset(baseUrl)

    render(
      <TestApp
        loadCollection={async () => COLLECTION}
        detectSpatialDataset={detect}
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
    hold = true
    fireEvent.click(within(bar).getByRole('button', { name: '1 dpi A' }))
    await waitFor(() => {
      expect(within(bar).getByRole('button', { name: '1 dpi A' })).toHaveAttribute(
        'aria-busy',
        'true',
      )
    })

    openControls('open-dataset')
    fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
      target: { value: SHAM_A },
    })

    expect(within(bar).getByRole('button', { name: 'Sham A' })).not.toHaveAttribute(
      'aria-busy',
    )
    expect(within(bar).getByRole('button', { name: '1 dpi A' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it("keeps the bar's grid, its preview size and previews in the address", async () => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&collection=${encodeURIComponent(COLLECTION_URL)}&dataset=${encodeURIComponent(SHAM_A)}&collectionView=grid&collectionPreviewSize=240`,
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
    const size = within(bar).getByRole('slider', { name: 'Preview size' })
    expect(size).toHaveValue('240')
    expect((await hashAfterWrite()).get('collectionPreviewSize')).toBe('240')
    fireEvent.change(size, { target: { value: '320' } })
    expect((await hashAfterWrite()).get('collectionPreviewSize')).toBe('320')
    // The default size is left out.
    fireEvent.change(size, { target: { value: '150' } })
    expect((await hashAfterWrite()).has('collectionPreviewSize')).toBe(false)

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

  describe('with cells placed in 3D', () => {
    const STACK = 'https://example.test/skin/aligned_sections.h5ad'
    const hashAfterWrite = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      return new URLSearchParams(window.location.hash.slice(1))
    }

    // Two cells 60 µm apart in z, from a third column of obsm spatial.
    function deepDataset() {
      return {
        ...h5adDataset(),
        overview: vi.fn(async () => [
          { cellId: 'cell-a', position: { x: micrometers(0), y: micrometers(0) }, z: 0 },
          {
            cellId: 'cell-b',
            position: { x: micrometers(10), y: micrometers(10) },
            z: 60,
          },
        ]),
      }
    }

    it('shows the cells of one dataset in 3D at their z, in the link', async () => {
      window.history.replaceState(null, '', `/#xv=2&dataset=${encodeURIComponent(STACK)}`)

      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(deepDataset())}
        />,
      )

      openControls('cell-appearance')
      const viewGroup = await screen.findByRole('group', { name: 'Cell view' })
      fireEvent.click(within(viewGroup).getByRole('button', { name: '3D' }))

      const view = await screen.findByRole('region', { name: '3D cells' })
      expect(await within(view).findByText('2 cells, z 0 to 60 µm')).toBeInTheDocument()
      await waitFor(() => {
        expect(deckView.stackLayerIds).toEqual(['section-stack-0-cells'])
      })
      expect((await hashAfterWrite()).get('cellView')).toBe('3d')

      // Colouring by a gene draws the scoring cells over the others.
      openControls('genes')
      fireEvent.click(screen.getByRole('button', { name: 'Aqp4' }))
      await waitFor(() => {
        expect(deckView.stackLayerIds).toEqual([
          'section-stack-0-scored',
          'section-stack-0-context',
        ])
      })

      fireEvent.click(within(view).getByRole('button', { name: '2D View' }))
      expect(screen.queryByRole('region', { name: '3D cells' })).not.toBeInTheDocument()
      expect((await hashAfterWrite()).has('cellView')).toBe(false)
    })

    it('opens a link’s 3D view, and offers none for cells in a plane', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&dataset=${encodeURIComponent(STACK)}&cellView=3d`,
      )

      const { unmount } = render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(deepDataset())}
        />,
      )

      expect(await screen.findByRole('region', { name: '3D cells' })).toBeInTheDocument()
      unmount()

      window.history.replaceState(
        null,
        '',
        `/#xv=2&dataset=${encodeURIComponent(SHAM_A)}&cellView=3d`,
      )
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      // Once the gene panel is read, the cells are too.
      openControls('genes')
      expect(await screen.findByRole('button', { name: 'Aqp4' })).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Cell view' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '3D cells' })).not.toBeInTheDocument()
      expect((await hashAfterWrite()).has('cellView')).toBe(false)
    })
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
      deckView.onLinkedHover = undefined
      deckView.linkedLayerIds = undefined
      deckView.stackLayerIds = undefined
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
      // Every other entry can be shown beside it; one that is not
      // registered to it has a view of its own.
      expect(
        within(bar).getByRole('button', { name: 'Show Atlas beside' }),
      ).toHaveAttribute(
        'title',
        'Show Atlas beside the open dataset, with a view of its own',
      )
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

      // A dataset outside the coordinate system opens fitted; the panel stays
      // where it was, unlinked.
      fireEvent.click(within(bar).getByRole('button', { name: 'Atlas' }))
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Atlas' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      const kept = screen.getByRole('region', { name: 'Section 1' })
      expect(
        within(kept).getByRole('button', { name: 'Link Section 1 to the main view' }),
      ).toHaveAttribute('aria-pressed', 'false')
      await waitFor(() => {
        expect(deckView.current?.target?.[0]).toBeCloseTo(5)
      })
      expect(deckView.linked).toMatchObject({ target: [7, -1, 0], zoom: 3 })
      const atlas = await hashAfterWrite()
      expect(atlas.getAll('compare')).toEqual([SECTION_1])
      expect(atlas.getAll('compareLink')).toEqual(['0,7,-1,3'])
    })

    it('keeps the sections beside the open dataset while the next one loads', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}`,
      )
      // From the click on, Section 2 never answers, as a slow server.
      let hold = false
      const detect: SpatialDatasetDetector = async (baseUrl) =>
        hold && baseUrl === SECTION_2 ? pendingPromise() : detectSpatialDataset(baseUrl)

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detect}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      const bar = screen.getByRole('navigation', { name: 'Collection' })
      hold = true
      fireEvent.click(within(panel).getByRole('button', { name: 'Open' }))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
      })

      // Section 1 is still open, with Section 2 beside it.
      expect(within(bar).getByRole('button', { name: 'Section 1' })).toHaveAttribute(
        'aria-current',
        'true',
      )
      expect(screen.getByRole('region', { name: 'Section 2' })).toBeInTheDocument()
      expect((await hashAfterWrite()).getAll('compare')).toEqual([SECTION_2])
    })

    it('keeps the open dataset when a section is opened in the commit that shows it', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}`,
      )
      let hold = false
      const detect: SpatialDatasetDetector = async (baseUrl) =>
        hold && baseUrl === SECTION_2 ? pendingPromise() : detectSpatialDataset(baseUrl)
      // Clicks the panel's Open as soon as the commit that shows it ends,
      // before React's passive effects run, as a slow machine can (CI). A
      // load started then once thought nothing was open, and closed Section 1.
      const opened = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const panel = document.querySelector<HTMLElement>(
            'section[aria-label="Section 2"]',
          )
          const open =
            panel === null ? null : within(panel).queryByRole('button', { name: 'Open' })
          if (open === null) return

          observer.disconnect()
          hold = true
          fireEvent.click(open)
          resolve()
        })
        observer.observe(document.body, { childList: true, subtree: true })
      })

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detect}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      await opened
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
      })

      const bar = screen.getByRole('navigation', { name: 'Collection' })
      expect(within(bar).getByRole('button', { name: 'Section 1' })).toHaveAttribute(
        'aria-current',
        'true',
      )
      expect(screen.getByRole('region', { name: 'Section 2' })).toBeInTheDocument()
    })

    it('stacks serial sections in 3D, in the link, until a dataset outside opens', async () => {
      const stacked = parseDatasetCollection(
        {
          version: 1,
          datasets: [
            { dataset: 's1.h5ad', name: 'Section 1', coordinateSystem: 'cord', z: 0 },
            { dataset: 's2.h5ad', name: 'Section 2', coordinateSystem: 'cord', z: 10 },
            { dataset: 'atlas.h5ad', name: 'Atlas' },
          ],
        },
        'https://example.test/cord/collection.json',
      )
      window.history.replaceState(
        null,
        '',
        `/?collection=${encodeURIComponent(stacked.url)}`,
      )

      render(
        <TestApp
          loadCollection={async () => stacked}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      const bar = await screen.findByRole('navigation', { name: 'Collection' })
      const toggle = await within(bar).findByRole('button', { name: 'Stack in 3D' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      const stack = await screen.findByRole('region', { name: '3D section stack' })
      expect(within(stack).getByText('2 sections, z 0 to 10 µm')).toBeInTheDocument()
      // Both sections are read, the second though it was never previewed.
      await waitFor(() => {
        expect(deckView.stackLayerIds).toEqual([
          'section-stack-0-cells',
          'section-stack-1-cells',
        ])
      })
      expect((await hashAfterWrite()).get('sectionView')).toBe('3d')

      fireEvent.click(within(stack).getByRole('button', { name: '2D View' }))
      expect(
        screen.queryByRole('region', { name: '3D section stack' }),
      ).not.toBeInTheDocument()
      expect((await hashAfterWrite()).has('sectionView')).toBe(false)

      // Opening a section of the stack keeps it; the atlas opens in 2D.
      fireEvent.click(toggle)
      fireEvent.click(within(bar).getByRole('button', { name: 'Section 2' }))
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Section 2' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      expect(screen.getByRole('region', { name: '3D section stack' })).toBeInTheDocument()
      fireEvent.click(within(bar).getByRole('button', { name: 'Atlas' }))
      await waitFor(() => {
        expect(within(bar).getByRole('button', { name: 'Atlas' })).toHaveAttribute(
          'aria-current',
          'true',
        )
      })
      expect(
        screen.queryByRole('region', { name: '3D section stack' }),
      ).not.toBeInTheDocument()
      expect(
        within(bar).queryByRole('button', { name: 'Stack in 3D' }),
      ).not.toBeInTheDocument()
      expect((await hashAfterWrite()).has('sectionView')).toBe(false)
    })

    it('opens a link’s stack once its collection and dataset are read', async () => {
      const stacked = parseDatasetCollection(
        {
          version: 1,
          datasets: [
            { dataset: 's1.h5ad', name: 'Section 1', coordinateSystem: 'cord', z: 0 },
            { dataset: 's2.h5ad', name: 'Section 2', coordinateSystem: 'cord', z: 10 },
          ],
        },
        'https://example.test/cord/collection.json',
      )
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(stacked.url)}&dataset=${encodeURIComponent(SECTION_2)}&sectionView=3d`,
      )

      render(
        <TestApp
          loadCollection={async () => stacked}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      expect(
        await screen.findByRole('region', { name: '3D section stack' }),
      ).toBeInTheDocument()
      const bar = screen.getByRole('navigation', { name: 'Collection' })
      expect(within(bar).getByRole('button', { name: 'Stack in 3D' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect((await hashAfterWrite()).get('sectionView')).toBe('3d')
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

    it('unlinks a panel, links it again at its offset, and resets the offset', async () => {
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
      const link = within(panel).getByRole('button', {
        name: 'Link Section 2 to the main view',
      })
      const reset = within(panel).getByRole('button', {
        name: 'Reset the offset of Section 2',
      })
      expect(link).toHaveAttribute('aria-pressed', 'true')
      expect(reset).toBeDisabled()

      // Unlinked, the panel and the main view pan on their own.
      fireEvent.click(link)
      expect(link).toHaveAttribute('aria-pressed', 'false')
      act(() => {
        deckView.onLinkedChange?.({ viewState: { target: [910, 880, 0], zoom: 4 } })
      })
      expect(deckView.linked).toMatchObject({ target: [910, 880, 0], zoom: 4 })
      expect(deckView.current).toMatchObject({ target: [900, 900, 0], zoom: 3 })
      act(() => {
        deckView.onChange?.({ viewState: { target: [800, 800, 0], zoom: 3 } })
      })
      expect(deckView.linked).toMatchObject({ target: [910, 880, 0], zoom: 4 })
      // The address takes the panel's view once it rests.
      await waitFor(() => {
        expect(
          new URLSearchParams(window.location.hash.slice(1)).getAll('compareLink'),
        ).toEqual(['0,910,880,4'])
      })

      // Linked again where it is, it keeps its offset as they pan together.
      fireEvent.click(link)
      expect(link).toHaveAttribute('aria-pressed', 'true')
      act(() => {
        deckView.onChange?.({ viewState: { target: [700, 750, 0], zoom: 2 } })
      })
      expect(deckView.linked).toMatchObject({ target: [810, 830, 0], zoom: 3 })
      act(() => {
        deckView.onLinkedChange?.({ viewState: { target: [820, 830, 0], zoom: 3 } })
      })
      expect(deckView.current).toMatchObject({ target: [710, 750, 0], zoom: 2 })
      expect((await hashAfterWrite()).getAll('compareLink')).toEqual(['1,110,80,1'])

      // Reset puts it at the main view's centre and zoom.
      expect(reset).toBeEnabled()
      fireEvent.click(reset)
      expect(deckView.linked).toMatchObject({ target: [710, 750, 0], zoom: 2 })
      expect(reset).toBeDisabled()
      expect((await hashAfterWrite()).has('compareLink')).toBe(false)
    })

    it('opens a link’s panels with their links and offsets', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}&compareLink=1%2C10%2C-20%2C1&view=900%2C900%2C0%2C3`,
      )

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(h5adDataset())}
        />,
      )

      await screen.findByRole('region', { name: 'Section 2' })
      await waitFor(() => {
        expect(deckView.linked).toMatchObject({ target: [910, 880, 0], zoom: 4 })
      })
      expect((await hashAfterWrite()).getAll('compareLink')).toEqual(['1,10,-20,1'])
    })

    it('shows a panel’s image with its own channels, in the link', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}`,
      )
      const loader = imageLoaderFixture('https://example.test/cord/image.zarr')
      const dataset = {
        ...h5adDataset(),
        image: vi.fn(async () => ({ kind: 'pyramid' as const, loader })),
      }
      const retainDataset = vi.fn(() => () => {})

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(dataset)}
          retainDataset={retainDataset}
          computeAutoChannelContrast={vi.fn(async () => ({
            min: 0,
            max: 255,
            histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
          }))}
        />,
      )

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      const show = within(panel).getByRole('button', {
        name: 'Show the image of Section 2',
      })
      expect(show).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(show)
      expect(show).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(
        await within(panel).findByRole('button', { name: 'Channels of Section 2' }),
      )
      const popover = within(panel).getByRole('dialog', { name: 'Image of Section 2' })
      expect(within(popover).getByRole('checkbox', { name: 'DAPI' })).toBeChecked()
      expect(retainDataset).toHaveBeenCalledWith(SECTION_2)

      // The image alone, and no channel shown: the link keeps both.
      fireEvent.click(within(popover).getByRole('checkbox', { name: 'Cells' }))
      fireEvent.click(within(popover).getByRole('checkbox', { name: 'DAPI' }))
      await waitFor(() => {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        expect(hash.getAll('compareImage')).toEqual(['only'])
        expect(hash.getAll('compareChannels')).toEqual(['-'])
      })

      // Hiding the image drops both from the link.
      fireEvent.click(show)
      await waitFor(() => {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        expect(hash.has('compareImage')).toBe(false)
        expect(hash.has('compareChannels')).toBe(false)
      })
    })

    it('opens a link’s panel with its image and channels', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}&compareImage=1&compareChannels=-`,
      )
      const loader = imageLoaderFixture('https://example.test/cord/image.zarr')
      const dataset = {
        ...h5adDataset(),
        image: vi.fn(async () => ({ kind: 'pyramid' as const, loader })),
      }

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={createSpatialDatasetLoaderMock(dataset)}
          computeAutoChannelContrast={vi.fn(async () => ({
            min: 0,
            max: 255,
            histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
          }))}
        />,
      )

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      fireEvent.click(
        await within(panel).findByRole('button', { name: 'Channels of Section 2' }),
      )
      const popover = within(panel).getByRole('dialog', { name: 'Image of Section 2' })
      expect(within(popover).getByRole('checkbox', { name: 'DAPI' })).not.toBeChecked()
      expect(within(popover).getByRole('checkbox', { name: 'Cells' })).toBeChecked()
    })

    it('draws a panel’s cell boundaries for its view, in the link (plan 30-D9)', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}`,
      )
      // Each panel is 400 × 300 px; other elements are never measured, as
      // without the stub.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(
            private readonly callback: (
              entries: readonly { readonly contentRect: DOMRectReadOnly }[],
            ) => void,
          ) {}
          observe(element: Element) {
            if (!element.classList.contains('linked-section')) return
            this.callback([
              { contentRect: { width: 400, height: 300 } as DOMRectReadOnly },
            ])
          }
          unobserve() {}
          disconnect() {}
        },
      )
      const square = (x: number, y: number) =>
        [
          [x - 2, y - 2],
          [x + 2, y - 2],
          [x + 2, y + 2],
          [x - 2, y + 2],
        ].map(([px, py]) => ({ x: micrometers(px ?? 0), y: micrometers(py ?? 0) }))
      const section2 = {
        ...h5adDataset(),
        meta: vi.fn(async () => ({
          platform: 'h5ad' as const,
          capabilities: { cellBoundaries: true },
        })),
        elements: vi.fn(async () => ({
          elements: [
            { id: 'cell-a', geometry: { kind: 'polygon', rings: [square(0, 0)] } },
          ],
        })),
      }
      const section1 = h5adDataset()
      const retainDataset = vi.fn(() => () => {})

      render(
        <TestApp
          loadCollection={async () => REGISTERED}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={vi.fn<SpatialDatasetLoader>(
            async (url) =>
              (url === SECTION_2 ? section2 : section1) as unknown as Awaited<
                ReturnType<SpatialDatasetLoader>
              >,
          )}
          retainDataset={retainDataset}
        />,
      )

      const panel = await screen.findByRole('region', { name: 'Section 2' })
      await waitFor(() => {
        expect(deckView.linkedLayerIds).toEqual(['linked-section-cells'])
      })
      // Zoomed in on both cells.
      act(() => {
        deckView.onChange?.({ viewState: { target: [5, -5, 0], zoom: 3 } })
      })

      const show = within(panel).getByRole('button', {
        name: 'Show the cell boundaries of Section 2',
      })
      expect(show).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(show)
      expect(show).toHaveAttribute('aria-pressed', 'true')

      // Read for the panel's view and a margin: 50 × 37.5 µm at 8 px per µm.
      await waitFor(() => {
        expect(deckView.linkedLayerIds).toEqual([
          'cell-boundary-paths',
          'cell-boundary-hit-areas',
          'linked-section-cells',
        ])
      })
      expect(section2.elements).toHaveBeenCalledWith({
        minX: -32.5,
        maxX: 42.5,
        minY: -23.125,
        maxY: 33.125,
      })
      expect(section1.overview).toHaveBeenCalled()
      expect(retainDataset).toHaveBeenCalledWith(SECTION_2)
      expect((await hashAfterWrite()).getAll('compareBoundaries')).toEqual(['1'])

      // Hovering an outline names its cell.
      await waitFor(() => {
        deckView.onLinkedHover?.({
          index: 0,
          layer: { id: 'cell-boundary-hit-areas' },
          object: { id: 'cell-a' },
          x: 10,
          y: 10,
        })
        expect(within(panel).getByText('cell-a')).toBeInTheDocument()
      })

      fireEvent.click(show)
      await waitFor(() => {
        expect(deckView.linkedLayerIds).toEqual(['linked-section-cells'])
      })
      expect((await hashAfterWrite()).has('compareBoundaries')).toBe(false)
    })

    it('names the hovered cell of a section beside, unless Settings turns tooltips off', async () => {
      window.history.replaceState(
        null,
        '',
        `/#xv=2&collection=${encodeURIComponent(REGISTERED.url)}&dataset=${encodeURIComponent(SECTION_1)}&compare=${encodeURIComponent(SECTION_2)}`,
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
        expect(deckView.linked).toBeDefined()
      })
      const hover = () => {
        deckView.onLinkedHover?.({
          index: 0,
          layer: { id: 'linked-section-cells' },
          x: 10,
          y: 10,
        })
      }
      const hoverFirstCell = () => {
        act(hover)
      }

      // Hovered again until the panel's latest render has its cells: under a
      // loaded run the first handler can come from an earlier render.
      await waitFor(() => {
        hover()
        expect(within(panel).getByText('cell-a')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Settings' })).getByLabelText(
          'Hover tooltips',
        ),
      )
      expect(within(panel).queryByText('cell-a')).not.toBeInTheDocument()

      hoverFirstCell()
      expect(within(panel).queryByText('cell-a')).not.toBeInTheDocument()
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

  it('opens a linked dataset over the image, with the channel settings, and labels its entry names', async () => {
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
        defaults: {
          channelSettings: { dapi: { color: '#FF00FF', contrast: [10, 200] } },
        },
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
    const computeAutoChannelContrast = vi.fn(async () => ({
      min: 0,
      max: 255,
      histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
    }))

    render(
      <TestApp
        loadCollection={loadCollection}
        detectSpatialDataset={detect}
        getSpatialDataset={createSpatialDatasetLoaderMock(dataset)}
        computeAutoChannelContrast={computeAutoChannelContrast}
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
    // The collection's colour and window, which the link does not carry,
    // and no auto contrast over the window.
    expect(screen.getByLabelText('DAPI color')).toHaveValue('#ff00ff')
    expect(screen.getByLabelText('DAPI minimum')).toHaveValue(10)
    expect(screen.getByLabelText('DAPI maximum')).toHaveValue(200)
    expect(computeAutoChannelContrast).not.toHaveBeenCalled()
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

describe('App with an image beside itself', () => {
  const IMAGE_URL = 'https://example.test/slides/tonsil.ome.zarr'

  beforeEach(() => {
    window.history.replaceState(
      null,
      '',
      `/#xv=2&dataset=${encodeURIComponent(IMAGE_URL)}`,
    )
  })

  function renderImageApp() {
    const loader = imageLoaderFixture(IMAGE_URL)
    const dataset = {
      meta: vi.fn(async () => ({
        platform: 'image' as const,
        units: loader.units,
        extent: {
          minX: micrometers(0),
          maxX: micrometers(80),
          minY: micrometers(0),
          maxY: micrometers(40),
        },
        capabilities: {
          transcripts: false,
          cellBoundaries: false,
          pyramidImage: true,
          multiChannel: true,
        },
        channels: loader.channels,
      })),
      image: vi.fn(async () => ({ kind: 'pyramid' as const, loader })),
    }

    render(
      <TestApp
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'image' as const,
          baseUrl: IMAGE_URL,
          imageUrl: IMAGE_URL,
          checked: [],
        }))}
        getSpatialDataset={createSpatialDatasetLoaderMock(dataset)}
        computeAutoChannelContrast={vi.fn(async () => ({
          min: 0,
          max: 255,
          histogram: { bins: [1], maxCount: 1, min: 0, max: 255, sampleCount: 1 },
        }))}
      />,
    )

    return dataset
  }

  it('shows the open image again beside the main view, with its own channels', async () => {
    const dataset = renderImageApp()

    await waitFor(() => {
      expect(dataset.image).toHaveBeenCalledTimes(1)
    })
    openControls('image')
    fireEvent.click(await screen.findByRole('button', { name: 'Show beside' }))

    // The same image, linked, from the loaders the main view has open.
    const panel = await screen.findByRole('region', { name: /, beside$/ })
    expect(
      within(panel).getByRole('button', { name: /^Link .* to the main view$/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    fireEvent.click(await within(panel).findByRole('button', { name: /^Channels of / }))
    const popover = within(panel).getByRole('dialog', { name: /^Image of / })
    expect(within(popover).getByRole('checkbox', { name: 'DAPI' })).toBeChecked()
    expect(dataset.image).toHaveBeenCalledTimes(1)

    // Its channels are its own.
    fireEvent.click(within(popover).getByRole('checkbox', { name: 'DAPI' }))
    const layers = screen.getByRole('complementary', { name: 'Layers' })
    expect(within(layers).getByRole('checkbox', { name: 'DAPI' })).toBeChecked()
    await waitFor(() => {
      const hash = new URLSearchParams(window.location.hash.slice(1))
      expect(hash.getAll('compare')).toEqual([IMAGE_URL])
      expect(hash.getAll('compareImage')).toEqual(['1'])
      expect(hash.getAll('compareChannels')).toEqual(['-'])
    })

    // Another copy is numbered.
    fireEvent.click(screen.getByRole('button', { name: 'Show beside again' }))
    expect(await screen.findByRole('region', { name: /, beside 2$/ })).toBeInTheDocument()
  })

  it("shows or hides the main view's image from its pill, as the Layers drawer does", async () => {
    const dataset = renderImageApp()

    await waitFor(() => {
      expect(dataset.image).toHaveBeenCalledTimes(1)
    })
    openControls('image')
    fireEvent.click(await screen.findByRole('button', { name: 'Show beside' }))
    await screen.findByRole('region', { name: /, beside$/ })

    const toggle = screen.getByRole('button', {
      name: /^Show the image of .* in the main view$/,
    })
    const eye = within(screen.getByRole('complementary', { name: 'Layers' })).getByRole(
      'checkbox',
      { name: 'Show Image' },
    )
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(eye).toBeChecked()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(eye).not.toBeChecked()
    // The panel's image is its own.
    const panel = screen.getByRole('region', { name: /, beside$/ })
    expect(
      within(panel).getByRole('button', { name: /^Channels of / }),
    ).toBeInTheDocument()

    fireEvent.click(eye)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
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
    tileBounds: () => ({
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(80),
      maxY: micrometers(40),
    }),
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
