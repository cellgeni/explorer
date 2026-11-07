import type { ComponentProps, FormEventHandler } from 'react'
import {
  ActivityLog,
  CellFeatureMatrixCompatibilityNotice,
  DatasetDiagnosticsPanel,
  DownloadIcon,
  ErrorSummary,
  FallbackNoticeSummary,
} from '../../components/AppStatusPanels'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import { visiumHdBinSizeLabel, type VisiumHdControlState } from '../dataset/visiumHdModel'
import type { SpatialDataControlState } from '../dataset/spatialDataModel'
import type { SpatialDataSelection } from '../../datasets/spatialDataDataset'
import { useState } from 'react'

type DatasetDiagnosticsState = ComponentProps<typeof DatasetDiagnosticsPanel>['state']
type CellFeatureMatrixCompatibilityState = ComponentProps<
  typeof CellFeatureMatrixCompatibilityNotice
>['state']
type ErrorSummaryItems = ComponentProps<typeof ErrorSummary>['errors']
type FallbackNoticeItems = ComponentProps<typeof FallbackNoticeSummary>['notices']
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
  readonly spatialDataControlState: SpatialDataControlState
  readonly onSpatialDataSelectionChange: (selection: SpatialDataSelection) => void
  readonly activeErrors: ErrorSummaryItems
  readonly fallbackNotices: FallbackNoticeItems
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
  spatialDataControlState,
  onSpatialDataSelectionChange,
  activeErrors,
  fallbackNotices,
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
        <label htmlFor={datasetInputId}>Dataset or image URL</label>
        <input
          id={datasetInputId}
          name="datasetUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={datasetUrl}
          placeholder="https://bucket.example/output-or-image.ome.tif"
          title="Dataset or image URL"
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
        <button type="submit" disabled={isLoading} title="Load dataset or image">
          {isLoading ? 'Loading…' : 'Load Dataset'}
        </button>
      </form>
      <VisiumHdDatasetControls
        inputId={visiumHdBinSizeInputId}
        state={visiumHdControlState}
        onBinSizeChange={onVisiumHdBinSizeChange}
      />
      {spatialDataControlState.status === 'idle' ? null : (
        <SpatialDataDatasetControls
          key={`${spatialDataControlState.coordinateSystem}:${spatialDataControlState.units.micrometersPerUnit.toString()}`}
          state={spatialDataControlState}
          disabled={isLoading || spatialDataControlState.status === 'loading'}
          onSelectionChange={onSpatialDataSelectionChange}
        />
      )}
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
      <FallbackNoticeSummary notices={fallbackNotices} />

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
  const loadedBinSize = state.loadedBinSize ?? state.selectedBinSize
  const binCount =
    state.binCount?.toLocaleString() ?? selectedOption?.binCount?.toLocaleString() ?? '…'
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
          {binCount} at {visiumHdBinSizeLabel(loadedBinSize)}
          {loadedBinSize === state.selectedBinSize
            ? ''
            : ` view; ${visiumHdBinSizeLabel(state.selectedBinSize)} selected`}
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

function SpatialDataDatasetControls({
  state,
  disabled,
  onSelectionChange,
}: {
  readonly state: Exclude<SpatialDataControlState, { readonly status: 'idle' }>
  readonly disabled: boolean
  readonly onSelectionChange: (selection: SpatialDataSelection) => void
}) {
  const { units } = state
  const [unitDraft, setUnitDraft] = useState(
    units.source === 'unknown' ? '' : formatMicrometersPerUnit(units.micrometersPerUnit),
  )
  const parsedDraft = Number(unitDraft)
  const draftValid =
    unitDraft.trim() !== '' && Number.isFinite(parsedDraft) && parsedDraft > 0
  const { micrometersPerUnit: _override, ...withoutOverride } = state.selection
  void _override

  return (
    <section
      className="visium-hd-controls spatialdata-controls"
      aria-label="SpatialData view"
    >
      <div className="dataset-platform-row">
        <span>Dataset type</span>
        <strong>SpatialData</strong>
      </div>
      <label className="visium-bin-control">
        <span>Coordinate system</span>
        <select
          title="SpatialData coordinate system to show"
          value={state.coordinateSystem}
          disabled={disabled || state.coordinateSystems.length < 2}
          onChange={(event) => {
            // Images and units belong to a coordinate system.
            onSelectionChange({ coordinateSystem: event.currentTarget.value })
          }}
        >
          {state.coordinateSystems.map((system) => (
            <option key={system} value={system}>
              {system}
            </option>
          ))}
        </select>
      </label>
      <label className="visium-bin-control">
        <span>Image</span>
        <select
          title="SpatialData image to show as the morphology layer"
          value={state.image ?? ''}
          disabled={disabled || state.images.length < 2}
          onChange={(event) => {
            onSelectionChange({
              ...state.selection,
              coordinateSystem: state.coordinateSystem,
              image: event.currentTarget.value,
            })
          }}
        >
          {state.images.length === 0 ? <option value="">None</option> : null}
          {state.images.map((image) => (
            <option key={image} value={image}>
              {image}
            </option>
          ))}
        </select>
      </label>
      <form
        className="visium-bin-control spatialdata-units-control"
        onSubmit={(event) => {
          event.preventDefault()

          if (draftValid) {
            onSelectionChange({
              ...state.selection,
              coordinateSystem: state.coordinateSystem,
              micrometersPerUnit: parsedDraft,
            })
          }
        }}
      >
        <span title="Micrometers per coordinate-system unit">µm per unit</span>
        <span className="spatialdata-units-inputs">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            aria-label="Micrometers per coordinate-system unit"
            title="Micrometers per coordinate-system unit"
            placeholder="unknown"
            value={unitDraft}
            disabled={disabled}
            onChange={(event) => {
              setUnitDraft(event.currentTarget.value)
            }}
          />
          <button type="submit" disabled={disabled || !draftValid} title="Use this scale">
            Set
          </button>
          <button
            type="button"
            disabled={disabled || units.source !== 'override'}
            title="Use declared or estimated units"
            onClick={() => {
              onSelectionChange({
                ...withoutOverride,
                coordinateSystem: state.coordinateSystem,
              })
            }}
          >
            Auto
          </button>
        </span>
      </form>
      <p className="visium-hd-note">{spatialDataUnitsNote(units)}</p>
    </section>
  )
}

function spatialDataUnitsNote(
  units: Exclude<SpatialDataControlState, { readonly status: 'idle' }>['units'],
): string {
  switch (units.source) {
    case 'override':
      return 'Scale set in the viewer.'
    case 'declared':
      return `Declared by the store (${units.detail}).`
    case 'estimated':
      return `Estimated from ${units.detail}. Set the scale if you know it.`
    case 'unknown':
      return 'Units unknown: distances are in coordinate units. Set µm per unit if you know the pixel size.'
  }
}

function formatMicrometersPerUnit(value: number): string {
  return Number(value.toPrecision(4)).toString()
}
