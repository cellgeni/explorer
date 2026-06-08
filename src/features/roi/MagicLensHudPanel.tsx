import { MagicLensPanel } from './RoiPanels'
import type { MagicLensScope, MagicLensState } from './magicLensModel'

interface MagicLensHudPanelProps {
  readonly active: boolean
  readonly magicLensScopeInputId: string
  readonly magicLensRadiusInputId: string
  readonly magicLensMinQvInputId: string
  readonly magicLensCopy: string
  readonly loadEnabled: boolean
  readonly roiAvailable: boolean
  readonly magicLensScope: MagicLensScope
  readonly magicLensState: MagicLensState
  readonly magicLensRadiusMicrometers: number
  readonly magicLensMinQv: number
  readonly magicLensIsCursorActive: boolean
  readonly magicLensCanScan: boolean
  readonly onScopeChange: (scope: MagicLensScope) => void
  readonly onRadiusChange: (radiusMicrometers: number) => void
  readonly onMinQvChange: (minQv: number) => void
  readonly onCursorActiveChange: (active: boolean) => void
  readonly onRunMagicLens: () => void
}

export function MagicLensHudPanel({
  active,
  magicLensScopeInputId,
  magicLensRadiusInputId,
  magicLensMinQvInputId,
  magicLensCopy,
  loadEnabled,
  roiAvailable,
  magicLensScope,
  magicLensState,
  magicLensRadiusMicrometers,
  magicLensMinQv,
  magicLensIsCursorActive,
  magicLensCanScan,
  onScopeChange,
  onRadiusChange,
  onMinQvChange,
  onCursorActiveChange,
  onRunMagicLens,
}: MagicLensHudPanelProps) {
  return (
    <div
      id="hud-panel-magic-lens"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-magic-lens"
      hidden={!active}
    >
      <section
        className="analysis-section magic-lens-section"
        aria-labelledby="magic-lens-heading"
      >
        <div className="section-heading-row">
          <h2 id="magic-lens-heading">Magic Lens</h2>
          <span
            className={
              magicLensState.status === 'loading'
                ? 'status-chip is-loading'
                : 'status-chip'
            }
            aria-live="polite"
          >
            {magicLensCopy}
          </span>
        </div>

        <div className="magic-lens-scope">
          <span id={magicLensScopeInputId}>Scope</span>
          <div
            className="magic-lens-scope-segmented"
            role="group"
            aria-labelledby={magicLensScopeInputId}
          >
            <button
              type="button"
              aria-pressed={magicLensScope === 'cursor'}
              onClick={() => {
                onScopeChange('cursor')
              }}
            >
              Cursor
            </button>
            <button
              type="button"
              aria-pressed={magicLensScope === 'viewport'}
              onClick={() => {
                onScopeChange('viewport')
              }}
            >
              Viewport
            </button>
            <button
              type="button"
              aria-pressed={magicLensScope === 'roi'}
              disabled={!roiAvailable}
              onClick={() => {
                onScopeChange('roi')
              }}
            >
              ROI
            </button>
          </div>
        </div>

        <label htmlFor={magicLensRadiusInputId}>Radius</label>
        <div className="magic-lens-radius-control">
          <input
            id={magicLensRadiusInputId}
            type="range"
            min="10"
            max="500"
            step="10"
            value={magicLensRadiusMicrometers}
            disabled={magicLensScope !== 'cursor'}
            onChange={(event) => {
              onRadiusChange(event.currentTarget.valueAsNumber)
            }}
          />
          <output htmlFor={magicLensRadiusInputId}>
            {magicLensRadiusMicrometers.toLocaleString()} um
          </output>
        </div>

        <label htmlFor={magicLensMinQvInputId}>Min QV</label>
        <input
          id={magicLensMinQvInputId}
          type="number"
          inputMode="numeric"
          min="0"
          max="40"
          step="1"
          value={magicLensMinQv}
          onChange={(event) => {
            onMinQvChange(event.currentTarget.valueAsNumber)
          }}
        />

        {magicLensScope === 'cursor' ? (
          <button
            type="button"
            className="secondary-action"
            aria-pressed={magicLensIsCursorActive}
            disabled={!loadEnabled}
            onClick={() => {
              onCursorActiveChange(!magicLensIsCursorActive)
            }}
          >
            {magicLensIsCursorActive ? 'Disable Lens' : 'Enable Lens'}
          </button>
        ) : (
          <button
            type="button"
            className="secondary-action"
            disabled={!magicLensCanScan}
            onClick={onRunMagicLens}
          >
            {magicLensState.status === 'loading' ? 'Scanning...' : 'Scan Lens'}
          </button>
        )}

        <MagicLensPanel state={magicLensState} />
      </section>
    </div>
  )
}
