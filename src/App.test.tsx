import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { intToCellId } from './data/cellid'
import { micrometers } from './data/coords'
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
    expect(screen.getByRole('checkbox', { name: 'Morphology image' })).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Boundary limit' })).toHaveValue(500)
    expect(screen.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument()
    expect(screen.getByLabelText('Gene selection')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )
    expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()
  })

  it('lets the user configure the boundary polygon visible-cell limit', () => {
    render(<App />)

    const boundaryLimitInput = screen.getByRole('spinbutton', {
      name: 'Boundary limit',
    })

    fireEvent.change(boundaryLimitInput, { target: { value: '750' } })

    expect(boundaryLimitInput).toHaveValue(750)
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
    const loadGenePanel = vi.fn(async () => [])

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        loadGenePanel={loadGenePanel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        includeCellIds: false,
        limit: null,
      })
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(loadMorphologyImage).not.toHaveBeenCalled()
    expect(loadGenePanel).toHaveBeenCalledWith(DEMO_DATASET_URL)
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
    const loadGenePanel = vi.fn(async () => [])

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        loadGenePanel={loadGenePanel}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morphology image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        includeCellIds: false,
        limit: null,
      })
    })
    await waitFor(() => {
      expect(loadMorphologyImage).toHaveBeenCalledWith(DEMO_DATASET_URL)
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })

  it('requests all overview cells by default without cell IDs', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL, {
        includeCellIds: false,
        limit: null,
      })
    })
  })

  it('loads gene options and lets the user select genes', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb', 'Gad1', 'Slc17a7'])

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByText('3 genes')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Gad1' }))

    expect(screen.getByLabelText('Selected genes')).toHaveTextContent('Gad1')
  })
})
