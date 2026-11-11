import { useId, useState } from 'react'
import {
  ActivityLog,
  DataAccessNotes,
  DatasetDiagnosticsPanel,
  DownloadIcon,
  ErrorSummary,
} from '../../components/AppStatusPanels'
import { Disclosure, Select } from '../../components/ui'
import type { SpatialDataSelection } from '../../datasets/spatialDataDataset'
import { formatVisiumUnits, type VisiumImageKind } from '../../datasets/visiumFormat'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import type { DatasetManifestAbout } from '../dataset/datasetManifestModel'
import type { SpatialDataControlState } from '../dataset/spatialDataModel'
import { visiumHdBinSizeLabel, type VisiumHdControlState } from '../dataset/visiumHdModel'
import {
  visiumImageLabel,
  visiumSourceLabel,
  type VisiumControlState,
} from '../dataset/visiumModel'
import type {
  DatasetDiagnosticsModel,
  DatasetViewOptionsModel,
  OpenDatasetModel,
} from './datasetInfoModel'

// The dataset menu and info drawer put the boundary limit under Advanced (15.2-F), since it
// rarely changes and Settings has it too.
export function OpenDatasetForm({
  open,
  boundaryLimit = 'inline',
}: {
  readonly open: OpenDatasetModel
  // The start screen leaves it to Settings.
  readonly boundaryLimit?: 'inline' | 'advanced' | 'none' | undefined
}) {
  const datasetInputId = useId()
  const morphologyInputId = useId()
  const boundaryLimitInputId = useId()
  const boundaryLimitField = (
    <>
      <label htmlFor={boundaryLimitInputId}>Boundary limit</label>
      <input
        id={boundaryLimitInputId}
        name="boundaryCellLimit"
        type="number"
        inputMode="numeric"
        min="1"
        max={open.maxBoundaryCellLimit}
        step="1"
        autoComplete="off"
        value={open.boundaryCellLimit}
        title="Boundary cell limit"
        disabled={open.boundaryLimitDisabled}
        onChange={(event) => {
          open.onBoundaryCellLimitChange(event.currentTarget.valueAsNumber)
        }}
      />
    </>
  )

  return (
    <form className="dataset-form" onSubmit={open.onSubmit}>
      <label htmlFor={datasetInputId}>Dataset or image URL</label>
      <input
        id={datasetInputId}
        name="datasetUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={open.datasetUrl}
        placeholder="https://bucket.example/output-or-image.ome.tif"
        title="Dataset or image URL"
        onChange={(event) => {
          open.onDatasetUrlChange(event.currentTarget.value)
        }}
      />
      <label className="dataset-toggle" htmlFor={morphologyInputId}>
        <input
          id={morphologyInputId}
          name="loadMorphologyImage"
          type="checkbox"
          checked={open.shouldLoadMorphology}
          title="Toggle morphology image loading"
          onChange={(event) => {
            open.onShouldLoadMorphologyChange(event.currentTarget.checked)
          }}
        />
        <span>{open.morphologyLabel}</span>
      </label>
      {boundaryLimit === 'none' ? null : boundaryLimit === 'inline' ? (
        boundaryLimitField
      ) : (
        <Disclosure
          title="Advanced dataset options"
          summary="Advanced"
          className="dataset-form-advanced"
        >
          {boundaryLimitField}
        </Disclosure>
      )}
      <button type="submit" disabled={open.isLoading} title="Load dataset or image">
        {open.isLoading ? 'Loading…' : 'Load Dataset'}
      </button>
    </form>
  )
}

// The boundary limit alone, for Settings (15.2-B).
export function BoundaryLimitField({ open }: { readonly open: OpenDatasetModel }) {
  const inputId = useId()

  return (
    <div className="shell-setting-field">
      <label htmlFor={inputId}>Boundary limit</label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min="1"
        max={open.maxBoundaryCellLimit}
        step="1"
        autoComplete="off"
        value={open.boundaryCellLimit}
        title="Boundary cell limit"
        disabled={open.boundaryLimitDisabled}
        onChange={(event) => {
          open.onBoundaryCellLimitChange(event.currentTarget.valueAsNumber)
        }}
      />
    </div>
  )
}

// The Visium summary and library, and the SpatialData view, whichever the
// dataset has: the info drawer's View options (15.2-F). Visium HD bin size,
// the Visium tissue image and off-tissue spots are in their layer sections.
export function DatasetViewOptions({
  viewOptions: { spatialData, visium },
}: {
  readonly viewOptions: DatasetViewOptionsModel
}) {
  return (
    <>
      {visium.state.status === 'idle' ? null : (
        <VisiumDatasetControls visium={visium} state={visium.state} />
      )}
      {spatialData.state.status === 'idle' ? null : (
        <SpatialDataDatasetControls
          key={`${spatialData.state.coordinateSystem}:${spatialData.state.units.micrometersPerUnit.toString()}`}
          state={spatialData.state}
          disabled={spatialData.disabled}
          onSelectionChange={spatialData.onSelectionChange}
        />
      )}
    </>
  )
}

// Diagnose and download, then the diagnostics report, data access notes,
// issues and the activity log.
export function DatasetDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: DatasetDiagnosticsModel
}) {
  return (
    <>
      <div className="dataset-action-row">
        <button
          type="button"
          className="secondary-action"
          disabled={diagnostics.state.status === 'loading' || !diagnostics.canRun}
          title="Diagnose dataset"
          onClick={diagnostics.onRun}
        >
          {diagnostics.state.status === 'loading' ? 'Diagnosing…' : 'Diagnose Dataset'}
        </button>
        <button
          type="button"
          className="secondary-action icon-action"
          aria-label="Download diagnostics"
          title="Download diagnostics"
          onClick={diagnostics.onDownload}
        >
          <DownloadIcon />
        </button>
      </div>
      <DatasetDiagnosticsPanel state={diagnostics.state} />
      <DataAccessNotes
        matrixState={diagnostics.matrixState}
        notices={diagnostics.fallbackNotices}
      />

      <ErrorSummary errors={diagnostics.errors} onRunDiagnostics={diagnostics.onRun} />
      <ActivityLog entries={diagnostics.log} onClear={diagnostics.onClearLog} />
    </>
  )
}

// The deck.gl layer and budget lines (?debug=1).
export function LayerStackLines({
  diagnostics,
}: {
  readonly diagnostics: DatasetDiagnosticsModel
}) {
  const { layerStack } = diagnostics

  if (layerStack === null) {
    return null
  }

  const { performanceBudget } = layerStack

  return (
    <>
      <p>
        {layerStack.deckLayerCount} Deck Layer - deck.gl {layerStack.deckVersion}
      </p>
      <p>
        Budget {performanceBudget.profile} -{' '}
        {performanceBudget.overviewRenderCellLimit.toLocaleString()} cells -{' '}
        {performanceBudget.maxConcurrentTileRequests} tile requests
      </p>
    </>
  )
}

// Name, description, and source from the dataset manifest, so viewers know
// where the data comes from and how to cite it.
export function DatasetAbout({ about }: { readonly about: DatasetManifestAbout }) {
  const { name, description, source } = about
  const sourceLabel = [source?.repository, source?.accession]
    .filter((part) => part !== undefined)
    .join(' ')

  return (
    <section className="dataset-about" aria-label="About this dataset">
      {name === undefined ? null : <strong className="dataset-about-name">{name}</strong>}
      {description === undefined ? null : <p>{description}</p>}
      {source === undefined ? null : (
        <dl>
          {sourceLabel === '' && source.url === undefined ? null : (
            <>
              <dt>Source</dt>
              <dd>
                {source.url === undefined ? (
                  sourceLabel
                ) : (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {sourceLabel === '' ? source.url : sourceLabel}
                  </a>
                )}
              </dd>
            </>
          )}
          {source.license === undefined ? null : (
            <>
              <dt>Licence</dt>
              <dd>{source.license}</dd>
            </>
          )}
          {source.citation === undefined ? null : (
            <>
              <dt>Cite</dt>
              <dd>{source.citation}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}

// Visium HD's type, bin count and bin size: the Bins section.
export function VisiumHdBinControls({
  visiumHd,
}: {
  readonly visiumHd: DatasetViewOptionsModel['visiumHd']
}) {
  const inputId = useId()

  return (
    <VisiumHdDatasetControls
      inputId={inputId}
      state={visiumHd.state}
      onBinSizeChange={visiumHd.onBinSizeChange}
    />
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

function VisiumDatasetControls({
  visium,
  state,
}: {
  readonly visium: VisiumViewModel
  readonly state: LoadedVisiumState
}) {
  const { disabled, onViewChange } = visium
  const { summary } = state
  const offTissue = summary.offTissueSpotCount.toLocaleString()

  return (
    <section className="visium-hd-controls visium-controls" aria-label="Visium dataset">
      <div className="dataset-platform-row">
        <span>Dataset type</span>
        <strong>{visiumSourceLabel(state.source)}</strong>
      </div>
      <div className="dataset-platform-row">
        <span>Spots</span>
        <strong>
          {summary.spotCount.toLocaleString()} × {summary.spotDiameterMicrometers} µm
          {summary.offTissueSpotCount === 0
            ? ''
            : summary.showOffTissue
              ? ` (incl. ${offTissue} off tissue)`
              : ` (${offTissue} off tissue hidden)`}
        </strong>
      </div>
      {summary.libraryIds.length > 1 ? (
        <label className="visium-bin-control">
          <span>Library</span>
          <select
            title="Visium library to show"
            value={state.requestedView?.libraryId ?? summary.libraryId}
            disabled={disabled}
            onChange={(event) => {
              onViewChange({ libraryId: event.currentTarget.value })
            }}
          >
            {summary.libraryIds.map((libraryId) => (
              <option key={libraryId} value={libraryId}>
                {libraryId}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="dataset-platform-row">
          <span>Library</span>
          <strong>{summary.libraryId}</strong>
        </div>
      )}
      {summary.chemistry === undefined ? null : (
        <div className="dataset-platform-row">
          <span>Chemistry</span>
          <strong>{summary.chemistry}</strong>
        </div>
      )}
      <div className="dataset-platform-row">
        <span>Scale</span>
        <strong title={`Source: ${summary.units.source}`}>
          {formatVisiumUnits(summary.units)}
        </strong>
      </div>
    </section>
  )
}

type VisiumViewModel = DatasetViewOptionsModel['visium']
type LoadedVisiumState = Exclude<VisiumControlState, { readonly status: 'idle' }>

// The Visium tissue image, for the Image section.
export function VisiumTissueImageSelect({
  visium,
}: {
  readonly visium: VisiumViewModel
}) {
  const { disabled, onImageChange, state } = visium

  if (state.status === 'idle') {
    return null
  }

  const { summary } = state

  return (
    <Select<VisiumImageKind | ''>
      className="ui-field--inline"
      label="Tissue image"
      title="Visium tissue image to show"
      value={state.image ?? ''}
      disabled={disabled || summary.images.length === 0}
      options={[
        { value: '', label: summary.images.length === 0 ? 'None available' : 'None' },
        ...summary.images.map((image) => ({
          value: image,
          label: visiumImageLabel(image),
        })),
      ]}
      onChange={(value) => {
        onImageChange(value === '' ? null : value)
      }}
    />
  )
}

// Show off-tissue spots, for the Spots section.
export function VisiumOffTissueToggle({ visium }: { readonly visium: VisiumViewModel }) {
  const { disabled, onViewChange, state } = visium

  if (state.status === 'idle' || state.summary.offTissueSpotCount === 0) {
    return null
  }

  return (
    <label className="dataset-toggle">
      <input
        type="checkbox"
        checked={state.requestedView?.showOffTissue ?? state.summary.showOffTissue}
        disabled={disabled}
        title="Show the spots that are not under tissue"
        onChange={(event) => {
          onViewChange({ showOffTissue: event.currentTarget.checked })
        }}
      />
      <span>Show off-tissue spots</span>
    </label>
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
