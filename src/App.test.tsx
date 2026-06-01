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
    expect(screen.getByRole('slider', { name: 'Image opacity' })).toHaveValue('100')
    expect(screen.getByRole('slider', { name: 'Gene opacity' })).toHaveValue('100')
    expect(screen.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument()
    expect(screen.getByLabelText('Gene selection')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Gene scale' })).toHaveValue('gold')
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )
    expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()
  })

  it('lets the user configure image and gene layer opacity', () => {
    render(<App />)

    const imageOpacityInput = screen.getByRole('slider', {
      name: 'Image opacity',
    })
    const geneOpacityInput = screen.getByRole('slider', {
      name: 'Gene opacity',
    })

    fireEvent.change(imageOpacityInput, { target: { value: '45' } })
    fireEvent.change(geneOpacityInput, { target: { value: '70' } })

    expect(imageOpacityInput).toHaveValue('45')
    expect(geneOpacityInput).toHaveValue('70')
  })

  it('lets the user configure the boundary polygon visible-cell limit', () => {
    render(<App />)

    const boundaryLimitInput = screen.getByRole('spinbutton', {
      name: 'Boundary limit',
    })

    fireEvent.change(boundaryLimitInput, { target: { value: '750' } })

    expect(boundaryLimitInput).toHaveValue(750)
  })

  it('lets the user configure the gene expression color scale', () => {
    render(<App />)

    const geneScaleInput = screen.getByRole('combobox', {
      name: 'Gene scale',
    })

    fireEvent.change(geneScaleInput, { target: { value: 'viridis' } })

    expect(geneScaleInput).toHaveValue('viridis')
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
      channels: [],
      channelLoaders: [],
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
      expect(loadDatasetOverview).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          includeCellIds: false,
          limit: null,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(loadMorphologyImage).not.toHaveBeenCalled()
    expect(loadGenePanel).toHaveBeenCalledWith(
      DEMO_DATASET_URL,
      expect.objectContaining({
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    )
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })

  it('loads morphology image when the option is selected', async () => {
    const dapiChannel = {
      id: 'Channel:0',
      index: 0,
      name: 'DAPI',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'morphology_focus_0000.ome.tif',
    }
    const boundaryChannel = {
      id: 'Channel:1',
      index: 1,
      name: 'Boundary',
      color: [32, 166, 122] as const,
      contrast: { min: 0, max: 65_535 },
      fileName: 'morphology_focus_0001.ome.tif',
    }
    const dapiLoader = {} as TiffPyramidLoader
    const boundaryLoader = {} as TiffPyramidLoader
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadMorphologyImage = vi.fn(async () => ({
      url: `${DEMO_DATASET_URL}/morphology_focus/morphology_focus_0000.ome.tif`,
      loader: dapiLoader,
      channels: [dapiChannel, boundaryChannel],
      channelLoaders: [
        { info: dapiChannel, loader: dapiLoader },
        { info: boundaryChannel, loader: boundaryLoader },
      ],
    }))
    const loadGenePanel = vi.fn(async () => [])
    const computeAutoChannelContrast = vi.fn(async () => ({
      min: 12,
      max: 345,
      histogram: {
        bins: Array.from({ length: 32 }, (_value, index) => index + 1),
        maxCount: 32,
        min: 12,
        max: 345,
        sampleCount: 528,
      },
    }))

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        loadGenePanel={loadGenePanel}
        computeAutoChannelContrast={computeAutoChannelContrast}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Morphology image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          includeCellIds: false,
          limit: null,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    await waitFor(() => {
      expect(loadMorphologyImage).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'DAPI' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Boundary' })).not.toBeChecked()
    expect(screen.getByLabelText('DAPI color')).toHaveValue('#5890ff')

    fireEvent.click(screen.getByRole('button', { name: 'DAPI auto contrast' }))

    await waitFor(() => {
      expect(computeAutoChannelContrast).toHaveBeenCalledWith(
        { info: dapiChannel, loader: dapiLoader },
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(screen.getByLabelText('DAPI minimum')).toHaveValue(12)
    expect(screen.getByLabelText('DAPI maximum')).toHaveValue(345)
    expect(screen.getByLabelText('DAPI histogram')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Boundary' }))

    expect(screen.getByRole('checkbox', { name: 'Boundary' })).toBeChecked()
    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
  })

  it('surfaces structured dataset load errors', async () => {
    const loadDatasetOverview = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const loadGenePanel = vi.fn(async () => [])

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    const alert = await screen.findByRole('alert', { name: 'Load issues' })

    expect(alert).toHaveTextContent('Dataset overview')
    expect(alert).toHaveTextContent('Network request failed')
    expect(alert).toHaveTextContent('Check dataset URL, CORS, and network access.')
    expect(
      await screen.findByText(/Load failed - Network request failed/),
    ).toBeInTheDocument()
  })

  it('surfaces cells.parquet decode failures with parquet-specific guidance', async () => {
    const loadDatasetOverview = vi.fn(async () => {
      throw new RangeError('Offset is outside the bounds of the DataView')
    })
    const loadGenePanel = vi.fn(async () => [])

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    const alert = await screen.findByRole('alert', { name: 'Load issues' })

    expect(alert).toHaveTextContent('Dataset overview')
    expect(alert).toHaveTextContent('cells.parquet decode failed')
    expect(alert).toHaveTextContent(
      'The overview cells.parquet file was reachable, but the browser Parquet reader could not decode it',
    )
    expect(alert).toHaveTextContent(
      'Rewrite cells.parquet with a browser-compatible Parquet encoding',
    )
    expect(
      await screen.findByText(/Load failed - cells\.parquet decode failed/),
    ).toBeInTheDocument()
  })

  it('surfaces structured gene panel errors without failing the overview', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => {
      throw new Error('Unable to load gene_panel.json: HTTP 404.')
    })

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()

    const alert = await screen.findByRole('alert', { name: 'Load issues' })

    expect(alert).toHaveTextContent('Gene panel')
    expect(alert).toHaveTextContent('HTTP 404 response')
    expect(alert).toHaveTextContent('Check the dataset URL and object permissions.')
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
      expect(loadDatasetOverview).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          includeCellIds: false,
          limit: null,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
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
