import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  App,
  type AnalysisEmbeddingsLoader,
  type AnnotationGroupLoader,
  type AnnotationLoader,
  type DatasetDiagnosticsRunner,
  type DatasetOverviewLoader,
  type GeneExpressionLoader,
  type GenePanelLoader,
  type RoiCellsLoader,
  type RoiGeneStatsLoader,
  type RoiTranscriptsLoader,
} from './App'
import { intToCellId } from './data/cellid'
import { micrometers } from './data/coords'
import { warmDatasetForRoi } from './data/datasetWarmup'
import { GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT } from './data/geneExpressionLod'
import { DEMO_DATASET_URL, initialViewerState, useViewerStore } from './store/viewerStore'
import type { TiffPyramidLoader } from './tiff/loader'

vi.mock('@deck.gl/react', () => ({
  DeckGL: () => <div data-testid="deckgl" />,
}))

vi.mock('./data/datasetAnnotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data/datasetAnnotations')>()

  return {
    ...actual,
    loadDatasetAnnotationGroups: vi.fn(async () => []),
  }
})

vi.mock('./data/datasetWarmup', () => ({
  warmDatasetForRoi: vi.fn(async () => undefined),
}))

function openHudTab(name: string): void {
  fireEvent.click(screen.getByRole('tab', { name }))
}

function pendingPromise<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    useViewerStore.setState(initialViewerState)
    vi.mocked(warmDatasetForRoi).mockClear()
  })

  it('renders the Xenium viewer shell', () => {
    render(<App />)

    const datasetInput = screen.getByLabelText('Dataset URL')

    expect(screen.queryByText('Xenium Explorer')).not.toBeInTheDocument()
    expect(datasetInput).toBeInstanceOf(HTMLInputElement)

    if (datasetInput instanceof HTMLInputElement) {
      expect(datasetInput.value).toContain('/public/xenium/')
    }

    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Morphology image' })).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Boundary limit' })).toHaveValue(5_000)
    expect(screen.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    openHudTab('Layers')
    expect(screen.getByRole('slider', { name: 'Image opacity' })).toHaveValue('100')
    expect(screen.getByRole('slider', { name: 'Cell fill opacity' })).toHaveValue('100')
    expect(screen.getByRole('slider', { name: 'Cell boundary opacity' })).toHaveValue(
      '100',
    )
    const coordinateUnitGroup = screen.getByRole('group', {
      name: 'Mouse coordinates',
    })
    expect(
      within(coordinateUnitGroup).getByRole('button', { name: 'μm' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(coordinateUnitGroup).getByRole('button', { name: 'px' }),
    ).toHaveAttribute('aria-pressed', 'false')
    const layerStack = screen.getByRole('region', { name: 'Layer Stack' })
    expect(within(layerStack).queryByText('cells')).not.toBeInTheDocument()
    expect(within(layerStack).queryByText('boundaries')).not.toBeInTheDocument()
    expect(within(layerStack).queryByText('image')).not.toBeInTheDocument()

    openHudTab('Genes')
    expect(screen.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument()
    expect(screen.getByLabelText('Gene selection')).toBeDisabled()
    expect(screen.getByLabelText('Gene set symbols')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Signature score' })).toHaveValue('sum')
    expect(screen.getByRole('combobox', { name: 'Gene scale' })).toHaveValue('plasma')
    expect(screen.getByRole('combobox', { name: 'Expression detail' })).toHaveValue(
      'auto',
    )
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )

    openHudTab('Annotations')
    expect(screen.getByRole('heading', { name: 'Annotations' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Annotation set' })).toHaveValue('all')
    expect(screen.getByRole('combobox', { name: 'Annotation set' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load Annotations' })).toBeDisabled()

    openHudTab('Cell')
    expect(screen.getByRole('heading', { name: 'UMAP/tSNE' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Embedding view' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load Embeddings' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()

    openHudTab('ROI')
    expect(screen.getByRole('heading', { name: 'ROI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw Box' })).toBeDisabled()
  })

  it('lets the user configure image and cell layer opacity', () => {
    render(<App />)
    openHudTab('Layers')

    const imageOpacityInput = screen.getByRole('slider', {
      name: 'Image opacity',
    })
    const cellFillOpacityInput = screen.getByRole('slider', {
      name: 'Cell fill opacity',
    })
    const cellBoundaryOpacityInput = screen.getByRole('slider', {
      name: 'Cell boundary opacity',
    })

    fireEvent.change(imageOpacityInput, { target: { value: '45' } })
    fireEvent.change(cellFillOpacityInput, { target: { value: '70' } })
    fireEvent.change(cellBoundaryOpacityInput, { target: { value: '35' } })

    expect(imageOpacityInput).toHaveValue('45')
    expect(cellFillOpacityInput).toHaveValue('70')
    expect(cellBoundaryOpacityInput).toHaveValue('35')
  })

  it('records compact debug activity entries', () => {
    render(<App />)

    const activityLog = screen.getByLabelText('Activity log')

    expect(within(activityLog).getByText('Idle')).toBeInTheDocument()

    openHudTab('Layers')
    fireEvent.change(screen.getByRole('slider', { name: 'Image opacity' }), {
      target: { value: '45' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'px' }))

    openHudTab('Dataset')
    expect(within(activityLog).getByText('Image opacity: 45%')).toBeInTheDocument()
    expect(within(activityLog).getByText('Mouse coordinates: px')).toBeInTheDocument()

    fireEvent.click(within(activityLog).getByRole('button', { name: 'Clear' }))

    expect(within(activityLog).getByText('Idle')).toBeInTheDocument()
  })

  it('collapses and expands the control HUD', () => {
    render(<App />)

    const hideButton = screen.getByRole('button', { name: 'Hide Controls' })
    expect(hideButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()

    fireEvent.click(hideButton)

    const showButton = screen.getByRole('button', { name: 'Show Controls' })
    expect(showButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Load Dataset' })).not.toBeInTheDocument()

    fireEvent.click(showButton)

    expect(screen.getByRole('button', { name: 'Hide Controls' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
  })

  it('restores dataset controls from a shareable hash', async () => {
    window.history.replaceState(
      null,
      '',
      '/#xv=1&dataset=https%3A%2F%2Fexample.test%2Fxenium&tab=genes&genes=Actb%2CGad1&scale=viridis&coord=px',
    )

    render(<App />)

    expect(screen.getByRole('tab', { name: 'Genes' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'Gene scale' })).toHaveValue('viridis')
    expect(screen.getByRole('button', { name: 'Actb' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gad1' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText('Dataset URL')).toHaveValue(
        'https://example.test/xenium',
      )
    })
  })

  it('runs dataset diagnostics and summarizes the report', async () => {
    const runDatasetDiagnostics: ReturnType<typeof vi.fn<DatasetDiagnosticsRunner>> =
      vi.fn(async (baseUrl) => ({
        baseUrl,
        startedAt: '2026-06-04T00:00:00.000Z',
        completedAt: '2026-06-04T00:00:01.000Z',
        checks: [
          {
            id: 'cells-parquet',
            label: 'Overview cells',
            url: `${baseUrl}/cells.parquet`,
            required: true,
            status: 'pass',
            message: 'Byte-range readable',
            durationMs: 1,
          },
        ],
      }))

    render(<App runDatasetDiagnostics={runDatasetDiagnostics} />)

    fireEvent.click(screen.getByRole('button', { name: 'Diagnose Dataset' }))

    expect(await screen.findByText('All checks passed')).toBeInTheDocument()
    expect(screen.getByText('Overview cells')).toBeInTheDocument()
    expect(runDatasetDiagnostics).toHaveBeenCalledWith(
      expect.stringContaining('/public/xenium/'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('shows compact loading indicators while startup queries are pending', async () => {
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      () => pendingPromise(),
    )
    const loadGenePanel: ReturnType<typeof vi.fn<GenePanelLoader>> = vi.fn(() =>
      pendingPromise(),
    )
    const loadAnnotationGroups: ReturnType<typeof vi.fn<AnnotationGroupLoader>> = vi.fn(
      () => pendingPromise(),
    )

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadAnnotationGroups={loadAnnotationGroups}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    const loadingStatus = await screen.findByRole('status', {
      name: 'Active loading tasks',
    })

    expect(within(loadingStatus).getByText('Loading dataset')).toBeInTheDocument()
    expect(within(loadingStatus).getByText('Loading gene panel')).toBeInTheDocument()
    expect(within(loadingStatus).getByText('Loading annotation sets')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Genes' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Annotations' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
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
    openHudTab('Genes')

    const geneScaleInput = screen.getByRole('combobox', {
      name: 'Gene scale',
    })

    expect(
      within(geneScaleInput).getByRole('option', { name: 'Plasma' }),
    ).toBeInTheDocument()
    expect(
      within(geneScaleInput).getByRole('option', { name: 'Cividis' }),
    ).toBeInTheDocument()
    expect(
      within(geneScaleInput).getByRole('option', { name: 'Teal' }),
    ).toBeInTheDocument()
    expect(
      within(geneScaleInput).getByRole('option', { name: 'Rose' }),
    ).toBeInTheDocument()
    expect(
      within(geneScaleInput).getByRole('option', { name: 'Glasbey' }),
    ).toBeInTheDocument()

    fireEvent.change(geneScaleInput, { target: { value: 'glasbey' } })

    expect(geneScaleInput).toHaveValue('glasbey')
  })

  it('loads an embedding panel linked to ROI cells', async () => {
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
        position: { x: micrometers(0), y: micrometers(0) },
        transcriptCount: 8,
        cellArea: 22,
      },
      {
        cellId: intToCellId(1, 2),
        position: { x: micrometers(10), y: micrometers(10) },
        transcriptCount: 12,
        cellArea: 30,
      },
    ])
    const loadAnalysisEmbeddings: ReturnType<typeof vi.fn<AnalysisEmbeddingsLoader>> =
      vi.fn(async () => [
        {
          kind: 'umap',
          label: 'UMAP',
          sourcePath: 'analysis/umap/gene_expression_2_components/projection.csv',
          points: [
            { id: cellId, x: 0, y: 0 },
            { id: intToCellId(1, 2), x: 1, y: 1 },
          ],
        },
      ])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [
      {
        id: cellId,
        position: { x: micrometers(0), y: micrometers(0) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 0,
        hitCellLimit: false,
      }),
    )

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadAnalysisEmbeddings={loadAnalysisEmbeddings}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Cell')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Load Embeddings' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))

      expect(await screen.findByText('UMAP: 2 cells')).toBeInTheDocument()
      expect(screen.getByLabelText('UMAP embedding, 2 cells')).toBeInTheDocument()

      const roiLayer = document.querySelector('.roi-draw-layer')

      if (!(roiLayer instanceof HTMLElement)) {
        throw new Error('Expected ROI draw layer.')
      }

      openHudTab('ROI')
      fireEvent.click(screen.getByRole('button', { name: 'Draw Box' }))
      fireEvent.pointerDown(roiLayer, { clientX: 480, clientY: 480, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })
      fireEvent.pointerUp(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })

      const embeddingSummary = await screen.findByLabelText('Embedding link summary')
      expect(embeddingSummary).toHaveTextContent('ROI')
      expect(embeddingSummary).toHaveTextContent('1')
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    }
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

      openHudTab('Genes')
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

      openHudTab('Genes')
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
          includeCellIds: true,
          limit: null,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
    await waitFor(() => {
      expect(warmDatasetForRoi).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(loadMorphologyImage).not.toHaveBeenCalled()
    expect(loadGenePanel).toHaveBeenCalledWith(
      DEMO_DATASET_URL,
      expect.objectContaining({
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    )
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
          includeCellIds: true,
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
    openHudTab('Layers')
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

    const alert = await screen.findByRole('alert', { name: 'Load issues' })

    expect(alert).toHaveTextContent('Gene panel')
    expect(alert).toHaveTextContent('HTTP 404 response')
    expect(alert).toHaveTextContent('Check the dataset URL and object permissions.')
  })

  it('requests all overview cells by default with cell IDs', async () => {
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
          includeCellIds: true,
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

    openHudTab('Genes')
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
    const loadAnnotationGroups: ReturnType<typeof vi.fn<AnnotationGroupLoader>> = vi.fn(
      async () => [
        {
          id: 'analysis:0',
          label: 'graphclust',
          groupingName: 'gene_expression_graphclust',
          groupCount: 2,
        },
        {
          id: 'analysis:1',
          label: 'kmeans 3',
          groupingName: 'gene_expression_kmeans_3_clusters',
          groupCount: 3,
        },
      ],
    )
    const loadAnnotations: ReturnType<typeof vi.fn<AnnotationLoader>> = vi.fn(
      async () => [
        {
          id: 'analysis:1:0',
          label: 'kmeans 3: Cluster 1',
          cellIds: [cellId],
        },
      ],
    )

    render(
      <App
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadAnnotationGroups={loadAnnotationGroups}
        loadAnnotations={loadAnnotations}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    openHudTab('Annotations')
    expect(await screen.findByRole('option', { name: 'kmeans 3' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Annotation set' }), {
      target: { value: 'analysis:1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Annotations' }))

    await waitFor(() => {
      expect(loadAnnotations).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          groupId: 'analysis:1',
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
      'kmeans 3: Cluster 1',
    )
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')

    const colorInput = screen.getByLabelText('kmeans 3: Cluster 1 color')
    const colorPicker = colorInput.closest('.annotation-color-picker')

    if (!(colorPicker instanceof HTMLElement)) {
      throw new Error('Expected annotation color picker wrapper.')
    }

    expect(colorInput).toHaveValue('#1f77b4')
    expect(colorPicker).toHaveStyle('--annotation-color: #1f77b4')

    fireEvent.change(colorInput, { target: { value: '#d62728' } })
    expect(colorInput).toHaveValue('#d62728')
    expect(colorPicker).toHaveStyle('--annotation-color: #d62728')

    openHudTab('Genes')
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'annotations',
    )

    openHudTab('Annotations')
    fireEvent.click(screen.getByRole('button', { name: 'Remove kmeans 3: Cluster 1' }))

    expect(screen.queryByLabelText('Loaded annotations')).not.toBeInTheDocument()
    openHudTab('Genes')
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

    openHudTab('Annotations')
    await waitFor(() => {
      expect(screen.getByLabelText('Import File')).toBeEnabled()
    })
    fireEvent.change(screen.getByLabelText('Import File'), {
      target: { files: [file] },
    })

    expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
      'Manual ROI',
    )
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')
    openHudTab('Genes')
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'annotations',
    )

    openHudTab('Annotations')
    fireEvent.click(screen.getByRole('button', { name: 'Clear Annotations' }))

    expect(screen.queryByLabelText('Loaded annotations')).not.toBeInTheDocument()
    openHudTab('Genes')
    expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
      'transcript-count',
    )
  })

  it('shows ROI query loading while drawn ROI cells are pending', async () => {
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
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(() =>
      pendingPromise(),
    )

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('ROI')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Draw Box' }))

      const roiLayer = document.querySelector('.roi-draw-layer')

      if (!(roiLayer instanceof HTMLElement)) {
        throw new Error('Expected ROI draw layer.')
      }

      fireEvent.pointerDown(roiLayer, { clientX: 480, clientY: 480, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })
      fireEvent.pointerUp(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })

      const loadingStatus = await screen.findByRole('status', {
        name: 'Active loading tasks',
      })

      expect(within(loadingStatus).getByText('Querying ROI cells')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'ROI' })).toHaveAttribute(
        'aria-busy',
        'true',
      )
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
    }
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
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:roi-transcripts')
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const downloadClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
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
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [
          {
            gene: 'Actb',
            count: 42,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 42,
            percentTotal: 70,
          },
          {
            gene: 'Gad1',
            count: 18,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 18,
            percentTotal: 30,
          },
        ],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 60,
        hitCellLimit: false,
      }),
    )
    const loadRoiTranscripts: ReturnType<typeof vi.fn<RoiTranscriptsLoader>> = vi.fn(
      async () => [
        {
          cellId,
          featureName: 'Actb',
          position: { x: micrometers(10), y: micrometers(20) },
          zLocation: 1,
          qv: 35,
          overlapsNucleus: true,
          isGene: true,
        },
      ],
    )

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
          loadRoiTranscripts={loadRoiTranscripts}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('ROI')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      })
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
            kind: 'box',
            bbox: expect.objectContaining({
              minX: expect.any(Number) as number,
              maxX: expect.any(Number) as number,
              minY: expect.any(Number) as number,
              maxY: expect.any(Number) as number,
            }) as object,
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

      await waitFor(() => {
        expect(loadRoiGeneStats).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.arrayContaining([
            expect.objectContaining({ id: cellId }) as unknown as object,
          ]),
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      const geneDistribution = await screen.findByLabelText('ROI gene distribution')
      expect(geneDistribution).toHaveTextContent('Top ROI genes')
      expect(geneDistribution).toHaveTextContent('Actb')
      expect(geneDistribution).toHaveTextContent('42')
      expect(geneDistribution).toHaveTextContent('70% total')

      fireEvent.click(screen.getByRole('button', { name: 'Export Transcripts' }))

      await waitFor(() => {
        expect(loadRoiTranscripts).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.objectContaining({
            kind: 'box',
            bbox: expect.objectContaining({
              minX: expect.any(Number) as number,
              maxX: expect.any(Number) as number,
              minY: expect.any(Number) as number,
              maxY: expect.any(Number) as number,
            }) as object,
          }),
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(createObjectUrlSpy).toHaveBeenCalled()
      expect(downloadClickSpy).toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Save ROI' }))

      openHudTab('Annotations')
      expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
        'ROI 1',
      )
      expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent('1')
      openHudTab('Genes')
      expect(screen.getByRole('combobox', { name: 'Cell color' })).toHaveValue(
        'annotations',
      )
    } finally {
      rectSpy.mockRestore()
      contextSpy.mockRestore()
      createObjectUrlSpy.mockRestore()
      revokeObjectUrlSpy.mockRestore()
      downloadClickSpy.mockRestore()
    }
  })

  it('starts a bbox-backed ROI query from a lasso selection', async () => {
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
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [])

    try {
      render(
        <App
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('ROI')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draw Lasso' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Draw Lasso' }))

      const roiLayer = document.querySelector('.roi-draw-layer')

      if (!(roiLayer instanceof HTMLElement)) {
        throw new Error('Expected ROI draw layer.')
      }

      fireEvent.pointerDown(roiLayer, { clientX: 480, clientY: 480, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 520, clientY: 480, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 520, clientY: 520, pointerId: 1 })
      fireEvent.pointerUp(roiLayer, { clientX: 480, clientY: 520, pointerId: 1 })

      await waitFor(() => {
        expect(loadRoiCells).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.objectContaining({
            kind: 'lasso',
            bbox: expect.objectContaining({
              minX: expect.any(Number) as number,
              maxX: expect.any(Number) as number,
              minY: expect.any(Number) as number,
              maxY: expect.any(Number) as number,
            }) as object,
            points: expect.any(Array) as unknown as object,
          }),
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(await screen.findByText('0 cells')).toBeInTheDocument()
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

    openHudTab('Genes')
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
