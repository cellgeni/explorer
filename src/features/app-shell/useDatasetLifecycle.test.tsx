import { act, render, waitFor } from '@testing-library/react'
import { useEffect, useState, type SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { setVisiumView, visiumViewFor } from '../../datasets/datasetFactory'
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
import { AUTO_GENE_SCALE_RANGE, type GeneScaleRange } from '../genes/geneScaleRange'
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

// A Gene scale range setter that keeps its value, as useState would.
function geneScaleRangeState() {
  const state = { range: AUTO_GENE_SCALE_RANGE }
  const setGeneExpressionScaleRange = vi.fn((next: SetStateAction<GeneScaleRange>) => {
    state.range = typeof next === 'function' ? next(state.range) : next
  })

  return { state, setGeneExpressionScaleRange }
}

function Probe({
  refs,
  appendFallbackNotice = vi.fn(),
  extraSetters = {},
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
  loadMorphologyImage = vi.fn(async () => {
    throw new Error('unused')
  }),
  setCellMetadataTracks = vi.fn(),
  setSelectedCellMetadataTrackId = vi.fn(),
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
  isDatasetLoaded = false,
  isDatasetLoading = false,
  onBeforeDatasetLoad,
  resultRef,
  startDatasetLoadRef = { current: null },
  warmDatasetForRoi = vi.fn(async () => undefined),
}: {
  readonly refs: ReturnType<typeof createLifecycleRefs>
  readonly appendFallbackNotice?: LifecycleOptions['callbacks']['appendFallbackNotice']
  readonly extraSetters?: Partial<LifecycleOptions['setters']>
  readonly detectSpatialDataset?: LifecycleOptions['loaders']['detectSpatialDataset']
  readonly getSpatialDataset?: LifecycleOptions['loaders']['getSpatialDataset']
  readonly loadAnnotationGroups?: LifecycleOptions['loaders']['loadAnnotationGroups']
  readonly loadDatasetOverview?: LifecycleOptions['loaders']['loadDatasetOverview']
  readonly loadGenePanel?: LifecycleOptions['loaders']['loadGenePanel']
  readonly loadMorphologyImage?: LifecycleOptions['loaders']['loadMorphologyImage']
  readonly setCellMetadataTracks?: LifecycleOptions['setters']['setCellMetadataTracks']
  readonly setSelectedCellMetadataTrackId?: LifecycleOptions['setters']['setSelectedCellMetadataTrackId']
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
  readonly isDatasetLoaded?: boolean
  readonly isDatasetLoading?: boolean
  readonly onBeforeDatasetLoad?: () => void
  readonly resultRef?: { current: ReturnType<typeof useDatasetLifecycle> | null }
  readonly startDatasetLoadRef?: LifecycleOptions['refs']['startDatasetLoadRef']
  readonly warmDatasetForRoi?: LifecycleOptions['loaders']['warmDatasetForRoi']
}) {
  const noopSetter = vi.fn()

  const result = useDatasetLifecycle({
    callbacks: {
      appendDebugEvent: vi.fn(),
      appendFallbackNotice,
      ...(onBeforeDatasetLoad === undefined ? {} : { onBeforeDatasetLoad }),
      queueAutoContrast: vi.fn(),
      recordTelemetry: vi.fn(),
    },
    controls: {
      isDatasetLoaded,
      isDatasetLoading,
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
      loadMorphologyImage,
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
      nucleusBoundaryAbortRef: refs.nucleusBoundaryAbortRef,
      nucleusBoundaryRequestIdRef: numberRef(),
      nucleusBoundaryViewportKeyRef: stringRef(),
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
      visiumHdBinRequestIdRef: refs.visiumHdBinRequestIdRef,
    },
    setters: {
      setMerscopeImageState: noopSetter,
      setAteraImageState: noopSetter,
      setAnalysisEmbeddingState: noopSetter,
      setAnnotationColors: noopSetter,
      setAnnotationGroupState: noopSetter,
      setAnnotationState: noopSetter,
      setHiddenAnnotationIds: noopSetter,
      setHiddenAnnotationSetIds: noopSetter,
      setCellMetadataTracks,
      setSelectedCellMetadataTrackId,
      setAutoContrastChannelIds: noopSetter,
      setBoundaryElements: noopSetter,
      setBoundaryState: noopSetter,
      setNucleusBoundaryState: noopSetter,
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
      setGeneExpressionScaleRange: noopSetter,
      setGeneExpressionScoreMode: noopSetter,
      setGeneExpressionState: noopSetter,
      setGenePanelState,
      setHoveredTranscript: noopSetter,
      setLoadState,
      setPendingDatasetLoadState: noopSetter,
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
      setSavedGeneSets: noopSetter,
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
      setSpatialDataControlState: noopSetter,
      setVisiumControlState: noopSetter,
      ...extraSetters,
    },
  })

  useEffect(() => {
    if (resultRef !== undefined) resultRef.current = result
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
    nucleusBoundaryAbortRef: abortRef(),
    roiAbortRef: abortRef(),
    roiGeneViewportWarmupAbortRef: abortRef(),
    roiGeneViewportWarmupTimeoutRef: timeoutRef(),
    roiTranscriptExportAbortRef: abortRef(),
    transcriptAbortRef: abortRef(),
    transcriptCapabilityAbortRef: abortRef(),
    visiumHdBinRequestIdRef: numberRef(),
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
    expect(refs.nucleusBoundaryAbortRef.current).toBeNull()
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

  it('keeps a manifest’s gene range for a later dataset that sets none', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef: LifecycleOptions['refs']['startDatasetLoadRef'] = {
      current: null,
    }
    const withRange = 'https://example.test/with-range'
    const withoutRange = 'https://example.test/without-range'
    const detectSpatialDataset: LifecycleOptions['loaders']['detectSpatialDataset'] =
      vi.fn(async (url: string) => ({
        platform: 'xenium' as const,
        baseUrl: url,
        ...(url === withRange
          ? {
              manifest: {
                platform: 'xenium' as const,
                url: `${url}/explorer.json`,
                rootUrl: url,
                files: {},
                defaults: { geneRange: [null, 40] as const },
              },
            }
          : {}),
        checked: [],
      }))
    const geneScaleRange = geneScaleRangeState()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={detectSpatialDataset}
        startDatasetLoadRef={startDatasetLoadRef}
        extraSetters={{
          setGeneExpressionScaleRange: geneScaleRange.setGeneExpressionScaleRange,
        }}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(withRange, false)
    })
    expect(geneScaleRange.state.range).toEqual({ min: null, max: 40 })

    await act(async () => {
      await startDatasetLoadRef.current?.(withoutRange, false)
    })
    expect(detectSpatialDataset).toHaveBeenCalledTimes(2)
    expect(geneScaleRange.state.range).toEqual({ min: null, max: 40 })
  })

  describe('replacing an open dataset (15.1-F)', () => {
    const OPEN_URL = 'https://example.test/open'
    const NEXT_URL = 'https://example.test/next'

    function deferred<T>() {
      let resolve: (value: T) => void = () => undefined
      const promise = new Promise<T>((next) => {
        resolve = next
      })
      return { promise, resolve }
    }

    function statusOf(state: unknown): string {
      return (state as { readonly status?: string }).status ?? '?'
    }

    function startLoad() {
      return {
        current: null as
          | ((datasetUrl: string, loadImage: boolean) => Promise<void>)
          | null,
      }
    }

    it('keeps the open dataset when the new one cannot be found', async () => {
      const refs = createLifecycleRefs()
      const openDatasetSignal = refs.datasetAbortRef.current.signal
      const startDatasetLoadRef = startLoad()
      const setLoadState = vi.fn()
      const setOverviewCells = vi.fn()
      const setDatasetPlatform = vi.fn()
      const setPendingDatasetLoadState = vi.fn()
      const appendFallbackNotice = vi.fn()
      const onBeforeDatasetLoad = vi.fn()

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          appendFallbackNotice={appendFallbackNotice}
          detectSpatialDataset={vi.fn(async () => ({
            platform: 'unknown' as const,
            baseUrl: NEXT_URL,
            checked: [
              {
                path: 'experiment.xenium',
                url: `${NEXT_URL}/experiment.xenium`,
                ok: false,
                status: 404,
              },
              {
                path: 'cells.parquet',
                url: `${NEXT_URL}/cells.parquet`,
                ok: false,
                status: 404,
              },
            ],
          }))}
          setDatasetPlatform={setDatasetPlatform}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
          extraSetters={{ setOverviewCells, setPendingDatasetLoadState }}
          onBeforeDatasetLoad={onBeforeDatasetLoad}
        />,
      )

      await act(async () => {
        await startDatasetLoadRef.current?.(NEXT_URL, false)
      })

      expect(setLoadState).not.toHaveBeenCalled()
      expect(setOverviewCells).not.toHaveBeenCalled()
      expect(setDatasetPlatform).not.toHaveBeenCalled()
      expect(onBeforeDatasetLoad).not.toHaveBeenCalled()
      expect(openDatasetSignal.aborted).toBe(false)
      expect(setPendingDatasetLoadState).toHaveBeenNthCalledWith(1, {
        status: 'loading',
        url: NEXT_URL,
      })
      expect(setPendingDatasetLoadState).toHaveBeenLastCalledWith({
        status: 'error',
        url: NEXT_URL,
        error: expect.objectContaining({ code: 'not-found' }),
      })
    })

    it('replaces the open dataset only when the new overview is ready', async () => {
      const refs = createLifecycleRefs()
      const openDatasetSignal = refs.datasetAbortRef.current.signal
      const startDatasetLoadRef = startLoad()
      const overview = deferred<[]>()
      const updates: string[] = []
      const setLoadState = vi.fn((state: unknown) => {
        updates.push(`load:${statusOf(state)}`)
      })
      const setOverviewCells = vi.fn(() => {
        updates.push('cells')
      })
      const setDatasetPlatform = vi.fn((platform: unknown) => {
        updates.push(`platform:${String(platform)}`)
      })
      const setGenePanelState = vi.fn((state: unknown) => {
        updates.push(`genes:${statusOf(state)}`)
      })
      const setPendingDatasetLoadState = vi.fn((state: unknown) => {
        updates.push(`pending:${statusOf(state)}`)
      })

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          loadDatasetOverview={vi.fn(() => overview.promise)}
          loadGenePanel={vi.fn(async () => ['GENEA'])}
          setDatasetPlatform={setDatasetPlatform}
          setGenePanelState={setGenePanelState}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
          extraSetters={{ setOverviewCells, setPendingDatasetLoadState }}
        />,
      )

      let load: Promise<void> | undefined
      await act(async () => {
        load = startDatasetLoadRef.current?.(NEXT_URL, false)
        await Promise.resolve()
        await Promise.resolve()
      })

      // The gene panel is ready, but the open dataset is still shown.
      expect(updates).toEqual(['pending:loading'])
      expect(openDatasetSignal.aborted).toBe(false)

      await act(async () => {
        overview.resolve([])
        await load
      })

      expect(openDatasetSignal.aborted).toBe(true)
      expect(updates).toEqual([
        'pending:loading',
        'pending:idle',
        'platform:null',
        'cells',
        'load:loading',
        'genes:idle',
        'platform:xenium',
        'genes:loading',
        'genes:ready',
        'cells',
        'load:ready',
      ])
    })

    it('opens a SpatialData image before the cells and shows it once they replace the open dataset', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const overview = deferred<[]>()
      const updates: string[] = []
      const channel = {
        id: 'Channel:0:0',
        index: 0,
        name: 'DAPI',
        color: [88, 144, 255] as const,
        contrast: { min: 0, max: 255 },
      }
      const dataset = {
        overview: vi.fn(() => overview.promise),
        genePanel: vi.fn(async () => []),
        annotationGroups: vi.fn(async () => []),
        embeddingOptions: vi.fn(async () => []),
        metadataTracks: vi.fn(async () => []),
        image: vi.fn(async () => ({
          kind: 'pyramid' as const,
          loader: { url: `${NEXT_URL}/images/he`, channels: [channel] },
        })),
        summary: vi.fn(async () => ({
          coordinateSystem: 'global',
          coordinateSystems: ['global'],
          images: ['he'],
          tables: [],
          regions: [],
          skippedElements: [],
          units: { micrometersPerUnit: 1, source: 'unknown', detail: '' },
        })),
      }
      const setMorphologyImage = vi.fn((image: unknown) => {
        updates.push(image === null ? 'image:null' : 'image')
      })
      const setLoadState = vi.fn((state: unknown) => {
        updates.push(`load:${statusOf(state)}`)
      })

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          detectSpatialDataset={vi.fn(async () => ({
            platform: 'spatialdata' as const,
            baseUrl: NEXT_URL,
            spatialDataUrl: NEXT_URL,
            checked: [],
          }))}
          getSpatialDataset={
            vi.fn(
              async () => dataset,
            ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
          }
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
          extraSetters={{ setMorphologyImage }}
        />,
      )

      let load: Promise<void> | undefined
      await act(async () => {
        load = startDatasetLoadRef.current?.(NEXT_URL, true)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      // The image opened while the cells load, but the open dataset stays.
      // It can wait on the table for its units, so it stops with the load.
      expect(dataset.image).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
      expect(dataset.summary).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
      expect(updates).toEqual([])

      await act(async () => {
        overview.resolve([])
        await load
      })

      expect(updates).toEqual(['image:null', 'load:loading', 'image', 'load:ready'])
    })

    it('keeps colours changed while loading, and drops old Visium HD reads', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const setGeneExpressionColorScale = vi.fn()
      const setTranscriptDensityColorScale = vi.fn()
      const setTranscriptPointColorMode = vi.fn()
      const setTranscriptExactPointLimit = vi.fn()

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          loadDatasetOverview={vi.fn(async () => [])}
          startDatasetLoadRef={startDatasetLoadRef}
          extraSetters={{
            setGeneExpressionColorScale,
            setTranscriptDensityColorScale,
            setTranscriptExactPointLimit,
            setTranscriptPointColorMode,
          }}
        />,
      )

      await act(async () => {
        await startDatasetLoadRef.current?.(NEXT_URL, false)
      })

      // A Visium HD bin or LOD read for the old dataset is now stale.
      expect(refs.visiumHdBinRequestIdRef.current).toBe(1)
      // Each is set from the current value, not the one when the load began.
      function keeps(setter: ReturnType<typeof vi.fn>, current: unknown) {
        const update = setter.mock.lastCall?.[0] as (value: unknown) => unknown
        expect(update(current)).toBe(current)
      }
      keeps(setGeneExpressionColorScale, 'magma')
      keeps(setTranscriptDensityColorScale, 'viridis')
      keeps(setTranscriptPointColorMode, 'quality')
      keeps(setTranscriptExactPointLimit, 42_000)
    })

    it('renders the cleared state before the new one, also for the same URL', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const rendered: string[] = []

      function Recorder() {
        const [loadState, setLoadState] = useState<
          Parameters<LifecycleOptions['setters']['setLoadState']>[0]
        >({ status: 'ready', url: OPEN_URL, cellCount: 1 })
        const status = typeof loadState === 'function' ? '?' : loadState.status
        rendered.push(status)

        return (
          <Probe
            refs={refs}
            isDatasetLoaded={status === 'ready'}
            setLoadState={setLoadState}
            startDatasetLoadRef={startDatasetLoadRef}
          />
        )
      }

      render(<Recorder />)
      rendered.length = 0

      // A Visium library switch reloads the open URL. Effects keyed on the
      // dataset's status and URL only rerun if a render shows it loading.
      await act(async () => {
        await startDatasetLoadRef.current?.(OPEN_URL, false)
      })

      expect(rendered).toEqual(['loading', 'ready'])
    })

    it('cancels a pending load and keeps the open dataset (15.3-D)', async () => {
      const refs = createLifecycleRefs()
      const openDatasetSignal = refs.datasetAbortRef.current.signal
      const startDatasetLoadRef = startLoad()
      const resultRef: { current: ReturnType<typeof useDatasetLifecycle> | null } = {
        current: null,
      }
      const overview = deferred<[]>()
      let overviewSignal: AbortSignal | undefined
      const setLoadState = vi.fn()
      const setOverviewCells = vi.fn()
      const setPendingDatasetLoadState = vi.fn()
      const onBeforeDatasetLoad = vi.fn()

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          loadDatasetOverview={vi.fn((_url, options) => {
            overviewSignal = options?.signal
            return overview.promise
          })}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
          resultRef={resultRef}
          extraSetters={{ setOverviewCells, setPendingDatasetLoadState }}
          onBeforeDatasetLoad={onBeforeDatasetLoad}
        />,
      )

      let load: Promise<void> | undefined
      await act(async () => {
        load = startDatasetLoadRef.current?.(NEXT_URL, false)
        await Promise.resolve()
        await Promise.resolve()
      })
      act(() => {
        resultRef.current?.cancelDatasetLoad()
      })
      await act(async () => {
        overview.resolve([])
        await load
      })

      expect(overviewSignal?.aborted).toBe(true)
      expect(openDatasetSignal.aborted).toBe(false)
      expect(setPendingDatasetLoadState).toHaveBeenLastCalledWith({ status: 'idle' })
      expect(setLoadState).not.toHaveBeenCalled()
      expect(setOverviewCells).not.toHaveBeenCalled()
      expect(onBeforeDatasetLoad).not.toHaveBeenCalled()
    })

    it('cancels a first load back to no dataset (15.3-D)', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const resultRef: { current: ReturnType<typeof useDatasetLifecycle> | null } = {
        current: null,
      }
      const overview = deferred<[]>()
      const loadStates: string[] = []
      const setLoadState = vi.fn((state: unknown) => {
        loadStates.push(statusOf(state))
      })
      const setGenePanelState = vi.fn()
      const setDatasetPlatform = vi.fn()

      render(
        <Probe
          refs={refs}
          isDatasetLoading
          loadDatasetOverview={vi.fn(() => overview.promise)}
          setDatasetPlatform={setDatasetPlatform}
          setGenePanelState={setGenePanelState}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
          resultRef={resultRef}
        />,
      )

      let load: Promise<void> | undefined
      await act(async () => {
        load = startDatasetLoadRef.current?.(NEXT_URL, false)
        await Promise.resolve()
        await Promise.resolve()
      })
      const datasetSignal = refs.datasetAbortRef.current?.signal
      act(() => {
        resultRef.current?.cancelDatasetLoad()
      })
      await act(async () => {
        overview.resolve([])
        await load
      })

      expect(datasetSignal?.aborted).toBe(true)
      expect(loadStates).toEqual(['loading', 'idle'])
      expect(setDatasetPlatform).toHaveBeenLastCalledWith(null)
      expect(setGenePanelState).toHaveBeenLastCalledWith({ status: 'idle' })
    })

    it('puts a view change’s control back when a plain load replaces it', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef: LifecycleOptions['refs']['startDatasetLoadRef'] = {
        current: null,
      }
      const overview = deferred<[]>()

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          loadDatasetOverview={vi.fn(() => overview.promise)}
          startDatasetLoadRef={startDatasetLoadRef}
        />,
      )

      const first = { restoreControl: vi.fn() }
      const second = { restoreControl: vi.fn() }
      await act(async () => {
        void startDatasetLoadRef.current?.(OPEN_URL, false, first)
        await Promise.resolve()
      })
      // Another view change replaces it; that one puts the control back if
      // it fails.
      await act(async () => {
        void startDatasetLoadRef.current?.(OPEN_URL, false, second)
        await Promise.resolve()
      })
      expect(first.restoreControl).not.toHaveBeenCalled()

      // A plain load replaces the second, which will never open.
      await act(async () => {
        void startDatasetLoadRef.current?.(NEXT_URL, false)
        await Promise.resolve()
      })
      expect(second.restoreControl).toHaveBeenCalledTimes(1)
    })

    it('drops the summary of a SpatialData store another load replaced', async () => {
      const STORE_URL = 'https://example.test/store.zarr'
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const summary = deferred<{
        readonly coordinateSystem: string
        readonly coordinateSystems: readonly string[]
        readonly images: readonly string[]
        readonly tables: readonly string[]
        readonly regions: readonly string[]
        readonly skippedElements: readonly string[]
        readonly units: { micrometersPerUnit: number; source: string; detail: string }
      }>()
      const dataset = {
        overview: vi.fn(async () => []),
        genePanel: vi.fn(async () => []),
        annotationGroups: vi.fn(async () => []),
        embeddingOptions: vi.fn(async () => []),
        metadataTracks: vi.fn(async () => []),
        summary: vi.fn(() => summary.promise),
      }
      const setSpatialDataControlState = vi.fn()

      render(
        <Probe
          refs={refs}
          detectSpatialDataset={vi.fn(async (url: string) =>
            url === STORE_URL
              ? {
                  platform: 'spatialdata' as const,
                  baseUrl: url,
                  spatialDataUrl: url,
                  checked: [],
                }
              : { platform: 'xenium' as const, baseUrl: url, checked: [] },
          )}
          getSpatialDataset={
            vi.fn(
              async () => dataset,
            ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
          }
          startDatasetLoadRef={startDatasetLoadRef}
          extraSetters={{ setSpatialDataControlState }}
        />,
      )

      let storeLoad: Promise<void> | undefined
      await act(async () => {
        storeLoad = startDatasetLoadRef.current?.(STORE_URL, false)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(dataset.summary).toHaveBeenCalled()

      await act(async () => {
        await startDatasetLoadRef.current?.(NEXT_URL, false)
      })
      await act(async () => {
        summary.resolve({
          coordinateSystem: 'global',
          coordinateSystems: ['global'],
          images: [],
          tables: ['table'],
          regions: [],
          skippedElements: [],
          units: { micrometersPerUnit: 1, source: 'unknown', detail: '' },
        })
        await storeLoad
      })

      expect(setSpatialDataControlState).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready' }),
      )
    })

    it('stops the background reads of a load that fails', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const panel = deferred<string[]>()
      const setGenePanelState = vi.fn()
      const setLoadState = vi.fn()

      render(
        <Probe
          refs={refs}
          loadDatasetOverview={vi.fn(async () => {
            throw new Error('HTTP 500 reading cells.parquet')
          })}
          loadGenePanel={vi.fn(() => panel.promise)}
          setGenePanelState={setGenePanelState}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
        />,
      )

      await act(async () => {
        await startDatasetLoadRef.current?.(NEXT_URL, false)
      })
      expect(setLoadState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'error' }),
      )

      // The gene panel read started before the failure answers after it.
      await act(async () => {
        panel.resolve(['EPCAM', 'KRT8'])
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(setGenePanelState).toHaveBeenLastCalledWith({ status: 'idle' })
    })

    it('drops a pending load when another starts', async () => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = startLoad()
      const first = deferred<[]>()
      const setLoadState = vi.fn()
      const loadDatasetOverview = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(async () => [])

      render(
        <Probe
          refs={refs}
          isDatasetLoaded
          loadDatasetOverview={loadDatasetOverview}
          setLoadState={setLoadState}
          startDatasetLoadRef={startDatasetLoadRef}
        />,
      )

      let firstLoad: Promise<void> | undefined
      await act(async () => {
        firstLoad = startDatasetLoadRef.current?.(OPEN_URL, false)
        await Promise.resolve()
      })
      await act(async () => {
        await startDatasetLoadRef.current?.(NEXT_URL, false)
      })
      await act(async () => {
        first.resolve([])
        await firstLoad
      })

      expect(setLoadState).toHaveBeenCalledWith({
        status: 'ready',
        url: NEXT_URL,
        cellCount: 0,
      })
      expect(setLoadState).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready', url: OPEN_URL }),
      )
    })
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

  it('applies dataset manifest defaults beneath a shared link', async () => {
    const refs = createLifecycleRefs()
    const datasetUrl = 'https://example.test/xenium'
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'xenium' as const,
      baseUrl: datasetUrl,
      manifest: {
        platform: 'xenium' as const,
        url: `${datasetUrl}/explorer.json`,
        rootUrl: datasetUrl,
        name: 'Run 1',
        source: { repository: 'BioImage Archive', accession: 'S-BIAD1' },
        files: {},
        defaults: {
          genes: ['EPCAM'],
          cellBoundaries: false,
          nucleusBoundaries: true,
          imageOpacity: 0.4,
          colorCellsBy: 'cell-area',
          geneColorScale: 'rainbow',
          geneRange: [0, 40] as const,
        },
      },
      checked: [],
    }))
    const geneScaleRange = geneScaleRangeState()
    const appendFallbackNotice = vi.fn()
    const setImageLayerOpacity = vi.fn()
    const setObservationColorMode = vi.fn()
    const setSelectedGenes = vi.fn()
    const setSavedGeneSets = vi.fn()
    const setGeneExpressionColorScale = vi.fn()
    const setShowCellBoundaries = vi.fn()
    const setShowNucleusBoundaries = vi.fn()
    const setLoadState = vi.fn()
    const setDatasetAbout = vi.fn()
    const setDatasetManifestDefaults = vi.fn()

    // The shared link names the dataset, so the lifecycle loads it on mount.
    render(
      <Probe
        refs={refs}
        appendFallbackNotice={appendFallbackNotice}
        detectSpatialDataset={detectSpatialDataset}
        extraSetters={{
          setDatasetAbout,
          setDatasetManifestDefaults,
          setGeneExpressionColorScale,
          setGeneExpressionScaleRange: geneScaleRange.setGeneExpressionScaleRange,
          setImageLayerOpacity,
          setObservationColorMode,
          setSavedGeneSets,
          setSelectedGenes,
        }}
        initialShareableState={{
          datasetUrl,
          selectedGenes: ['ACTB'],
          geneSets: 'Epithelial|mean|EPCAM,KRT8',
          showCellBoundaries: true,
          // The Gene scale reset to Auto, which the manifest's range would undo.
          geneExpressionScaleRange: ',',
        }}
        setLoadState={setLoadState}
        setShowCellBoundaries={setShowCellBoundaries}
        setShowNucleusBoundaries={setShowNucleusBoundaries}
      />,
    )

    await waitFor(() => {
      expect(setLoadState).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready', url: datasetUrl }),
      )
    })
    expect(detectSpatialDataset).toHaveBeenCalledTimes(1)
    expect(setDatasetAbout).toHaveBeenLastCalledWith({
      name: 'Run 1',
      source: { repository: 'BioImage Archive', accession: 'S-BIAD1' },
    })

    // The shared link sets genes, cell boundaries and the range, so those win.
    expect(setSelectedGenes).toHaveBeenLastCalledWith(['ACTB'])
    expect(setSavedGeneSets).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'Epithelial', genes: ['EPCAM', 'KRT8'] }),
    ])
    expect(setShowCellBoundaries).toHaveBeenLastCalledWith(true)
    expect(geneScaleRange.state.range).toEqual(AUTO_GENE_SCALE_RANGE)
    // The rest come from the manifest.
    expect(setShowNucleusBoundaries).toHaveBeenLastCalledWith(true)
    expect(setImageLayerOpacity).toHaveBeenCalledWith(0.4)
    expect(setObservationColorMode).toHaveBeenLastCalledWith('cell-area')
    // The dataset's links leave the manifest's values out (15.5).
    expect(setDatasetManifestDefaults).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedGenes: ['EPCAM'], imageOpacity: 0.4 }),
    )
    // Unknown values are reported and leave the control alone.
    expect(setGeneExpressionColorScale).not.toHaveBeenCalledWith('rainbow')
    expect(appendFallbackNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('defaults.geneColorScale "rainbow"'),
      }),
    )
  })

  it('keeps a link’s colour mode over the gene expression a manifest’s genes open in', async () => {
    const refs = createLifecycleRefs()
    const datasetUrl = 'https://example.test/xenium'
    // As examples/bia/S-BIAD2376.json: genes without colorCellsBy.
    const detectSpatialDataset = vi.fn(async () => ({
      platform: 'xenium' as const,
      baseUrl: datasetUrl,
      manifest: {
        platform: 'xenium' as const,
        url: `${datasetUrl}/explorer.json`,
        rootUrl: datasetUrl,
        files: {},
        defaults: { genes: ['COL1A1'] },
      },
      checked: [],
    }))
    const setObservationColorMode = vi.fn()
    const setSelectedGenes = vi.fn()
    const setLoadState = vi.fn()

    // The link leaves the manifest's gene out and names Transcript count.
    render(
      <Probe
        refs={refs}
        detectSpatialDataset={detectSpatialDataset}
        extraSetters={{ setObservationColorMode, setSelectedGenes }}
        initialShareableState={{
          linkVersion: 2,
          datasetUrl,
          observationColorMode: 'transcript-count',
        }}
        setLoadState={setLoadState}
      />,
    )

    await waitFor(() => {
      expect(setLoadState).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ready', url: datasetUrl }),
      )
    })
    expect(setSelectedGenes).toHaveBeenLastCalledWith(['COL1A1'])
    expect(setObservationColorMode).toHaveBeenLastCalledWith('transcript-count')
  })

  it('loads SpatialData tables through AnnData readers and shows boundaries', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/sample.sdata.zarr'
    const metadataTrack = {
      id: 'h5ad:score',
      label: 'score',
      values: null,
      cellCount: 1,
      min: 0.5,
      max: 0.5,
    }
    const dataset = {
      overview: vi.fn(async () => [
        {
          cellId: 'cell-a',
          position: { x: micrometers(1), y: micrometers(2) },
          transcriptCount: 0,
        },
      ]),
      genePanel: vi.fn(async () => ['Actb']),
      geneAliases: vi.fn(async () => new Map([['Actb', 'ENSMUSG00000029580']])),
      annotationGroups: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => []),
      metadataTracks: vi.fn(async () => [metadataTrack]),
      image: vi.fn(async () => null),
      summary: vi.fn(async () => ({
        coordinateSystem: 'global',
        coordinateSystems: ['global'],
        regions: ['cells'],
        skippedElements: [],
      })),
    }
    const loadDatasetOverview = vi.fn(async () => [])
    const setCellMetadataTracks = vi.fn()
    const setSelectedCellMetadataTrackId = vi.fn()
    const setDatasetPlatform = vi.fn()
    const setGenePanelState = vi.fn()
    const setLoadState = vi.fn()
    const setMorphologyState = vi.fn()
    const setShowCellBoundaries = vi.fn()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'spatialdata' as const,
          baseUrl: datasetUrl,
          spatialDataUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={
          vi.fn(
            async () => dataset,
          ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
        }
        loadDatasetOverview={loadDatasetOverview}
        initialShareableState={{ datasetUrl, cellMetadataTrackId: 'h5ad:score' }}
        setCellMetadataTracks={setCellMetadataTracks}
        setSelectedCellMetadataTrackId={setSelectedCellMetadataTrackId}
        setDatasetPlatform={setDatasetPlatform}
        setGenePanelState={setGenePanelState}
        setLoadState={setLoadState}
        setMorphologyState={setMorphologyState}
        setShowCellBoundaries={setShowCellBoundaries}
        startDatasetLoadRef={startDatasetLoadRef}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    expect(setDatasetPlatform).toHaveBeenCalledWith('spatialdata')
    expect(setShowCellBoundaries).toHaveBeenCalledWith(true)
    expect(setGenePanelState).toHaveBeenLastCalledWith({
      status: 'ready',
      url: datasetUrl,
      genes: ['Actb'],
      aliases: new Map([['Actb', 'ENSMUSG00000029580']]),
    })
    expect(setLoadState).toHaveBeenLastCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    })
    expect(setCellMetadataTracks).toHaveBeenLastCalledWith([metadataTrack])
    expect(setSelectedCellMetadataTrackId).toHaveBeenCalledWith('h5ad:score')
    await waitFor(() => {
      expect(setMorphologyState).toHaveBeenLastCalledWith({ status: 'idle' })
    })
    expect(dataset.image).toHaveBeenCalled()
    expect(loadDatasetOverview).not.toHaveBeenCalled()
  })

  it.each([
    {
      source: 'space-ranger' as const,
      detection: {
        platform: 'visium' as const,
        baseUrl: 'https://example.test/visium/outs',
        files: {
          tissuePositions: 'spatial/tissue_positions.csv',
          scalefactors: 'spatial/scalefactors_json.json',
          filteredMatrix: 'filtered_feature_bc_matrix.h5',
        },
        checked: [],
      },
    },
    {
      source: 'h5ad' as const,
      detection: {
        platform: 'h5ad' as const,
        baseUrl: 'https://example.test/visium.h5ad',
        h5adUrl: 'https://example.test/visium.h5ad',
        checked: [],
      },
    },
  ])(
    'loads Visium spots and the tissue image from $source',
    async ({ source, detection }) => {
      const refs = createLifecycleRefs()
      const startDatasetLoadRef = {
        current: null as
          | ((datasetUrl: string, loadImage: boolean) => Promise<void>)
          | null,
      }
      const datasetUrl = detection.baseUrl
      const summary = {
        libraryId: 'sample-A',
        libraryIds: ['sample-A'],
        spotCount: 1,
        offTissueSpotCount: 0,
        spotDiameterMicrometers: 55,
        units: {
          micrometersPerPixel: 0.65,
          source: 'spot-diameter' as const,
          detail: 'spot_diameter_fullres as 65 µm',
        },
        scalefactors: { tissueHiresScalef: 0.2 },
        images: ['hires' as const],
      }
      const dataset = {
        overview: vi.fn(async () => [
          {
            cellId: 'AAACAAGTATCTCCCA-1',
            position: { x: micrometers(10), y: micrometers(20) },
            transcriptCount: 0,
            cellArea: 2375.8,
          },
        ]),
        genePanel: vi.fn(async () => ['Actb']),
        annotationGroups: vi.fn(async () => []),
        embeddingOptions: vi.fn(async () => []),
        metadataTracks: vi.fn(async () => []),
        meta: vi.fn(async () => ({
          platform: 'visium',
          units: {
            dataUnit: 'micrometer',
            imageUnit: 'pixel',
            micrometersPerPixel: micrometers(0.65),
            origin: 'top-left',
            imageYAxis: 'down',
          },
          extent: {
            minX: micrometers(0),
            maxX: micrometers(1),
            minY: micrometers(0),
            maxY: micrometers(1),
          },
          capabilities: {
            transcripts: false,
            cellBoundaries: true,
            pyramidImage: false,
            multiChannel: false,
          },
        })),
        visiumSummary: vi.fn(async () => summary),
        tissueImage: vi.fn(async () => ({
          kind: 'flat' as const,
          url: 'https://example.test/hires.png',
          scaleFactor: 0.2,
        })),
      }
      const getSpatialDataset = vi.fn(
        async () => dataset,
      ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
      const appendFallbackNotice = vi.fn()
      const setDatasetPlatform = vi.fn()
      const setFlatMorphologyImage = vi.fn()
      const setLoadState = vi.fn()
      const setMorphologyState = vi.fn()
      const setShowCellBoundaries = vi.fn()
      const setVisiumControlState = vi.fn()

      render(
        <Probe
          refs={refs}
          appendFallbackNotice={appendFallbackNotice}
          detectSpatialDataset={vi.fn(async () => detection)}
          getSpatialDataset={getSpatialDataset}
          extraSetters={{ setVisiumControlState }}
          setDatasetPlatform={setDatasetPlatform}
          setFlatMorphologyImage={setFlatMorphologyImage}
          setLoadState={setLoadState}
          setMorphologyState={setMorphologyState}
          setShowCellBoundaries={setShowCellBoundaries}
          startDatasetLoadRef={startDatasetLoadRef}
        />,
      )

      await act(async () => {
        await startDatasetLoadRef.current?.(datasetUrl, true)
      })

      expect(setDatasetPlatform).toHaveBeenLastCalledWith('visium')
      expect(setShowCellBoundaries).toHaveBeenLastCalledWith(false)
      expect(setVisiumControlState).toHaveBeenCalledWith({
        status: 'ready',
        source,
        summary,
        image: 'hires',
      })
      expect(setLoadState).toHaveBeenLastCalledWith({
        status: 'ready',
        url: datasetUrl,
        cellCount: 1,
      })
      expect(appendFallbackNotice).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('spot_diameter_fullres as 65 µm') as string,
        }),
      )
      await waitFor(() => {
        expect(setFlatMorphologyImage).toHaveBeenCalledWith({
          url: 'https://example.test/hires.png',
          scaleFactor: 0.2,
          micrometersPerPixel: 0.65,
        })
      })
      expect(dataset.tissueImage).toHaveBeenCalledWith('hires')
      // The default view, set for the URL once the load commits.
      expect(getSpatialDataset).toHaveBeenCalledWith(
        detection.baseUrl,
        expect.objectContaining({ visiumView: {} }),
      )
      expect(visiumViewFor(datasetUrl)).toEqual({})
      expect(setMorphologyState).toHaveBeenLastCalledWith({
        status: 'ready',
        url: 'https://example.test/hires.png',
      })
    },
  )

  it('restores the shared Visium library, off-tissue spots, and image', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/two-sections.h5ad'
    const summary = {
      libraryId: 'lib-B',
      libraryIds: ['lib-A', 'lib-B'],
      spotCount: 12,
      offTissueSpotCount: 2,
      showOffTissue: true,
      spotDiameterMicrometers: 55,
      units: {
        micrometersPerPixel: 0.5,
        source: 'spot-grid' as const,
        detail: 'fit',
      },
      scalefactors: { tissueHiresScalef: 0.2, tissueLowresScalef: 0.05 },
      images: ['hires' as const, 'lowres' as const],
    }
    const dataset = {
      overview: vi.fn(async () => []),
      genePanel: vi.fn(async () => []),
      annotationGroups: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => []),
      metadataTracks: vi.fn(async () => []),
      meta: vi.fn(),
      visiumSummary: vi.fn(async () => summary),
      tissueImage: vi.fn(async () => null),
    }
    const getSpatialDataset = vi.fn(
      async () => dataset,
    ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
    const setVisiumControlState = vi.fn()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'h5ad' as const,
          baseUrl: datasetUrl,
          h5adUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={getSpatialDataset}
        extraSetters={{ setVisiumControlState }}
        initialShareableState={{
          datasetUrl,
          visiumLibrary: 'lib-B',
          visiumOffTissue: true,
          visiumImage: 'lowres',
        }}
        startDatasetLoadRef={startDatasetLoadRef}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    // The shared view is opened as its own dataset and set for the URL.
    expect(getSpatialDataset).toHaveBeenCalledWith(
      datasetUrl,
      expect.objectContaining({
        visiumView: { libraryId: 'lib-B', showOffTissue: true },
      }),
    )
    expect(visiumViewFor(datasetUrl)).toEqual({ libraryId: 'lib-B', showOffTissue: true })
    expect(setVisiumControlState).toHaveBeenCalledWith({
      status: 'ready',
      source: 'h5ad',
      summary,
      image: 'lowres',
    })
    await waitFor(() => {
      expect(dataset.tissueImage).toHaveBeenCalledWith('lowres')
    })
    setVisiumView(datasetUrl, undefined)
  })

  it('keeps an .h5ad without uns/spatial on the H5AD platform', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/cells.h5ad'
    const dataset = {
      overview: vi.fn(async () => []),
      genePanel: vi.fn(async () => []),
      annotationGroups: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => []),
      metadataTracks: vi.fn(async () => []),
      meta: vi.fn(),
      visiumSummary: vi.fn(async () => null),
      tissueImage: vi.fn(),
    }
    const setDatasetPlatform = vi.fn()
    const setVisiumControlState = vi.fn()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'h5ad' as const,
          baseUrl: datasetUrl,
          h5adUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={
          vi.fn(
            async () => dataset,
          ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
        }
        extraSetters={{ setVisiumControlState }}
        setDatasetPlatform={setDatasetPlatform}
        startDatasetLoadRef={startDatasetLoadRef}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    expect(setDatasetPlatform).toHaveBeenLastCalledWith('h5ad')
    expect(setVisiumControlState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    )
    expect(dataset.tissueImage).not.toHaveBeenCalled()
  })

  it('gives the dataset it opens, and each of its reads, the signal Cancel aborts', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const resultRef: { current: ReturnType<typeof useDatasetLifecycle> | null } = {
      current: null,
    }
    const datasetUrl = 'https://example.test/cells.h5ad'
    const signals = new Map<string, AbortSignal | undefined>()
    const read =
      (name: string) =>
      (options?: { readonly signal?: AbortSignal }): Promise<never> => {
        signals.set(name, options?.signal)
        return new Promise(() => undefined)
      }
    const dataset = {
      overview: vi.fn(read('overview')),
      genePanel: vi.fn(read('genePanel')),
      geneAliases: vi.fn(read('geneAliases')),
      annotationGroups: vi.fn(read('annotationGroups')),
      embeddingOptions: vi.fn(read('embeddingOptions')),
      metadataTracks: vi.fn(read('metadataTracks')),
      meta: vi.fn(),
      visiumSummary: vi.fn(async (options?: { readonly signal?: AbortSignal }) => {
        signals.set('visiumSummary', options?.signal)
        return null
      }),
      tissueImage: vi.fn(),
    }

    render(
      <Probe
        refs={refs}
        isDatasetLoading
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'h5ad' as const,
          baseUrl: datasetUrl,
          h5adUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={
          vi.fn(async (_url: string, options?: { readonly signal?: AbortSignal }) => {
            signals.set('getSpatialDataset', options?.signal)
            return dataset
          }) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
        }
        startDatasetLoadRef={startDatasetLoadRef}
        resultRef={resultRef}
      />,
    )

    await act(async () => {
      void startDatasetLoadRef.current?.(datasetUrl, false)
      await vi.waitFor(() => {
        expect(dataset.metadataTracks).toHaveBeenCalled()
      })
    })

    expect([...signals.keys()].sort()).toEqual([
      'annotationGroups',
      'embeddingOptions',
      'geneAliases',
      'genePanel',
      'getSpatialDataset',
      'metadataTracks',
      'overview',
      'visiumSummary',
    ])
    expect([...signals.values()].every((signal) => signal?.aborted === false)).toBe(true)
    act(() => {
      resultRef.current?.cancelDatasetLoad()
    })
    expect([...signals.values()].every((signal) => signal?.aborted === true)).toBe(true)
  })

  it('loads Atera through AnnData readers and opens its 2D morphology image', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/atera'
    const morphologyUrl = `${datasetUrl}/morphology_2d/ch0000_dapi.ome.tif`
    const dataset = {
      overview: vi.fn(async () => [
        {
          cellId: 'aaaaaaaa-1',
          position: { x: micrometers(1), y: micrometers(2) },
          transcriptCount: 12,
        },
      ]),
      genePanel: vi.fn(async () => ['UMOD']),
      annotationGroups: vi.fn(async () => [
        { id: 'obs:azimuth', label: 'azimuth', groupingName: 'azimuth', groupCount: 4 },
        {
          id: 'obs:graphclust',
          label: 'graphclust',
          groupingName: 'graphclust',
          groupCount: 9,
        },
      ]),
      embeddingOptions: vi.fn(async () => []),
      metadataTracks: vi.fn(async () => []),
      morphologyUrl: vi.fn(async () => morphologyUrl),
      morphology3dUrl: vi.fn(async () => null),
    }
    const loadMorphologyImage = vi.fn(async () => ({
      url: morphologyUrl,
      loader: {} as never,
      channels: [],
      channelLoaders: [],
    }))
    const loadDatasetOverview = vi.fn(async () => [])
    const setAteraImageState = vi.fn()
    const setDatasetPlatform = vi.fn()
    const setLoadState = vi.fn()
    const setShowCellBoundaries = vi.fn()
    const setShowNucleusBoundaries = vi.fn()
    const setSelectedAnnotationGroupId = vi.fn()
    const warmDatasetForRoi = vi.fn(async () => undefined)

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'atera' as const,
          baseUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={
          vi.fn(
            async () => dataset,
          ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
        }
        loadDatasetOverview={loadDatasetOverview}
        loadMorphologyImage={loadMorphologyImage}
        setDatasetPlatform={setDatasetPlatform}
        setLoadState={setLoadState}
        setShowCellBoundaries={setShowCellBoundaries}
        setShowNucleusBoundaries={setShowNucleusBoundaries}
        startDatasetLoadRef={startDatasetLoadRef}
        warmDatasetForRoi={warmDatasetForRoi}
        extraSetters={{ setSelectedAnnotationGroupId, setAteraImageState }}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    expect(setDatasetPlatform).toHaveBeenCalledWith('atera')
    // Without a 3D stack there is no image choice.
    expect(setAteraImageState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    )
    expect(setShowCellBoundaries).toHaveBeenCalledWith(true)
    expect(setShowNucleusBoundaries).toHaveBeenCalledWith(false)
    // graphclust, as on Xenium (15.1-I, run on the AnnData path in 15.5-B).
    expect(setSelectedAnnotationGroupId).toHaveBeenLastCalledWith('obs:graphclust')
    expect(setLoadState).toHaveBeenLastCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    })
    await waitFor(() => {
      expect(loadMorphologyImage).toHaveBeenCalledWith(
        datasetUrl,
        expect.objectContaining({ candidates: [morphologyUrl] }),
      )
    })
    expect(loadDatasetOverview).not.toHaveBeenCalled()
    expect(warmDatasetForRoi).not.toHaveBeenCalled()
  })

  it('opens the Atera 3D DAPI stack when the link asks for it', async () => {
    const refs = createLifecycleRefs()
    const startDatasetLoadRef = {
      current: null as ((datasetUrl: string, loadImage: boolean) => Promise<void>) | null,
    }
    const datasetUrl = 'https://example.test/atera'
    const morphology3dUrl = `${datasetUrl}/morphology_3d/ch0000_dapi_3d.ome.tif`
    const dataset = {
      overview: vi.fn(async () => [
        { cellId: 'aaaaaaaa-1', position: { x: micrometers(1), y: micrometers(2) } },
      ]),
      genePanel: vi.fn(async () => ['UMOD']),
      annotationGroups: vi.fn(async () => []),
      embeddingOptions: vi.fn(async () => []),
      metadataTracks: vi.fn(async () => []),
      morphologyUrl: vi.fn(async () => `${datasetUrl}/morphology_2d/ch0000_dapi.ome.tif`),
      morphology3dUrl: vi.fn(async () => morphology3dUrl),
    }
    const loadMorphologyImage = vi.fn(async () => ({
      url: morphology3dUrl,
      loader: {} as never,
      channels: [],
      channelLoaders: [],
    }))
    const setAteraImageState = vi.fn()

    render(
      <Probe
        refs={refs}
        detectSpatialDataset={vi.fn(async () => ({
          platform: 'atera' as const,
          baseUrl: datasetUrl,
          checked: [],
        }))}
        getSpatialDataset={
          vi.fn(
            async () => dataset,
          ) as unknown as LifecycleOptions['loaders']['getSpatialDataset']
        }
        loadMorphologyImage={loadMorphologyImage}
        startDatasetLoadRef={startDatasetLoadRef}
        extraSetters={{ setAteraImageState }}
        initialShareableState={{ datasetUrl, ateraImage: '3d', morphologyZPlane: 7 }}
      />,
    )

    await act(async () => {
      await startDatasetLoadRef.current?.(datasetUrl, true)
    })

    expect(setAteraImageState).toHaveBeenLastCalledWith({ status: 'ready', choice: '3d' })
    await waitFor(() => {
      expect(loadMorphologyImage).toHaveBeenCalledWith(datasetUrl, {
        candidates: [morphology3dUrl],
        signal: expect.any(AbortSignal),
        onFallback: expect.any(Function),
        zPlane: 7,
        zchunkStoreUrl: null,
      })
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
    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl, {
      detection: expect.objectContaining({ platform: 'visium-hd', baseUrl: datasetUrl }),
      signal: expect.any(AbortSignal),
    })
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
    expect(setSpatialGridCells).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['BC-1'],
        gridId: grid.id,
        rows: Int32Array.from([0]),
        cols: Int32Array.from([0]),
      }),
    )
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
    // The dataset reports a low-res tissue image fallback through this.
    expect(dataset.image).toHaveBeenCalledWith(undefined, {
      onFallback: expect.any(Function),
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

    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl, {
      detection: expect.objectContaining({ platform: 'visium-hd', baseUrl: datasetUrl }),
      signal: expect.any(AbortSignal),
    })
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
