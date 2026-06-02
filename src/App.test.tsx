import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  App,
  type AnnotationLoader,
  type GeneExpressionLoader,
  type RoiCellsLoader,
} from './App'
import { intToCellId } from './data/cellid'
import { micrometers } from './data/coords'
import { GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT } from './data/geneExpressionLod'
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
    const layerStack = screen.getByRole('region', { name: 'Layer Stack' })
    expect(within(layerStack).queryByText('cells')).not.toBeInTheDocument()
    expect(within(layerStack).queryByText('boundaries')).not.toBeInTheDocument()
    expect(within(layerStack).queryByText('image')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument()
    expect(screen.getByLabelText('Gene selection')).toBeDisabled()
    expect(screen.getByLabelText('Gene set symbols')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Signature score' })).toHaveValue('sum')
    expect(screen.getByRole('combobox', { name: 'Gene scale' })).toHaveValue('gold')
    expect(screen.getByRole('combobox', { name: 'Expression detail' })).toHaveValue(
      'auto',
    )
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )
    expect(screen.getByRole('heading', { name: 'Annotations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Annotations' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'ROI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw Box' })).toBeDisabled()
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

  it('loads exact expression for the current region when requested', async () => {
    const rect = {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      top: 0,
      right: 1000,
      bottom: 1000,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect)
    const contextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    const overviewCells = Array.from({ length: 6000 }, (_value, index) => ({
      cellId: intToCellId(1, index + 1),
      position: {
        x: micrometers(index % 100),
        y: micrometers(Math.floor(index / 100)),
      },
      transcriptCount: 8,
      cellArea: 22,
    }))
    const loadDatasetOverview = vi.fn(async () => overviewCells)
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadGeneExpression: ReturnType<typeof vi.fn<GeneExpressionLoader>> = vi.fn(
      async () => ({
        cells: [
          {
            id: intToCellId(1, 1),
            position: { x: micrometers(0), y: micrometers(0) },
            count: 8,
          },
        ],
        genes: ['Actb'],
        maxCount: 8,
      }),
    )

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadGeneExpression={loadGeneExpression}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByText('1 genes')).toBeInTheDocument()
      fireEvent.change(screen.getByRole('combobox', { name: 'Expression detail' }), {
        target: { value: 'exact-region' },
      })
      fireEvent.change(screen.getByLabelText('Gene selection'), {
        target: { value: 'Actb' },
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Actb' }))

      await waitFor(() => {
        expect(loadGeneExpression).toHaveBeenCalled()
      })

      const lastCall = loadGeneExpression.mock.calls.at(-1)
      expect(lastCall?.[2]).toEqual(['Actb'])
      expect(lastCall?.[3]).toEqual(
        expect.objectContaining({
          limit: 6000,
          sampleStride: 1,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
      expect(
        await screen.findByText('Expression exact region: 1 cell'),
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Gene scale values')).toHaveTextContent('0')
      expect(screen.getByLabelText('Gene scale values')).toHaveTextContent('4')
      expect(screen.getByLabelText('Gene scale values')).toHaveTextContent('8')
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    }
  })

  it('loads a stable whole-slide expression sample at overview zoom', async () => {
    const rect = {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      top: 0,
      right: 1000,
      bottom: 1000,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect)
    const contextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    const overviewCells = Array.from({ length: 50_001 }, (_value, index) => ({
      cellId: intToCellId(1, index + 1),
      position: {
        x: micrometers((index % 250) * 40),
        y: micrometers(Math.floor(index / 250) * 40),
      },
      transcriptCount: 8,
      cellArea: 22,
    }))
    const loadDatasetOverview = vi.fn(async () => overviewCells)
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadGeneExpression: ReturnType<typeof vi.fn<GeneExpressionLoader>> = vi.fn(
      async () => ({
        cells: [],
        genes: ['Actb'],
        maxCount: 0,
      }),
    )

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadGeneExpression={loadGeneExpression}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByText('1 genes')).toBeInTheDocument()
      fireEvent.click(await screen.findByRole('button', { name: 'Actb' }))

      await waitFor(() => {
        expect(loadGeneExpression).toHaveBeenCalled()
      })

      const lastCall = loadGeneExpression.mock.calls.at(-1)
      expect(lastCall?.[1]).toEqual({
        minX: micrometers(0),
        maxX: micrometers(9_960),
        minY: micrometers(0),
        maxY: micrometers(8_000),
      })
      expect(lastCall?.[2]).toEqual(['Actb'])
      expect(lastCall?.[3]).toEqual(
        expect.objectContaining({
          limit: GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT,
          sampleStride: 4,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
      expect(
        await screen.findByText(
          'Expression overview: 0 positive cells across 50,001 slide cells',
        ),
      ).toBeInTheDocument()
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    }
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

    await waitFor(() => {
      expect(computeAutoChannelContrast).toHaveBeenCalledWith(
        { info: dapiChannel, loader: dapiLoader },
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(computeAutoChannelContrast).toHaveBeenCalledWith(
      { info: boundaryChannel, loader: boundaryLoader },
      expect.objectContaining({
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    )
    expect(screen.getByLabelText('DAPI minimum')).toHaveValue(12)
    expect(screen.getByLabelText('DAPI maximum')).toHaveValue(345)
    expect(screen.getByLabelText('DAPI histogram')).toBeInTheDocument()
    expect(screen.getByLabelText('Boundary minimum')).toHaveValue(12)
    expect(screen.getByLabelText('Boundary maximum')).toHaveValue(345)

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

  it('loads built-in analysis annotations on request', async () => {
    const cellId = intToCellId(1, 1)
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadAnnotations: ReturnType<typeof vi.fn<AnnotationLoader>> = vi.fn(
      async () => [
        {
          id: 'analysis:0:0',
          label: 'graphclust: Cluster 1',
          cellIds: [cellId],
        },
      ],
    )

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadAnnotations={loadAnnotations}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load Annotations' }))

    await waitFor(() => {
      expect(loadAnnotations).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
      'graphclust: Cluster 1',
    )
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')

    const colorInput = screen.getByLabelText('graphclust: Cluster 1 color')
    expect(colorInput).toHaveValue('#1f77b4')

    fireEvent.change(colorInput, { target: { value: '#d62728' } })
    expect(colorInput).toHaveValue('#d62728')

    fireEvent.change(screen.getByRole('combobox', { name: 'Cell color' }), {
      target: { value: 'annotations' },
    })
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'annotations',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove graphclust: Cluster 1' }))

    expect(screen.queryByLabelText('Loaded annotations')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )
  })

  it('imports custom CSV annotations from a local file', async () => {
    const cellId = intToCellId(1, 1)
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const file = new File([`cell_id,label\n${cellId},Manual ROI`], 'manual.csv', {
      type: 'text/csv',
    })

    render(
      <App loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Import File'), {
      target: { files: [file] },
    })

    expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
      'Manual ROI',
    )
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'Clear Annotations' }))

    expect(screen.queryByLabelText('Loaded annotations')).not.toBeInTheDocument()
  })

  it('draws a box ROI, summarizes true cells, and saves it as an annotation', async () => {
    const rect = {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      top: 0,
      right: 1000,
      bottom: 1000,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect)
    const contextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    const cellId = intToCellId(1, 1)
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [
      {
        id: cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 12,
        cellArea: 30,
      },
    ])

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByText(/Loaded 1 overview cell/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Draw Box' }))

      const roiLayer = document.querySelector('.roi-draw-layer')

      if (!(roiLayer instanceof HTMLElement)) {
        throw new Error('Expected ROI draw layer.')
      }

      fireEvent.pointerDown(roiLayer, { clientX: 480, clientY: 480, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })
      fireEvent.pointerUp(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })

      await waitFor(() => {
        expect(loadRoiCells).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.objectContaining({
            minX: expect.any(Number) as number,
            maxX: expect.any(Number) as number,
            minY: expect.any(Number) as number,
            maxY: expect.any(Number) as number,
          }),
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })

      const summary = await screen.findByLabelText('ROI summary')
      expect(summary).toHaveTextContent('Cells')
      expect(summary).toHaveTextContent('1')
      expect(summary).toHaveTextContent('12')
      expect(summary).toHaveTextContent('30')

      fireEvent.click(screen.getByRole('button', { name: 'Save ROI' }))

      expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
        'ROI 1',
      )
      expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    }
  })

  it('lets the user paste, score, save, and reapply gene sets', async () => {
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

    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'gad1, ACTB, missing' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))

    const selectedGenes = screen.getByLabelText('Selected genes')
    expect(selectedGenes).toHaveTextContent('Actb')
    expect(selectedGenes).toHaveTextContent('Gad1')
    expect(selectedGenes).not.toHaveTextContent('missing')

    fireEvent.change(screen.getByRole('combobox', { name: 'Signature score' }), {
      target: { value: 'mean' },
    })
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Interneuron set' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))

    const savedSets = screen.getByLabelText('Saved gene sets')
    expect(savedSets).toHaveTextContent('Interneuron set')
    expect(savedSets).toHaveTextContent('mean')

    fireEvent.click(screen.getByRole('button', { name: 'Actb' }))
    expect(screen.getByLabelText('Selected genes')).not.toHaveTextContent('Actb')

    fireEvent.click(screen.getByRole('button', { name: 'Apply Interneuron set' }))

    expect(screen.getByLabelText('Selected genes')).toHaveTextContent('Actb')
    expect(screen.getByRole('combobox', { name: 'Signature score' })).toHaveValue('mean')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Interneuron set' }))

    expect(screen.queryByLabelText('Saved gene sets')).not.toBeInTheDocument()
  })
})
