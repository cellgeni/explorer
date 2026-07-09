import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  App,
  type AnalysisEmbeddingsLoader,
  type AnnotationGroupLoader,
  type AnnotationLoader,
  type BoundaryElementsLoader,
  type CellTranscriptDistributionLoader,
  type CustomMorphologyLayerLoader,
  type DatasetDiagnosticsRunner,
  type DatasetOverviewLoader,
  type DatasetWarmupLoader,
  type GeneExpressionLoader,
  type GenePanelLoader,
  type RoiCellsLoader,
  type RoiGeneStatsLoader,
  type RoiTranscriptsLoader,
  type TranscriptAggregateLoader,
  type TranscriptCapabilitiesLoader,
  type TranscriptViewportLoader,
} from './App'
import { intToCellId } from './data/cellid'
import { imagePixels, micrometers } from './data/coords'
import { NO_ANNOTATION_GROUP_ID } from './data/datasetAnnotations'
import { warmDatasetForRoi } from './data/datasetWarmup'
import { GENE_EXPRESSION_OVERVIEW_SAMPLE_CELL_LIMIT } from './data/geneExpressionLod'
import { DEMO_DATASET_URL, initialViewerState, useViewerStore } from './store/viewerStore'
import type { SpatialElement } from './datasets/spatialDataset'
import type { TiffPyramidLoader } from './tiff/loader'
import {
  appTestDependencies,
  appViewportRectFixture,
  createSpatialDatasetLoaderMock,
  createVisiumHdDatasetMock,
  createVisiumHdDetectorMock,
  deferredPromise,
  installAppViewportFixture,
  openHudTab,
  pendingPromise,
  visiumHdDetectionFixture,
  visiumHdMetaFixture,
  visiumOverviewFixture,
  type AppTestDependencyProps,
} from './test/appTestHarness'

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    layers = [],
    onClick,
  }: {
    readonly layers?: readonly unknown[]
    readonly onClick?: (info: {
      readonly object?: unknown
      readonly x: number
      readonly y: number
    }) => void
  }) => (
    <div data-testid="deckgl">
      {layers.map((layer) => {
        const candidate = layer as {
          readonly id?: string
          readonly props?: {
            readonly id?: string
            readonly data?: readonly unknown[]
          }
        }
        const id = candidate.id ?? candidate.props?.id ?? 'unknown-layer'
        const data = candidate.props?.data ?? []
        const clickObject = Array.isArray(data) ? data[0] : undefined

        return (
          <div
            key={id}
            data-testid={`deck-layer-${id}`}
            data-count={String(data.length)}
            onClick={() => {
              onClick?.({ object: clickObject, x: 0, y: 0 })
            }}
          />
        )
      })}
    </div>
  ),
}))

vi.mock('./datasets/datasetFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./datasets/datasetFactory')>()

  return {
    ...actual,
    detectSpatialDataset: vi.fn(async (baseUrl: string) => ({
      platform: 'xenium' as const,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      checked: [],
    })),
  }
})

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

function TestApp(props: AppTestDependencyProps) {
  return <App dependencies={appTestDependencies(props)} />
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    useViewerStore.setState(initialViewerState)
    vi.mocked(warmDatasetForRoi).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the Xenium viewer shell', () => {
    render(<TestApp />)

    const datasetInput = screen.getByLabelText('Dataset or image URL')

    expect(screen.queryByText('Xenium Explorer')).not.toBeInTheDocument()
    expect(datasetInput).toBeInstanceOf(HTMLInputElement)

    if (datasetInput instanceof HTMLInputElement) {
      expect(datasetInput.value).toContain('/public/xenium/')
    }

    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download diagnostics' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Download Diagnostics')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Morphology image' })).toBeChecked()
    const boundaryLimitInput = screen.getByRole('spinbutton', {
      name: 'Boundary limit',
    })
    expect(boundaryLimitInput).toHaveValue(50_000)
    expect(boundaryLimitInput).toHaveAttribute('max', '100000')
    expect(screen.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Layers' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    openHudTab('Layers')
    expect(screen.getByRole('slider', { name: 'Dataset image opacity' })).toHaveValue(
      '100',
    )
    expect(screen.getByRole('slider', { name: 'Cell fill opacity' })).toHaveValue('50')
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
    expect(screen.getByRole('button', { name: 'Distance measure' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const measurementUnitGroup = screen.getByRole('group', {
      name: 'Measure unit',
    })
    expect(
      within(measurementUnitGroup).getByRole('button', { name: 'μm' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(measurementUnitGroup).getByRole('button', { name: 'px' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Clear Measurement' })).toBeInTheDocument()
    expect(screen.getByLabelText('Custom image URL')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load Layer' })).toBeDisabled()
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

    openHudTab('Transcripts')
    expect(screen.getByRole('heading', { name: 'Transcripts' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show transcripts' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Detail' })).toHaveValue('auto')
    const transcriptExactBudgetInput = screen.getByRole('spinbutton', {
      name: 'Exact budget',
    })
    expect(transcriptExactBudgetInput).toHaveValue(100_000)
    expect(transcriptExactBudgetInput).toHaveAttribute('max', '1000000')
    expect(screen.getByRole('combobox', { name: 'Feature filter' })).toHaveValue('all')
    expect(screen.getByLabelText('Feature search')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Density color' })).toHaveValue('thermal')
    expect(screen.getByRole('combobox', { name: 'Point color' })).toHaveValue('feature')
    expect(screen.getByRole('spinbutton', { name: 'Min QV' })).toHaveValue(20)
    expect(screen.getByRole('checkbox', { name: 'Gene-only calls' })).toBeChecked()
    expect(screen.getByRole('slider', { name: 'Transcript opacity' })).toHaveValue('85')
    expect(screen.getByRole('slider', { name: 'Point size' })).toHaveValue('2')

    openHudTab('Magic Lens')
    expect(screen.getByRole('heading', { name: 'Magic Lens' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Min QV' })).toHaveValue(20)
    expect(screen.getByRole('slider', { name: 'Radius' })).toHaveValue('80')
    expect(screen.getByRole('button', { name: 'Enable Lens' })).toBeDisabled()
    const magicLensScopeGroup = screen.getByRole('group', { name: 'Scope' })
    expect(
      within(magicLensScopeGroup).getByRole('button', { name: 'Cursor' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(magicLensScopeGroup).getByRole('button', { name: 'Viewport' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(magicLensScopeGroup).getByRole('button', { name: 'ROI' }),
    ).toBeDisabled()

    openHudTab('Annotations')
    expect(screen.getByRole('heading', { name: 'Annotations' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Annotation set' })).toHaveValue('all')
    expect(screen.getByRole('combobox', { name: 'Annotation set' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load Annotations' })).toBeDisabled()

    openHudTab('Cell')
    expect(screen.getByRole('heading', { name: 'Embeddings' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Embedding view' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load Embeddings' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()

    openHudTab('ROI')
    expect(screen.getByRole('heading', { name: 'ROI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw Box' })).toBeDisabled()
  })

  it('hides transcript controls for Visium HD datasets', async () => {
    const visiumUrl = 'https://example.test/visium-hd'
    window.history.replaceState(
      null,
      '',
      `/#dataset=${encodeURIComponent(visiumUrl)}&tab=transcripts`,
    )
    const viewport = installAppViewportFixture()
    const overview = visiumOverviewFixture()
    const detectSpatialDataset = createVisiumHdDetectorMock(
      visiumHdDetectionFixture({ baseUrl: visiumUrl }),
    )
    const matrix = vi.fn(async () => ({
      geneNames: ['A2M', 'GAD1'],
      cells: new Map([
        ['BC-1', { geneNames: ['A2M', 'GAD1'], counts: [7, 2] }],
        ['BC-2', { geneNames: ['GAD1'], counts: [3] }],
      ]),
    }))
    const visiumDataset = createVisiumHdDatasetMock({
      overview,
      overrides: { matrix },
    })
    const getSpatialDataset = createSpatialDatasetLoaderMock(visiumDataset)

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
        />,
      )

      expect(screen.getByRole('tab', { name: 'Transcripts' })).toHaveAttribute(
        'aria-selected',
        'true',
      )

      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset', hidden: true }))

      await waitFor(() => {
        expect(detectSpatialDataset).toHaveBeenCalled()
        expect(visiumDataset.readBinnedOverview).toHaveBeenCalled()
      })
      await screen.findAllByText(/Visium HD ready/)

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: 'Transcripts' })).not.toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
          'aria-selected',
          'true',
        )
      })
      expect(
        screen.queryByRole('heading', { name: 'Transcripts' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('checkbox', { name: 'Show transcripts' }),
      ).not.toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('loads an image-only source and enables GeoJSON shape annotations', async () => {
    const imageUrl = 'https://example.test/images/sample.ome.tif'
    window.history.replaceState(null, '', `/#dataset=${encodeURIComponent(imageUrl)}`)
    const viewport = installAppViewportFixture()
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:geometric-annotations')
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const downloadClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const loader = imageOnlyTiffLoaderFixture(imageUrl)
    const imageDataset = {
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
    const computeAutoChannelContrast = vi.fn(async () => ({
      min: 0,
      max: 255,
      histogram: {
        bins: Array.from({ length: 32 }, () => 1),
        maxCount: 1,
        min: 0,
        max: 255,
        sampleCount: 32,
      },
    }))
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'image' as const,
      baseUrl: imageUrl,
      imageUrl,
      checked: [],
    }))
    const getSpatialDataset = createSpatialDatasetLoaderMock(imageDataset)
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      async () => {
        throw new Error('Image-only loading must not request overview cells.')
      },
    )

    try {
      render(
        <TestApp
          computeAutoChannelContrast={computeAutoChannelContrast}
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
          loadDatasetOverview={loadDatasetOverview}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await waitFor(() => {
        expect(imageDataset.image).toHaveBeenCalledTimes(1)
      })
      expect(imageDataset.meta).toHaveBeenCalled()
      expect(loadDatasetOverview).not.toHaveBeenCalled()
      expect(screen.queryByText('Please load a dataset')).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Genes' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Transcripts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Magic Lens' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Cell' })).not.toBeInTheDocument()

      openHudTab('Layers')
      expect(screen.getByRole('checkbox', { name: 'DAPI' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Marker' })).toBeChecked()
      expect(screen.getByLabelText('DAPI color')).toHaveValue('#5890ff')
      expect(screen.queryByRole('slider', { name: 'Cell fill opacity' })).toBeNull()
      expect(screen.queryByRole('slider', { name: 'Cell boundary opacity' })).toBeNull()
      expect(screen.queryByLabelText('Cell boundaries')).toBeNull()

      openHudTab('ROI')
      expect(screen.getByRole('heading', { name: 'Geometry' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Export Cells' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Export Transcripts' })).toBeNull()

      openHudTab('Annotations')
      expect(screen.getByRole('heading', { name: 'GeoJSON shapes' })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Annotation set' })).toBeNull()

      fireEvent.change(screen.getByLabelText('Import GeoJSON'), {
        target: {
          files: [
            new File(
              [
                JSON.stringify({
                  type: 'Feature',
                  properties: { label: 'Image region' },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [10, 10],
                        [20, 10],
                        [20, 20],
                        [10, 10],
                      ],
                    ],
                  },
                }),
              ],
              'region.geojson',
              { type: 'application/geo+json' },
            ),
          ],
        },
      })

      expect(await screen.findByText('Image region')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export GeoJSON' })).toBeEnabled()
      expect(screen.getByTestId('deck-layer-geometric-annotations')).toHaveAttribute(
        'data-count',
        '1',
      )

      fireEvent.click(screen.getByRole('button', { name: 'Export GeoJSON' }))

      expect(downloadClickSpy).toHaveBeenCalledTimes(1)
      const blob = createObjectUrlSpy.mock.calls[0]?.[0]
      expect(blob).toBeInstanceOf(Blob)

      if (blob instanceof Blob) {
        await expect(blob.text()).resolves.toContain('"coordinate_unit": "micrometer"')
      }
    } finally {
      viewport.restore()
      createObjectUrlSpy.mockRestore()
      revokeObjectUrlSpy.mockRestore()
      downloadClickSpy.mockRestore()
    }
  })

  it('draws a Visium HD ROI, exports barcodes, and links barcode embeddings', async () => {
    const visiumUrl = 'https://example.test/visium-hd'
    window.history.replaceState(null, '', `/#dataset=${encodeURIComponent(visiumUrl)}`)
    const viewport = installAppViewportFixture()
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:visium-roi-barcodes')
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const downloadClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const overview = visiumOverviewFixture()
    const detectSpatialDataset = createVisiumHdDetectorMock(
      visiumHdDetectionFixture({ baseUrl: visiumUrl }),
    )
    const matrix = vi.fn(async () => ({
      geneNames: ['A2M', 'GAD1'],
      cells: new Map([
        ['BC-1', { geneNames: ['A2M', 'GAD1'], counts: [7, 2] }],
        ['BC-2', { geneNames: ['GAD1'], counts: [3] }],
      ]),
    }))
    const visiumDataset = createVisiumHdDatasetMock({
      overview,
      overrides: { matrix },
    })
    const getSpatialDataset = createSpatialDatasetLoaderMock(visiumDataset)
    const loadAnalysisEmbeddings: ReturnType<typeof vi.fn<AnalysisEmbeddingsLoader>> =
      vi.fn(async () => [
        {
          kind: 'umap',
          label: 'UMAP',
          sourcePath:
            'binned_outputs/square_016um/analysis/umap/gene_expression_2_components/projection.csv',
          points: [
            { id: 'BC-1', x: 0, y: 0 },
            { id: 'BC-2', x: 10, y: 10 },
          ],
        },
      ])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [])
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => {
        throw new Error('Visium HD ROI drawing must not request top ROI genes.')
      },
    )

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
          loadAnalysisEmbeddings={loadAnalysisEmbeddings}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await waitFor(() => {
        expect(detectSpatialDataset).toHaveBeenCalled()
        expect(visiumDataset.readBinnedOverview).toHaveBeenCalled()
      })
      await screen.findAllByText(/Visium HD ready/)

      openHudTab('ROI')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Draw Box' }))

      const roiLayer = document.querySelector('.roi-draw-layer')

      if (!(roiLayer instanceof HTMLElement)) {
        throw new Error('Expected ROI draw layer.')
      }

      fireEvent.pointerDown(roiLayer, { clientX: 4, clientY: 4, pointerId: 1 })
      fireEvent.pointerMove(roiLayer, { clientX: 316, clientY: 186, pointerId: 1 })
      fireEvent.pointerUp(roiLayer, { clientX: 316, clientY: 186, pointerId: 1 })

      const summary = await screen.findByLabelText('ROI summary')
      expect(summary).toHaveTextContent('Bins')
      expect(summary).toHaveTextContent('2')
      expect(summary).toHaveTextContent('16 um')
      expect(screen.getByRole('button', { name: 'Export Barcodes' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Export Cells' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Export Transcripts' })).toBeNull()
      const roiGeneDistribution = await screen.findByLabelText('ROI gene distribution')
      expect(roiGeneDistribution).toHaveTextContent('ROI genes')
      expect(roiGeneDistribution).toHaveTextContent('A2M')
      expect(roiGeneDistribution).toHaveTextContent('GAD1')
      expect(screen.queryByText('Top ROI genes')).toBeNull()
      expect(loadRoiCells).not.toHaveBeenCalled()
      expect(loadRoiGeneStats).not.toHaveBeenCalled()
      expect(matrix).toHaveBeenCalledWith(
        ['BC-1', 'BC-2'],
        16,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Export Barcodes' }))

      expect(downloadClickSpy).toHaveBeenCalled()
      const blob = createObjectUrlSpy.mock.calls[0]?.[0]
      expect(blob).toBeInstanceOf(Blob)

      if (blob instanceof Blob) {
        await expect(blob.text()).resolves.toContain('BC-1')
        await expect(blob.text()).resolves.toContain('BC-2')
      }

      openHudTab('Cell')
      fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))

      await waitFor(() => {
        expect(loadAnalysisEmbeddings).toHaveBeenCalledWith(
          visiumUrl,
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
            visiumHdBinSizeMicrometers: 16,
          }),
        )
      })
      expect(await screen.findByText('UMAP: 2 linked')).toBeInTheDocument()
      expect(
        screen.getByRole('img', { name: 'UMAP embedding, 2 bins' }),
      ).toBeInTheDocument()

      fireEvent.pointerDown(screen.getByRole('img', { name: 'UMAP embedding, 2 bins' }), {
        clientX: 12,
        clientY: 178,
      })

      expect(await screen.findByText('Selected bin')).toBeInTheDocument()
      expect(screen.getByText('BC-1')).toBeInTheDocument()
    } finally {
      viewport.restore()
      createObjectUrlSpy.mockRestore()
      revokeObjectUrlSpy.mockRestore()
      downloadClickSpy.mockRestore()
    }
  })

  it('scans Visium HD viewport bins with selected-gene magic lens expression', async () => {
    const visiumUrl = 'https://example.test/visium-hd'
    window.history.replaceState(null, '', `/#dataset=${encodeURIComponent(visiumUrl)}`)
    const viewport = installAppViewportFixture()
    const overview = visiumOverviewFixture()
    const detectSpatialDataset = createVisiumHdDetectorMock(
      visiumHdDetectionFixture({ baseUrl: visiumUrl }),
    )
    const visiumDataset = createVisiumHdDatasetMock({
      overview,
      overrides: {
        genePanel: vi.fn(async () => ['A2M', 'GAD1']),
        matrix: vi.fn(async () => ({
          geneNames: ['A2M', 'GAD1'],
          cells: new Map([
            [
              'BC-1',
              {
                geneNames: ['A2M', 'GAD1'],
                counts: [7, 2],
              },
            ],
            [
              'BC-2',
              {
                geneNames: ['GAD1'],
                counts: [3],
              },
            ],
          ]),
        })),
        geneExpression: vi.fn(async () => ({
          elements: [
            {
              id: 'BC-1',
              position: { x: micrometers(10), y: micrometers(5) },
              count: 7,
              cellArea: 256,
            },
          ],
          genes: ['A2M'],
          geneCounts: [{ gene: 'A2M', count: 7 }],
          maxCount: 7,
        })),
      },
    })
    const getSpatialDataset = createSpatialDatasetLoaderMock(visiumDataset)
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [])

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
          loadRoiCells={loadRoiCells}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await screen.findAllByText(/Visium HD ready/)

      openHudTab('Magic Lens')
      expect(screen.queryByRole('spinbutton', { name: 'Min QV' })).toBeNull()
      const enableLensButton = screen.getByRole('button', { name: 'Enable Lens' })
      await waitFor(() => {
        expect(enableLensButton).toBeEnabled()
      })
      fireEvent.click(enableLensButton)
      expect(screen.getByRole('button', { name: 'Disable Lens' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Viewport' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Scan Lens' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Scan Lens' }))

      await waitFor(() => {
        expect(visiumDataset.matrix).toHaveBeenCalledWith(
          ['BC-1', 'BC-2'],
          16,
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })

      const allGeneResults = await screen.findByLabelText('Magic lens results')
      expect(allGeneResults).toHaveTextContent('UMIs')
      expect(allGeneResults).toHaveTextContent('12')
      expect(allGeneResults).toHaveTextContent('Bins')
      expect(allGeneResults).toHaveTextContent('2')
      expect(screen.getByLabelText('Magic lens gene distribution')).toHaveTextContent(
        'A2M',
      )
      expect(screen.getByLabelText('Magic lens gene distribution')).toHaveTextContent(
        'GAD1',
      )

      openHudTab('Genes')
      expect(await screen.findByText('2 genes')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'A2M' }))

      openHudTab('Magic Lens')
      fireEvent.click(screen.getByRole('button', { name: 'Viewport' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Scan Lens' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Scan Lens' }))

      await waitFor(() => {
        expect(visiumDataset.geneExpression).toHaveBeenCalledWith(
          expect.objectContaining({
            minX: expect.any(Number) as number,
            maxX: expect.any(Number) as number,
            minY: expect.any(Number) as number,
            maxY: expect.any(Number) as number,
          }),
          ['A2M'],
          expect.objectContaining({
            binSizeMicrometers: 16,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(loadRoiCells).not.toHaveBeenCalled()

      const results = await screen.findByLabelText('Magic lens results')
      expect(results).toHaveTextContent('UMIs')
      expect(results).toHaveTextContent('7')
      expect(results).toHaveTextContent('Bins')
      expect(results).toHaveTextContent('2')
      expect(results).toHaveTextContent('Selected')
      expect(screen.getByLabelText('Magic lens gene distribution')).toHaveTextContent(
        'A2M',
      )
    } finally {
      viewport.restore()
    }
  })

  it('updates selected Visium HD bin info when selected-gene expression loads', async () => {
    const visiumUrl = 'https://example.test/visium-hd'
    window.history.replaceState(null, '', `/#dataset=${encodeURIComponent(visiumUrl)}`)
    const viewport = installAppViewportFixture()
    const overview = visiumOverviewFixture()
    const detectSpatialDataset = createVisiumHdDetectorMock(
      visiumHdDetectionFixture({ baseUrl: visiumUrl }),
    )
    const visiumDataset = createVisiumHdDatasetMock({
      overview,
      overrides: {
        genePanel: vi.fn(async () => ['Actb']),
        geneExpression: vi.fn(async () => ({
          elements: [
            {
              id: 'BC-1',
              position: { x: micrometers(10), y: micrometers(5) },
              count: 7,
            },
          ],
          genes: ['Actb'],
          maxCount: 7,
        })),
        matrix: vi.fn(async () => ({
          geneNames: ['Actb', 'Gad1'],
          cells: new Map([
            [
              'BC-1',
              {
                geneNames: ['Actb', 'Gad1'],
                counts: [9, 3],
              },
            ],
          ]),
        })),
      },
    })
    const getSpatialDataset = createSpatialDatasetLoaderMock(visiumDataset)

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await waitFor(() => {
        expect(visiumDataset.readBinnedOverview).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
          'data-count',
          '2',
        )
      })

      openHudTab('Cell')
      fireEvent.click(screen.getByTestId('deck-layer-spatial-grid-cells'))

      const initialBinInfo = screen.getByRole('region', { name: 'Bin Info' })
      expect(within(initialBinInfo).getByText('BC-1')).toBeInTheDocument()
      expect(
        within(initialBinInfo).getByText('Select a gene or gene set to load expression.'),
      ).toBeInTheDocument()

      await waitFor(() => {
        expect(visiumDataset.matrix).toHaveBeenCalledWith(
          ['BC-1'],
          16,
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      await waitFor(() => {
        expect(within(initialBinInfo).getByText('12 counts')).toBeInTheDocument()
      })
      expect(
        within(initialBinInfo).getByRole('button', { name: 'Refresh Bin GEX' }),
      ).toBeInTheDocument()
      expect(within(initialBinInfo).getAllByText('Selected bin').length).toBeGreaterThan(
        0,
      )
      expect(within(initialBinInfo).getByText('Actb')).toBeInTheDocument()
      expect(within(initialBinInfo).getByText('Gad1')).toBeInTheDocument()

      openHudTab('Genes')
      expect(await screen.findByText('1 genes')).toBeInTheDocument()
      fireEvent.click(await screen.findByRole('button', { name: 'Actb' }))

      await waitFor(() => {
        expect(visiumDataset.geneExpression).toHaveBeenCalled()
      })

      openHudTab('Cell')
      const updatedBinInfo = screen.getByRole('region', { name: 'Bin Info' })
      await waitFor(() => {
        expect(within(updatedBinInfo).getByText('Loaded')).toBeInTheDocument()
      })
      expect(within(updatedBinInfo).getAllByText('Actb').length).toBeGreaterThan(0)
      expect(within(updatedBinInfo).getByText('7')).toBeInTheDocument()
      expect(
        within(updatedBinInfo).queryByText('No expression loaded'),
      ).not.toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('loads Visium HD segmented boundaries through the active spatial dataset', async () => {
    const visiumUrl = 'https://example.test/visium-hd'
    window.history.replaceState(null, '', `/#dataset=${encodeURIComponent(visiumUrl)}`)
    const viewport = installAppViewportFixture()
    const overview = visiumOverviewFixture()
    const detectSpatialDataset = createVisiumHdDetectorMock(
      visiumHdDetectionFixture({
        baseUrl: visiumUrl,
        segmentedOutputs: {
          cellSegmentationsGeojsonPath: 'segmented_outputs/cell_segmentations.geojson',
          nucleusInstanceMaskTiffPath: 'segmented_outputs/nucleus_instance_mask.tiff',
        },
      }),
    )
    const cellBoundaryBatch: { readonly elements: readonly SpatialElement[] } = {
      elements: [
        {
          id: 'cellid_000000001-1',
          geometry: {
            kind: 'polygon' as const,
            rings: [
              [
                { x: micrometers(0), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(10) },
              ],
            ],
          },
        },
      ],
    }
    const cellBoundaryDeferred = deferredPromise<{
      readonly elements: readonly SpatialElement[]
    }>()
    const visiumDataset = createVisiumHdDatasetMock({
      overview,
      meta: visiumHdMetaFixture(overview, {
        capabilities: {
          cellBoundaries: true,
        },
        segmentations: [
          {
            id: 'visium-hd-cell-segmentations',
            kind: 'cell' as const,
            label: 'Cell segmentations',
            sourceKind: 'geojson' as const,
            path: 'segmented_outputs/cell_segmentations.geojson',
          },
          {
            id: 'visium-hd-nucleus-instance-mask',
            kind: 'nucleus' as const,
            label: 'Nucleus instance mask',
            sourceKind: 'tiff' as const,
            path: 'segmented_outputs/nucleus_instance_mask.tiff',
          },
        ],
      }),
      overrides: {
        elements: vi.fn(() => cellBoundaryDeferred.promise),
        barcodeMappingsForCell: vi.fn(async () => [
          {
            square002um: 's_002um_000001_000002-1',
            square008um: 's_008um_000000_000000-1',
            square016um: 'BC-1',
            cellId: 'cellid_000000001-1',
            inNucleus: false,
            inCell: true,
          },
        ]),
        matrix: vi.fn(async () => ({
          geneNames: ['Actb', 'Gad1'],
          cells: new Map([
            [
              'BC-1',
              {
                geneNames: ['Actb', 'Gad1'],
                counts: [8, 4],
              },
            ],
          ]),
        })),
        segmentationElements: vi.fn(async () => [
          {
            id: 'nucleus_000000001',
            geometry: {
              kind: 'polygon' as const,
              rings: [
                [
                  { x: micrometers(1), y: micrometers(1) },
                  { x: micrometers(4), y: micrometers(1) },
                  { x: micrometers(4), y: micrometers(4) },
                ],
              ],
            },
          },
        ]),
      },
    })
    const getSpatialDataset = createSpatialDatasetLoaderMock(visiumDataset)
    const loadBoundaryElements: ReturnType<typeof vi.fn<BoundaryElementsLoader>> = vi.fn(
      async () => ({ elements: [] }),
    )

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
          loadBoundaryElements={loadBoundaryElements}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await screen.findAllByText(/Visium HD ready/)
      expect(visiumDataset.elements).not.toHaveBeenCalled()
      expect(visiumDataset.segmentationElements).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
          'data-count',
          '2',
        )
        expect(screen.queryByTestId('deck-layer-cell-boundary-hit-areas')).toBeNull()
        expect(
          screen.queryByTestId('deck-layer-nucleus-segmentation-polygons'),
        ).toBeNull()
      })
      openHudTab('Layers')
      expect(screen.getByLabelText('Cell boundaries')).not.toBeChecked()
      expect(screen.getByLabelText('Nucleus boundaries')).not.toBeChecked()

      fireEvent.click(screen.getByLabelText('Cell boundaries'))
      await waitFor(() => {
        expect(visiumDataset.elements).toHaveBeenCalledWith(
          expect.objectContaining({
            minX: expect.any(Number) as number,
            maxX: expect.any(Number) as number,
            minY: expect.any(Number) as number,
            maxY: expect.any(Number) as number,
          }),
        )
      })
      await act(async () => {
        cellBoundaryDeferred.resolve(cellBoundaryBatch)
        await cellBoundaryDeferred.promise
      })
      await waitFor(() => {
        expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
          'data-count',
          '2',
        )
        expect(screen.getByTestId('deck-layer-cell-boundary-hit-areas')).toHaveAttribute(
          'data-count',
          '1',
        )
        expect(
          screen.queryByTestId('deck-layer-nucleus-segmentation-polygons'),
        ).toBeNull()
      })

      fireEvent.click(screen.getByLabelText('Nucleus boundaries'))
      await waitFor(() => {
        expect(visiumDataset.segmentationElements).toHaveBeenCalledWith(
          'nucleus',
          expect.objectContaining({
            minX: expect.any(Number) as number,
            maxX: expect.any(Number) as number,
            minY: expect.any(Number) as number,
            maxY: expect.any(Number) as number,
          }),
        )
        expect(
          screen.getByTestId('deck-layer-nucleus-segmentation-polygons'),
        ).toHaveAttribute('data-count', '1')
      })

      fireEvent.click(screen.getByLabelText('Cell boundaries'))
      await waitFor(() => {
        expect(screen.queryByTestId('deck-layer-cell-boundary-hit-areas')).toBeNull()
        expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
          'data-count',
          '2',
        )
        expect(
          screen.getByTestId('deck-layer-nucleus-segmentation-polygons'),
        ).toHaveAttribute('data-count', '1')
      })

      fireEvent.click(screen.getByLabelText('Cell boundaries'))
      await waitFor(() => {
        expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
          'data-count',
          '2',
        )
        expect(screen.getByTestId('deck-layer-cell-boundary-hit-areas')).toHaveAttribute(
          'data-count',
          '1',
        )
      })
      fireEvent.click(screen.getByTestId('deck-layer-cell-boundary-hit-areas'))
      openHudTab('Cell')

      expect(screen.getByRole('heading', { name: 'Cell Info' })).toBeInTheDocument()
      expect(screen.getByText('Selected cell')).toBeInTheDocument()
      expect(screen.getByText('cellid_000000001-1')).toBeInTheDocument()
      const selectedCellInfo = screen.getByRole('region', { name: 'Cell Info' })

      fireEvent.click(
        within(selectedCellInfo).getByRole('button', { name: 'Load Cell GEX' }),
      )

      await waitFor(() => {
        expect(visiumDataset.barcodeMappingsForCell).toHaveBeenCalledWith(
          'cellid_000000001-1',
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      await waitFor(() => {
        expect(visiumDataset.matrix).toHaveBeenCalledWith(
          ['BC-1'],
          16,
          expect.objectContaining({
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      await waitFor(() => {
        expect(within(selectedCellInfo).getByText('12 counts')).toBeInTheDocument()
      })
      expect(within(selectedCellInfo).getByText('Actb')).toBeInTheDocument()
      expect(within(selectedCellInfo).getByText('Gad1')).toBeInTheDocument()
      expect(loadBoundaryElements).not.toHaveBeenCalled()
    } finally {
      viewport.restore()
    }
  })

  it('lets the user configure image and cell layer opacity', () => {
    render(<TestApp />)
    openHudTab('Layers')

    const imageOpacityInput = screen.getByRole('slider', {
      name: 'Dataset image opacity',
    })
    const cellFillOpacityInput = screen.getByRole('slider', {
      name: 'Cell fill opacity',
    })
    const cellBoundaryOpacityInput = screen.getByRole('slider', {
      name: 'Cell boundary opacity',
    })

    expect(cellFillOpacityInput).toHaveValue('50')

    fireEvent.change(imageOpacityInput, { target: { value: '45' } })
    fireEvent.change(cellFillOpacityInput, { target: { value: '70' } })
    fireEvent.change(cellBoundaryOpacityInput, { target: { value: '35' } })

    expect(imageOpacityInput).toHaveValue('45')
    expect(cellFillOpacityInput).toHaveValue('70')
    expect(cellBoundaryOpacityInput).toHaveValue('35')
  })

  it('loads a custom morphology layer from a URL', async () => {
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      async () => [
        {
          cellId: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 8,
        },
      ],
    )
    const baseLoader = {} as TiffPyramidLoader
    const customLoader = {} as TiffPyramidLoader
    const customChannel = {
      id: 'Channel:0',
      index: 0,
      name: 'Custom DAPI',
      color: [88, 144, 255] as const,
      contrast: { min: 0, max: 65_535 },
    }
    const loadCustomMorphologyLayer: ReturnType<
      typeof vi.fn<CustomMorphologyLayerLoader>
    > = vi.fn(async (url) => ({
      url,
      loader: customLoader,
      channels: [customChannel],
      channelLoaders: [{ info: customChannel, loader: customLoader }],
    }))
    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={vi.fn(async () => [])}
        loadMorphologyImage={vi.fn(async () => ({
          url: 'https://example.test/xenium/morphology_focus_0000.ome.tif',
          loader: baseLoader,
          channels: [],
          channelLoaders: [],
        }))}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))
    openHudTab('Layers')

    await waitFor(() => {
      expect(screen.getByLabelText('Custom image URL')).toBeEnabled()
    })

    fireEvent.change(screen.getByLabelText('Custom image URL'), {
      target: { value: 'https://example.test/layers/remote.ome.tif' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Layer' }))

    expect(
      await screen.findByRole('checkbox', { name: 'remote.ome.tif / Custom DAPI' }),
    ).toBeChecked()
    fireEvent.change(screen.getByRole('slider', { name: 'remote.ome.tif opacity' }), {
      target: { value: '35' },
    })
    expect(loadCustomMorphologyLayer).toHaveBeenCalledWith(
      'https://example.test/layers/remote.ome.tif',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    await waitFor(() => {
      expect(window.location.hash).toContain(
        'customImageUrl=https%3A%2F%2Fexample.test%2Flayers%2Fremote.ome.tif',
      )
    })
    await waitFor(() => {
      expect(window.location.hash).toContain('customImageOpacity=0.35')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove remote.ome.tif' }))

    expect(
      screen.queryByRole('checkbox', { name: 'remote.ome.tif / Custom DAPI' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.hash).not.toContain('customImageUrl=')
    })
    expect(window.location.hash).not.toContain('customImageOpacity=')
  })

  it('records compact debug activity entries', () => {
    render(<TestApp />)

    const activityLog = screen.getByLabelText('Activity log')

    expect(within(activityLog).getByText('Idle')).toBeInTheDocument()

    openHudTab('Layers')
    fireEvent.change(screen.getByRole('slider', { name: 'Dataset image opacity' }), {
      target: { value: '45' },
    })
    const coordinateUnitGroup = screen.getByRole('group', {
      name: 'Mouse coordinates',
    })
    fireEvent.click(within(coordinateUnitGroup).getByRole('button', { name: 'px' }))
    fireEvent.click(screen.getByRole('button', { name: 'Distance measure' }))
    const measurementUnitGroup = screen.getByRole('group', { name: 'Measure unit' })
    fireEvent.click(within(measurementUnitGroup).getByRole('button', { name: 'px' }))

    openHudTab('Dataset')
    expect(
      within(activityLog).getByText('Dataset image opacity: 45%'),
    ).toBeInTheDocument()
    expect(within(activityLog).getByText('Mouse coordinates: px')).toBeInTheDocument()
    expect(within(activityLog).getByText('Distance measure enabled')).toBeInTheDocument()
    expect(within(activityLog).getByText('Measure unit: px')).toBeInTheDocument()

    fireEvent.click(within(activityLog).getByRole('button', { name: 'Clear' }))

    expect(within(activityLog).getByText('Idle')).toBeInTheDocument()
  })

  it('collapses and expands the control HUD', () => {
    render(<TestApp />)

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
      '/#xv=1&dataset=https%3A%2F%2Fexample.test%2Fxenium&annotationUrl=https%3A%2F%2Fexample.test%2Fannotations%2Fmanual.csv&customImageUrl=https%3A%2F%2Fexample.test%2Flayers%2Fhe.ome.tif&customImageOpacity=0.35&tab=genes&genes=Actb%2CGad1&scale=viridis&coord=px&imgOpacity=0.45&cellFill=0.7&cellBoundary=0.35&channels=Channel%3A1&lensScope=cursor&lens=1&lensRadius=120&lensQv=18',
    )
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
    const customLoader = {} as TiffPyramidLoader
    const customChannel = {
      id: 'Channel:0',
      index: 0,
      name: 'H&E',
      color: [255, 255, 255] as const,
      contrast: { min: 0, max: 255 },
    }
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      async () => [
        {
          cellId: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 8,
        },
      ],
    )
    const loadGenePanel = vi.fn(async () => ['Actb', 'Gad1'])
    const loadMorphologyImage = vi.fn(async () => ({
      url: 'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      loader: dapiLoader,
      channels: [dapiChannel, boundaryChannel],
      channelLoaders: [
        { info: dapiChannel, loader: dapiLoader },
        { info: boundaryChannel, loader: boundaryLoader },
      ],
    }))
    const loadCustomMorphologyLayer: ReturnType<
      typeof vi.fn<CustomMorphologyLayerLoader>
    > = vi.fn(async (url) => ({
      url,
      loader: customLoader,
      channels: [customChannel],
      channelLoaders: [{ info: customChannel, loader: customLoader }],
    }))
    const computeAutoChannelContrast = vi.fn(async () => ({
      min: 0,
      max: 1,
      histogram: {
        bins: Array.from({ length: 32 }, () => 1),
        maxCount: 1,
        min: 0,
        max: 1,
        sampleCount: 32,
      },
    }))
    const fetchAnnotations = vi.fn(
      async () => new Response(`cell_id,label\n${intToCellId(1, 1)},Manual annotation`),
    )
    vi.stubGlobal('fetch', fetchAnnotations)

    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadMorphologyImage={loadMorphologyImage}
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
        computeAutoChannelContrast={computeAutoChannelContrast}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Genes' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('combobox', { name: 'Gene scale' })).toHaveValue('viridis')
    expect(screen.getByRole('button', { name: 'Actb' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gad1' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText('Dataset or image URL')).toHaveValue(
        'https://example.test/xenium',
      )
    })
    expect(loadDatasetOverview).toHaveBeenCalledWith(
      'https://example.test/xenium',
      expect.objectContaining({
        includeCellIds: true,
        limit: null,
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    )

    openHudTab('Layers')
    expect(screen.getByRole('slider', { name: 'Dataset image opacity' })).toHaveValue(
      '45',
    )
    expect(screen.getByRole('slider', { name: 'Cell fill opacity' })).toHaveValue('70')
    expect(screen.getByRole('slider', { name: 'Cell boundary opacity' })).toHaveValue(
      '35',
    )
    expect(await screen.findByRole('checkbox', { name: 'DAPI' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Boundary' })).toBeChecked()
    expect(
      await screen.findByRole('checkbox', { name: 'he.ome.tif / H&E' }),
    ).toBeChecked()
    expect(screen.getByRole('slider', { name: 'he.ome.tif opacity' })).toHaveValue('35')
    expect(loadCustomMorphologyLayer).toHaveBeenCalledWith(
      'https://example.test/layers/he.ome.tif',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    openHudTab('Magic Lens')
    expect(screen.getByRole('spinbutton', { name: 'Min QV' })).toHaveValue(18)
    expect(screen.getByRole('slider', { name: 'Radius' })).toHaveValue('120')
    expect(screen.getByRole('button', { name: 'Disable Lens' })).toBeEnabled()

    openHudTab('Annotations')
    expect(screen.getByLabelText('Annotation URL')).toHaveValue(
      'https://example.test/annotations/manual.csv',
    )
    await waitFor(() => {
      expect(fetchAnnotations).toHaveBeenCalledWith(
        'https://example.test/annotations/manual.csv',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(await screen.findAllByText('Manual annotation')).not.toHaveLength(0)
  })

  it('auto-loads a dataset URL from the query string without waiting for a click', async () => {
    const queryDatasetUrl = 'https://example.test/query-xenium'
    window.history.replaceState(
      null,
      '',
      `/?dataset=${encodeURIComponent(queryDatasetUrl)}`,
    )
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      async () => [
        {
          cellId: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 8,
        },
      ],
    )
    const loadGenePanel = vi.fn(async () => [])
    const loadMorphologyImage = vi.fn(async () => ({
      url: `${queryDatasetUrl}/morphology_focus/morphology_focus_0000.ome.tif`,
      loader: {} as TiffPyramidLoader,
      channels: [],
      channelLoaders: [],
    }))

    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadMorphologyImage={loadMorphologyImage}
      />,
    )

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledWith(
        queryDatasetUrl,
        expect.objectContaining({
          includeCellIds: true,
          limit: null,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(screen.getByLabelText('Dataset or image URL')).toHaveValue(queryDatasetUrl)

    fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
      target: { value: 'https://example.test/typed' },
    })

    expect(loadDatasetOverview).toHaveBeenCalledTimes(1)
  })

  it('starts query-string auto-load once after the StrictMode probe settles', async () => {
    const queryDatasetUrl = 'https://example.test/strict-xenium'
    window.history.replaceState(
      null,
      '',
      `/?dataset=${encodeURIComponent(queryDatasetUrl)}`,
    )
    const loadDatasetOverview: ReturnType<typeof vi.fn<DatasetOverviewLoader>> = vi.fn(
      async () => [
        {
          cellId: intToCellId(1, 1),
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 8,
        },
      ],
    )
    const loadGenePanel = vi.fn(async () => [])
    const loadMorphologyImage = vi.fn(async () => ({
      url: `${queryDatasetUrl}/morphology_focus/morphology_focus_0000.ome.tif`,
      loader: {} as TiffPyramidLoader,
      channels: [],
      channelLoaders: [],
    }))

    render(
      <StrictMode>
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadMorphologyImage={loadMorphologyImage}
        />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(loadDatasetOverview).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
  })

  it('runs dataset diagnostics and summarizes the report', async () => {
    const runDatasetDiagnostics: ReturnType<typeof vi.fn<DatasetDiagnosticsRunner>> =
      vi.fn(async (baseUrl) => ({
        baseUrl,
        platform: 'xenium',
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

    render(<TestApp runDatasetDiagnostics={runDatasetDiagnostics} />)

    fireEvent.click(screen.getByRole('button', { name: 'Diagnose Dataset' }))

    expect(await screen.findByText('All checks passed')).toBeInTheDocument()
    expect(screen.getByText('Overview cells')).toBeInTheDocument()
    expect(runDatasetDiagnostics).toHaveBeenCalledWith(
      expect.stringContaining('/public/xenium/'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('scans current viewport cells with the magic lens', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb', 'Gad1'])
    const cellId = intToCellId(1, 1)
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [
      {
        id: cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [
          {
            gene: 'Actb',
            count: 2,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 2,
            percentTotal: 66.7,
          },
          {
            gene: 'Gad1',
            count: 1,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 1,
            percentTotal: 33.3,
          },
        ],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 3,
        hitCellLimit: false,
      }),
    )
    const loadRoiTranscripts: ReturnType<typeof vi.fn<RoiTranscriptsLoader>> = vi.fn(
      async () => [],
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
          loadRoiTranscripts={loadRoiTranscripts}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Genes')
      expect(await screen.findByText('2 genes')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Actb' }))

      openHudTab('Magic Lens')
      fireEvent.click(screen.getByRole('button', { name: 'Viewport' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Scan Lens' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Scan Lens' }))

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
            limit: 25_000,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      await waitFor(() => {
        expect(loadRoiGeneStats).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.arrayContaining([
            expect.objectContaining({ id: cellId }) as unknown as object,
          ]),
          expect.objectContaining({
            cellLimit: 25_000,
            geneLimit: 10_000,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(loadRoiTranscripts).not.toHaveBeenCalled()

      const results = await screen.findByLabelText('Magic lens results')
      expect(results).toHaveTextContent('Transcripts')
      expect(results).toHaveTextContent('8')
      expect(results).toHaveTextContent('Genes')
      expect(results).toHaveTextContent('2')
      expect(results).toHaveTextContent('Selected')
      expect(results).toHaveTextContent('2')
      const distribution = screen.getByLabelText('Magic lens gene distribution')
      expect(distribution).toHaveTextContent('Actb')
      expect(distribution).toHaveTextContent('Gad1')
    } finally {
      viewport.restore()
    }
  })

  it('aborts an active magic lens scan when drawing a new ROI', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    let magicLensSignal: AbortSignal | undefined
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(
      (_baseUrl, _selection, options) => {
        if (magicLensSignal === undefined) {
          magicLensSignal = options?.signal
          return pendingPromise()
        }

        return Promise.resolve([
          {
            id: intToCellId(1, 1),
            position: { x: micrometers(10), y: micrometers(20) },
            transcriptCount: 8,
            cellArea: 22,
          },
        ])
      },
    )
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(() => {
      return pendingPromise()
    })
    const loadRoiTranscripts: ReturnType<typeof vi.fn<RoiTranscriptsLoader>> = vi.fn(
      async () => [],
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiTranscripts={loadRoiTranscripts}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Magic Lens')
      fireEvent.click(await screen.findByRole('button', { name: 'Viewport' }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Scan Lens' })).toBeEnabled()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Scan Lens' }))

      await waitFor(() => {
        expect(loadRoiCells).toHaveBeenCalledTimes(1)
      })
      expect(magicLensSignal?.aborted).toBe(false)
      expect(loadRoiTranscripts).not.toHaveBeenCalled()

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
        expect(loadRoiCells).toHaveBeenCalledTimes(2)
      })
      expect(magicLensSignal?.aborted).toBe(true)
      expect(screen.getByRole('tab', { name: 'Magic Lens' })).not.toHaveAttribute(
        'aria-busy',
        'true',
      )
    } finally {
      viewport.restore()
    }
  })

  it('scans exact circle cells while cursor magic lens is enabled', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb', 'Gad1'])
    const insideCellId = intToCellId(1, 1)
    const outsideCellId = intToCellId(1, 2)
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(async () => [
      {
        id: insideCellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
      {
        id: outsideCellId,
        position: { x: micrometers(240), y: micrometers(20) },
        transcriptCount: 12,
        cellArea: 24,
      },
    ])
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [
          {
            gene: 'Actb',
            count: 8,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 8,
            percentTotal: 100,
          },
        ],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 8,
        hitCellLimit: false,
      }),
    )
    const loadRoiTranscripts: ReturnType<typeof vi.fn<RoiTranscriptsLoader>> = vi.fn(
      async () => [],
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
          loadRoiTranscripts={loadRoiTranscripts}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Magic Lens')
      const enableButton = await screen.findByRole('button', { name: 'Enable Lens' })
      await waitFor(() => {
        expect(enableButton).toBeEnabled()
      })
      fireEvent.click(enableButton)
      fireEvent.pointerMove(
        screen.getByRole('img', { name: 'Spatial viewer canvas area' }),
        {
          clientX: 500,
          clientY: 500,
        },
      )

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
            limit: 25_000,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      await waitFor(() => {
        expect(loadRoiGeneStats).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          [expect.objectContaining({ id: insideCellId })],
          expect.objectContaining({
            cellLimit: 25_000,
            geneLimit: 10_000,
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(loadRoiTranscripts).not.toHaveBeenCalled()

      const results = await screen.findByLabelText('Magic lens results')
      expect(results).toHaveTextContent('Transcripts')
      expect(results).toHaveTextContent('8')
      expect(results).toHaveTextContent('Cells')
      expect(results).toHaveTextContent('1')
      expect(screen.getByLabelText('Magic lens gene distribution')).toHaveTextContent(
        'Actb',
      )
      expect(screen.getByLabelText('Magic lens gene distribution')).not.toHaveTextContent(
        'Gad1',
      )
    } finally {
      viewport.restore()
    }
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
      <TestApp
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
    const queuedTaskList = within(loadingStatus).getByRole('list', {
      name: 'Additional loading tasks',
    })

    expect(queuedTaskList.querySelectorAll('.loading-task-bullet')).toHaveLength(
      queuedTaskList.querySelectorAll('li').length,
    )
    expect(loadingStatus.closest('.control-hud')).toBeNull()
    expect(loadingStatus.closest('.viewport-notification-stack')).not.toBeNull()
    expect(loadingStatus.closest('.viewer-region')).not.toBeNull()
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
    render(<TestApp />)

    const boundaryLimitInput = screen.getByRole('spinbutton', {
      name: 'Boundary limit',
    })

    fireEvent.change(boundaryLimitInput, { target: { value: '750' } })

    expect(boundaryLimitInput).toHaveValue(750)
  })

  it('lets the user configure the gene expression color scale', () => {
    render(<TestApp />)
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
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        <TestApp
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
      viewport.restore()
    }
  })

  it('lists H5AD annotations and obsm embeddings without loading them by default', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const h5adUrl = 'https://example.test/sample.h5ad'
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'h5ad' as const,
      baseUrl: h5adUrl,
      h5adUrl,
      checked: [],
    }))
    const h5adCells = Array.from({ length: 3_005 }, (_value, index) => ({
      cellId: index === 0 ? 'cell-a' : `cell-${index}`,
      position: { x: micrometers(index % 100), y: micrometers(Math.floor(index / 100)) },
      transcriptCount: 0,
    }))
    const h5adDataset = {
      overview: vi.fn(async () => h5adCells),
      genePanel: vi.fn(async () => []),
      annotationGroups: vi.fn(async () => [
        {
          id: 'analysis:cell-type',
          label: 'cell_type',
          groupingName: 'cell_type',
          groupCount: 2,
        },
      ]),
      annotations: vi.fn(async () => [
        {
          id: 'analysis:cell-type:t-cell',
          label: 'cell_type: T cell',
          cellIds: ['cell-a'],
        },
      ]),
      metadataTracks: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => [
        { kind: 'X_umap', label: 'UMAP', sourcePath: '/obsm/X_umap' },
        { kind: 'X_pca', label: 'PCA', sourcePath: '/obsm/X_pca' },
      ]),
      embeddings: vi.fn(async (options?: { readonly kind?: string }) =>
        options?.kind === 'X_pca'
          ? [
              {
                kind: 'X_pca',
                label: 'PCA',
                sourcePath: '/obsm/X_pca',
                points: [{ id: 'cell-a', x: 1, y: 1 }],
              },
            ]
          : [
              {
                kind: 'X_umap',
                label: 'UMAP',
                sourcePath: '/obsm/X_umap',
                points: [{ id: 'cell-a', x: 0, y: 0 }],
              },
            ],
      ),
    }
    const getSpatialDataset = createSpatialDatasetLoaderMock(h5adDataset)
    const loadAnalysisEmbeddings: ReturnType<typeof vi.fn<AnalysisEmbeddingsLoader>> =
      vi.fn(async () => [])

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
          loadAnalysisEmbeddings={loadAnalysisEmbeddings}
        />,
      )
      fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
        target: { value: h5adUrl },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await screen.findByText(/H5AD ready: 3,005 cells, 0 genes/)
      expect(screen.getByTestId('deck-layer-cells-overview-scatter')).toHaveAttribute(
        'data-count',
        '3005',
      )

      openHudTab('Annotations')
      const annotationSet = screen.getByRole('combobox', { name: 'Annotation set' })
      const loadAnnotationsButton = screen.getByRole('button', {
        name: 'Load Annotations',
      })

      expect(annotationSet).toHaveValue(NO_ANNOTATION_GROUP_ID)
      expect(
        within(annotationSet).getByRole('option', { name: 'cell_type' }),
      ).toHaveValue('analysis:cell-type')
      expect(loadAnnotationsButton).toBeDisabled()
      expect(h5adDataset.annotations).not.toHaveBeenCalled()
      expect(h5adDataset.metadataTracks).not.toHaveBeenCalled()

      fireEvent.change(annotationSet, { target: { value: 'analysis:cell-type' } })
      expect(loadAnnotationsButton).toBeEnabled()
      fireEvent.click(loadAnnotationsButton)

      await screen.findByText('Annotations loaded: 1 labels')
      expect(h5adDataset.annotations).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'analysis:cell-type' }),
      )

      openHudTab('Cell')
      const embeddingView = screen.getByRole('combobox', { name: 'Embedding view' })

      expect(within(embeddingView).getByRole('option', { name: 'UMAP' })).toHaveValue(
        'X_umap',
      )
      expect(within(embeddingView).getByRole('option', { name: 'PCA' })).toHaveValue(
        'X_pca',
      )
      expect(h5adDataset.embeddings).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))

      expect(await screen.findByText('UMAP: 1 cells')).toBeInTheDocument()
      expect(screen.getByLabelText('UMAP embedding, 1 cells')).toBeInTheDocument()
      expect(h5adDataset.embeddings).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'X_umap' }),
      )
      expect(loadAnalysisEmbeddings).not.toHaveBeenCalled()

      fireEvent.change(embeddingView, { target: { value: 'X_pca' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))

      expect(await screen.findByText('PCA: 1 cells')).toBeInTheDocument()
      expect(screen.getByLabelText('PCA embedding, 1 cells')).toBeInTheDocument()
      expect(h5adDataset.embeddings).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'X_pca' }),
      )
    } finally {
      viewport.restore()
    }
  })

  it('loads H5AD selected-cell observations and expression from the matrix', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const h5adUrl = 'https://example.test/sample.h5ad'
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'h5ad' as const,
      baseUrl: h5adUrl,
      h5adUrl,
      checked: [],
    }))
    const h5adDataset = {
      overview: vi.fn(async () => [
        {
          cellId: 'cell-a',
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 0,
          metadata: {
            BARCODE_SAMPLE_CROP: 'TTCTCTCTCACTCCGT-1_WSSS_PLA8810751_1',
            FINAL_ANNOT_INV_TROPH_CORRECTED: 'INV_TROPH',
            N_GENES: 5395,
          },
        },
      ]),
      genePanel: vi.fn(async () => ['Actb', 'Gad1']),
      annotationGroups: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => []),
      matrix: vi.fn(async () => ({
        geneNames: ['Actb', 'Gad1'],
        cells: new Map([['cell-a', { geneNames: ['Actb', 'Gad1'], counts: [7, 3] }]]),
      })),
    }
    const getSpatialDataset = createSpatialDatasetLoaderMock(h5adDataset)

    try {
      render(
        <TestApp
          detectSpatialDataset={detectSpatialDataset}
          getSpatialDataset={getSpatialDataset}
        />,
      )
      fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
        target: { value: h5adUrl },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      await screen.findByText(/H5AD ready: 1 cells, 2 genes/)
      fireEvent.click(screen.getByTestId('deck-layer-cells-overview-scatter'))
      openHudTab('Cell')

      const cellInfoSection = screen.getByRole('region', { name: 'Cell Info' })
      await waitFor(() => {
        expect(h5adDataset.matrix).toHaveBeenCalledWith(['cell-a'])
      })

      expect(within(cellInfoSection).getByText('BARCODE_SAMPLE_CROP')).toBeInTheDocument()
      expect(
        within(cellInfoSection).getByText('TTCTCTCTCACTCCGT-1_WSSS_PLA8810751_1'),
      ).toBeInTheDocument()
      expect(
        within(cellInfoSection).getByText('FINAL_ANNOT_INV_TROPH_CORRECTED'),
      ).toBeInTheDocument()
      expect(within(cellInfoSection).getByText('N_GENES')).toBeInTheDocument()
      expect(within(cellInfoSection).queryByText('Cell Area')).not.toBeInTheDocument()
      expect(within(cellInfoSection).queryByText('Eccentricity')).not.toBeInTheDocument()
      expect(within(cellInfoSection).queryByText('Major Axis')).not.toBeInTheDocument()
      expect(within(cellInfoSection).queryByText('Circularity')).not.toBeInTheDocument()

      const expressionList =
        await within(cellInfoSection).findByLabelText('Cell gene expression')
      expect(expressionList).toHaveTextContent('Actb')
      expect(expressionList).toHaveTextContent('Gad1')
      expect(within(cellInfoSection).getByText('10 counts')).toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('loads full expression and shape metrics for a selected cell', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const cellId = intToCellId(1, 1)
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(0), y: micrometers(0) },
        transcriptCount: 8,
        cellArea: 22,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadAnnotations: ReturnType<typeof vi.fn<AnnotationLoader>> = vi.fn(
      async () => [
        { id: 'annotation:t-cell', label: 'T cells', cellIds: [cellId] },
        { id: 'annotation:other', label: 'Other cells', cellIds: [intToCellId(2, 1)] },
      ],
    )
    const loadAnalysisEmbeddings: ReturnType<typeof vi.fn<AnalysisEmbeddingsLoader>> =
      vi.fn(async () => [
        {
          kind: 'umap',
          label: 'UMAP',
          sourcePath: 'analysis/umap/gene_expression_2_components/projection.csv',
          points: [{ id: cellId, x: 0, y: 0 }],
        },
      ])
    const loadBoundaryElements: ReturnType<typeof vi.fn<BoundaryElementsLoader>> = vi.fn(
      async () => ({
        elements: [
          {
            id: cellId,
            geometry: {
              kind: 'polygon',
              rings: [
                [
                  { x: micrometers(-2), y: micrometers(-2) },
                  { x: micrometers(2), y: micrometers(-2) },
                  { x: micrometers(2), y: micrometers(2) },
                  { x: micrometers(-2), y: micrometers(2) },
                ],
              ],
            },
          },
        ],
      }),
    )
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [
          {
            gene: 'Actb',
            count: 7,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 7,
            percentTotal: 70,
          },
          {
            gene: 'Gad1',
            count: 3,
            detectedCells: 1,
            percentCells: 100,
            meanPerCell: 3,
            percentTotal: 30,
          },
        ],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 10,
        hitCellLimit: false,
      }),
    )
    const loadCellTranscriptDistribution: ReturnType<
      typeof vi.fn<CellTranscriptDistributionLoader>
    > = vi.fn(async () => ({
      bins: [
        { minZ: 0, maxZ: 1, count: 5, percent: 62.5 },
        { minZ: 1, maxZ: 2, count: 3, percent: 37.5 },
      ],
      transcriptCount: 8,
      zCount: 8,
      missingZCount: 0,
      minZ: 0,
      maxZ: 2,
      maxBinCount: 5,
      hitTranscriptLimit: false,
      minQv: 20,
    }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadAnnotations={loadAnnotations}
          loadAnalysisEmbeddings={loadAnalysisEmbeddings}
          loadBoundaryElements={loadBoundaryElements}
          loadRoiGeneStats={loadRoiGeneStats}
          loadCellTranscriptDistribution={loadCellTranscriptDistribution}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Annotations')
      fireEvent.click(await screen.findByRole('button', { name: 'Load Annotations' }))
      expect(await screen.findByLabelText('Loaded annotations')).toHaveTextContent(
        'T cells',
      )

      openHudTab('Cell')
      fireEvent.click(await screen.findByRole('button', { name: 'Load Embeddings' }))
      const embeddingCanvas = await screen.findByLabelText('UMAP embedding, 1 cells')
      fireEvent.pointerDown(embeddingCanvas, { clientX: 500, clientY: 500 })

      await waitFor(() => {
        expect(loadRoiGeneStats).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          [
            expect.objectContaining({
              id: cellId,
              transcriptCount: 8,
              cellArea: 22,
            }) as unknown as object,
          ],
          expect.objectContaining({
            cellLimit: 1,
            geneLimit: 100_000,
            sampleStrategy: 'head',
            signal: expect.any(AbortSignal) as AbortSignal,
          }),
        )
      })
      expect(loadBoundaryElements).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          minX: expect.any(Number) as number,
          maxX: expect.any(Number) as number,
          minY: expect.any(Number) as number,
          maxY: expect.any(Number) as number,
        }) as object,
        expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
      )
      await waitFor(() => {
        expect(loadCellTranscriptDistribution).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          cellId,
          expect.objectContaining({
            limit: 100_000,
            minQv: 20,
            binCount: 16,
            signal: expect.any(AbortSignal) as AbortSignal,
            boundaryPolygon: expect.arrayContaining([
              expect.objectContaining({
                x: micrometers(-2),
                y: micrometers(-2),
              }) as object,
            ]) as object,
          }),
        )
      })

      const expressionList = await screen.findByLabelText('Cell gene expression')
      expect(
        await screen.findByLabelText('Cell transcript z-axis distribution'),
      ).toHaveTextContent('8 z records')
      expect(screen.getByText('Z location (um)')).toBeInTheDocument()
      expect(expressionList).toHaveTextContent('Actb')
      expect(expressionList).toHaveTextContent('Gad1')
      expect(screen.getByText('10 counts')).toBeInTheDocument()
      expect(screen.getByText('5.3 um')).toBeInTheDocument()
      expect(screen.getByText('Eccentricity')).toBeInTheDocument()
      expect(screen.getAllByText('0').length).toBeGreaterThan(0)
      const cellInfoSection = screen.getByRole('region', { name: 'Cell Info' })
      const annotationsTerm = within(cellInfoSection).getByText('Annotations')
      expect(annotationsTerm.nextElementSibling).toHaveTextContent('T cells')
      expect(annotationsTerm.nextElementSibling).not.toHaveTextContent('Other cells')

      fireEvent.click(within(cellInfoSection).getByRole('button', { name: 'Clear Cell' }))

      expect(within(cellInfoSection).getByText('No cell selected')).toBeInTheDocument()
      expect(
        within(cellInfoSection).queryByRole('button', { name: 'Clear Cell' }),
      ).not.toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('loads exact expression for the current region when requested', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        elements: [
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
        <TestApp
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
      viewport.restore()
    }
  })

  it('loads a stable whole-slide expression sample at overview zoom', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        elements: [],
        genes: ['Actb'],
        maxCount: 0,
      }),
    )

    try {
      render(
        <TestApp
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
      viewport.restore()
    }
  })

  it('can request gene expression across all slide cells without sampling', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        elements: [],
        genes: ['Actb'],
        maxCount: 0,
      }),
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadGeneExpression={loadGeneExpression}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('Genes')
      expect(await screen.findByText('1 genes')).toBeInTheDocument()
      fireEvent.change(screen.getByRole('combobox', { name: 'Expression detail' }), {
        target: { value: 'all-cells' },
      })
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
          limit: 50_001,
          sampleStride: 1,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
      expect(
        await screen.findByText(
          'Expression all cells: 0 positive cells across 50,001 slide cells',
        ),
      ).toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('loads overview cells without morphology image when the option is disabled', async () => {
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
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        loadGenePanel={loadGenePanel}
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

  it('finishes the lazy transcript capability check when the Transcripts tab opens', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))

    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadTranscriptCapabilities={loadTranscriptCapabilities}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
    openHudTab('Transcripts')

    await waitFor(() => {
      expect(loadTranscriptCapabilities).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    })
    expect(await screen.findByText('Exact only')).toBeInTheDocument()
    expect(
      screen.queryByText('Checking transcript outputs for this dataset.'),
    ).not.toBeInTheDocument()
  })

  it('adds transcript feature filters from the transcript search control', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb', 'Gad1', 'Gad2'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))

    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        loadTranscriptCapabilities={loadTranscriptCapabilities}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
    openHudTab('Transcripts')

    const featureSearchInput = screen.getByLabelText('Feature search')
    await waitFor(() => {
      expect(featureSearchInput).toBeEnabled()
    })
    fireEvent.change(featureSearchInput, { target: { value: 'gad' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Gad1' }))

    expect(screen.getByRole('combobox', { name: 'Feature filter' })).toHaveValue(
      'selected',
    )
    expect(screen.getByLabelText('Transcript selected features')).toHaveTextContent(
      'Gad1',
    )
    expect(screen.queryByRole('button', { name: 'Gad2' })).not.toBeInTheDocument()
  })

  it('requires an explicit load action for near-budget exact transcript viewports', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 80_000,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))
    const loadTranscriptViewport: ReturnType<typeof vi.fn<TranscriptViewportLoader>> =
      vi.fn(async () => ({
        points: [],
        groups: [],
        hitPointLimit: false,
      }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptViewport={loadTranscriptViewport}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Exact only')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      expect(
        await screen.findByText(
          /Exact transcript viewport is near the 100,000 point budget/,
        ),
      ).toBeInTheDocument()
      expect(loadTranscriptViewport).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Load exact viewport' }))

      await waitFor(() => {
        expect(loadTranscriptViewport).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.any(Object),
          expect.objectContaining({
            pointLimit: 100_000,
          }),
        )
      })
    } finally {
      viewport.restore()
    }
  })

  it('renders density squares when native transcript LOD planning is selected', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
      {
        cellId: intToCellId(1, 2),
        position: { x: micrometers(40), y: micrometers(60) },
        transcriptCount: 12,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: true,
    }))
    const loadTranscriptAggregates: ReturnType<typeof vi.fn<TranscriptAggregateLoader>> =
      vi.fn(async () => ({
        source: 'native-zarr',
        selectedFeatureNames: [],
        level: {
          level: 2,
          gridSizeMicrometers: 1_000,
          gridKeys: ['0,0'],
          transcriptCounts: [20],
        },
        scaleMax: 100,
        bins: [
          {
            id: 'native-zarr-grid:2:0:0',
            source: 'native-zarr',
            level: 2,
            binX: 0,
            binY: 0,
            position: { x: micrometers(500), y: micrometers(500) },
            radiusMicrometers: 420,
            binSizeMicrometers: 1_000,
            count: 20,
          },
        ],
      }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptAggregates={loadTranscriptAggregates}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Native LOD + exact')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('combobox', { name: 'Feature filter' }), {
        target: { value: 'all' },
      })
      fireEvent.change(screen.getByRole('combobox', { name: 'Detail' }), {
        target: { value: 'density' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      expect(
        await screen.findByText(/Showing native all-transcript density squares/),
      ).toBeInTheDocument()
      const densityScale = screen.getByLabelText(
        'Transcript density color scale from 0 to 100 transcripts per square.',
      )
      expect(within(densityScale).getByText('0')).toBeInTheDocument()
      expect(within(densityScale).getByText('50')).toBeInTheDocument()
      expect(within(densityScale).getByText('100')).toBeInTheDocument()
      expect(screen.getByText('Native')).toBeInTheDocument()
      expect(screen.getAllByText(/^[1-9][0-9]* squares$/).length).toBeGreaterThan(0)
      expect(loadTranscriptAggregates).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.any(Object),
        expect.objectContaining({
          mode: 'density',
          featureNames: [],
          maxBins: 1_500,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    } finally {
      viewport.restore()
    }
  })

  it('keeps selected-gene transcript Density on all-transcript squares', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb', 'CD74'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: true,
    }))
    const loadTranscriptAggregates: ReturnType<typeof vi.fn<TranscriptAggregateLoader>> =
      vi.fn(async () => ({
        source: 'native-zarr',
        selectedFeatureNames: [],
        level: {
          level: 0,
          gridSizeMicrometers: 40,
          gridKeys: ['1,1'],
          transcriptCounts: [13],
        },
        scaleMax: 100,
        bins: [
          {
            id: 'native-zarr-density:0:1:1',
            source: 'native-zarr',
            glyphType: 'density',
            level: 0,
            binX: 1,
            binY: 1,
            position: { x: micrometers(60), y: micrometers(60) },
            radiusMicrometers: 16,
            binSizeMicrometers: 40,
            count: 13,
          },
        ],
      }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptAggregates={loadTranscriptAggregates}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Genes')
      expect(await screen.findByText('2 genes')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Gene selection'), {
        target: { value: 'act' },
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Actb' }))
      fireEvent.change(screen.getByLabelText('Gene selection'), {
        target: { value: 'cd' },
      })
      fireEvent.click(await screen.findByRole('button', { name: 'CD74' }))

      openHudTab('Transcripts')
      expect(await screen.findByText('Native LOD + exact')).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Bins' })).not.toBeInTheDocument()

      fireEvent.change(screen.getByRole('combobox', { name: 'Detail' }), {
        target: { value: 'density' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      expect(
        await screen.findByText(/Showing native all-transcript density squares/),
      ).toBeInTheDocument()
      expect(screen.getAllByText(/^[1-9][0-9]* squares$/).length).toBeGreaterThan(0)
      expect(loadTranscriptAggregates).toHaveBeenLastCalledWith(
        DEMO_DATASET_URL,
        expect.any(Object),
        expect.objectContaining({
          mode: 'density',
          featureNames: [],
          maxBins: 1_500,
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    } finally {
      viewport.restore()
    }
  })

  it('uses density squares in Auto when the transcript estimate exceeds budget', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 200_000,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: true,
    }))
    const loadTranscriptViewport: ReturnType<typeof vi.fn<TranscriptViewportLoader>> =
      vi.fn(() => pendingPromise())
    const loadTranscriptAggregates: ReturnType<typeof vi.fn<TranscriptAggregateLoader>> =
      vi.fn(async () => ({
        source: 'native-zarr',
        selectedFeatureNames: [],
        level: {
          level: 2,
          gridSizeMicrometers: 1_000,
          gridKeys: ['0,0'],
          transcriptCounts: [200_000],
        },
        scaleMax: 100,
        bins: [
          {
            id: 'native-zarr-grid:2:0:0',
            source: 'native-zarr',
            level: 2,
            binX: 0,
            binY: 0,
            position: { x: micrometers(500), y: micrometers(500) },
            radiusMicrometers: 420,
            binSizeMicrometers: 1_000,
            count: 200_000,
          },
        ],
      }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptAggregates={loadTranscriptAggregates}
          loadTranscriptViewport={loadTranscriptViewport}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Native LOD + exact')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Feature filter' })).toHaveValue('all')

      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      expect(
        await screen.findByText(/Showing native all-transcript density squares/),
      ).toBeInTheDocument()
      expect(screen.getAllByText(/^[1-9][0-9]* squares$/).length).toBeGreaterThan(0)
      expect(loadTranscriptAggregates).toHaveBeenCalled()
      expect(loadTranscriptViewport).not.toHaveBeenCalled()
    } finally {
      viewport.restore()
    }
  })

  it('switches Auto to exact transcripts when the estimate is inside budget', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: true,
    }))
    const loadTranscriptAggregates: ReturnType<typeof vi.fn<TranscriptAggregateLoader>> =
      vi.fn(async () => ({
        source: 'native-zarr',
        selectedFeatureNames: [],
        level: {
          level: 2,
          gridSizeMicrometers: 1_000,
          gridKeys: ['0,0'],
          transcriptCounts: [8],
        },
        scaleMax: 100,
        bins: [],
      }))
    const loadTranscriptViewport: ReturnType<typeof vi.fn<TranscriptViewportLoader>> =
      vi.fn(async () => ({
        points: [
          {
            id: 'F1:101',
            transcriptId: '101',
            cellId: null,
            cellAssignment: 'unavailable',
            featureName: 'Actb',
            fovName: 'F1',
            position: { x: micrometers(10), y: micrometers(20) },
            qv: 37,
            isGene: true,
          },
        ],
        groups: [],
        hitPointLimit: false,
      }))

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptAggregates={loadTranscriptAggregates}
          loadTranscriptViewport={loadTranscriptViewport}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Native LOD + exact')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('combobox', { name: 'Feature filter' }), {
        target: { value: 'all' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      await waitFor(() => {
        expect(loadTranscriptViewport).toHaveBeenCalledWith(
          DEMO_DATASET_URL,
          expect.any(Object),
          expect.objectContaining({
            pointLimit: 100_000,
            featureNames: [],
          }),
        )
      })
      expect(loadTranscriptAggregates).not.toHaveBeenCalled()
      expect(await screen.findByText('1 points')).toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('times out exact transcript loading instead of staying busy forever', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))
    const loadTranscriptViewport: ReturnType<typeof vi.fn<TranscriptViewportLoader>> =
      vi.fn(() => pendingPromise())

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptViewport={loadTranscriptViewport}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Exact only')).toBeInTheDocument()
      await waitFor(() => {
        expect(
          within(screen.getByLabelText('Transcript overlay summary')).getByText('8'),
        ).toBeInTheDocument()
      })

      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Exact budget' }), {
        target: { value: '75000' },
      })
      fireEvent.change(screen.getByRole('combobox', { name: 'Feature filter' }), {
        target: { value: 'all' },
      })
      fireEvent.change(screen.getByRole('combobox', { name: 'Detail' }), {
        target: { value: 'exact' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(220)
      })
      expect(loadTranscriptViewport).toHaveBeenCalledWith(
        DEMO_DATASET_URL,
        expect.any(Object),
        expect.objectContaining({
          pointLimit: 75_000,
        }),
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000)
      })

      expect(
        screen.getByText(/Exact transcript loading exceeded 12 seconds/),
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
      viewport.restore()
    }
  })

  it('keeps the previous exact transcript layer visible while panning loads the next viewport', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => ['Actb'])
    const loadTranscriptCapabilities: ReturnType<
      typeof vi.fn<TranscriptCapabilitiesLoader>
    > = vi.fn(async () => ({
      rawParquet: true,
      nativeZarr: false,
    }))
    const loadTranscriptViewport: ReturnType<typeof vi.fn<TranscriptViewportLoader>> = vi
      .fn()
      .mockResolvedValueOnce({
        points: [
          {
            id: 't1',
            cellId: intToCellId(1, 1),
            featureName: 'Actb',
            fovName: 'AA1',
            position: { x: micrometers(10), y: micrometers(20) },
            qv: 35,
            isGene: true,
          },
        ],
        groups: [],
        hitPointLimit: false,
      })
      .mockReturnValueOnce(pendingPromise())

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadTranscriptCapabilities={loadTranscriptCapabilities}
          loadTranscriptViewport={loadTranscriptViewport}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(await screen.findByTestId('deckgl')).toBeInTheDocument()
      openHudTab('Transcripts')
      expect(await screen.findByText('Exact only')).toBeInTheDocument()
      await waitFor(() => {
        expect(
          within(screen.getByLabelText('Transcript overlay summary')).getByText('8'),
        ).toBeInTheDocument()
      })

      vi.useFakeTimers()
      fireEvent.change(screen.getByRole('combobox', { name: 'Feature filter' }), {
        target: { value: 'all' },
      })
      fireEvent.change(screen.getByRole('combobox', { name: 'Detail' }), {
        target: { value: 'exact' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show transcripts' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(220)
        await Promise.resolve()
      })
      expect(loadTranscriptViewport).toHaveBeenCalledTimes(1)
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByText('1 points')).toBeInTheDocument()
      expect(screen.getByTestId('deck-layer-transcript-exact-points')).toHaveAttribute(
        'data-count',
        '1',
      )

      fireEvent.keyDown(screen.getByRole('img', { name: 'Spatial viewer canvas area' }), {
        key: 'ArrowRight',
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180)
        await Promise.resolve()
      })

      expect(screen.getByText('Loading')).toBeInTheDocument()
      expect(screen.getByTestId('deck-layer-transcript-exact-points')).toHaveAttribute(
        'data-count',
        '1',
      )
    } finally {
      vi.useRealTimers()
      viewport.restore()
    }
  })

  it('loads morphology image by default', async () => {
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
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        loadGenePanel={loadGenePanel}
        computeAutoChannelContrast={computeAutoChannelContrast}
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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

  it('surfaces Safari cells.parquet out-of-bounds failures with parquet-specific guidance', async () => {
    const loadDatasetOverview = vi.fn(async () => {
      throw new RangeError('Out of bounds access')
    })
    const loadGenePanel = vi.fn(async () => [])

    render(
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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
      <TestApp
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

    const visibilityInput = screen.getByLabelText('kmeans 3: Cluster 1 visible')
    expect(visibilityInput).toBeChecked()
    fireEvent.click(visibilityInput)
    expect(visibilityInput).not.toBeChecked()
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent(
      'kmeans 3: Cluster 1',
    )

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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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

  it('keeps imported annotations with colliding label slugs removable independently', async () => {
    const cd16Positive = intToCellId(1, 1)
    const cd16Negative = intToCellId(2, 1)
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: cd16Positive,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
        cellArea: 22,
      },
      {
        cellId: cd16Negative,
        position: { x: micrometers(30), y: micrometers(40) },
        transcriptCount: 12,
        cellArea: 18,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const file = new File(
      [
        `cell_id,label
${cd16Positive},CD16+ NK cells
${cd16Negative},CD16- NK cells`,
      ],
      'celltypist.csv',
      { type: 'text/csv' },
    )

    render(
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    openHudTab('Annotations')
    await waitFor(() => {
      expect(screen.getByLabelText('Import File')).toBeEnabled()
    })
    fireEvent.change(screen.getByLabelText('Import File'), {
      target: { files: [file] },
    })

    const annotationList = await screen.findByLabelText('Loaded annotations')
    expect(annotationList).toHaveTextContent('CD16+ NK cells')
    expect(annotationList).toHaveTextContent('CD16- NK cells')
    expect(screen.getByText('2 labels')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove CD16+ NK cells' }))

    expect(screen.queryByText('CD16+ NK cells')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Loaded annotations')).toHaveTextContent(
      'CD16- NK cells',
    )
    expect(screen.getByText('1 label')).toBeInTheDocument()
  })

  it('shows ROI query loading while drawn ROI cells are pending', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        <TestApp
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
      viewport.restore()
    }
  })

  it('keeps ROI drawing disabled until dataset preparation completes', async () => {
    vi.mocked(warmDatasetForRoi).mockImplementationOnce(() => pendingPromise())

    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])

    render(
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    openHudTab('ROI')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Draw Box' })).toBeDisabled()
    })
    expect(screen.getByText('Preparing')).toBeInTheDocument()
  })

  it('notifies when the cell-feature matrix is not CSC formatted', async () => {
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const capability = {
      url: `${DEMO_DATASET_URL}/cell_feature_matrix.zarr.zip`,
      hasCellMajorCsc: false,
      cellCount: 1,
      featureCount: 2,
    }
    const warmDatasetForRoi: ReturnType<typeof vi.fn<DatasetWarmupLoader>> = vi.fn(
      async (_baseUrl, options) => {
        options?.onCellFeatureMatrixCapability?.(capability)

        return { cellFeatureMatrix: capability }
      },
    )

    render(
      <TestApp
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        warmDatasetForRoi={warmDatasetForRoi}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

    const notice = await screen.findByRole('status', {
      name: 'Cell-feature matrix warning',
    })

    expect(notice).toHaveTextContent('cell_feature_matrix.zarr.zip')
    expect(notice).toHaveTextContent('not in CSC format')
    expect(notice).toHaveTextContent('cell_feature_matrix.h5')
  })

  it('shows sampled ROI genes before the full ROI gene refinement finishes', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const loadDatasetOverview = vi.fn(async () => [
      {
        cellId: intToCellId(1, 1),
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 8,
      },
    ])
    const loadGenePanel = vi.fn(async () => [])
    const roiCells = Array.from({ length: 1_500 }, (_value, index) => ({
      id: intToCellId(1, index + 1),
      position: { x: micrometers(index), y: micrometers(index) },
      transcriptCount: 8,
      cellArea: 22,
    }))
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(
      async () => roiCells,
    )
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi
      .fn()
      .mockResolvedValueOnce({
        genes: [
          {
            gene: 'Actb',
            count: 900,
            detectedCells: 900,
            percentCells: 90,
            meanPerCell: 0.9,
            percentTotal: 100,
          },
        ],
        cellCount: 1_500,
        sampledCellCount: 32,
        totalCount: 900,
        hitCellLimit: true,
      })
      .mockImplementationOnce(() => pendingPromise())

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
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

      const geneDistribution = await screen.findByLabelText('ROI gene distribution')

      expect(geneDistribution).toHaveTextContent('Top ROI genes')
      expect(geneDistribution).toHaveTextContent('32 sampled')
      expect(geneDistribution).toHaveTextContent('Actb')
      await waitFor(() => {
        expect(loadRoiGeneStats).toHaveBeenCalledTimes(2)
      })
      expect(loadRoiGeneStats).toHaveBeenNthCalledWith(
        1,
        DEMO_DATASET_URL,
        roiCells,
        expect.objectContaining({
          cellLimit: 32,
          sampleStrategy: 'head',
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
      expect(loadRoiGeneStats).toHaveBeenNthCalledWith(
        2,
        DEMO_DATASET_URL,
        roiCells,
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      )
    } finally {
      viewport.restore()
    }
  })

  it('keeps ROI drawing enabled while viewport ROI gene warmup is pending', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const overviewCells = Array.from({ length: 200 }, (_value, index) => ({
      cellId: intToCellId(1, index + 1),
      position: {
        x: micrometers(index % 20),
        y: micrometers(Math.floor(index / 20)),
      },
      transcriptCount: 8,
      cellArea: 22,
    }))
    const roiCells = overviewCells.map((cell) => ({
      id: cell.cellId,
      position: cell.position,
      transcriptCount: cell.transcriptCount,
      cellArea: cell.cellArea,
    }))
    const loadDatasetOverview = vi.fn(async () => overviewCells)
    const loadGenePanel = vi.fn(async () => [])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(
      async () => roiCells,
    )
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(() =>
      pendingPromise(),
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('ROI')
      await waitFor(
        () => {
          expect(loadRoiGeneStats).toHaveBeenCalled()
        },
        { timeout: 2_000 },
      )

      expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      expect(screen.getByText('Preparing genes')).toBeInTheDocument()

      const loadingStatus = await screen.findByRole('status', {
        name: 'Active loading tasks',
      })
      expect(
        within(loadingStatus).getByText('Preparing cell feature matrix'),
      ).toBeInTheDocument()
    } finally {
      viewport.restore()
    }
  })

  it('prewarms ROI gene stats for the visible ROI viewport', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
    const overviewCells = Array.from({ length: 200 }, (_value, index) => ({
      cellId: intToCellId(1, index + 1),
      position: {
        x: micrometers(index % 20),
        y: micrometers(Math.floor(index / 20)),
      },
      transcriptCount: 8,
      cellArea: 22,
    }))
    const roiCells = overviewCells.map((cell) => ({
      id: cell.cellId,
      position: cell.position,
      transcriptCount: cell.transcriptCount,
      cellArea: cell.cellArea,
    }))
    const loadDatasetOverview = vi.fn(async () => overviewCells)
    const loadGenePanel = vi.fn(async () => [])
    const loadRoiCells: ReturnType<typeof vi.fn<RoiCellsLoader>> = vi.fn(
      async () => roiCells,
    )
    const loadRoiGeneStats: ReturnType<typeof vi.fn<RoiGeneStatsLoader>> = vi.fn(
      async () => ({
        genes: [],
        cellCount: roiCells.length,
        sampledCellCount: 32,
        totalCount: 0,
        hitCellLimit: true,
      }),
    )

    try {
      render(
        <TestApp
          loadDatasetOverview={loadDatasetOverview}
          loadGenePanel={loadGenePanel}
          loadRoiCells={loadRoiCells}
          loadRoiGeneStats={loadRoiGeneStats}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      openHudTab('ROI')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draw Box' })).toBeEnabled()
      })

      await waitFor(
        () => {
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
              limit: 5_000,
              signal: expect.any(AbortSignal) as AbortSignal,
            }),
          )
        },
        { timeout: 2_000 },
      )
      await waitFor(
        () => {
          expect(loadRoiGeneStats).toHaveBeenCalledWith(
            DEMO_DATASET_URL,
            roiCells,
            expect.objectContaining({
              cellLimit: 32,
              sampleStrategy: 'head',
              signal: expect.any(AbortSignal) as AbortSignal,
            }),
          )
        },
        { timeout: 2_000 },
      )
    } finally {
      viewport.restore()
    }
  })

  it('draws a box ROI, summarizes true cells, and saves it as an annotation', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        <TestApp
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
      viewport.restore()
      createObjectUrlSpy.mockRestore()
      revokeObjectUrlSpy.mockRestore()
      downloadClickSpy.mockRestore()
    }
  })

  it('starts a bbox-backed ROI query from a lasso selection', async () => {
    const viewport = installAppViewportFixture(
      appViewportRectFixture({ width: 1000, height: 1000, right: 1000, bottom: 1000 }),
    )
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
        <TestApp
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
      viewport.restore()
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
      <TestApp loadDatasetOverview={loadDatasetOverview} loadGenePanel={loadGenePanel} />,
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

function imageOnlyTiffLoaderFixture(url: string): TiffPyramidLoader {
  return {
    url,
    imageWidth: imagePixels(160),
    imageHeight: imagePixels(80),
    tileWidth: imagePixels(256),
    tileHeight: imagePixels(256),
    numLevels: 1,
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
      {
        id: 'Channel:1',
        index: 1,
        name: 'Marker',
        color: [215, 63, 124],
        contrast: { min: 0, max: 255 },
      },
    ],
  } as unknown as TiffPyramidLoader
}
