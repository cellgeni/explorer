import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import {
  MAX_TRANSCRIPT_EXACT_RENDER_LIMIT,
  MIN_TRANSCRIPT_EXACT_RENDER_LIMIT,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import {
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_POINT_COLOR_MODE_OPTIONS,
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import { opacityToPercent } from '../../rendering/layerOpacity'
import { TranscriptStatusPanel } from './TranscriptStatusPanel'
import {
  isTranscriptDetailMode,
  isTranscriptFeatureFilterMode,
  transcriptDensityScaleAriaLabel,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from './transcriptLayerModel'

interface TranscriptHudPanelProps {
  readonly active: boolean
  readonly transcriptDetailInputId: string
  readonly transcriptDensityScaleInputId: string
  readonly transcriptPointColorInputId: string
  readonly transcriptPointBudgetInputId: string
  readonly transcriptMinQvInputId: string
  readonly transcriptFeatureFilterInputId: string
  readonly transcriptFeatureSearchInputId: string
  readonly transcriptOpacityInputId: string
  readonly transcriptPointSizeInputId: string
  readonly transcriptCopy: string
  readonly loadEnabled: boolean
  readonly featureSearchEnabled: boolean
  readonly showTranscriptOverlay: boolean
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly selectedGenes: readonly string[]
  readonly transcriptFeatureSearch: string
  readonly filteredTranscriptFeatures: readonly string[]
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptDensityScaleMax: number | undefined
  readonly transcriptDensityScaleLabels: readonly [string, string, string]
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptMinQv: number
  readonly transcriptGeneOnly: boolean
  readonly transcriptOpacity: number
  readonly transcriptPointSize: number
  readonly transcriptCapabilityState: TranscriptCapabilityState
  readonly transcriptLayerState: TranscriptLayerState
  readonly visibleTranscriptEstimate: number
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly onShowTranscriptOverlayChange: (enabled: boolean) => void
  readonly onTranscriptDetailModeChange: (mode: TranscriptDetailMode) => void
  readonly onTranscriptExactPointLimitChange: (limit: number) => void
  readonly onTranscriptFeatureFilterModeChange: (
    mode: TranscriptFeatureFilterMode,
  ) => void
  readonly onToggleSelectedFeature: (gene: string) => void
  readonly onTranscriptFeatureSearchChange: (search: string) => void
  readonly onPickTranscriptFeature: (gene: string) => void
  readonly onTranscriptDensityColorScaleChange: (
    scale: TranscriptDensityColorScale,
  ) => void
  readonly onTranscriptPointColorModeChange: (mode: TranscriptPointColorMode) => void
  readonly onTranscriptMinQvChange: (minQv: number) => void
  readonly onTranscriptGeneOnlyChange: (enabled: boolean) => void
  readonly onTranscriptOpacityPercentChange: (percent: number) => void
  readonly onTranscriptPointSizeChange: (pointSize: number) => void
  readonly onPinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly onClearPinnedTranscript: () => void
  readonly onLoadExactViewport: (requestKey: string) => void
}

export function TranscriptHudPanel({
  active,
  transcriptDetailInputId,
  transcriptDensityScaleInputId,
  transcriptPointColorInputId,
  transcriptPointBudgetInputId,
  transcriptMinQvInputId,
  transcriptFeatureFilterInputId,
  transcriptFeatureSearchInputId,
  transcriptOpacityInputId,
  transcriptPointSizeInputId,
  transcriptCopy,
  loadEnabled,
  featureSearchEnabled,
  showTranscriptOverlay,
  transcriptDetailMode,
  transcriptExactPointLimit,
  effectiveTranscriptFeatureFilterMode,
  selectedGenes,
  transcriptFeatureSearch,
  filteredTranscriptFeatures,
  transcriptDensityColorScale,
  transcriptDensityScaleMax,
  transcriptDensityScaleLabels,
  transcriptPointColorMode,
  transcriptMinQv,
  transcriptGeneOnly,
  transcriptOpacity,
  transcriptPointSize,
  transcriptCapabilityState,
  transcriptLayerState,
  visibleTranscriptEstimate,
  hoveredTranscript,
  pinnedTranscript,
  onShowTranscriptOverlayChange,
  onTranscriptDetailModeChange,
  onTranscriptExactPointLimitChange,
  onTranscriptFeatureFilterModeChange,
  onToggleSelectedFeature,
  onTranscriptFeatureSearchChange,
  onPickTranscriptFeature,
  onTranscriptDensityColorScaleChange,
  onTranscriptPointColorModeChange,
  onTranscriptMinQvChange,
  onTranscriptGeneOnlyChange,
  onTranscriptOpacityPercentChange,
  onTranscriptPointSizeChange,
  onPinTranscript,
  onClearPinnedTranscript,
  onLoadExactViewport,
}: TranscriptHudPanelProps) {
  const isTranscriptWorkLoading =
    transcriptCapabilityState.status === 'loading' ||
    transcriptLayerState.status === 'loading'
  const transcriptOpacityPercent = opacityToPercent(transcriptOpacity)

  return (
    <div
      id="hud-panel-transcripts"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-transcripts"
      hidden={!active}
    >
      <section
        className="analysis-section transcript-section"
        aria-labelledby="transcript-heading"
      >
        <div className="section-heading-row">
          <h2 id="transcript-heading">Transcripts</h2>
          <span
            className={isTranscriptWorkLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {transcriptCopy}
          </span>
        </div>

        <label className="dataset-toggle" htmlFor="show-transcripts-overlay">
          <input
            id="show-transcripts-overlay"
            type="checkbox"
            checked={showTranscriptOverlay}
            disabled={!loadEnabled}
            onChange={(event) => {
              onShowTranscriptOverlayChange(event.currentTarget.checked)
            }}
          />
          <span>Show transcripts</span>
        </label>

        <label htmlFor={transcriptDetailInputId}>Detail</label>
        <select
          id={transcriptDetailInputId}
          value={transcriptDetailMode}
          onChange={(event) => {
            const nextMode = event.currentTarget.value

            if (isTranscriptDetailMode(nextMode)) {
              onTranscriptDetailModeChange(nextMode)
            }
          }}
        >
          <option value="auto">Auto</option>
          <option value="density">Density</option>
          <option value="exact">Exact</option>
        </select>

        <label htmlFor={transcriptPointBudgetInputId}>Exact budget</label>
        <input
          id={transcriptPointBudgetInputId}
          type="number"
          inputMode="numeric"
          min={MIN_TRANSCRIPT_EXACT_RENDER_LIMIT}
          max={MAX_TRANSCRIPT_EXACT_RENDER_LIMIT}
          step="1000"
          value={transcriptExactPointLimit}
          onChange={(event) => {
            onTranscriptExactPointLimitChange(event.currentTarget.valueAsNumber)
          }}
        />

        <label htmlFor={transcriptFeatureFilterInputId}>Feature filter</label>
        <select
          id={transcriptFeatureFilterInputId}
          value={effectiveTranscriptFeatureFilterMode}
          onChange={(event) => {
            const nextMode = event.currentTarget.value

            if (isTranscriptFeatureFilterMode(nextMode)) {
              onTranscriptFeatureFilterModeChange(nextMode)
            }
          }}
        >
          <option value="selected" disabled={selectedGenes.length === 0}>
            Selected genes
          </option>
          <option value="all">All features</option>
        </select>

        {selectedGenes.length === 0 ? null : (
          <div className="gene-chip-row" aria-label="Transcript selected features">
            {selectedGenes.map((gene) => (
              <button
                key={gene}
                type="button"
                className="gene-chip"
                onClick={() => {
                  onToggleSelectedFeature(gene)
                }}
              >
                {gene}
              </button>
            ))}
          </div>
        )}

        <label htmlFor={transcriptFeatureSearchInputId}>Feature search</label>
        <input
          id={transcriptFeatureSearchInputId}
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={transcriptFeatureSearch}
          disabled={!featureSearchEnabled}
          placeholder="Search transcript features"
          onChange={(event) => {
            onTranscriptFeatureSearchChange(event.currentTarget.value)
          }}
        />

        {transcriptFeatureSearch.trim() === '' ? null : (
          <div className="gene-option-list" aria-label="Transcript feature options">
            {filteredTranscriptFeatures.length === 0 ? (
              <span className="option-empty">No matching features</span>
            ) : (
              filteredTranscriptFeatures.map((gene) => (
                <button
                  key={gene}
                  type="button"
                  onClick={() => {
                    onPickTranscriptFeature(gene)
                  }}
                >
                  {gene}
                </button>
              ))
            )}
          </div>
        )}

        <label htmlFor={transcriptDensityScaleInputId}>Density color</label>
        <div className="transcript-density-scale-control">
          <select
            id={transcriptDensityScaleInputId}
            value={transcriptDensityColorScale}
            onChange={(event) => {
              const nextScale = event.currentTarget.value

              if (isTranscriptDensityColorScale(nextScale)) {
                onTranscriptDensityColorScaleChange(nextScale)
              }
            }}
          >
            {TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div
            className="transcript-density-scale-preview-wrap"
            aria-label={transcriptDensityScaleAriaLabel(transcriptDensityScaleMax)}
          >
            <span
              className={`transcript-density-scale-preview transcript-density-scale-preview-${transcriptDensityColorScale}`}
              aria-hidden="true"
            />
            <span className="transcript-density-scale-values" aria-hidden="true">
              <span>{transcriptDensityScaleLabels[0]}</span>
              <span>{transcriptDensityScaleLabels[1]}</span>
              <span>{transcriptDensityScaleLabels[2]}</span>
            </span>
          </div>
        </div>

        <label htmlFor={transcriptPointColorInputId}>Point color</label>
        <select
          id={transcriptPointColorInputId}
          value={transcriptPointColorMode}
          onChange={(event) => {
            const nextMode = event.currentTarget.value

            if (isTranscriptPointColorMode(nextMode)) {
              onTranscriptPointColorModeChange(nextMode)
            }
          }}
        >
          {TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <label htmlFor={transcriptMinQvInputId}>Min QV</label>
        <input
          id={transcriptMinQvInputId}
          type="number"
          inputMode="numeric"
          min="0"
          max="40"
          step="1"
          value={transcriptMinQv}
          onChange={(event) => {
            onTranscriptMinQvChange(event.currentTarget.valueAsNumber)
          }}
        />

        <label className="dataset-toggle" htmlFor="transcript-gene-only">
          <input
            id="transcript-gene-only"
            type="checkbox"
            checked={transcriptGeneOnly}
            onChange={(event) => {
              onTranscriptGeneOnlyChange(event.currentTarget.checked)
            }}
          />
          <span>Gene-only calls</span>
        </label>

        <div className="layer-opacity-control">
          <div className="layer-opacity-header">
            <label htmlFor={transcriptOpacityInputId}>Transcript opacity</label>
            <span>{transcriptOpacityPercent}%</span>
          </div>
          <input
            id={transcriptOpacityInputId}
            type="range"
            min="0"
            max="100"
            step="5"
            value={transcriptOpacityPercent}
            aria-valuetext={`${transcriptOpacityPercent}%`}
            onChange={(event) => {
              onTranscriptOpacityPercentChange(event.currentTarget.valueAsNumber)
            }}
          />
        </div>

        <div className="layer-opacity-control">
          <div className="layer-opacity-header">
            <label htmlFor={transcriptPointSizeInputId}>Point size</label>
            <span>{transcriptPointSize}px</span>
          </div>
          <input
            id={transcriptPointSizeInputId}
            type="range"
            min="1"
            max="6"
            step="1"
            value={transcriptPointSize}
            aria-valuetext={`${transcriptPointSize}px`}
            onChange={(event) => {
              onTranscriptPointSizeChange(event.currentTarget.valueAsNumber)
            }}
          />
        </div>

        <TranscriptStatusPanel
          capabilityState={transcriptCapabilityState}
          layerState={transcriptLayerState}
          exactPointLimit={transcriptExactPointLimit}
          visibleTranscriptEstimate={visibleTranscriptEstimate}
          hoveredTranscript={hoveredTranscript}
          pinnedTranscript={pinnedTranscript}
          onPinTranscript={onPinTranscript}
          onClearPinnedTranscript={onClearPinnedTranscript}
          onLoadExactViewport={onLoadExactViewport}
        />
      </section>
    </div>
  )
}
