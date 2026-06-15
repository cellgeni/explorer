import type { ComponentProps, FormEventHandler } from 'react'
import {
  ActivityLog,
  CellFeatureMatrixCompatibilityNotice,
  DatasetDiagnosticsPanel,
  DownloadIcon,
  ErrorSummary,
} from '../../components/AppStatusPanels'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import { visiumHdBinSizeLabel, type VisiumHdControlState } from '../dataset/visiumHdModel'

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
  readonly visiumHdBinSizeInputId: string
  readonly datasetUrl: string
  readonly shouldLoadMorphology: boolean
  readonly morphologyLabel: string
  readonly boundaryCellLimit: number
  readonly maxBoundaryCellLimit: number
  readonly boundaryControlsDisabled: boolean
  readonly isLoading: boolean
  readonly diagnosticsState: DatasetDiagnosticsState
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCompatibilityState
  readonly visiumHdControlState: VisiumHdControlState
  readonly activeErrors: ErrorSummaryItems
  readonly debugLog: ActivityLogEntries
  readonly onSubmit: FormEventHandler<HTMLFormElement>
  readonly onDatasetUrlChange: (url: string) => void
  readonly onShouldLoadMorphologyChange: (enabled: boolean) => void
  readonly onBoundaryCellLimitChange: (limit: number) => void
  readonly onVisiumHdBinSizeChange: (binSize: VisiumHdBinSizeMicrometers) => void
  readonly onRunDatasetDiagnostics: () => void
  readonly onDownloadDiagnostics: () => void
  readonly onClearDebugLog: () => void
}

export function DatasetHudPanel({
  active,
  datasetInputId,
  morphologyInputId,
  boundaryLimitInputId,
  visiumHdBinSizeInputId,
  datasetUrl,
  shouldLoadMorphology,
  morphologyLabel,
  boundaryCellLimit,
  maxBoundaryCellLimit,
  boundaryControlsDisabled,
  isLoading,
  diagnosticsState,
  cellFeatureMatrixCapabilityState,
  visiumHdControlState,
  activeErrors,
  debugLog,
  onSubmit,
  onDatasetUrlChange,
  onShouldLoadMorphologyChange,
  onBoundaryCellLimitChange,
  onVisiumHdBinSizeChange,
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
          title="Dataset URL"
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
            title="Toggle morphology image loading"
            onChange={(event) => {
              onShouldLoadMorphologyChange(event.currentTarget.checked)
            }}
          />
          <span>{morphologyLabel}</span>
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
          title="Boundary cell limit"
          disabled={boundaryControlsDisabled}
          onChange={(event) => {
            onBoundaryCellLimitChange(event.currentTarget.valueAsNumber)
          }}
        />
        <button type="submit" disabled={isLoading} title="Load dataset">
          {isLoading ? 'Loading…' : 'Load Dataset'}
        </button>
      </form>
      <VisiumHdDatasetControls
        inputId={visiumHdBinSizeInputId}
        state={visiumHdControlState}
        onBinSizeChange={onVisiumHdBinSizeChange}
      />
      <div className="dataset-action-row">
        <button
          type="button"
          className="secondary-action"
          disabled={diagnosticsState.status === 'loading' || datasetUrl.trim() === ''}
          title="Diagnose dataset"
          onClick={onRunDatasetDiagnostics}
        >
          {diagnosticsState.status === 'loading' ? 'Diagnosing…' : 'Diagnose Dataset'}
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

function VisiumHdDatasetControls({
  inputId,
  state,
  onBinSizeChange,
}: {
  readonly inputId: string
  readonly state: VisiumHdControlState
  readonly onBinSizeChange: (binSize: VisiumHdBinSizeMicrometers) => void
}) {
  if (state.status === 'idle') {
    return null
  }

  const selectedOption = state.options.find(
    (option) => option.size === state.selectedBinSize,
  )
  const disabledReason = state.options.find(
    (option) => option.size === 2 && option.reason !== undefined,
  )?.reason

  return (
    <section className="visium-hd-controls" aria-label="Visium HD dataset">
      <div className="dataset-platform-row">
        <span>Dataset type</span>
        <strong>Visium HD</strong>
      </div>
      <div className="dataset-platform-row">
        <span>Active bins</span>
        <strong>
          {state.binCount?.toLocaleString() ??
            selectedOption?.binCount?.toLocaleString() ??
            '…'}{' '}
          at {visiumHdBinSizeLabel(state.selectedBinSize)}
        </strong>
      </div>
      <div className="visium-bin-control">
        <span id={inputId}>Bin size</span>
        <div
          className="visium-bin-segmented"
          role="group"
          aria-labelledby={inputId}
          aria-busy={state.status === 'loading'}
        >
          {state.options.map((option) => (
            <button
              key={option.size}
              type="button"
              aria-pressed={option.size === state.selectedBinSize}
              disabled={option.disabled || state.status === 'loading'}
              title={option.reason ?? `${visiumHdBinSizeLabel(option.size)} bins`}
              onClick={() => {
                onBinSizeChange(option.size)
              }}
            >
              {visiumHdBinSizeLabel(option.size)}
            </button>
          ))}
        </div>
      </div>
      {state.status === 'error' ? (
        <p className="visium-hd-note">{state.error ?? 'Visium HD bin load failed.'}</p>
      ) : null}
      {disabledReason === undefined ? null : (
        <p className="visium-hd-note">{disabledReason}</p>
      )}
    </section>
  )
}
