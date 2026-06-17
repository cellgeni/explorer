import { useCallback, useRef } from 'react'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import type { DatasetMeta, ImageSource } from '../../datasets/spatialDataset'
import type {
  VisiumHdBinnedOverview,
  VisiumHdBinSizeMicrometers,
} from '../../datasets/visiumHdDataset'
import {
  gridCellBatchesToLayerData,
  type GridCellDatum,
} from '../../rendering/deckLayers'
import type { DatasetLoadState, MorphologyLoadState } from '../dataset/datasetLoadModel'
import {
  createVisiumHdBinOptions,
  updateVisiumHdBinOptionCount,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import {
  abortActiveRequest,
  formatElapsed,
  readTimestamp,
  type DebugLogAppendOptions,
} from './appRuntimeModel'

interface MutableRef<T> {
  current: T
}

interface Setter<T> {
  (value: T | ((current: T) => T)): void
}

export interface VisiumHdOverviewDataset {
  readonly maxTwoMicrometerFilteredBarcodes?: number | undefined
  meta(binSizeMicrometers?: VisiumHdBinSizeMicrometers): Promise<DatasetMeta>
  image(binSizeMicrometers?: VisiumHdBinSizeMicrometers): Promise<ImageSource | null>
  genePanel?(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly string[]>
  readBinnedOverview(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
  ): Promise<VisiumHdBinnedOverview>
}

export interface UseVisiumHdBinWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadedDatasetUrl: string | null
  readonly onBeforeBinSizeChange?: () => void
  readonly shouldLoadMorphology: boolean
  readonly visiumHdTwoMicrometerFilteredBarcodeBudget?: number | undefined
  readonly visiumHdControlState: VisiumHdControlState
  readonly flatMorphologyImage?: FlatMorphologyCanvasImage | null | undefined
  readonly visiumHdBinRequestIdRef?: MutableRef<number> | undefined
  readonly geneExpressionAbortRef?: MutableRef<AbortController | null> | undefined
  readonly geneExpressionRequestIdRef?: MutableRef<number> | undefined
  readonly geneExpressionViewportKeyRef?: MutableRef<string | null> | undefined
  readonly setFlatMorphologyImage: Setter<FlatMorphologyCanvasImage | null>
  readonly setGeneExpressionBatch?: Setter<GeneExpressionBatch | null> | undefined
  readonly setGeneExpressionScaleDomain?: Setter<GeneExpressionScaleDomain> | undefined
  readonly setGeneExpressionState?:
    | Setter<GeneExpressionState<StructuredLoadError>>
    | undefined
  readonly setGenePanelState: Setter<GenePanelState<StructuredLoadError>>
  readonly setLoadState: Setter<DatasetLoadState<StructuredLoadError>>
  readonly setMorphologyState: Setter<MorphologyLoadState<StructuredLoadError>>
  readonly setSpatialGridCells: Setter<readonly GridCellDatum[]>
  readonly setSelectedGridCell: Setter<GridCellDatum | null>
  readonly setVisiumHdControlState: Setter<VisiumHdControlState>
}

export interface UseVisiumHdBinWorkflowResult {
  readonly handleVisiumHdBinSizeChange: (
    binSize: VisiumHdBinSizeMicrometers,
  ) => Promise<void>
}

export function useVisiumHdBinWorkflow({
  appendDebugEvent,
  getSpatialDataset,
  loadedDatasetUrl,
  onBeforeBinSizeChange,
  shouldLoadMorphology,
  visiumHdTwoMicrometerFilteredBarcodeBudget,
  visiumHdControlState,
  flatMorphologyImage,
  visiumHdBinRequestIdRef,
  geneExpressionAbortRef,
  geneExpressionRequestIdRef,
  geneExpressionViewportKeyRef,
  setFlatMorphologyImage,
  setGeneExpressionBatch,
  setGeneExpressionScaleDomain,
  setGeneExpressionState,
  setGenePanelState,
  setLoadState,
  setMorphologyState,
  setSpatialGridCells,
  setSelectedGridCell,
  setVisiumHdControlState,
}: UseVisiumHdBinWorkflowOptions): UseVisiumHdBinWorkflowResult {
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
      setVisiumHdControlState((current) =>
        current.status === 'idle'
          ? current
          : {
              ...current,
              status: 'loading',
              selectedBinSize: binSize,
            },
      )
      appendDebugEvent(`Loading Visium HD ${binSize} µm bins`)

      try {
        const dataset =
          visiumHdTwoMicrometerFilteredBarcodeBudget === undefined
            ? await getSpatialDataset(datasetUrl)
            : await getSpatialDataset(datasetUrl, {
                visiumHdMaxTwoMicrometerFilteredBarcodes:
                  visiumHdTwoMicrometerFilteredBarcodeBudget,
              })

        if (!isVisiumHdOverviewDataset(dataset)) {
          throw new Error('Loaded dataset does not expose Visium HD binned outputs.')
        }

        if (dataset.genePanel !== undefined) {
          setGenePanelState({ status: 'loading', url: datasetUrl })
          void dataset
            .genePanel(binSize)
            .then((genes) => {
              if (requestIdRef.current !== requestId) {
                return
              }

              setGenePanelState({ status: 'ready', url: datasetUrl, genes })
              appendDebugEvent(
                `Visium HD gene panel ready: ${genes.length.toLocaleString()} genes`,
              )
            })
            .catch((error) => {
              if (requestIdRef.current !== requestId) {
                return
              }

              setGenePanelState({
                status: 'error',
                url: datasetUrl,
                error: createStructuredLoadError('Gene panel', error),
              })
              appendDebugEvent('Visium HD gene panel failed')
            })
        }

        const [overview, meta] = await Promise.all([
          dataset.readBinnedOverview(binSize),
          dataset.meta(binSize),
        ])

        if (requestIdRef.current !== requestId) {
          return
        }

        setSpatialGridCells(
          gridCellBatchesToLayerData([overview.grid], [overview.gridCells], {
            metadata: [
              {
                binSizeMicrometers: overview.binSizeMicrometers,
                inTissue: overview.inTissue,
                fullresRows: overview.fullresRows,
                fullresCols: overview.fullresCols,
              },
            ],
          }),
        )
        setLoadState({
          status: 'ready',
          url: datasetUrl,
          cellCount: overview.gridCells.ids.length,
        })

        setVisiumHdControlState({
          status: 'ready',
          url: datasetUrl,
          selectedBinSize: overview.binSizeMicrometers,
          options: updateVisiumHdBinOptionCount(
            visiumHdControlState.options,
            overview.binSizeMicrometers,
            overview.gridCells.ids.length,
          ),
          binCount: overview.gridCells.ids.length,
        })
        appendDebugEvent(
          `Visium HD ${overview.binSizeMicrometers} µm bins ready: ${overview.gridCells.ids.length.toLocaleString()} in ${formatElapsed(
            startedAt,
          )}`,
        )

        if (!shouldLoadMorphology) {
          setFlatMorphologyImage(null)
          setMorphologyState({ status: 'idle' })
          return
        }

        if (flatMorphologyImage !== undefined && flatMorphologyImage !== null) {
          setMorphologyState({
            status: 'ready',
            url: flatMorphologyImage.url,
          })
          return
        }

        setMorphologyState({ status: 'loading', url: datasetUrl })
        const imageSource = await dataset.image(overview.binSizeMicrometers)

        if (requestIdRef.current !== requestId) {
          return
        }

        const flatImage = flatMorphologyImageFromSource(imageSource, meta)

        if (flatImage === null) {
          setFlatMorphologyImage(null)
          setMorphologyState({ status: 'idle' })
          return
        }

        setFlatMorphologyImage(flatImage)
        setMorphologyState({
          status: 'ready',
          url: flatImage.url,
        })
      } catch (error) {
        if (requestIdRef.current !== requestId) {
          return
        }

        setVisiumHdControlState((current) =>
          current.status === 'idle'
            ? current
            : {
                ...current,
                status: 'error',
                error: readErrorMessage(error),
              },
        )
        setLoadState({
          status: 'error',
          url: datasetUrl,
          error: createStructuredLoadError('Dataset overview', error),
        })
        appendDebugEvent(`Visium HD ${binSize} µm bins failed`)
      }
    },
    [
      appendDebugEvent,
      flatMorphologyImage,
      geneExpressionAbortRef,
      geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
      getSpatialDataset,
      loadedDatasetUrl,
      onBeforeBinSizeChange,
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
      visiumHdTwoMicrometerFilteredBarcodeBudget,
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
  if (geneExpressionAbortRef !== undefined) {
    abortActiveRequest(geneExpressionAbortRef)
  }

  if (geneExpressionRequestIdRef !== undefined) {
    geneExpressionRequestIdRef.current += 1
  }

  if (geneExpressionViewportKeyRef !== undefined) {
    geneExpressionViewportKeyRef.current = null
  }

  setGeneExpressionBatch?.(null)
  setGeneExpressionScaleDomain?.({ key: '', max: 0 })
  setGeneExpressionState?.({ status: 'idle' })
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

export function visiumHdControlStateFromOverview(
  url: string,
  availableBinSizes: readonly VisiumHdBinSizeMicrometers[],
  overview: VisiumHdBinnedOverview,
  options: {
    readonly twoMicrometerFilteredBarcodeBudget?: number | undefined
  } = {},
): VisiumHdControlState {
  const binOptionOptions =
    options.twoMicrometerFilteredBarcodeBudget === undefined
      ? {}
      : {
          twoMicrometerFilteredBarcodeBudget: options.twoMicrometerFilteredBarcodeBudget,
        }

  return {
    status: 'ready',
    url,
    selectedBinSize: overview.binSizeMicrometers,
    options: createVisiumHdBinOptions(
      availableBinSizes,
      {
        [overview.binSizeMicrometers]: overview.gridCells.ids.length,
      },
      binOptionOptions,
    ),
    binCount: overview.gridCells.ids.length,
  }
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
