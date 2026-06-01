import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { intToCellId } from './data/cellid'
import { micrometers } from './data/coords'
import { DEFAULT_OVERVIEW_CELL_LIMIT } from './data/datasetOverview'
import { DEMO_DATASET_URL, initialViewerState, useViewerStore } from './store/viewerStore'
import type { TiffPyramidLoader } from './tiff/loader'

vi.mock('@deck.gl/react', () => ({
  DeckGL: () => <div data-testid="deckgl" />,
}))

describe('App', () => {
  beforeEach(() => {
    useViewerStore.setState(initialViewerState)
  })

  it('renders the Xenium viewer shell', () => {
    render(<App />)

    const datasetInput = screen.getByLabelText('Dataset URL')

    expect(screen.getByRole('heading', { name: 'Xenium Explorer' })).toBeInTheDocument()
    expect(datasetInput).toBeInstanceOf(HTMLInputElement)

    if (datasetInput instanceof HTMLInputElement) {
      expect(datasetInput.value).toContain('/public/xenium/')
    }

    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'All cells' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Morphology image' })).not.toBeChecked()
  })

  it('loads overview cells without morphology image by default', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadMorphologyImage = vi.fn(async () => ({
      url: `${DEMO_DATASET_URL}/morphology_focus/morphology_focus_0000.ome.tif`,
      loader: {} as TiffPyramidLoader,
    }))

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        limit: DEFAULT_OVERVIEW_CELL_LIMIT,
      })
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(loadMorphologyImage).not.toHaveBeenCalled()
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })

  it('loads morphology image when the option is selected', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadMorphologyImage = vi.fn(async () => ({
      url: `${DEMO_DATASET_URL}/morphology_focus/morphology_focus_0000.ome.tif`,
      loader: {} as TiffPyramidLoader,
    }))

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morphology image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        limit: DEFAULT_OVERVIEW_CELL_LIMIT,
      })
    })
    await waitFor(() => {
      expect(loadMorphologyImage).toHaveBeenCalledWith(DEMO_DATASET_URL)
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })

  it('requests all overview cells when the option is selected', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])

    render(<App loadDatasetOverview={loadDatasetOverview} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'All cells' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        limit: null,
      })
    })
  })
})
