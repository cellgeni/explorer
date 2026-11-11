import { useId } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import {
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  geneExpressionScaleGradient,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { opacityToPercent } from '../../rendering/layerOpacity'
import { Chip } from '../../components/ui'
import { isObservationColorMode } from '../app-shell/appShellModel'
import { GeneOptionList } from '../genes/GeneOptionList'
import {
  defaultGeneSetName,
  formatGeneScaleValue,
  geneSearchEmptyMessage,
  isGeneExpressionDetailMode,
} from '../genes/geneControlsModel'
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

// The cell fill and boundary opacity sliders, without a wrapper.
export function CellOpacityControls({
  appearance,
}: {
  readonly appearance: CellAppearanceModel
}) {
  const fillInputId = useId()
  const boundaryInputId = useId()

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
    </>
  )
}

// Gene search, the selected-gene chips, typed symbols and saved gene sets.
export function GenePicker({ genes }: { readonly genes: GeneSelectionModel }) {
  const searchInputId = useId()
  const symbolsInputId = useId()
  const setNameInputId = useId()
  const {
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
          <label htmlFor={scoreInputId}>Combine genes</label>
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

      <label htmlFor={scaleInputId}>Gene scale</label>
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
        <div className="gene-scale-values" aria-label="Gene scale values">
          <span>0</span>
          <span>{formatGeneScaleValue(colour.scaleMax / 2)}</span>
          <span>{formatGeneScaleValue(colour.scaleMax)}</span>
        </div>
      </div>
    </>
  )
}

export function ExpressionDetailControl({
  colour,
}: {
  readonly colour: CellColourModel
}) {
  const inputId = useId()

  return (
    <>
      <label htmlFor={inputId}>Expression detail</label>
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
        <option value="gene-expression">Gene expression</option>
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
