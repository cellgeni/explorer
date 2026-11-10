import type { Dispatch, FormEventHandler, SetStateAction } from 'react'
import {
  MAX_BOUNDARY_VIEWPORT_CELL_LIMIT,
  normalizeBoundaryCellLimit,
} from '../../rendering/boundaryViewport'
import { DatasetHudPanel } from '../control-hud/DatasetHudPanel'
import type {
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
} from '../dataset/datasetLoadModel'
import type { DatasetManifestAbout } from '../dataset/datasetManifestModel'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import type { SpatialDataControlState } from '../dataset/spatialDataModel'
import type { SpatialDataSelection } from '../../datasets/spatialDataDataset'
import type { VisiumControlState } from '../dataset/visiumModel'
import type { VisiumImageKind } from '../../datasets/visiumFormat'
import type { AnnDataVisiumView } from '../../datasets/h5adDataset'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { DebugLogAppendOptions, DebugLogEntry } from './appRuntimeModel'
import type { FallbackNoticeEntry } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'

type AppDatasetControlIds = Pick<
  AppControlIds,
  | 'datasetInputId'
  | 'morphologyInputId'
  | 'boundaryLimitInputId'
  | 'visiumHdBinSizeInputId'
>

export interface AppDatasetHudPanelProps {
  readonly active: boolean
  readonly activeErrors: readonly StructuredLoadError[]
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly boundaryCellLimit: number
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCapabilityState
  readonly controlIds: AppDatasetControlIds
  readonly datasetAbout: DatasetManifestAbout | null
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly fallbackNotices: readonly FallbackNoticeEntry[]
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly handleDatasetSubmit: FormEventHandler<HTMLFormElement>
  readonly handleDownloadDiagnostics: () => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
  readonly handleVisiumHdBinSizeChange: (
    binSize: VisiumHdBinSizeMicrometers,
  ) => Promise<void>
  readonly isLoading: boolean
  readonly isVisiumHdDataset: boolean
  readonly setBoundaryCellLimit: Dispatch<SetStateAction<number>>
  readonly setDatasetUrl: (url: string) => void
  readonly setDebugLog: Dispatch<SetStateAction<readonly DebugLogEntry[]>>
  readonly setShouldLoadMorphology: Dispatch<SetStateAction<boolean>>
  readonly shouldLoadMorphology: boolean
  readonly visiumHdControlState: VisiumHdControlState
  readonly spatialDataControlState: SpatialDataControlState
  readonly handleSpatialDataSelectionChange: (selection: SpatialDataSelection) => void
  readonly visiumControlState: VisiumControlState
  readonly handleVisiumImageChange: (image: VisiumImageKind | null) => void
  readonly handleVisiumViewChange: (view: AnnDataVisiumView) => void
}

export function AppDatasetHudPanel({
  active,
  activeErrors,
  appendDebugEvent,
  boundaryCellLimit,
  cellFeatureMatrixCapabilityState,
  controlIds,
  datasetAbout,
  datasetUrl,
  debugLog,
  fallbackNotices,
  diagnosticsState,
  handleDatasetSubmit,
  handleDownloadDiagnostics,
  handleRunDatasetDiagnostics,
  handleVisiumHdBinSizeChange,
  isLoading,
  isVisiumHdDataset,
  setBoundaryCellLimit,
  setDatasetUrl,
  setDebugLog,
  setShouldLoadMorphology,
  shouldLoadMorphology,
  visiumHdControlState,
  spatialDataControlState,
  handleSpatialDataSelectionChange,
  visiumControlState,
  handleVisiumImageChange,
  handleVisiumViewChange,
}: AppDatasetHudPanelProps) {
  return (
    <DatasetHudPanel
      active={active}
      datasetInputId={controlIds.datasetInputId}
      morphologyInputId={controlIds.morphologyInputId}
      boundaryLimitInputId={controlIds.boundaryLimitInputId}
      visiumHdBinSizeInputId={controlIds.visiumHdBinSizeInputId}
      datasetAbout={datasetAbout}
      datasetUrl={datasetUrl}
      shouldLoadMorphology={shouldLoadMorphology}
      morphologyLabel={
        isVisiumHdDataset || visiumControlState.status !== 'idle'
          ? 'Tissue image'
          : 'Morphology image'
      }
      boundaryCellLimit={boundaryCellLimit}
      maxBoundaryCellLimit={MAX_BOUNDARY_VIEWPORT_CELL_LIMIT}
      boundaryControlsDisabled={isVisiumHdDataset}
      isLoading={isLoading}
      diagnosticsState={diagnosticsState}
      cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
      visiumHdControlState={visiumHdControlState}
      spatialDataControlState={spatialDataControlState}
      onSpatialDataSelectionChange={handleSpatialDataSelectionChange}
      visiumControlState={visiumControlState}
      onVisiumImageChange={handleVisiumImageChange}
      onVisiumViewChange={handleVisiumViewChange}
      activeErrors={activeErrors}
      fallbackNotices={fallbackNotices}
      debugLog={debugLog}
      onSubmit={handleDatasetSubmit}
      onDatasetUrlChange={setDatasetUrl}
      onShouldLoadMorphologyChange={(checked) => {
        setShouldLoadMorphology(checked)
        appendDebugEvent(
          checked ? 'Morphology image enabled' : 'Morphology image disabled',
        )
      }}
      onBoundaryCellLimitChange={(value) => {
        const nextLimit = normalizeBoundaryCellLimit(value)
        setBoundaryCellLimit(nextLimit)
        appendDebugEvent(`Boundary limit: ${nextLimit.toLocaleString()}`, {
          coalesceKey: 'boundary-limit',
        })
      }}
      onRunDatasetDiagnostics={() => {
        void handleRunDatasetDiagnostics()
      }}
      onVisiumHdBinSizeChange={(binSize) => {
        void handleVisiumHdBinSizeChange(binSize)
      }}
      onDownloadDiagnostics={handleDownloadDiagnostics}
      onClearDebugLog={() => {
        setDebugLog([])
      }}
    />
  )
}
