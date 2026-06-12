import type { ObservationColorMode } from '../../rendering/cellStyling'
import {
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import { isObservationColorMode } from '../app-shell/appShellModel'
import { GeneOptionList } from './GeneOptionList'
import {
  defaultGeneSetName,
  formatGeneScaleValue,
  isGeneExpressionDetailMode,
  type GeneExpressionState,
  type GenePanelState,
  type SavedGeneSet,
} from './geneControlsModel'

interface GeneHudPanelProps {
  readonly active: boolean
  readonly geneSearchInputId: string
  readonly geneSetSymbolsInputId: string
  readonly geneSetNameInputId: string
  readonly geneSetScoreInputId: string
  readonly geneScaleInputId: string
  readonly geneExpressionDetailInputId: string
  readonly observationModeInputId: string
  readonly analysisHeaderCopy: string
  readonly geneExpressionCopy: string
  readonly genePanelState: GenePanelState
  readonly geneExpressionState: GeneExpressionState
  readonly geneSearch: string
  readonly geneSetSymbols: string
  readonly geneSetName: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly savedGeneSets: readonly SavedGeneSet[]
  readonly selectedGenes: readonly string[]
  readonly filteredGenes: readonly string[]
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionScaleMax: number
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly observationColorMode: ObservationColorMode
  readonly hasAnnotationColors: boolean
  readonly onGeneSearchChange: (search: string) => void
  readonly onToggleGene: (gene: string) => void
  readonly onGeneSetSymbolsChange: (symbols: string) => void
  readonly onApplyGeneSetSymbols: () => void
  readonly onSaveSelectedGeneSet: () => void
  readonly onGeneSetNameChange: (name: string) => void
  readonly onGeneExpressionScoreModeChange: (mode: GeneExpressionScoreMode) => void
  readonly onApplySavedGeneSet: (geneSet: SavedGeneSet) => void
  readonly onRemoveSavedGeneSet: (id: string) => void
  readonly onGeneExpressionColorScaleChange: (scale: GeneExpressionColorScale) => void
  readonly onGeneExpressionDetailModeChange: (mode: GeneExpressionDetailMode) => void
  readonly onObservationColorModeChange: (mode: ObservationColorMode) => void
}

export function GeneHudPanel({
  active,
  geneSearchInputId,
  geneSetSymbolsInputId,
  geneSetNameInputId,
  geneSetScoreInputId,
  geneScaleInputId,
  geneExpressionDetailInputId,
  observationModeInputId,
  analysisHeaderCopy,
  geneExpressionCopy,
  genePanelState,
  geneExpressionState,
  geneSearch,
  geneSetSymbols,
  geneSetName,
  geneExpressionScoreMode,
  savedGeneSets,
  selectedGenes,
  filteredGenes,
  geneExpressionColorScale,
  geneExpressionScaleMax,
  geneExpressionDetailMode,
  observationColorMode,
  hasAnnotationColors,
  onGeneSearchChange,
  onToggleGene,
  onGeneSetSymbolsChange,
  onApplyGeneSetSymbols,
  onSaveSelectedGeneSet,
  onGeneSetNameChange,
  onGeneExpressionScoreModeChange,
  onApplySavedGeneSet,
  onRemoveSavedGeneSet,
  onGeneExpressionColorScaleChange,
  onGeneExpressionDetailModeChange,
  onObservationColorModeChange,
}: GeneHudPanelProps) {
  const isGenePanelReady = genePanelState.status === 'ready'
  const isGeneWorkLoading =
    genePanelState.status === 'loading' || geneExpressionState.status === 'loading'

  return (
    <div
      id="hud-panel-genes"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-genes"
      hidden={!active}
    >
      <section className="analysis-section" aria-labelledby="analysis-heading">
        <div className="section-heading-row">
          <h2 id="analysis-heading">Analysis</h2>
          <span
            className={isGeneWorkLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {analysisHeaderCopy}
          </span>
        </div>

        <label htmlFor={geneSearchInputId}>Gene selection</label>
        <input
          id={geneSearchInputId}
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={geneSearch}
          disabled={!isGenePanelReady}
          placeholder="Search genes"
          title="Gene selection search"
          onChange={(event) => {
            onGeneSearchChange(event.currentTarget.value)
          }}
        />

        {selectedGenes.length === 0 ? null : (
          <div className="gene-chip-row" aria-label="Selected genes">
            {selectedGenes.map((gene) => (
              <button
                key={gene}
                type="button"
                className="gene-chip"
                title={`Remove ${gene}`}
                onClick={() => {
                  onToggleGene(gene)
                }}
              >
                {gene}
              </button>
            ))}
          </div>
        )}

        <GeneOptionList
          genes={filteredGenes}
          selectedGenes={selectedGenes}
          onToggleGene={onToggleGene}
        />

        <label htmlFor={geneSetSymbolsInputId}>Gene set symbols</label>
        <textarea
          id={geneSetSymbolsInputId}
          className="gene-set-symbols"
          autoComplete="off"
          spellCheck={false}
          rows={1}
          value={geneSetSymbols}
          disabled={!isGenePanelReady}
          placeholder="Actb, Gad1, Slc17a7"
          title="Gene set symbols"
          onChange={(event) => {
            onGeneSetSymbolsChange(event.currentTarget.value)
          }}
        />
        <div className="gene-set-actions">
          <button
            type="button"
            disabled={!isGenePanelReady || geneSetSymbols.trim() === ''}
            title="Apply gene set symbols"
            onClick={onApplyGeneSetSymbols}
          >
            Apply Symbols
          </button>
          <button
            type="button"
            disabled={selectedGenes.length === 0}
            title="Save selected genes as a set"
            onClick={onSaveSelectedGeneSet}
          >
            Save Set
          </button>
        </div>

        <label htmlFor={geneSetNameInputId}>Set name</label>
        <input
          id={geneSetNameInputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={geneSetName}
          placeholder={defaultGeneSetName(selectedGenes)}
          title="Gene set name"
          onChange={(event) => {
            onGeneSetNameChange(event.currentTarget.value)
          }}
        />

        <label htmlFor={geneSetScoreInputId}>Signature score</label>
        <select
          id={geneSetScoreInputId}
          value={geneExpressionScoreMode}
          title="Signature score"
          onChange={(event) => {
            const nextScoreMode = event.currentTarget.value

            if (isGeneExpressionScoreMode(nextScoreMode)) {
              onGeneExpressionScoreModeChange(nextScoreMode)
            }
          }}
        >
          {GENE_EXPRESSION_SCORE_MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

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
                    onApplySavedGeneSet(geneSet)
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
                    onRemoveSavedGeneSet(geneSet.id)
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <label htmlFor={geneScaleInputId}>Gene scale</label>
        <div className="gene-scale-control">
          <select
            id={geneScaleInputId}
            value={geneExpressionColorScale}
            title="Gene scale"
            onChange={(event) => {
              const nextScale = event.currentTarget.value

              if (isGeneExpressionColorScale(nextScale)) {
                onGeneExpressionColorScaleChange(nextScale)
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
            className={`gene-scale-preview gene-scale-preview-${geneExpressionColorScale}`}
            aria-hidden="true"
          />
          <div className="gene-scale-values" aria-label="Gene scale values">
            <span>0</span>
            <span>{formatGeneScaleValue(geneExpressionScaleMax / 2)}</span>
            <span>{formatGeneScaleValue(geneExpressionScaleMax)}</span>
          </div>
        </div>

        <label htmlFor={geneExpressionDetailInputId}>Expression detail</label>
        <select
          id={geneExpressionDetailInputId}
          value={geneExpressionDetailMode}
          title="Expression detail"
          onChange={(event) => {
            const nextMode = event.currentTarget.value

            if (isGeneExpressionDetailMode(nextMode)) {
              onGeneExpressionDetailModeChange(nextMode)
            }
          }}
        >
          <option value="auto">Auto LOD</option>
          <option value="exact-region">Exact region</option>
          <option value="all-cells">All cells</option>
        </select>

        <label htmlFor={observationModeInputId}>Cell color</label>
        <select
          id={observationModeInputId}
          value={observationColorMode}
          title="Cell color"
          onChange={(event) => {
            const nextMode = event.currentTarget.value

            if (isObservationColorMode(nextMode)) {
              onObservationColorModeChange(nextMode)
            }
          }}
        >
          <option value="transcript-count">Transcript count</option>
          <option value="cell-area">Cell area</option>
          {hasAnnotationColors ? <option value="annotations">Annotations</option> : null}
        </select>

        <p className="analysis-status" aria-live="polite">
          {geneExpressionCopy}
        </p>
      </section>
    </div>
  )
}
