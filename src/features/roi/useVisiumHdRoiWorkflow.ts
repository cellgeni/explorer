import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { RoiDrawMode } from '../../components/ViewerCore'
import { summarizeRoiGeneExpression } from '../../data/roiGeneStats'
import type { RoiSelection } from '../../data/roiSelection'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import { slug } from '../../utils/slug'
import {
  downloadTextFile,
  invalidateLatestRequest,
  isAbortError,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import {
  isVisiumHdExpressionProfileDataset,
  type VisiumHdExpressionProfileDataset,
} from '../app-shell/visiumHdAppController'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  defaultRoiName,
  IDLE_ROI_GENE_STATS_STATE,
  roiGeneStatsFailed,
  roiGeneStatsLoading,
  roiGeneStatsReady,
  roiSelectionLabel,
  roiSelectionToGeoJson,
  type RoiGeneStatsState,
} from './roiModel'
import {
  IDLE_VISIUM_HD_ROI_STATE,
  selectVisiumHdGridCellsInRoi,
  visiumHdRoiBinsToCsv,
  visiumHdRoiReady,
  type VisiumHdRoiState,
} from './visiumHdRoiModel'

interface MutableRef<T> {
  current: T
}

interface UseVisiumHdRoiWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly clearRoi: () => void
}

interface UseVisiumHdRoiWorkflowControls {
  readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly isVisiumHdDataset: boolean
  readonly roiName: string
}

interface UseVisiumHdRoiWorkflowData {
  readonly activeRoiState: VisiumHdRoiState
  readonly gridCells: readonly GridCellDatum[]
  readonly loadState: DatasetLoadState<StructuredLoadError>
}

interface UseVisiumHdRoiWorkflowLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
}

interface UseVisiumHdRoiWorkflowRefs {
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
  readonly roiGeneAbortRef: MutableRef<AbortController | null>
  readonly roiGeneRequestIdRef: MutableRef<number>
  readonly roiIdRef: MutableRef<number>
}

interface UseVisiumHdRoiWorkflowSetters {
  readonly setRoiGeneStatsState: Dispatch<
    SetStateAction<RoiGeneStatsState<StructuredLoadError>>
  >
  readonly setRoiMode: Dispatch<SetStateAction<RoiDrawMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setVisiumHdRoiState: Dispatch<SetStateAction<VisiumHdRoiState>>
}

interface UseVisiumHdRoiWorkflowOptions {
  readonly callbacks: UseVisiumHdRoiWorkflowCallbacks
  readonly controls: UseVisiumHdRoiWorkflowControls
  readonly data: UseVisiumHdRoiWorkflowData
  readonly loaders: UseVisiumHdRoiWorkflowLoaders
  readonly refs: UseVisiumHdRoiWorkflowRefs
  readonly setters: UseVisiumHdRoiWorkflowSetters
}

interface UseVisiumHdRoiWorkflowResult {
  readonly clearVisiumHdRoiState: () => void
  readonly handleClearActiveRoi: () => void
  readonly handleExportVisiumHdRoiBarcodes: () => void
  readonly handleExportVisiumHdRoiGeoJson: () => void
  readonly handleVisiumHdRoiComplete: (selection: RoiSelection) => void
}

export function useVisiumHdRoiWorkflow({
  callbacks: { appendDebugEvent, clearRoi },
  controls: { activeBinSize, isVisiumHdDataset, roiName },
  data: { activeRoiState, gridCells, loadState },
  loaders: { getSpatialDataset },
  refs: { initialSharedRoiSelectionRef, roiGeneAbortRef, roiGeneRequestIdRef, roiIdRef },
  setters: { setRoiGeneStatsState, setRoiMode, setRoiName, setVisiumHdRoiState },
}: UseVisiumHdRoiWorkflowOptions): UseVisiumHdRoiWorkflowResult {
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  const clearVisiumHdRoiState = useCallback(() => {
    invalidateLatestRequest({
      abortRef: roiGeneAbortRef,
      requestIdRef: roiGeneRequestIdRef,
    })
    setVisiumHdRoiState(IDLE_VISIUM_HD_ROI_STATE)
    setRoiGeneStatsState(IDLE_ROI_GENE_STATS_STATE)
  }, [roiGeneAbortRef, roiGeneRequestIdRef, setRoiGeneStatsState, setVisiumHdRoiState])

  const handleVisiumHdRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (!isVisiumHdDataset || readyDatasetUrl === null) {
        return
      }

      const result = selectVisiumHdGridCellsInRoi(gridCells, selection)
      const barcodes = result.bins.map((bin) => bin.barcode)
      const binSize = activeBinSize

      setRoiMode('idle')
      setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
      setVisiumHdRoiState(
        visiumHdRoiReady({
          url: readyDatasetUrl,
          ...(activeBinSize === undefined ? {} : { binSizeMicrometers: activeBinSize }),
          bbox: selection.bbox,
          selection,
          bins: result.bins,
          hitBinLimit: result.hitBinLimit,
        }),
      )
      appendDebugEvent(
        `${roiSelectionLabel(selection)} drawn: ${result.bins.length.toLocaleString()}${
          result.hitBinLimit ? '+' : ''
        } Visium HD bins`,
      )

      if (barcodes.length === 0 || binSize === undefined) {
        setRoiGeneStatsState(
          roiGeneStatsReady(
            readyDatasetUrl,
            summarizeRoiGeneExpression(
              { geneNames: [], cells: new Map() },
              { cellCount: barcodes.length, sampledCellIds: barcodes },
            ),
          ),
        )
        return
      }

      const request = startLatestRequest({
        abortRef: roiGeneAbortRef,
        requestIdRef: roiGeneRequestIdRef,
      })
      setRoiGeneStatsState(roiGeneStatsLoading(readyDatasetUrl, barcodes.length))
      appendDebugEvent(
        `ROI genes started: ${barcodes.length.toLocaleString()} Visium HD bins`,
      )

      void getSpatialDataset(readyDatasetUrl)
        .then((dataset) => {
          if (!isVisiumHdExpressionProfileDataset(dataset)) {
            throw new Error(
              'Loaded dataset does not expose Visium HD expression profiles.',
            )
          }

          const profileDataset = dataset as VisiumHdExpressionProfileDataset

          return profileDataset.matrix(barcodes, binSize, { signal: request.signal })
        })
        .then((matrix) => {
          if (!request.isCurrent() || request.signal.aborted) {
            return
          }

          const stats = summarizeRoiGeneExpression(matrix, {
            cellCount: barcodes.length,
            geneLimit: Number.MAX_SAFE_INTEGER,
            sampledCellIds: barcodes,
          })

          setRoiGeneStatsState(roiGeneStatsReady(readyDatasetUrl, stats))
          appendDebugEvent(
            `ROI genes ready: ${stats.genes.length.toLocaleString()} genes across ${barcodes.length.toLocaleString()} Visium HD bins`,
          )
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !request.isCurrent() || request.signal.aborted) {
            return
          }

          setRoiGeneStatsState(
            roiGeneStatsFailed(
              readyDatasetUrl,
              createStructuredLoadError('ROI genes', error),
            ),
          )
          appendDebugEvent('ROI genes failed')
        })
        .finally(() => {
          request.complete()
        })
    },
    [
      activeBinSize,
      appendDebugEvent,
      getSpatialDataset,
      gridCells,
      isVisiumHdDataset,
      readyDatasetUrl,
      roiGeneAbortRef,
      roiGeneRequestIdRef,
      roiIdRef,
      setRoiGeneStatsState,
      setRoiMode,
      setRoiName,
      setVisiumHdRoiState,
    ],
  )

  const handleExportVisiumHdRoiBarcodes = useCallback(() => {
    if (activeRoiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)

    downloadTextFile(
      `${slug(name)}-barcodes.csv`,
      visiumHdRoiBinsToCsv(activeRoiState.bins),
    )
    appendDebugEvent(`Exported ROI barcodes ${name}`)
  }, [activeRoiState, appendDebugEvent, roiIdRef, roiName])

  const handleExportVisiumHdRoiGeoJson = useCallback(() => {
    if (activeRoiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)

    downloadTextFile(
      `${slug(name)}-roi.geojson`,
      roiSelectionToGeoJson(activeRoiState.selection, {
        roi_name: name,
        dataset_platform: 'visium_hd',
        dataset_url: activeRoiState.url,
        selected_barcode_count: activeRoiState.bins.length,
        hit_barcode_limit: activeRoiState.hitBinLimit,
        bin_size_um: activeRoiState.binSizeMicrometers ?? null,
      }),
      'application/geo+json;charset=utf-8',
    )
    appendDebugEvent(`Exported ROI GeoJSON ${name}`)
  }, [activeRoiState, appendDebugEvent, roiIdRef, roiName])

  const handleClearActiveRoi = useCallback(() => {
    if (!isVisiumHdDataset) {
      clearRoi()
      return
    }

    setRoiMode('idle')
    clearVisiumHdRoiState()
    appendDebugEvent('Cleared ROI')
  }, [appendDebugEvent, clearRoi, clearVisiumHdRoiState, isVisiumHdDataset, setRoiMode])

  useEffect(() => {
    const selection = initialSharedRoiSelectionRef.current

    if (
      !isVisiumHdDataset ||
      selection === null ||
      readyDatasetUrl === null ||
      activeRoiState.status !== 'idle'
    ) {
      return
    }

    initialSharedRoiSelectionRef.current = null
    setRoiName('Shared ROI')
    handleVisiumHdRoiComplete(selection)
  }, [
    activeRoiState.status,
    handleVisiumHdRoiComplete,
    initialSharedRoiSelectionRef,
    isVisiumHdDataset,
    readyDatasetUrl,
    setRoiName,
  ])

  return {
    clearVisiumHdRoiState,
    handleClearActiveRoi,
    handleExportVisiumHdRoiBarcodes,
    handleExportVisiumHdRoiGeoJson,
    handleVisiumHdRoiComplete,
  }
}
