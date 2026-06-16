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
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  parseVisiumHdTwoMicrometerBudgetInput,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { DebugLogAppendOptions, DebugLogEntry } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'

type AppDatasetControlIds = Pick<
  AppControlIds,
  | 'datasetInputId'
  | 'morphologyInputId'
  | 'boundaryLimitInputId'
  | 'visiumHdBinSizeInputId'
  | 'visiumHdTwoMicrometerBudgetInputId'
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
  readonly handleVisiumHdBinSizeChange: (
    binSize: VisiumHdBinSizeMicrometers,
  ) => Promise<void>
  readonly isLoading: boolean
  readonly isVisiumHdDataset: boolean
  readonly setBoundaryCellLimit: Dispatch<SetStateAction<number>>
  readonly setDatasetUrl: (url: string) => void
  readonly setDebugLog: Dispatch<SetStateAction<readonly DebugLogEntry[]>>
  readonly setShouldLoadMorphology: Dispatch<SetStateAction<boolean>>
  readonly onVisiumHdTwoMicrometerBudgetInputChange: (value: string) => void
  readonly shouldLoadMorphology: boolean
  readonly visiumHdControlState: VisiumHdControlState
  readonly visiumHdTwoMicrometerBudgetInput: string
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
  handleVisiumHdBinSizeChange,
  isLoading,
  isVisiumHdDataset,
  setBoundaryCellLimit,
  setDatasetUrl,
  setDebugLog,
  setShouldLoadMorphology,
  onVisiumHdTwoMicrometerBudgetInputChange,
  shouldLoadMorphology,
  visiumHdControlState,
  visiumHdTwoMicrometerBudgetInput,
}: AppDatasetHudPanelProps) {
  return (
    <DatasetHudPanel
      active={active}
      datasetInputId={controlIds.datasetInputId}
      morphologyInputId={controlIds.morphologyInputId}
      boundaryLimitInputId={controlIds.boundaryLimitInputId}
      visiumHdBinSizeInputId={controlIds.visiumHdBinSizeInputId}
      visiumHdTwoMicrometerBudgetInputId={controlIds.visiumHdTwoMicrometerBudgetInputId}
      datasetUrl={datasetUrl}
      shouldLoadMorphology={shouldLoadMorphology}
      visiumHdTwoMicrometerBudgetInput={visiumHdTwoMicrometerBudgetInput}
      morphologyLabel={isVisiumHdDataset ? 'Tissue image' : 'Morphology image'}
      boundaryCellLimit={boundaryCellLimit}
      maxBoundaryCellLimit={MAX_BOUNDARY_VIEWPORT_CELL_LIMIT}
      boundaryControlsDisabled={isVisiumHdDataset}
      isLoading={isLoading}
      diagnosticsState={diagnosticsState}
      cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
      visiumHdControlState={visiumHdControlState}
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
      onVisiumHdTwoMicrometerBudgetInputChange={(value) => {
        const nextBudget = parseVisiumHdTwoMicrometerBudgetInput(value)
        onVisiumHdTwoMicrometerBudgetInputChange(value)
        appendDebugEvent(
          nextBudget === undefined
            ? 'Visium HD 2 µm budget disabled'
            : `Visium HD 2 µm budget: ${nextBudget.toLocaleString()} barcodes`,
          {
            coalesceKey: 'visium-hd-2um-budget',
          },
        )
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
