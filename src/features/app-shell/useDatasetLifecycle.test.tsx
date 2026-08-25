import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type {
  DatasetMeta,
  GridCellBatch,
  SpatialGrid,
} from '../../datasets/spatialDataset'
import type {
  VisiumHdBinnedOverview,
  VisiumHdBinDescriptor,
  VisiumHdBinSizeMicrometers,
} from '../../datasets/visiumHdDataset'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import {
  mergeMorphologyChannelSettings,
  useDatasetLifecycle,
} from './useDatasetLifecycle'

function abortRef() {
  return { current: new AbortController() }
}

function numberRef(value = 0) {
  return { current: value }
}

function stringRef(value: string | null = null) {
  return { current: value }
}

function timeoutRef() {
  return { current: null as number | null }
}

function visiumBinDescriptor(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
): VisiumHdBinDescriptor {
  const padded = binSizeMicrometers.toString().padStart(3, '0')
  const outputPath = `binned_outputs/square_${padded}um`

  return {
    binSizeMicrometers,
    outputPath,
    tissuePositionsPath: `${outputPath}/spatial/tissue_positions.parquet`,
    scalefactorsPath: `${outputPath}/spatial/scalefactors_json.json`,
    filteredMatrixH5Path: `${outputPath}/filtered_feature_bc_matrix.h5`,
  }
}

type LifecycleOptions = Parameters<typeof useDatasetLifecycle>[0]

function Probe({
  refs,
  detectSpatialDataset = vi.fn(async () => ({
    platform: 'xenium' as const,
    baseUrl: 'https://example.test/output',
    checked: [],
  })),
  getSpatialDataset = vi.fn(async () => {
    throw new Error('unused')
  }),
  loadAnnotationGroups = vi.fn(async () => []),
  loadDatasetOverview = vi.fn(async () => []),
  loadGenePanel = vi.fn(async () => []),
  setDatasetPlatform = vi.fn(),
  setFlatMorphologyImage = vi.fn(),
  setGenePanelState = vi.fn(),
  setLoadState = vi.fn(),
  setMorphologyState = vi.fn(),
  setSelectedGridCell = vi.fn(),
  setShowCellBoundaries = vi.fn(),
  setShowNucleusBoundaries = vi.fn(),
  setSpatialGridCells = vi.fn(),
  setVisiumHdControlState = vi.fn(),
  initialShareableState = {},
  startDatasetLoadRef = { current: null },
  warmDatasetForRoi = vi.fn(async () => undefined),
}: {
  readonly refs: ReturnType<typeof createLifecycleRefs>
  readonly detectSpatialDataset?: LifecycleOptions['loaders']['detectSpatialDataset']
  readonly getSpatialDataset?: LifecycleOptions['loaders']['getSpatialDataset']
  readonly loadAnnotationGroups?: LifecycleOptions['loaders']['loadAnnotationGroups']
  readonly loadDatasetOverview?: LifecycleOptions['loaders']['loadDatasetOverview']
  readonly loadGenePanel?: LifecycleOptions['loaders']['loadGenePanel']
  readonly setDatasetPlatform?: LifecycleOptions['setters']['setDatasetPlatform']
  readonly setFlatMorphologyImage?: LifecycleOptions['setters']['setFlatMorphologyImage']
  readonly setGenePanelState?: LifecycleOptions['setters']['setGenePanelState']
  readonly setLoadState?: LifecycleOptions['setters']['setLoadState']
  readonly setMorphologyState?: LifecycleOptions['setters']['setMorphologyState']
  readonly setSelectedGridCell?: LifecycleOptions['setters']['setSelectedGridCell']
  readonly setShowCellBoundaries?: LifecycleOptions['setters']['setShowCellBoundaries']
  readonly setShowNucleusBoundaries?: LifecycleOptions['setters']['setShowNucleusBoundaries']
  readonly setSpatialGridCells?: LifecycleOptions['setters']['setSpatialGridCells']
  readonly setVisiumHdControlState?: LifecycleOptions['setters']['setVisiumHdControlState']
  readonly initialShareableState?: LifecycleOptions['initialState']['initialShareableState']
  readonly startDatasetLoadRef?: LifecycleOptions['refs']['startDatasetLoadRef']
  readonly warmDatasetForRoi?: LifecycleOptions['loaders']['warmDatasetForRoi']
}) {
  const noopSetter = vi.fn()

  useDatasetLifecycle({
    callbacks: {
      appendDebugEvent: vi.fn(),
      appendFallbackNotice: vi.fn(),
      queueAutoContrast: vi.fn(),
      recordTelemetry: vi.fn(),
    },
    controls: {
      geneExpressionColorScale: 'plasma',
      transcriptDensityColorScale: 'thermal',
      transcriptExactPointLimit: 100_000,
      transcriptPointColorMode: 'feature',
    },
    initialState: {
      initialShareableState,
    },
    loaders: {
      detectSpatialDataset,
      getSpatialDataset,
      loadAnnotationGroups,
      loadDatasetOverview,
      loadGenePanel,
      loadMorphologyImage: vi.fn(async () => {
        throw new Error('unused')
      }),
      warmDatasetForRoi,
    },
    refs: {
      analysisEmbeddingAbortRef: refs.analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: numberRef(),
      autoContrastChannelIdsRef: { current: new Set<string>() },
      boundaryAbortRef: refs.boundaryAbortRef,
      boundaryRequestIdRef: numberRef(),
      boundaryViewportKeyRef: stringRef(),
      cellDetailAbortRef: refs.cellDetailAbortRef,
      cellDetailRequestIdRef: numberRef(),
      cellFeatureMatrixCapabilityKeyRef: stringRef(),
      cellTranscriptDistributionAbortRef: refs.cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef: numberRef(),
      customMorphologyLayerAbortRef: refs.customMorphologyLayerAbortRef,
      customMorphologyLayerRequestIdRef: numberRef(),
      datasetAbortRef: refs.datasetAbortRef,
      datasetWarmupAbortRef: refs.datasetWarmupAbortRef,
      diagnosticsAbortRef: refs.diagnosticsAbortRef,
      didApplyInitialDatasetUrlRef: { current: false },
      geneExpressionAbortRef: refs.geneExpressionAbortRef,
      geneExpressionRequestIdRef: numberRef(),
      geneExpressionViewportKeyRef: stringRef(),
      initialShareableStateRef: { current: initialShareableState },
      initialSharedRoiSelectionRef: { current: null },
      initialShouldLoadMorphologyRef: { current: false },
      lastViewportDetailRef: { current: null },
      loadRequestIdRef: numberRef(),
      magicLensAbortRef: refs.magicLensAbortRef,
      magicLensDebounceRef: refs.magicLensDebounceRef,
      magicLensLastDetailRef: { current: null },
      magicLensLastQueryKeyRef: stringRef(),
      magicLensRequestIdRef: numberRef(),
      roiAbortRef: refs.roiAbortRef,
      roiGeneViewportWarmupAbortRef: refs.roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef: stringRef(),
      roiGeneViewportWarmupTimeoutRef: refs.roiGeneViewportWarmupTimeoutRef,
      roiRequestIdRef: numberRef(),
      roiTranscriptExportAbortRef: refs.roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef: numberRef(),
      startDatasetLoadRef,
      transcriptAbortRef: refs.transcriptAbortRef,
      transcriptCapabilityAbortRef: refs.transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef: numberRef(),
      transcriptRequestIdRef: numberRef(),
      transcriptViewportKeyRef: stringRef(),
    },
    setters: {
      setAnalysisEmbeddingState: noopSetter,
      setAnnotationColors: noopSetter,
      setAnnotationGroupState: noopSetter,
      setAnnotationState: noopSetter,
      setHiddenAnnotationIds: noopSetter,
      setHiddenAnnotationSetIds: noopSetter,
      setCellMetadataTracks: noopSetter,
      setSelectedCellMetadataTrackId: noopSetter,
      setAutoContrastChannelIds: noopSetter,
      setBoundaryElements: noopSetter,
      setBoundaryState: noopSetter,
      setCellDetailState: noopSetter,
      setCellFeatureMatrixCapabilityState: noopSetter,
      setCellTranscriptDistributionState: noopSetter,
      setCurrentViewportDetail: noopSetter,
      setCustomMorphologyLayerState: noopSetter,
      setCustomMorphologyLayers: noopSetter,
      setCustomImageLayerOpacities: noopSetter,
      setDatasetUrl: vi.fn(),
      setDatasetPlatform,
      setDatasetWarmupState: noopSetter,
      setDiagnosticsState: noopSetter,
      setGeneExpressionBatch: noopSetter,
      setGeneExpressionColorScale: noopSetter,
      setGeneExpressionDetailMode: noopSetter,
      setGeneExpressionScaleDomain: noopSetter,
      setGeneExpressionScoreMode: noopSetter,
      setGeneExpressionState: noopSetter,
      setGenePanelState,
      setHoveredTranscript: noopSetter,
      setLoadState,
      setMagicLensActive: noopSetter,
      setMagicLensState: noopSetter,
      setManualTranscriptExactRequestKey: noopSetter,
      setMeasurementEnabled: noopSetter,
      setMeasurementResetKey: noopSetter,
      setMorphologyChannelSettings: noopSetter,
      setMorphologyImage: noopSetter,
      setFlatMorphologyImage,
      setMorphologyState,
      setObservationColorMode: noopSetter,
      setOverviewCells: noopSetter,
      setPinnedTranscript: noopSetter,
      setRoiGeneStatsState: noopSetter,
      setRoiGeneViewportWarmupState: noopSetter,
      setRoiMode: noopSetter,
      setRoiName: noopSetter,
      setRoiState: noopSetter,
      setRoiTranscriptExportState: noopSetter,
      setSelectedAnnotationGroupId: noopSetter,
      setSelectedCell: noopSetter,
      setSelectedGridCell,
      setSelectedEmbeddingKind: noopSetter,
      setSelectedGenes: noopSetter,
      setShowCellBoundaries,
      setShowNucleusBoundaries,
      setSpatialGridCells,
      setTranscriptCapabilityState: noopSetter,
      setTranscriptDensityColorScale: noopSetter,
      setTranscriptExactPointLimit: noopSetter,
      setTranscriptLayerState: noopSetter,
      setTranscriptPointColorMode: noopSetter,
      setVisiumHdControlState,
      setViewportCellCount: noopSetter,
    },
  })

  return null
}

function createLifecycleRefs() {
  return {
    analysisEmbeddingAbortRef: abortRef(),
    boundaryAbortRef: abortRef(),
    cellDetailAbortRef: abortRef(),
    cellTranscriptDistributionAbortRef: abortRef(),
    customMorphologyLayerAbortRef: abortRef(),
    datasetAbortRef: abortRef(),
    datasetWarmupAbortRef: abortRef(),
    diagnosticsAbortRef: abortRef(),
    geneExpressionAbortRef: abortRef(),
    magicLensAbortRef: abortRef(),
    magicLensDebounceRef: timeoutRef(),
    roiAbortRef: abortRef(),
    roiGeneViewportWarmupAbortRef: abortRef(),
    roiGeneViewportWarmupTimeoutRef: timeoutRef(),
    roiTranscriptExportAbortRef: abortRef(),
    transcriptAbortRef: abortRef(),
    transcriptCapabilityAbortRef: abortRef(),
  }
}

describe('useDatasetLifecycle', () => {
  it('preserves custom-layer channel settings when base morphology settings refresh', () => {
    expect(
      mergeMorphologyChannelSettings({
        baseChannelIds: ['Channel:0', 'Channel:1'],
        currentSettings: [
          {
            id: 'Channel:0',
            enabled: false,
            color: [1, 2, 3],
            contrastMin: 0,
            contrastMax: 1,
          },
          {
            id: 'custom-layer:1:Channel:0:0',
            enabled: true,
            color: [255, 255, 255],
            contrastMin: 0,
            contrastMax: 255,
          },
        ],
        nextBaseSettings: [
          {
            id: 'Channel:0',
            enabled: false,
            color: [88, 144, 255],
            contrastMin: 0,
            contrastMax: 65_535,
          },
          {
            id: 'Channel:1',
            enabled: false,
            color: [32, 166, 122],
            contrastMin: 0,
            contrastMax: 65_535,
          },
        ],
      }),
    ).toEqual([
      {
        id: 'Channel:0',
        enabled: false,
        color: [88, 144, 255],
        contrastMin: 0,
        contrastMax: 65_535,
      },
      {
        id: 'Channel:1',
        enabled: false,
        color: [32, 166, 122],
        contrastMin: 0,
        contrastMax: 65_535,
      },
      {
        id: 'custom-layer:1:Channel:0:0',
        enabled: true,
        color: [255, 255, 255],
        contrastMin: 0,
        contrastMax: 255,
      },
    ])
  })

  it('aborts active feature requests on unmount', () => {
    const refs = createLifecycleRefs()
    const { unmount } = render(<Probe refs={refs} />)

    unmount()

    expect(refs.datasetAbortRef.current).toBeNull()
    expect(refs.datasetWarmupAbortRef.current).toBeNull()
    expect(refs.diagnosticsAbortRef.current).toBeNull()
    expect(refs.analysisEmbeddingAbortRef.current).toBeNull()
    expect(refs.boundaryAbortRef.current).toBeNull()
    expect(refs.geneExpressionAbortRef.current).toBeNull()
    expect(refs.roiAbortRef.current).toBeNull()
    expect(refs.roiTranscriptExportAbortRef.current).toBeNull()
    expect(refs.transcriptCapabilityAbortRef.current).toBeNull()
    expect(refs.transcriptAbortRef.current).toBeNull()
    expect(refs.roiGeneViewportWarmupAbortRef.current).toBeNull()
    expect(refs.magicLensAbortRef.current).toBeNull()
    expect(refs.cellDetailAbortRef.current).toBeNull()
    expect(refs.cellTranscriptDistributionAbortRef.current).toBeNull()
    expect(refs.customMorphologyLayerAbortRef.current).toBeNull()
  })

  it('shows Xenium cell boundaries by default on a fresh dataset load', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/xenium'
    const setDatasetPlatform = vi.fn()
    const setLoadState = vi.fn()
    const setShowCellBoundaries = vi.fn()
    const setShowNucleusBoundaries = vi.fn()

    render(
      <Probe
        refs={refs}
        setDatasetPlatform={setDatasetPlatform}
        setLoadState={setLoadState}
        setShowCellBoundaries={setShowCellBoundaries}
        setShowNucleusBoundaries={setShowNucleusBoundaries}
        startDatasetLoadRef={startDatasetLoadRef}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, false)
    })

    expect(setDatasetPlatform).toHaveBeenCalledWith('xenium')
    expect(setShowCellBoundaries).toHaveBeenCalledWith(true)
    expect(setShowNucleusBoundaries).toHaveBeenCalledWith(false)
    expect(setLoadState).toHaveBeenCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 0,
    })
  })

  it('loads Visium HD binned overview without starting Xenium loaders', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/visium'
    const grid: SpatialGrid = {
      id: 'visium-hd-square-016um',
      binSizeMicrometers: micrometers(16),
      basis: {
        origin: { x: micrometers(8), y: micrometers(8) },
        rowStep: { x: micrometers(0), y: micrometers(16) },
        colStep: { x: micrometers(16), y: micrometers(0) },
      },
      bounds: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
    }
    const gridCells: GridCellBatch = {
      kind: 'grid-cells',
      gridId: grid.id,
      ids: ['BC-1'],
      rows: new Int32Array([0]),
      cols: new Int32Array([0]),
    }
    const meta: DatasetMeta = {
      platform: 'visium-hd',
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(0.5),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      extent: {
        minX: micrometers(0),
        maxX: micrometers(16),
        minY: micrometers(0),
        maxY: micrometers(16),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
      grids: [grid],
    }
    const overview: VisiumHdBinnedOverview = {
      binSizeMicrometers: 16,
      scalefactors: {
        micronsPerPixel: 0.5,
        tissueHiresScale: 0.2,
        tissueLowresScale: 0.02,
      },
      grid,
      gridCells,
      fullresRows: new Float64Array([16]),
      fullresCols: new Float64Array([16]),
      inTissue: new Uint8Array([1]),
      sourcePaths: {
        tissuePositions: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
        scalefactors: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
        tissueHiresImage: 'binned_outputs/square_016um/spatial/tissue_hires_image.png',
        tissueLowresImage: 'binned_outputs/square_016um/spatial/tissue_lowres_image.png',
        filteredMatrixH5: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      },
    }
    const dataset = {
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => ({
        kind: 'flat' as const,
        url: `${datasetUrl}/binned_outputs/square_016um/spatial/tissue_hires_image.png`,
        scaleFactor: 0.2,
        size: [200, 120] as const,
      })),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      genePanel: vi.fn(async () => ['Actb', 'Gad1']),
      meta: vi.fn(async () => meta),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'visium-hd' as const,
      baseUrl: datasetUrl,
      bins: [visiumBinDescriptor(16), visiumBinDescriptor(8), visiumBinDescriptor(2)],
      checked: [],
    }))
    const getSpatialDataset = vi.fn(async () => dataset)
    const loadAnnotationGroups = vi.fn(async () => [])
    const loadDatasetOverview = vi.fn(async () => [])
    const loadGenePanel = vi.fn(async () => [])
    const setDatasetPlatform = vi.fn()
    const setFlatMorphologyImage = vi.fn()
    const setGenePanelState = vi.fn()
    const setLoadState = vi.fn()
    const setMorphologyState = vi.fn()
    const setShowCellBoundaries = vi.fn()
    const setShowNucleusBoundaries = vi.fn()
    const setSpatialGridCells = vi.fn()
    const setVisiumHdControlState = vi.fn()
    const warmDatasetForRoi = vi.fn(async () => undefined)

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={detectSpatialDataset}
        getSpatialDataset={getSpatialDataset}
        loadAnnotationGroups={loadAnnotationGroups}
        loadDatasetOverview={loadDatasetOverview}
        loadGenePanel={loadGenePanel}
        setDatasetPlatform={setDatasetPlatform}
        setFlatMorphologyImage={setFlatMorphologyImage}
        setGenePanelState={setGenePanelState}
        setLoadState={setLoadState}
        setMorphologyState={setMorphologyState}
        setShowCellBoundaries={setShowCellBoundaries}
        setShowNucleusBoundaries={setShowNucleusBoundaries}
        setSpatialGridCells={setSpatialGridCells}
        setVisiumHdControlState={setVisiumHdControlState}
        startDatasetLoadRef={startDatasetLoadRef}
        warmDatasetForRoi={warmDatasetForRoi}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    expect(detectSpatialDataset).toHaveBeenCalledWith(
      datasetUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl)
    expect(loadDatasetOverview).not.toHaveBeenCalled()
    expect(loadGenePanel).not.toHaveBeenCalled()
    expect(loadAnnotationGroups).not.toHaveBeenCalled()
    expect(warmDatasetForRoi).not.toHaveBeenCalled()
    expect(setShowCellBoundaries).toHaveBeenCalledWith(false)
    expect(setShowNucleusBoundaries).toHaveBeenCalledWith(false)
    expect(dataset.genePanel).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(setGenePanelState).toHaveBeenCalledWith({
      status: 'loading',
      url: datasetUrl,
    })
    await waitFor(() => {
      expect(setGenePanelState).toHaveBeenCalledWith({
        status: 'ready',
        url: datasetUrl,
        genes: ['Actb', 'Gad1'],
      })
    })
    expect(setDatasetPlatform).toHaveBeenCalledWith('visium-hd')
    expect(setVisiumHdControlState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        selectedBinSize: 16,
        binCount: 1,
        options: [
          expect.objectContaining({ size: 16, available: true, disabled: false }),
          expect.objectContaining({ size: 8, available: true, disabled: false }),
          expect.objectContaining({ size: 2, available: true, disabled: false }),
        ],
      }),
    )
    expect(setLoadState).toHaveBeenCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    })
    const gridCellCall = setSpatialGridCells.mock.calls.find(
      ([value]) => Array.isArray(value) && value.length === 1,
    )
    expect(gridCellCall?.[0]).toEqual([
      expect.objectContaining({
        id: 'BC-1',
        gridId: grid.id,
        row: 0,
        col: 0,
      }),
    ])
    await waitFor(() => {
      expect(setFlatMorphologyImage).toHaveBeenCalledWith({
        url: `${datasetUrl}/binned_outputs/square_016um/spatial/tissue_hires_image.png`,
        size: [200, 120],
        scaleFactor: 0.2,
        micrometersPerPixel: micrometers(0.5),
      } satisfies FlatMorphologyCanvasImage)
    })
    expect(setMorphologyState).toHaveBeenCalledWith({
      status: 'ready',
      url: `${datasetUrl}/binned_outputs/square_016um/spatial/tissue_hires_image.png`,
    })
  })

  it('enables the 2 µm Visium HD tier when the dataset exposes a filtered-barcode budget', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/visium'
    const grid: SpatialGrid = {
      id: 'visium-hd-square-016um',
      binSizeMicrometers: micrometers(16),
      basis: {
        origin: { x: micrometers(8), y: micrometers(8) },
        rowStep: { x: micrometers(0), y: micrometers(16) },
        colStep: { x: micrometers(16), y: micrometers(0) },
      },
      bounds: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
    }
    const overview: VisiumHdBinnedOverview = {
      binSizeMicrometers: 16,
      scalefactors: {
        micronsPerPixel: 0.5,
        tissueHiresScale: 0.2,
        tissueLowresScale: 0.02,
      },
      grid,
      gridCells: {
        kind: 'grid-cells',
        gridId: grid.id,
        ids: ['BC-1'],
        rows: new Int32Array([0]),
        cols: new Int32Array([0]),
      },
      fullresRows: new Float64Array([16]),
      fullresCols: new Float64Array([16]),
      inTissue: new Uint8Array([1]),
      sourcePaths: {
        tissuePositions: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
        scalefactors: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
        tissueHiresImage: 'binned_outputs/square_016um/spatial/tissue_hires_image.png',
        tissueLowresImage: 'binned_outputs/square_016um/spatial/tissue_lowres_image.png',
        filteredMatrixH5: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      },
    }
    const dataset = {
      maxTwoMicrometerFilteredBarcodes: 25_000,
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => null),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      meta: vi.fn(async () => ({
        platform: 'visium-hd' as const,
        units: {
          dataUnit: 'micrometer' as const,
          imageUnit: 'pixel' as const,
          micrometersPerPixel: micrometers(0.5),
          origin: 'top-left' as const,
          imageYAxis: 'down' as const,
        },
        extent: {
          minX: micrometers(0),
          maxX: micrometers(16),
          minY: micrometers(0),
          maxY: micrometers(16),
        },
        capabilities: {
          transcripts: false,
          cellBoundaries: false,
          pyramidImage: false,
          multiChannel: false,
        },
        grids: [grid],
      })),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const getSpatialDataset = vi.fn(async () => dataset)
    const setVisiumHdControlState = vi.fn()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'visium-hd' as const,
          baseUrl: datasetUrl,
          bins: [visiumBinDescriptor(16), visiumBinDescriptor(8), visiumBinDescriptor(2)],
          checked: [],
        }))}
        getSpatialDataset={getSpatialDataset}
        setVisiumHdControlState={setVisiumHdControlState}
        startDatasetLoadRef={startDatasetLoadRef}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, false)
    })

    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl)
    expect(setVisiumHdControlState).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ size: 16, available: true, disabled: false }),
          expect.objectContaining({ size: 8, available: true, disabled: false }),
          expect.objectContaining({ size: 2, available: true, disabled: false }),
        ],
      }),
    )
  })
})
