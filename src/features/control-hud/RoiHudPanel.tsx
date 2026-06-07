import type { RoiDrawMode } from '../../components/ViewerCore'
import { RoiGeneStatsPanel } from '../roi/RoiPanels'
import type {
  RoiGeneStatsState,
  RoiState,
  RoiSummary,
  RoiTranscriptExportState,
} from '../roi/roiModel'

interface RoiHudPanelProps {
  readonly active: boolean
  readonly roiNameInputId: string
  readonly roiHeaderCopy: string
  readonly isLoading: boolean
  readonly canDrawRoi: boolean
  readonly roiMode: RoiDrawMode
  readonly roiName: string
  readonly loadEnabled: boolean
  readonly roiState: RoiState
  readonly roiSummary: RoiSummary | null
  readonly roiGeneStatsCopy: string
  readonly roiGeneStatsState: RoiGeneStatsState
  readonly roiTranscriptExportState: RoiTranscriptExportState
  readonly onRoiModeChange: (mode: RoiDrawMode) => void
  readonly onClearRoi: () => void
  readonly onRoiNameChange: (name: string) => void
  readonly onSaveRoiAnnotation: () => void
  readonly onExportRoiCells: () => void
  readonly onExportRoiTranscripts: () => void
}

export function RoiHudPanel({
  active,
  roiNameInputId,
  roiHeaderCopy,
  isLoading,
  canDrawRoi,
  roiMode,
  roiName,
  loadEnabled,
  roiState,
  roiSummary,
  roiGeneStatsCopy,
  roiGeneStatsState,
  roiTranscriptExportState,
  onRoiModeChange,
  onClearRoi,
  onRoiNameChange,
  onSaveRoiAnnotation,
  onExportRoiCells,
  onExportRoiTranscripts,
}: RoiHudPanelProps) {
  return (
    <div
      id="hud-panel-roi"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-roi"
      hidden={!active}
    >
      <section className="analysis-section" aria-labelledby="roi-heading">
        <div className="section-heading-row">
          <h2 id="roi-heading">ROI</h2>
          <span
            className={isLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {roiHeaderCopy}
          </span>
        </div>
        <div className="roi-action-row">
          <button
            type="button"
            className="secondary-action"
            disabled={!canDrawRoi}
            aria-pressed={roiMode === 'box'}
            onClick={() => {
              onRoiModeChange(roiMode === 'box' ? 'idle' : 'box')
            }}
          >
            {roiMode === 'box' ? 'Drawing Box' : 'Draw Box'}
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={!canDrawRoi}
            aria-pressed={roiMode === 'lasso'}
            onClick={() => {
              onRoiModeChange(roiMode === 'lasso' ? 'idle' : 'lasso')
            }}
          >
            {roiMode === 'lasso' ? 'Drawing Lasso' : 'Draw Lasso'}
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={roiState.status === 'idle'}
            onClick={onClearRoi}
          >
            Clear
          </button>
        </div>

        <label htmlFor={roiNameInputId}>ROI name</label>
        <input
          id={roiNameInputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={roiName}
          disabled={!loadEnabled}
          onChange={(event) => {
            onRoiNameChange(event.currentTarget.value)
          }}
        />

        {roiSummary === null ? null : (
          <dl className="roi-summary-list" aria-label="ROI summary">
            <div>
              <dt>Cells</dt>
              <dd>
                {roiSummary.cellCount.toLocaleString()}
                {roiState.status === 'ready' && roiState.hitCellLimit ? '+' : ''}
              </dd>
            </div>
            <div>
              <dt>Mean transcripts</dt>
              <dd>{formatNumber(roiSummary.meanTranscriptCount)}</dd>
            </div>
            <div>
              <dt>Mean area</dt>
              <dd>{formatNumber(roiSummary.meanCellArea)}</dd>
            </div>
          </dl>
        )}

        <RoiGeneStatsPanel copy={roiGeneStatsCopy} state={roiGeneStatsState} />

        <div className="roi-action-row">
          <button
            type="button"
            className="secondary-action"
            disabled={roiState.status !== 'ready'}
            onClick={onSaveRoiAnnotation}
          >
            Save ROI
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={roiState.status !== 'ready'}
            onClick={onExportRoiCells}
          >
            Export Cells
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={
              roiState.status !== 'ready' || roiTranscriptExportState.status === 'loading'
            }
            onClick={onExportRoiTranscripts}
          >
            {roiTranscriptExportState.status === 'loading'
              ? 'Exporting...'
              : 'Export Transcripts'}
          </button>
        </div>
        {roiTranscriptExportState.status === 'loading' ? (
          <p className="roi-gene-status" aria-live="polite">
            Preparing ROI transcript CSV
          </p>
        ) : null}
      </section>
    </div>
  )
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
