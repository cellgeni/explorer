import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { RoiDrawMode } from '../../components/ViewerCore'
import type { RoiSelection } from '../../data/roiSelection'
import type { GridCellDatum } from '../../rendering/deckLayers'
import { slug } from '../../utils/slug'
import {
  downloadTextFile,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { defaultRoiName, roiSelectionLabel, roiSelectionToGeoJson } from './roiModel'
import {
  IDLE_VISIUM_HD_ROI_STATE,
  selectVisiumHdGridCellsInRoi,
  visiumHdRoiBinsToCsv,
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
  readonly activeBinSize: number | undefined
  readonly isVisiumHdDataset: boolean
  readonly roiName: string
}

interface UseVisiumHdRoiWorkflowData {
  readonly activeRoiState: VisiumHdRoiState
  readonly gridCells: readonly GridCellDatum[]
  readonly loadState: DatasetLoadState<StructuredLoadError>
}

interface UseVisiumHdRoiWorkflowRefs {
  readonly initialSharedRoiSelectionRef: MutableRef<RoiSelection | null>
  readonly roiIdRef: MutableRef<number>
}

interface UseVisiumHdRoiWorkflowSetters {
  readonly setRoiMode: Dispatch<SetStateAction<RoiDrawMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setVisiumHdRoiState: Dispatch<SetStateAction<VisiumHdRoiState>>
}

interface UseVisiumHdRoiWorkflowOptions {
  readonly callbacks: UseVisiumHdRoiWorkflowCallbacks
  readonly controls: UseVisiumHdRoiWorkflowControls
  readonly data: UseVisiumHdRoiWorkflowData
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
  refs: { initialSharedRoiSelectionRef, roiIdRef },
  setters: { setRoiMode, setRoiName, setVisiumHdRoiState },
}: UseVisiumHdRoiWorkflowOptions): UseVisiumHdRoiWorkflowResult {
  const readyDatasetUrl = loadState.status === 'ready' ? loadState.url : null

  const clearVisiumHdRoiState = useCallback(() => {
    setVisiumHdRoiState(IDLE_VISIUM_HD_ROI_STATE)
  }, [setVisiumHdRoiState])

  const handleVisiumHdRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (!isVisiumHdDataset || readyDatasetUrl === null) {
        return
      }

      const result = selectVisiumHdGridCellsInRoi(gridCells, selection)

      setRoiMode('idle')
      setRoiName((current) => current.trim() || defaultRoiName(roiIdRef.current + 1))
      setVisiumHdRoiState({
        status: 'ready',
        url: readyDatasetUrl,
        ...(activeBinSize === undefined ? {} : { binSizeMicrometers: activeBinSize }),
        bbox: selection.bbox,
        selection,
        bins: result.bins,
        hitBinLimit: result.hitBinLimit,
      })
      appendDebugEvent(
        `${roiSelectionLabel(selection)} drawn: ${result.bins.length.toLocaleString()}${
          result.hitBinLimit ? '+' : ''
        } Visium HD bins`,
      )
    },
    [
      activeBinSize,
      appendDebugEvent,
      gridCells,
      isVisiumHdDataset,
      readyDatasetUrl,
      roiIdRef,
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
