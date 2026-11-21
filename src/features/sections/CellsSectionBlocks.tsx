import { useId } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import {
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  geneExpressionScaleGradient,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import {
  CELL_POINT_SCALE_STEPS,
  cellPointScaleStepIndex,
} from '../../rendering/cellPointStyle'
import { opacityToPercent } from '../../rendering/layerOpacity'
import { Button, Chip, InfoTip, NumberField, Segmented } from '../../components/ui'
import { COMBINE_GENES_HELP, EXPRESSION_DETAIL_HELP } from '../shell/helpText'
import { isObservationColorMode } from '../app-shell/appShellModel'
import { GeneOptionList } from '../genes/GeneOptionList'
import {
  defaultGeneSetName,
  formatGeneScaleValue,
  geneSearchEmptyMessage,
  isGeneExpressionDetailMode,
} from '../genes/geneControlsModel'
import {
  AUTO_GENE_SCALE_PERCENTILE,
  AUTO_GENE_SCALE_RANGE,
  formatPercentile,
  geneScaleMidpoint,
  geneScalePercentile,
  isAutoGeneScaleRange,
} from '../genes/geneScaleRange'
import { useGeneSetControls } from '../genes/useGeneSetControls'
import type {
  CellAppearanceModel,
  CellColourModel,
  GeneSelectionModel,
} from './cellsSectionModel'

// The cell and nucleus boundary checkboxes, without a wrapper, so the Layers
// tab can list them with Hover tooltips.
export function CellBoundaryToggles({
  appearance,
}: {
  readonly appearance: CellAppearanceModel
}) {
  const cellInputId = useId()
  const nucleusInputId = useId()

  if (!appearance.available) {
    return null
  }

  return (
    <>
      <label htmlFor={cellInputId}>
        <input
          id={cellInputId}
          type="checkbox"
          checked={appearance.showCellBoundaries}
          title="Toggle cell boundary layer"
          onChange={(event) => {
            appearance.onShowCellBoundariesChange(event.currentTarget.checked)
          }}
        />
        <span>Cell boundaries</span>
      </label>
      {appearance.nucleusBoundariesAvailable ? (
        <label htmlFor={nucleusInputId}>
          <input
            id={nucleusInputId}
            type="checkbox"
            checked={appearance.showNucleusBoundaries}
            title="Toggle nucleus boundary layer"
            onChange={(event) => {
              appearance.onShowNucleusBoundariesChange(event.currentTarget.checked)
            }}
          />
          <span>Nucleus boundaries</span>
        </label>
      ) : null}
    </>
  )
}

// The cell fill and boundary opacity and point size sliders, without a
// wrapper.
export function CellOpacityControls({
  appearance,
}: {
  readonly appearance: CellAppearanceModel
}) {
  const fillInputId = useId()
  const boundaryInputId = useId()
  const pointScaleInputId = useId()

  if (!appearance.available) {
    return null
  }

  const fillOpacityPercent = opacityToPercent(appearance.fillOpacity)
  const boundaryOpacityPercent = opacityToPercent(appearance.boundaryOpacity)

  return (
    <>
      <div className="layer-opacity-control">
        <div className="layer-opacity-header">
          <label htmlFor={fillInputId}>Cell fill opacity</label>
          <span>{fillOpacityPercent}%</span>
        </div>
        <input
          id={fillInputId}
          type="range"
          min="0"
          max="100"
          step="5"
          value={fillOpacityPercent}
          aria-valuetext={`${fillOpacityPercent}%`}
          title="Cell fill opacity"
          onChange={(event) => {
            appearance.onFillOpacityPercentChange(event.currentTarget.valueAsNumber)
          }}
        />
      </div>
      <div className="layer-opacity-control">
        <div className="layer-opacity-header">
          <label htmlFor={boundaryInputId}>Cell boundary opacity</label>
          <span>{boundaryOpacityPercent}%</span>
        </div>
        <input
          id={boundaryInputId}
          type="range"
          min="0"
          max="100"
          step="5"
          value={boundaryOpacityPercent}
          aria-valuetext={`${boundaryOpacityPercent}%`}
          title="Cell boundary opacity"
          onChange={(event) => {
            appearance.onBoundaryOpacityPercentChange(event.currentTarget.valueAsNumber)
          }}
        />
      </div>
      <div className="layer-opacity-control">
        <div className="layer-opacity-header">
          <label htmlFor={pointScaleInputId}>Cell point size</label>
          <span>{appearance.pointScale}×</span>
        </div>
        <input
          id={pointScaleInputId}
          type="range"
          min="0"
          max={CELL_POINT_SCALE_STEPS.length - 1}
          step="1"
          value={cellPointScaleStepIndex(appearance.pointScale)}
          aria-valuetext={`${appearance.pointScale} times`}
          title="Size of cells drawn as points"
          onChange={(event) => {
            const step = CELL_POINT_SCALE_STEPS[event.currentTarget.valueAsNumber]

            if (step !== undefined) {
              appearance.onPointScaleChange(step)
            }
          }}
        />
      </div>
    </>
  )
}

// 2D or 3D, for cells placed in 3D (a third spatial coordinate).
export function CellViewControl({
  appearance,
}: {
  readonly appearance: CellAppearanceModel
}) {
  const view = appearance.view

  if (!appearance.available || view === null) {
    return null
  }

  return (
    <div className="ui-field ui-field--inline cell-view-control">
      <span className="ui-field-label">View</span>
      <Segmented
        title="Show every cell in the plane, or the cells in 3D at their z"
        label="Cell view"
        value={view.open ? '3d' : '2d'}
        options={[
          { value: '2d', label: '2D', title: 'Show every cell in the plane' },
          { value: '3d', label: '3D', title: 'Show the cells in 3D at their z' },
        ]}
        onChange={(value) => {
          view.onOpenChange(value === '3d')
        }}
      />
    </div>
  )
}

// Gene search, the selected-gene chips, typed symbols and saved gene sets.
export function GenePicker({ genes }: { readonly genes: GeneSelectionModel }) {
  const searchInputId = useId()
  const symbolsInputId = useId()
  const setNameInputId = useId()
  const {
    addSavedGeneSet,
    aliases,
    applyGeneSetSymbols,
    applySavedGeneSet,
    filteredGenes,
    geneSearch,
    geneSetName,
    geneSetSymbols,
    pickGene,
    removeSavedGeneSet,
    saveSelectedGeneSet,
    savedGeneSets,
    setGeneSearch,
    setGeneSetName,
    setGeneSetSymbols,
  } = useGeneSetControls(genes)
  const isPanelReady = genes.panelState.status === 'ready'
  const selectedGenes = genes.selected
  const selectedGeneSet = new Set(selectedGenes)

  return (
    <>
      <label htmlFor={searchInputId}>Gene selection</label>
      <input
        id={searchInputId}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={geneSearch}
        disabled={!isPanelReady}
        placeholder="Search genes"
        title="Gene selection search"
        onChange={(event) => {
          setGeneSearch(event.currentTarget.value)
        }}
      />

      {selectedGenes.length === 0 ? null : (
        <div className="gene-chip-row" aria-label="Selected genes">
          {selectedGenes.map((gene) => (
            <Chip
              key={gene}
              title={gene}
              selected
              removeTitle={`Remove ${gene}`}
              onRemove={() => {
                genes.onToggle(gene)
              }}
            >
              {gene}
            </Chip>
          ))}
        </div>
      )}

      <GeneOptionList
        genes={filteredGenes}
        selectedGenes={selectedGenes}
        aliases={aliases}
        scrollResetKey={geneSearch}
        emptyMessage={geneSearchEmptyMessage(geneSearch, selectedGenes, {
          noun: 'genes',
          aliases,
        })}
        onToggleGene={pickGene}
      />

      <label htmlFor={symbolsInputId}>Gene set symbols</label>
      <textarea
        id={symbolsInputId}
        className="gene-set-symbols"
        autoComplete="off"
        spellCheck={false}
        rows={1}
        value={geneSetSymbols}
        disabled={!isPanelReady}
        placeholder="Actb, Gad1, Slc17a7"
        title="Gene set symbols"
        onChange={(event) => {
          setGeneSetSymbols(event.currentTarget.value)
        }}
      />
      <div className="gene-set-actions">
        <button
          type="button"
          disabled={!isPanelReady || geneSetSymbols.trim() === ''}
          title="Apply gene set symbols"
          onClick={applyGeneSetSymbols}
        >
          Apply Symbols
        </button>
        <button
          type="button"
          disabled={selectedGenes.length === 0}
          title="Save selected genes as a set"
          onClick={saveSelectedGeneSet}
        >
          Save Set
        </button>
      </div>

      <label htmlFor={setNameInputId}>Set name</label>
      <input
        id={setNameInputId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={geneSetName}
        placeholder={defaultGeneSetName(selectedGenes)}
        title="Gene set name"
        onChange={(event) => {
          setGeneSetName(event.currentTarget.value)
        }}
      />

      {savedGeneSets.length === 0 ? null : (
        <div className="gene-set-list" aria-label="Saved gene sets">
          {savedGeneSets.map((geneSet) => (
            <div key={geneSet.id} className="gene-set-row">
              <button
                type="button"
                className="gene-set-apply"
                aria-label={`Apply ${geneSet.name}`}
                title={`Apply ${geneSet.name}`}
                onClick={() => {
                  applySavedGeneSet(geneSet)
                }}
              >
                <span>{geneSet.name}</span>
                <small>{geneSet.scoreMode}</small>
              </button>
              <button
                type="button"
                className="gene-set-add"
                aria-label={`Add ${geneSet.name}`}
                title={
                  geneSet.genes.every((gene) => selectedGeneSet.has(gene))
                    ? `${geneSet.name}'s genes are all selected`
                    : `Add ${geneSet.name}'s genes to the selection`
                }
                disabled={geneSet.genes.every((gene) => selectedGeneSet.has(gene))}
                onClick={() => {
                  addSavedGeneSet(geneSet)
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="gene-set-remove"
                aria-label={`Remove ${geneSet.name}`}
                title={`Remove ${geneSet.name}`}
                onClick={() => {
                  removeSavedGeneSet(geneSet.id)
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// "Combine genes" (with two or more genes) and the gene colour scale.
export function GeneExpressionControls({ colour }: { readonly colour: CellColourModel }) {
  const scoreInputId = useId()
  const scaleInputId = useId()

  return (
    <>
      {colour.selectedGeneCount < 2 ? null : (
        <>
          <div className="ui-label-row">
            <label htmlFor={scoreInputId}>Combine genes</label>
            <InfoTip title="Combine genes">{COMBINE_GENES_HELP}</InfoTip>
          </div>
          <select
            id={scoreInputId}
            value={colour.scoreMode}
            title="How to combine the selected genes into one score per cell"
            onChange={(event) => {
              const nextScoreMode = event.currentTarget.value

              if (isGeneExpressionScoreMode(nextScoreMode)) {
                colour.onScoreModeChange(nextScoreMode)
              }
            }}
          >
            {GENE_EXPRESSION_SCORE_MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="ui-label-row">
        <label htmlFor={scaleInputId}>Gene scale</label>
        {isAutoGeneScaleRange(colour.scaleRange) ? null : (
          <Button
            title={`Back to Auto: 0 to the ${formatPercentile(AUTO_GENE_SCALE_PERCENTILE)} percentile of the selected genes' scores above 0`}
            variant="ghost"
            className="gene-scale-reset"
            onClick={() => {
              colour.onScaleRangeChange(AUTO_GENE_SCALE_RANGE)
            }}
          >
            Reset
          </Button>
        )}
      </div>
      <div className="gene-scale-control">
        <select
          id={scaleInputId}
          value={colour.colorScale}
          title="Gene scale"
          onChange={(event) => {
            const nextScale = event.currentTarget.value

            if (isGeneExpressionColorScale(nextScale)) {
              colour.onColorScaleChange(nextScale)
            }
          }}
        >
          {GENE_EXPRESSION_COLOR_SCALE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          className="gene-scale-preview"
          style={{
            backgroundImage: geneExpressionScaleGradient(colour.colorScale),
          }}
          aria-hidden="true"
        />
        <GeneScaleRangeFields colour={colour} />
      </div>
    </>
  )
}

// Where a top that follows the data is, for titles.
function scaleTopCopy({
  autoScaleMax,
  highestScore,
  scaleRange,
}: CellColourModel): string {
  return `the ${formatPercentile(geneScalePercentile(scaleRange))} percentile of the selected genes' scores above 0, ${formatGeneScaleValue(autoScaleMax)} (highest ${formatGeneScaleValue(highestScore)})`
}

// The top end's title: Auto, a percentile (from a link or manifest), or set.
function scaleTopTitle(colour: CellColourModel): string {
  const { max } = colour.scaleRange
  const where =
    max === null
      ? `Auto, ${scaleTopCopy(colour)}`
      : typeof max === 'number'
        ? 'set'
        : `set to ${scaleTopCopy(colour)}`

  return `Score at the top of the scale: ${where}. Cells at or above it get the last colour. Type a score and press Enter to ${max === null ? 'fix' : 'change'} it`
}

// The Gene scale's ends under the gradient, with the score at its middle. Each
// end is a field that reads as a label until pointed at: type a score and
// press Enter to fix it. A set end is in the accent colour.
function GeneScaleRangeFields({ colour }: { readonly colour: CellColourModel }) {
  const { scaleMin, scaleMax, scaleRange, onScaleRangeChange } = colour

  return (
    <div className="gene-scale-values" role="group" aria-label="Gene scale range">
      <NumberField
        title={`Score at the bottom of the scale: ${scaleRange.min === null ? 'Auto, 0' : 'set'}. Cells at or below it get the first colour. Type a score and press Enter to ${scaleRange.min === null ? 'fix' : 'change'} it`}
        label={<span className="visually-hidden">Gene scale minimum</span>}
        value={roundScaleValue(scaleMin)}
        className={scaleRange.min === null ? 'gene-scale-end' : 'gene-scale-end is-set'}
        onChange={(value) => {
          if (value < scaleMax) onScaleRangeChange({ ...scaleRange, min: value })
        }}
      />
      <span title="Score at the middle of the gradient">
        {formatGeneScaleValue(geneScaleMidpoint({ min: scaleMin, max: scaleMax }))}
      </span>
      <NumberField
        title={scaleTopTitle(colour)}
        label={<span className="visually-hidden">Gene scale maximum</span>}
        value={roundScaleValue(scaleMax)}
        className={scaleRange.max === null ? 'gene-scale-end' : 'gene-scale-end is-set'}
        onChange={(value) => {
          if (value > scaleMin) onScaleRangeChange({ ...scaleRange, max: value })
        }}
      />
    </div>
  )
}

// To the digits the scale labels show.
function roundScaleValue(value: number): number {
  const factor = Math.abs(value) < 10 ? 100 : 10
  return Math.round(value * factor) / factor
}

export function ExpressionDetailControl({
  colour,
}: {
  readonly colour: CellColourModel
}) {
  const inputId = useId()

  return (
    <>
      <div className="ui-label-row">
        <label htmlFor={inputId}>Expression detail</label>
        <InfoTip title="Expression detail">{EXPRESSION_DETAIL_HELP}</InfoTip>
      </div>
      <select
        id={inputId}
        value={colour.detailMode}
        title="Expression detail"
        onChange={(event) => {
          const nextMode = event.currentTarget.value

          if (isGeneExpressionDetailMode(nextMode)) {
            colour.onDetailModeChange(nextMode)
          }
        }}
      >
        <option value="auto">Auto LOD</option>
        <option value="exact-region">Exact region</option>
        <option value="all-cells">All cells</option>
      </select>
    </>
  )
}

// What colours the cells, and the metadata track when that is the choice.
export function CellColorControls({ colour }: { readonly colour: CellColourModel }) {
  const modeInputId = useId()
  const trackInputId = useId()
  const activeMetadataTrackId =
    colour.selectedMetadataTrackId ?? colour.metadataTracks[0]?.id ?? ''

  return (
    <>
      <label htmlFor={modeInputId}>Cell color</label>
      <select
        id={modeInputId}
        value={colour.mode}
        title="Cell color"
        onChange={(event) => {
          const nextMode = event.currentTarget.value

          if (isObservationColorMode(nextMode)) {
            colour.onModeChange(nextMode)
          }
        }}
      >
        {/* Picking a gene chooses it (D2); without genes it would colour
            nothing (15.5-B). */}
        {colour.selectedGeneCount > 0 || colour.mode === 'gene-expression' ? (
          <option value="gene-expression">Gene expression</option>
        ) : null}
        <option value="transcript-count">Transcript count</option>
        <option value="cell-area">Cell area</option>
        {colour.hasAnnotationColors ? (
          <option value="annotations">Annotations</option>
        ) : null}
        {colour.metadataTracks.length > 0 ? (
          <option value="metadata">Metadata</option>
        ) : null}
      </select>

      {colour.metadataTracks.length > 0 && colour.mode === 'metadata' ? (
        <>
          <label htmlFor={trackInputId}>Metadata track</label>
          <select
            id={trackInputId}
            value={activeMetadataTrackId}
            title="Metadata track"
            onChange={(event) => {
              colour.onMetadataTrackChange(event.currentTarget.value)
            }}
          >
            {colour.metadataTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {metadataTrackOptionLabel(track)}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </>
  )
}

function metadataTrackOptionLabel(track: ContinuousCellMetadataTrack): string {
  return `${track.label} (${formatMetadataValue(track.min)}-${formatMetadataValue(
    track.max,
  )})`
}

function formatMetadataValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toPrecision(3)
}
