import type { ComponentProps, FormEventHandler } from 'react'
import {
  ActivityLog,
  CellFeatureMatrixCompatibilityNotice,
  DatasetDiagnosticsPanel,
  DownloadIcon,
  ErrorSummary,
} from '../../components/AppStatusPanels'

type DatasetDiagnosticsState = ComponentProps<typeof DatasetDiagnosticsPanel>['state']
type CellFeatureMatrixCompatibilityState = ComponentProps<
  typeof CellFeatureMatrixCompatibilityNotice
>['state']
type ErrorSummaryItems = ComponentProps<typeof ErrorSummary>['errors']
type ActivityLogEntries = ComponentProps<typeof ActivityLog>['entries']

interface DatasetHudPanelProps {
  readonly active: boolean
  readonly datasetInputId: string
  readonly morphologyInputId: string
  readonly boundaryLimitInputId: string
  readonly datasetUrl: string
  readonly shouldLoadMorphology: boolean
  readonly boundaryCellLimit: number
  readonly maxBoundaryCellLimit: number
  readonly isLoading: boolean
  readonly diagnosticsState: DatasetDiagnosticsState
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCompatibilityState
  readonly activeErrors: ErrorSummaryItems
  readonly debugLog: ActivityLogEntries
  readonly onSubmit: FormEventHandler<HTMLFormElement>
  readonly onDatasetUrlChange: (url: string) => void
  readonly onShouldLoadMorphologyChange: (enabled: boolean) => void
  readonly onBoundaryCellLimitChange: (limit: number) => void
  readonly onRunDatasetDiagnostics: () => void
  readonly onDownloadDiagnostics: () => void
  readonly onClearDebugLog: () => void
}

export function DatasetHudPanel({
  active,
  datasetInputId,
  morphologyInputId,
  boundaryLimitInputId,
  datasetUrl,
  shouldLoadMorphology,
  boundaryCellLimit,
  maxBoundaryCellLimit,
  isLoading,
  diagnosticsState,
  cellFeatureMatrixCapabilityState,
  activeErrors,
  debugLog,
  onSubmit,
  onDatasetUrlChange,
  onShouldLoadMorphologyChange,
  onBoundaryCellLimitChange,
  onRunDatasetDiagnostics,
  onDownloadDiagnostics,
  onClearDebugLog,
}: DatasetHudPanelProps) {
  return (
    <div
      id="hud-panel-dataset"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-dataset"
      hidden={!active}
    >
      <form className="dataset-form" onSubmit={onSubmit}>
        <label htmlFor={datasetInputId}>Dataset URL</label>
        <input
          id={datasetInputId}
          name="datasetUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={datasetUrl}
          placeholder="https://bucket.example/output…"
          onChange={(event) => {
            onDatasetUrlChange(event.currentTarget.value)
          }}
        />
        <label className="dataset-toggle" htmlFor={morphologyInputId}>
          <input
            id={morphologyInputId}
            name="loadMorphologyImage"
            type="checkbox"
            checked={shouldLoadMorphology}
            onChange={(event) => {
              onShouldLoadMorphologyChange(event.currentTarget.checked)
            }}
          />
          <span>Morphology image</span>
        </label>
        <label htmlFor={boundaryLimitInputId}>Boundary limit</label>
        <input
          id={boundaryLimitInputId}
          name="boundaryCellLimit"
          type="number"
          inputMode="numeric"
          min="1"
          max={maxBoundaryCellLimit}
          step="1"
          autoComplete="off"
          value={boundaryCellLimit}
          onChange={(event) => {
            onBoundaryCellLimitChange(event.currentTarget.valueAsNumber)
          }}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Load Dataset'}
        </button>
      </form>
      <div className="dataset-action-row">
        <button
          type="button"
          className="secondary-action"
          disabled={diagnosticsState.status === 'loading' || datasetUrl.trim() === ''}
          onClick={onRunDatasetDiagnostics}
        >
          {diagnosticsState.status === 'loading' ? 'Diagnosing...' : 'Diagnose Dataset'}
        </button>
        <button
          type="button"
          className="secondary-action icon-action"
          aria-label="Download diagnostics"
          title="Download diagnostics"
          onClick={onDownloadDiagnostics}
        >
          <DownloadIcon />
        </button>
      </div>
      <DatasetDiagnosticsPanel state={diagnosticsState} />
      <CellFeatureMatrixCompatibilityNotice state={cellFeatureMatrixCapabilityState} />

      <ErrorSummary errors={activeErrors} />
      <ActivityLog entries={debugLog} onClear={onClearDebugLog} />
    </div>
  )
}
