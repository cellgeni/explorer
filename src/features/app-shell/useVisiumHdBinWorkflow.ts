import { useCallback, useRef } from 'react'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  visiumHdAvailableBinSizes,
  visiumHdGridLoadBinSize,
} from '../../data/visiumHdGridLod'
import type { FallbackNotice, FallbackNotifier } from '../../data/fallbackNotice'
import type {
  DatasetMeta,
  GeneExpressionBatch,
  ImageSource,
} from '../../datasets/spatialDataset'
import type {
  VisiumHdBinnedOverview,
  VisiumHdBinSizeMicrometers,
  VisiumHdImageOptions,
} from '../../datasets/visiumHdDataset'
import { type GridCellDatum } from '../../rendering/deckLayers'
import type { GridCellColumns } from '../../rendering/gridCellColumns'
import {
  IDLE_MORPHOLOGY_LOAD_STATE,
  datasetLoadReady,
  morphologyLoadFailed,
  morphologyLoadReady,
  morphologyLoadStarted,
  type DatasetLoadState,
  type MorphologyLoadState,
} from '../dataset/datasetLoadModel'
import {
  visiumHdControlFailed,
  visiumHdControlLoading,
  visiumHdControlReadyFromOptions,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import {
  EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
  IDLE_GENE_EXPRESSION_STATE,
  genePanelLoadFailed,
  genePanelLoadReady,
  genePanelLoadStarted,
} from '../genes/geneControlsModel'
import {
  formatRuntimeMemorySnapshot,
  readRuntimeMemorySnapshot,
} from '../../data/runtimeMemory'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import {
  abortActiveRequest,
  formatElapsed,
  invalidateLatestRequest,
  readTimestamp,
  type DebugLogAppendOptions,
} from './appRuntimeModel'
import { visiumHdOverviewToGridCellColumns } from './visiumHdGridLayerData'

interface MutableRef<T> {
  current: T
}

interface Setter<T> {
  (value: T | ((current: T) => T)): void
}

export interface VisiumHdOverviewDataset {
  readonly maxTwoMicrometerFilteredBarcodes?: number | undefined
  meta(binSizeMicrometers?: VisiumHdBinSizeMicrometers): Promise<DatasetMeta>
  image(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: VisiumHdImageOptions,
  ): Promise<ImageSource | null>
  genePanel?(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly string[]>
  readBinnedOverview(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
  ): Promise<VisiumHdBinnedOverview>
}

interface VisiumHdBinWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly onBeforeBinSizeChange?: () => void
  // Receives the notice when the tier's hi-res tissue image is passed over.
  readonly onFallback?: FallbackNotifier | undefined
}

interface VisiumHdBinWorkflowControls {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly shouldLoadMorphology: boolean
  readonly visiumHdControlState: VisiumHdControlState
}

interface VisiumHdBinWorkflowData {
  readonly flatMorphologyImage?: FlatMorphologyCanvasImage | null | undefined
  readonly loadedDatasetUrl: string | null
}

interface VisiumHdBinWorkflowLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
}

interface VisiumHdBinWorkflowRefs {
  readonly visiumHdBinRequestIdRef?: MutableRef<number> | undefined
  readonly geneExpressionAbortRef?: MutableRef<AbortController | null> | undefined
  readonly geneExpressionRequestIdRef?: MutableRef<number> | undefined
  readonly geneExpressionViewportKeyRef?: MutableRef<string | null> | undefined
}

interface VisiumHdBinWorkflowSetters {
  readonly setFlatMorphologyImage: Setter<FlatMorphologyCanvasImage | null>
  readonly setGeneExpressionBatch?: Setter<GeneExpressionBatch | null> | undefined
  readonly setGeneExpressionScaleDomain?: Setter<GeneExpressionScaleDomain> | undefined
  readonly setGeneExpressionState?:
    | Setter<GeneExpressionState<StructuredLoadError>>
    | undefined
  readonly setGenePanelState: Setter<GenePanelState<StructuredLoadError>>
  readonly setLoadState: Setter<DatasetLoadState<StructuredLoadError>>
  readonly setMorphologyState: Setter<MorphologyLoadState<StructuredLoadError>>
  readonly setSpatialGridCells: Setter<GridCellColumns>
  readonly setSelectedGridCell: Setter<GridCellDatum | null>
  readonly setVisiumHdControlState: Setter<VisiumHdControlState>
}

export interface UseVisiumHdBinWorkflowOptions {
  readonly callbacks: VisiumHdBinWorkflowCallbacks
  readonly controls: VisiumHdBinWorkflowControls
  readonly data: VisiumHdBinWorkflowData
  readonly loaders: VisiumHdBinWorkflowLoaders
  readonly refs?: VisiumHdBinWorkflowRefs | undefined
  readonly setters: VisiumHdBinWorkflowSetters
}

export interface UseVisiumHdBinWorkflowResult {
  readonly handleVisiumHdBinSizeChange: (
    binSize: VisiumHdBinSizeMicrometers,
  ) => Promise<void>
}

export function useVisiumHdBinWorkflow({
  callbacks,
  controls,
  data,
  loaders,
  refs,
  setters,
}: UseVisiumHdBinWorkflowOptions): UseVisiumHdBinWorkflowResult {
  const { appendDebugEvent, onBeforeBinSizeChange, onFallback } = callbacks
  const { currentViewportDetail, shouldLoadMorphology, visiumHdControlState } = controls
  const { flatMorphologyImage, loadedDatasetUrl } = data
  const { getSpatialDataset } = loaders
  const {
    geneExpressionAbortRef,
    geneExpressionRequestIdRef,
    geneExpressionViewportKeyRef,
    visiumHdBinRequestIdRef,
  } = refs ?? {}
  const {
    setFlatMorphologyImage,
    setGeneExpressionBatch,
    setGeneExpressionScaleDomain,
    setGeneExpressionState,
    setGenePanelState,
    setLoadState,
    setMorphologyState,
    setSelectedGridCell,
    setSpatialGridCells,
    setVisiumHdControlState,
  } = setters
  const fallbackRequestIdRef = useRef(0)
  const requestIdRef = visiumHdBinRequestIdRef ?? fallbackRequestIdRef

  const handleVisiumHdBinSizeChange = useCallback(
    async (binSize: VisiumHdBinSizeMicrometers) => {
      if (visiumHdControlState.status === 'idle') {
        return
      }

      const option = visiumHdControlState.options.find(
        (candidate) => candidate.size === binSize,
      )

      if (option === undefined || option.disabled) {
        return
      }

      const datasetUrl = loadedDatasetUrl ?? visiumHdControlState.url
      const overviewBinSize = visiumHdGridLoadBinSize(
        binSize,
        currentViewportDetail?.viewState.zoom,
        visiumHdAvailableBinSizes(visiumHdControlState.options),
      )
      const requestId = requestIdRef.current + 1
      const startedAt = readTimestamp()
      requestIdRef.current = requestId
      onBeforeBinSizeChange?.()
      setSelectedGridCell(null)
      resetVisiumHdExpressionState({
        geneExpressionAbortRef,
        geneExpressionRequestIdRef,
        geneExpressionViewportKeyRef,
        setGeneExpressionBatch,
        setGeneExpressionScaleDomain,
        setGeneExpressionState,
      })
      setVisiumHdControlState((current) => visiumHdControlLoading(current, binSize))
      appendDebugEvent(
        overviewBinSize === binSize
          ? `Loading Visium HD ${binSize} µm bins`
          : `Loading Visium HD ${overviewBinSize} µm view for selected ${binSize} µm bins`,
      )

      try {
        const dataset = await getSpatialDataset(datasetUrl)

        if (!isVisiumHdOverviewDataset(dataset)) {
          throw new Error('Loaded dataset does not expose Visium HD binned outputs.')
        }

        if (dataset.genePanel !== undefined) {
          setGenePanelState(genePanelLoadStarted(datasetUrl))
          void dataset
            .genePanel(binSize)
            .then((genes) => {
              if (requestIdRef.current !== requestId) {
                return
              }

              setGenePanelState(genePanelLoadReady(datasetUrl, genes))
              appendDebugEvent(
                `Visium HD gene panel ready: ${genes.length.toLocaleString()} genes`,
              )
            })
            .catch((error) => {
              if (requestIdRef.current !== requestId) {
                return
              }

              setGenePanelState(
                genePanelLoadFailed(
                  datasetUrl,
                  createStructuredLoadError('Gene panel', error),
                ),
              )
              appendDebugEvent('Visium HD gene panel failed')
            })
        }

        const [overview, meta] = await Promise.all([
          dataset.readBinnedOverview(overviewBinSize),
          dataset.meta(overviewBinSize),
        ])

        if (requestIdRef.current !== requestId) {
          return
        }

        setSpatialGridCells(visiumHdOverviewToGridCellColumns(overview, binSize))
        setLoadState(datasetLoadReady(datasetUrl, overview.gridCells.ids.length))

        setVisiumHdControlState(
          visiumHdControlReadyFromOptions(
            datasetUrl,
            visiumHdControlState.options,
            overview,
            binSize,
          ),
        )
        appendDebugEvent(
          `Visium HD ${overview.binSizeMicrometers} µm view ready for selected ${binSize} µm bins: ${overview.gridCells.ids.length.toLocaleString()} in ${formatElapsed(
            startedAt,
          )}${formatMemorySuffix()}`,
        )

        if (!shouldLoadMorphology) {
          setFlatMorphologyImage(null)
          setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
          return
        }

        if (flatMorphologyImage !== undefined && flatMorphologyImage !== null) {
          setMorphologyState(morphologyLoadReady(flatMorphologyImage.url))
          return
        }

        setMorphologyState(morphologyLoadStarted(datasetUrl))
        // Notices wait until this request is still the latest one.
        const imageNotices: FallbackNotice[] = []
        let imageSource: ImageSource | null

        try {
          imageSource = await dataset.image(overviewBinSize, {
            onFallback: (notice) => {
              imageNotices.push(notice)
            },
          })
        } catch (error) {
          if (requestIdRef.current !== requestId) {
            return
          }

          // The new bins are drawn; only the tissue image is missing.
          setMorphologyState(
            morphologyLoadFailed(
              datasetUrl,
              createStructuredLoadError('Morphology image', error),
            ),
          )
          appendDebugEvent('Visium HD tissue image failed')
          return
        }

        if (requestIdRef.current !== requestId) {
          return
        }

        for (const notice of imageNotices) {
          onFallback?.(notice)
        }

        const flatImage = flatMorphologyImageFromSource(imageSource, meta)

        if (flatImage === null) {
          setFlatMorphologyImage(null)
          setMorphologyState(IDLE_MORPHOLOGY_LOAD_STATE)
          return
        }

        setFlatMorphologyImage(flatImage)
        setMorphologyState(morphologyLoadReady(flatImage.url))
      } catch (error) {
        if (requestIdRef.current !== requestId) {
          return
        }

        // The bins already drawn stay loaded, so the dataset stays open: the
        // bin control shows the error, and selecting the size again retries.
        // Only the first load of a dataset fails it (useDatasetLifecycle).
        setVisiumHdControlState((current) =>
          visiumHdControlFailed(current, readErrorMessage(error)),
        )
        appendDebugEvent(`Visium HD ${binSize} µm bins failed`)
        const drawnBinSize =
          visiumHdControlState.loadedBinSize ?? visiumHdControlState.selectedBinSize
        onFallback?.({
          source: 'Dataset overview',
          message: `${binSize} µm bins could not be loaded, so the app kept the ${drawnBinSize} µm bins already drawn.`,
          action: `Select ${binSize} µm again to retry, or choose another bin size.`,
          detail: readErrorMessage(error),
        })
      }
    },
    [
      appendDebugEvent,
      currentViewportDetail,
      flatMorphologyImage,
      geneExpressionAbortRef,
      geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
      getSpatialDataset,
      loadedDatasetUrl,
      onBeforeBinSizeChange,
      onFallback,
      requestIdRef,
      setFlatMorphologyImage,
      setGeneExpressionBatch,
      setGeneExpressionScaleDomain,
      setGeneExpressionState,
      setGenePanelState,
      setLoadState,
      setMorphologyState,
      setSelectedGridCell,
      setSpatialGridCells,
      setVisiumHdControlState,
      shouldLoadMorphology,
      visiumHdControlState,
    ],
  )

  return { handleVisiumHdBinSizeChange }
}

function resetVisiumHdExpressionState({
  geneExpressionAbortRef,
  geneExpressionRequestIdRef,
  geneExpressionViewportKeyRef,
  setGeneExpressionBatch,
  setGeneExpressionScaleDomain,
  setGeneExpressionState,
}: {
  readonly geneExpressionAbortRef?: MutableRef<AbortController | null> | undefined
  readonly geneExpressionRequestIdRef?: MutableRef<number> | undefined
  readonly geneExpressionViewportKeyRef?: MutableRef<string | null> | undefined
  readonly setGeneExpressionBatch?: Setter<GeneExpressionBatch | null> | undefined
  readonly setGeneExpressionScaleDomain?: Setter<GeneExpressionScaleDomain> | undefined
  readonly setGeneExpressionState?:
    | Setter<GeneExpressionState<StructuredLoadError>>
    | undefined
}): void {
  if (geneExpressionAbortRef !== undefined && geneExpressionRequestIdRef !== undefined) {
    invalidateLatestRequest({
      abortRef: geneExpressionAbortRef,
      requestIdRef: geneExpressionRequestIdRef,
    })
  } else if (geneExpressionAbortRef !== undefined) {
    abortActiveRequest(geneExpressionAbortRef)
  } else if (geneExpressionRequestIdRef !== undefined) {
    geneExpressionRequestIdRef.current += 1
  }

  if (geneExpressionViewportKeyRef !== undefined) {
    geneExpressionViewportKeyRef.current = null
  }

  setGeneExpressionBatch?.(null)
  setGeneExpressionScaleDomain?.(EMPTY_GENE_EXPRESSION_SCALE_DOMAIN)
  setGeneExpressionState?.(IDLE_GENE_EXPRESSION_STATE)
}

export function isVisiumHdOverviewDataset(
  dataset: unknown,
): dataset is VisiumHdOverviewDataset {
  return (
    dataset !== null &&
    typeof dataset === 'object' &&
    'readBinnedOverview' in dataset &&
    typeof dataset.readBinnedOverview === 'function' &&
    'meta' in dataset &&
    typeof dataset.meta === 'function' &&
    'image' in dataset &&
    typeof dataset.image === 'function'
  )
}

function formatMemorySuffix(): string {
  const detail = formatRuntimeMemorySnapshot(readRuntimeMemorySnapshot())
  return detail === undefined ? '' : `; memory ${detail}`
}

export function flatMorphologyImageFromSource(
  source: ImageSource | null,
  meta: DatasetMeta,
): FlatMorphologyCanvasImage | null {
  if (source === null || source.kind !== 'flat') {
    return null
  }

  return {
    url: source.url,
    scaleFactor: source.scaleFactor,
    micrometersPerPixel: meta.units.micrometersPerPixel,
    ...(source.size === undefined ? {} : { size: source.size }),
  }
}
