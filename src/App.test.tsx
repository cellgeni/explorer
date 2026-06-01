import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { intToCellId } from './data/cellid'
import { micrometers } from './data/coords'
import { DEMO_DATASET_URL, initialViewerState, useViewerStore } from './store/viewerStore'

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
  })

  it('loads overview cells when the dataset form is submitted', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])

    render(<App loadDatasetOverview={loadDatasetOverview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(DEMO_DATASET_URL)
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })
})
