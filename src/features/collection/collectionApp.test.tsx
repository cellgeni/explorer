import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { micrometers } from '../../data/coords'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import { initialViewerState, useViewerStore } from '../../store/viewerStore'
import {
  appTestDependencies,
  createSpatialDatasetLoaderMock,
  openControls,
  type AppTestDependencyProps,
} from '../../test/appTestHarness'
import type { SpatialDatasetDetector } from '../app-shell/appDependencies'

// The camera ViewerCore gives deck.gl.
const deckView = vi.hoisted(() => ({
  current: undefined as { readonly target?: readonly number[] } | undefined,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({ viewState }: { readonly viewState?: { readonly target?: number[] } }) => {
    deckView.current = viewState
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
        'max 1',
      ),
    ).toBeInTheDocument()

    // The user adds a gene, then steps to the next section.
    openControls('genes')
    fireEvent.click(screen.getByRole('button', { name: 'Gfap' }))
    expect(await screen.findByRole('button', { name: 'Remove Gfap' })).toBeInTheDocument()
    // The previews follow: both genes count in the first cell.
    expect(
      await within(within(bar).getByRole('button', { name: '1 dpi A' })).findByText(
        'max 2',
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
