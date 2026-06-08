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
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { DebugLogAppendOptions, DebugLogEntry } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'

type AppDatasetControlIds = Pick<
  AppControlIds,
  'datasetInputId' | 'morphologyInputId' | 'boundaryLimitInputId'
>

export interface AppDatasetHudPanelProps {
  readonly active: boolean
  readonly activeErrors: readonly StructuredLoadError[]
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly boundaryCellLimit: number
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCapabilityState
  readonly controlIds: AppDatasetControlIds
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly handleDatasetSubmit: FormEventHandler<HTMLFormElement>
  readonly handleDownloadDiagnostics: () => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
  readonly isLoading: boolean
  readonly setBoundaryCellLimit: Dispatch<SetStateAction<number>>
  readonly setDatasetUrl: (url: string) => void
  readonly setDebugLog: Dispatch<SetStateAction<readonly DebugLogEntry[]>>
  readonly setShouldLoadMorphology: Dispatch<SetStateAction<boolean>>
  readonly shouldLoadMorphology: boolean
}

export function AppDatasetHudPanel({
  active,
  activeErrors,
  appendDebugEvent,
  boundaryCellLimit,
  cellFeatureMatrixCapabilityState,
  controlIds,
  datasetUrl,
  debugLog,
  diagnosticsState,
  handleDatasetSubmit,
  handleDownloadDiagnostics,
  handleRunDatasetDiagnostics,
  isLoading,
  setBoundaryCellLimit,
  setDatasetUrl,
  setDebugLog,
  setShouldLoadMorphology,
  shouldLoadMorphology,
}: AppDatasetHudPanelProps) {
  return (
    <DatasetHudPanel
      active={active}
      datasetInputId={controlIds.datasetInputId}
      morphologyInputId={controlIds.morphologyInputId}
      boundaryLimitInputId={controlIds.boundaryLimitInputId}
      datasetUrl={datasetUrl}
      shouldLoadMorphology={shouldLoadMorphology}
      boundaryCellLimit={boundaryCellLimit}
      maxBoundaryCellLimit={MAX_BOUNDARY_VIEWPORT_CELL_LIMIT}
      isLoading={isLoading}
      diagnosticsState={diagnosticsState}
      cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
      activeErrors={activeErrors}
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
      onDownloadDiagnostics={handleDownloadDiagnostics}
      onClearDebugLog={() => {
        setDebugLog([])
      }}
    />
  )
}
