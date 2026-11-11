import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Chip, InfoTip } from '../../components/ui'
import { MIN_QV_HELP, TRANSCRIPT_DETAIL_HELP } from '../shell/helpText'
import {
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_POINT_COLOR_MODE_OPTIONS,
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
  transcriptDensityScaleGradient,
} from '../../rendering/deckLayers'
import { opacityToPercent } from '../../rendering/layerOpacity'
import { filterGeneOptions, geneSearchEmptyMessage } from '../genes/geneControlsModel'
import { TranscriptPointBudget } from '../transcripts/TranscriptPointBudget'
import { TranscriptStatusPanel } from '../transcripts/TranscriptStatusPanel'
import {
  isTranscriptDetailMode,
  isTranscriptFeatureFilterMode,
  transcriptBudgetEstimate,
  transcriptDensityScaleAriaLabel,
} from '../transcripts/transcriptLayerModel'
import type {
  TranscriptFeatureModel,
  TranscriptsSectionModel,
} from './transcriptsSectionModel'

interface TranscriptsProps {
  readonly transcripts: TranscriptsSectionModel
}

// Show transcripts and the detail mode.
export function TranscriptDisplayControls({ transcripts }: TranscriptsProps) {
  const showInputId = useId()
  const detailInputId = useId()

  return (
    <>
      <label className="dataset-toggle" htmlFor={showInputId}>
        <input
          id={showInputId}
          type="checkbox"
          checked={transcripts.show}
          disabled={!transcripts.loadEnabled}
          title="Show transcript overlay"
          onChange={(event) => {
            transcripts.onShowChange(event.currentTarget.checked)
          }}
        />
        <span>Show transcripts</span>
      </label>

      <div className="ui-label-row">
        <label htmlFor={detailInputId}>Detail</label>
        <InfoTip title="Transcript detail">{TRANSCRIPT_DETAIL_HELP}</InfoTip>
      </div>
      <select
        id={detailInputId}
        value={transcripts.detailMode}
        title="Transcript detail"
        onChange={(event) => {
          const nextMode = event.currentTarget.value

          if (isTranscriptDetailMode(nextMode)) {
            transcripts.onDetailModeChange(nextMode)
          }
        }}
      >
        <option value="auto">Auto</option>
        <option value="density">Density</option>
        <option value="exact">Exact</option>
      </select>
    </>
  )
}

// The exact-point budget meter and its Edit Max field.
export function TranscriptBudget({ transcripts }: TranscriptsProps) {
  return (
    <TranscriptPointBudget
      estimate={transcriptBudgetEstimate(
        transcripts.capabilityState,
        transcripts.layerState,
        transcripts.visibleEstimate,
      )}
      limit={transcripts.exactPointLimit}
      onLimitChange={transcripts.onExactPointLimitChange}
    />
  )
}

// The feature filter, the selected-gene chips and the feature search. The
// search stays here, so typing does not re-render the app, and it clears when
// a new gene panel starts loading.
export function TranscriptFeatureControls({
  features,
}: {
  readonly features: TranscriptFeatureModel
}) {
  const filterInputId = useId()
  const searchInputId = useId()
  const [search, setSearch] = useState('')
  const lastGenePanelLoadingUrlRef = useRef<string | null>(null)
  const { options, panelState, selected } = features

  useEffect(() => {
    if (
      panelState.status !== 'loading' ||
      panelState.url === lastGenePanelLoadingUrlRef.current
    ) {
      return
    }

    lastGenePanelLoadingUrlRef.current = panelState.url
    setSearch('')
  }, [panelState])

  const filteredFeatures = useMemo(
    () => filterGeneOptions(options, search, selected, { limit: 24 }),
    [options, search, selected],
  )

  return (
    <>
      <label htmlFor={filterInputId}>Feature filter</label>
      <select
        id={filterInputId}
        value={features.filterMode}
        title="Transcript feature filter"
        onChange={(event) => {
          const nextMode = event.currentTarget.value

          if (isTranscriptFeatureFilterMode(nextMode)) {
            features.onFilterModeChange(nextMode)
          }
        }}
      >
        <option value="selected" disabled={selected.length === 0}>
          Selected genes
        </option>
        <option value="all">All features</option>
      </select>

      {selected.length === 0 ? null : (
        <div className="gene-chip-row" aria-label="Transcript selected features">
          {selected.map((gene) => (
            <Chip
              key={gene}
              title={gene}
              selected
              removeTitle={`Remove ${gene} from transcript features`}
              onRemove={() => {
                features.onToggle(gene)
              }}
            >
              {gene}
            </Chip>
          ))}
        </div>
      )}

      <label htmlFor={searchInputId}>Feature search</label>
      <input
        id={searchInputId}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={search}
        disabled={panelState.status !== 'ready'}
        placeholder="Search transcript features"
        title="Transcript feature search"
        onChange={(event) => {
          setSearch(event.currentTarget.value)
        }}
      />

      {search.trim() === '' ? null : (
        <div className="gene-option-list" aria-label="Transcript feature options">
          {filteredFeatures.length === 0 ? (
            <span className="option-empty">
              {geneSearchEmptyMessage(search, selected, { noun: 'features' })}
            </span>
          ) : (
            filteredFeatures.map((gene) => (
              <button
                key={gene}
                type="button"
                title={gene}
                onClick={() => {
                  if (features.onPick(gene)) {
                    setSearch('')
                  }
                }}
              >
                {gene}
              </button>
            ))
          )}
        </div>
      )}
    </>
  )
}

// Density colour and point colour.
export function TranscriptColourControls({ transcripts }: TranscriptsProps) {
  const densityInputId = useId()
  const pointInputId = useId()
  const densityScaleLabel = transcriptDensityScaleAriaLabel(transcripts.densityScaleMax)

  return (
    <>
      <label htmlFor={densityInputId}>Density color</label>
      <div className="transcript-density-scale-control">
        <select
          id={densityInputId}
          value={transcripts.densityColorScale}
          title="Transcript density color"
          onChange={(event) => {
            const nextScale = event.currentTarget.value

            if (isTranscriptDensityColorScale(nextScale)) {
              transcripts.onDensityColorScaleChange(nextScale)
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
          aria-label={densityScaleLabel}
          title={densityScaleLabel}
        >
          <span
            className="transcript-density-scale-preview"
            style={{
              backgroundImage: transcriptDensityScaleGradient(
                transcripts.densityColorScale,
              ),
            }}
            aria-hidden="true"
          />
          <span className="transcript-density-scale-values" aria-hidden="true">
            <span>{transcripts.densityScaleLabels[0]}</span>
            <span>{transcripts.densityScaleLabels[1]}</span>
            <span>{transcripts.densityScaleLabels[2]}</span>
          </span>
        </div>
      </div>

      <label htmlFor={pointInputId}>Point color</label>
      <select
        id={pointInputId}
        value={transcripts.pointColorMode}
        title="Transcript point color"
        onChange={(event) => {
          const nextMode = event.currentTarget.value

          if (isTranscriptPointColorMode(nextMode)) {
            transcripts.onPointColorModeChange(nextMode)
          }
        }}
      >
        {TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  )
}

// Min QV and gene-only calls.
export function TranscriptFilterControls({ transcripts }: TranscriptsProps) {
  const minQvInputId = useId()
  const geneOnlyInputId = useId()

  return (
    <>
      <div className="ui-label-row">
        <label htmlFor={minQvInputId}>Min QV</label>
        <InfoTip title="Min QV">{MIN_QV_HELP}</InfoTip>
      </div>
      <input
        id={minQvInputId}
        type="number"
        inputMode="numeric"
        min="0"
        max="40"
        step="1"
        value={transcripts.minQv}
        title="Transcript minimum QV"
        onChange={(event) => {
          transcripts.onMinQvChange(event.currentTarget.valueAsNumber)
        }}
      />

      <label className="dataset-toggle" htmlFor={geneOnlyInputId}>
        <input
          id={geneOnlyInputId}
          type="checkbox"
          checked={transcripts.geneOnly}
          disabled={!transcripts.geneOnlyFilterEnabled}
          title="Gene-only transcript calls"
          onChange={(event) => {
            transcripts.onGeneOnlyChange(event.currentTarget.checked)
          }}
        />
        <span>Gene-only calls</span>
      </label>
    </>
  )
}

// Transcript opacity and point size.
export function TranscriptPointStyleControls({ transcripts }: TranscriptsProps) {
  const opacityInputId = useId()
  const pointSizeInputId = useId()
  const opacityPercent = opacityToPercent(transcripts.opacity)

  return (
    <>
      <div className="layer-opacity-control">
        <div className="layer-opacity-header">
          <label htmlFor={opacityInputId}>Transcript opacity</label>
          <span>{opacityPercent}%</span>
        </div>
        <input
          id={opacityInputId}
          type="range"
          min="0"
          max="100"
          step="5"
          value={opacityPercent}
          aria-valuetext={`${opacityPercent}%`}
          title="Transcript opacity"
          onChange={(event) => {
            transcripts.onOpacityPercentChange(event.currentTarget.valueAsNumber)
          }}
        />
      </div>

      <div className="layer-opacity-control">
        <div className="layer-opacity-header">
          <label htmlFor={pointSizeInputId}>Point size</label>
          <span>{transcripts.pointSize}px</span>
        </div>
        <input
          id={pointSizeInputId}
          type="range"
          min="1"
          max="6"
          step="1"
          value={transcripts.pointSize}
          aria-valuetext={`${transcripts.pointSize}px`}
          title="Transcript point size"
          onChange={(event) => {
            transcripts.onPointSizeChange(event.currentTarget.valueAsNumber)
          }}
        />
      </div>
    </>
  )
}

// The layer status, and the hovered and pinned transcript unless
// showInspection is off (the Transcript card shows the pinned one).
export function TranscriptDetails({
  transcripts,
  showInspection = true,
}: TranscriptsProps & { readonly showInspection?: boolean }) {
  return (
    <TranscriptStatusPanel
      showInspection={showInspection}
      capabilityState={transcripts.capabilityState}
      layerState={transcripts.layerState}
      hoveredTranscript={transcripts.hoveredTranscript}
      pinnedTranscript={transcripts.pinnedTranscript}
      onPinTranscript={transcripts.onPinTranscript}
      onClearPinnedTranscript={transcripts.onClearPinnedTranscript}
      onLoadExactViewport={transcripts.onLoadExactViewport}
    />
  )
}
