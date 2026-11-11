import { useId } from 'react'
import type { MeasureToolModel, ViewSettingsModel } from './viewSettingsModel'

export function HoverTooltipsToggle({
  settings,
}: {
  readonly settings: ViewSettingsModel
}) {
  const inputId = useId()

  return (
    <label htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={settings.showHoverTooltips}
        title="Toggle bin and cell hover tooltips"
        onChange={(event) => {
          settings.onShowHoverTooltipsChange(event.currentTarget.checked)
        }}
      />
      <span>Hover tooltips</span>
    </label>
  )
}

// The minimap at the bottom right of the canvas (15.4-D).
export function MinimapToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  const inputId = useId()

  return (
    <label htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={settings.showMinimap}
        title="Show the minimap at the bottom right of the canvas"
        onChange={(event) => {
          settings.onShowMinimapChange(event.currentTarget.checked)
        }}
      />
      <span>Show minimap</span>
    </label>
  )
}

// Rulers along the top and left edges of the canvas (15.4-E).
export function AxesToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  const inputId = useId()

  return (
    <label htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={settings.showAxes}
        title="Show rulers with coordinates along the top and left edges of the canvas"
        onChange={(event) => {
          settings.onShowAxesChange(event.currentTarget.checked)
        }}
      />
      <span>Show axes</span>
    </label>
  )
}

export function CoordinateUnitControl({
  settings,
}: {
  readonly settings: ViewSettingsModel
}) {
  const labelId = useId()

  return (
    <div className="coordinate-unit-control">
      <span id={labelId}>Mouse coordinates</span>
      <div className="coordinate-unit-segmented" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          aria-pressed={settings.coordinateUnit === 'um'}
          title="Show mouse coordinates in micrometers"
          onClick={() => {
            settings.onCoordinateUnitChange('um')
          }}
        >
          µm
        </button>
        <button
          type="button"
          aria-pressed={settings.coordinateUnit === 'px'}
          title="Show mouse coordinates in pixels"
          onClick={() => {
            settings.onCoordinateUnitChange('px')
          }}
        >
          px
        </button>
      </div>
    </div>
  )
}

// The measure unit and Clear Measurement: the Measure tool's popover.
export function MeasureToolOptions({ measure }: { readonly measure: MeasureToolModel }) {
  const unitLabelId = useId()

  return (
    <>
      <div className="coordinate-unit-control">
        <span id={unitLabelId}>Measure unit</span>
        <div
          className="coordinate-unit-segmented"
          role="group"
          aria-labelledby={unitLabelId}
        >
          <button
            type="button"
            aria-pressed={measure.unit === 'um'}
            title="Measure distances in micrometers"
            onClick={() => {
              measure.onUnitChange('um')
            }}
          >
            µm
          </button>
          <button
            type="button"
            aria-pressed={measure.unit === 'px'}
            title="Measure distances in pixels"
            onClick={() => {
              measure.onUnitChange('px')
            }}
          >
            px
          </button>
        </div>
      </div>
      <button
        type="button"
        className="secondary-action measurement-clear-action"
        title="Clear measurement"
        onClick={measure.onClear}
      >
        Clear Measurement
      </button>
    </>
  )
}
