import { useEffect, useRef } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  visiumHdAvailableBinSizes,
  visiumHdGridLoadBinSize,
} from '../../data/visiumHdGridLod'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import { datasetLoadReady, type DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  visiumHdControlFailed,
  visiumHdControlLoading,
  visiumHdControlReadyFromOptions,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import { createStructuredLoadError, readErrorMessage } from '../errors/loadErrorModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import {
  formatElapsed,
  readTimestamp,
  type DebugLogAppendOptions,
} from './appRuntimeModel'
import {
  gridCellLayerBinSize,
  visiumHdOverviewToGridCellColumns,
} from './visiumHdGridLayerData'
import { isVisiumHdOverviewDataset } from './useVisiumHdBinWorkflow'
import type { GridCellColumns } from '../../rendering/gridCellColumns'

interface MutableRef<T> {
  current: T
}

interface Setter<T> {
  (value: T | ((current: T) => T)): void
}

interface VisiumHdGridLodWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

interface VisiumHdGridLodWorkflowControls {
  readonly visiumHdControlState: VisiumHdControlState
}

interface VisiumHdGridLodWorkflowData {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly loadedDatasetUrl: string | null
  readonly spatialGridCells: GridCellColumns
}

interface VisiumHdGridLodWorkflowLoaders {
  readonly getSpatialDataset: SpatialDatasetLoader
}

interface VisiumHdGridLodWorkflowRefs {
  readonly visiumHdBinRequestIdRef: MutableRef<number>
}

interface VisiumHdGridLodWorkflowSetters {
  readonly setLoadState: Setter<DatasetLoadState<StructuredLoadError>>
  readonly setSpatialGridCells: Setter<GridCellColumns>
  readonly setVisiumHdControlState: Setter<VisiumHdControlState>
}

export interface UseVisiumHdGridLodWorkflowOptions {
  readonly callbacks: VisiumHdGridLodWorkflowCallbacks
  readonly controls: VisiumHdGridLodWorkflowControls
  readonly data: VisiumHdGridLodWorkflowData
  readonly loaders: VisiumHdGridLodWorkflowLoaders
  readonly refs: VisiumHdGridLodWorkflowRefs
  readonly setters: VisiumHdGridLodWorkflowSetters
}

export function useVisiumHdGridLodWorkflow({
  callbacks: { appendDebugEvent },
  controls: { visiumHdControlState },
  data: { currentViewportDetail, loadedDatasetUrl, spatialGridCells },
  loaders: { getSpatialDataset },
  refs: { visiumHdBinRequestIdRef },
  setters: { setLoadState, setSpatialGridCells, setVisiumHdControlState },
}: UseVisiumHdGridLodWorkflowOptions): void {
  // A level-of-detail read has a counter of its own: the next one replaces
  // it, and so does a bin switch (visiumHdBinRequestIdRef), but it leaves the
  // switch's gene panel and image reads, which check that counter, alone.
  const lodRequestIdRef = useRef(0)

  useEffect(() => {
    if (
      visiumHdControlState.status !== 'ready' ||
      visiumHdControlState.selectedBinSize !== 2
    ) {
      return
    }

    const selectedBinSize = visiumHdControlState.selectedBinSize
    const desiredBinSize = visiumHdGridLoadBinSize(
      selectedBinSize,
      currentViewportDetail?.viewState.zoom,
      visiumHdAvailableBinSizes(visiumHdControlState.options),
    )
    const loadedBinSize = gridCellLayerBinSize(spatialGridCells)

    if (loadedBinSize === desiredBinSize) {
      return
    }

    const datasetUrl = loadedDatasetUrl ?? visiumHdControlState.url
    const requestId = lodRequestIdRef.current + 1
    const switchRequestId = visiumHdBinRequestIdRef.current
    const isCurrent = () =>
      lodRequestIdRef.current === requestId &&
      visiumHdBinRequestIdRef.current === switchRequestId
    const startedAt = readTimestamp()
    lodRequestIdRef.current = requestId
    setVisiumHdControlState((current) => visiumHdControlLoading(current, selectedBinSize))
    appendDebugEvent(visiumHdGridLodLoadMessage(selectedBinSize, desiredBinSize), {
      coalesceKey: 'visium-hd-grid-lod',
    })

    void getSpatialDataset(datasetUrl)
      .then(async (dataset) => {
        if (!isVisiumHdOverviewDataset(dataset)) {
          throw new Error('Loaded dataset does not expose Visium HD binned outputs.')
        }

        return dataset.readBinnedOverview(desiredBinSize)
      })
      .then((overview) => {
        if (!isCurrent()) {
          return
        }

        setSpatialGridCells(visiumHdOverviewToGridCellColumns(overview, selectedBinSize))
        setLoadState(datasetLoadReady(datasetUrl, overview.gridCells.ids.length))
        setVisiumHdControlState(
          visiumHdControlReadyFromOptions(
            datasetUrl,
            visiumHdControlState.options,
            overview,
            selectedBinSize,
          ),
        )
        appendDebugEvent(
          `Visium HD ${overview.binSizeMicrometers} µm view ready for selected ${selectedBinSize} µm bins: ${overview.gridCells.ids.length.toLocaleString()} in ${formatElapsed(
            startedAt,
          )}`,
          { coalesceKey: 'visium-hd-grid-lod' },
        )
      })
      .catch((error) => {
        if (!isCurrent()) {
          return
        }

        setVisiumHdControlState((current) =>
          visiumHdControlFailed(current, readErrorMessage(error)),
        )
        appendDebugEvent(
          `Visium HD ${desiredBinSize} µm view failed for selected ${selectedBinSize} µm bins`,
          { coalesceKey: 'visium-hd-grid-lod' },
        )
        setLoadState((current) =>
          current.status === 'ready'
            ? current
            : {
                status: 'error',
                url: datasetUrl,
                error: createStructuredLoadError('Dataset overview', error),
              },
        )
      })
  }, [
    appendDebugEvent,
    currentViewportDetail,
    getSpatialDataset,
    loadedDatasetUrl,
    setLoadState,
    setSpatialGridCells,
    setVisiumHdControlState,
    spatialGridCells,
    visiumHdBinRequestIdRef,
    visiumHdControlState,
  ])
}

function visiumHdGridLodLoadMessage(
  selectedBinSize: VisiumHdBinSizeMicrometers,
  desiredBinSize: VisiumHdBinSizeMicrometers,
): string {
  return selectedBinSize === desiredBinSize
    ? `Loading Visium HD ${desiredBinSize} µm bins for close zoom`
    : `Loading Visium HD ${desiredBinSize} µm view for selected ${selectedBinSize} µm bins`
}
