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
    geneExpression: vi.fn(async () => ({ elements: [], maxCount: 0 })),
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
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
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

    // The user adds a gene, then steps to the next section.
    openControls('genes')
    fireEvent.click(screen.getByRole('button', { name: 'Gfap' }))
    expect(await screen.findByRole('button', { name: 'Remove Gfap' })).toBeInTheDocument()
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
