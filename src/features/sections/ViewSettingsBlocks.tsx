import { useId } from 'react'
import type { MeasureToolModel, ViewSettingsModel } from './viewSettingsModel'

export function HoverTooltipsToggle({
  settings,
}: {
  readonly settings: ViewSettingsModel
}) {
  return (
    <SettingsCheckbox
      label="Hover tooltips"
      title="Toggle bin and cell hover tooltips"
      checked={settings.showHoverTooltips}
      onChange={settings.onShowHoverTooltipsChange}
    />
  )
}

// The minimap at the bottom right of the canvas (15.4-D).
export function MinimapToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  return (
    <SettingsCheckbox
      label="Show minimap"
      title="Show the minimap at the bottom right of the canvas"
      checked={settings.showMinimap}
      onChange={settings.onShowMinimapChange}
    />
  )
}

// Rulers along the top and left edges of the canvas (15.4-E).
export function AxesToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  return (
    <SettingsCheckbox
      label="Show axes"
      title="Show rulers with coordinates along the top and left edges of the canvas"
      checked={settings.showAxes}
      onChange={settings.onShowAxesChange}
    />
  )
}

// Zoom out, Zoom in and Fit to view; the keys still work without them.
export function NavigationToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  return (
    <SettingsCheckbox
      label="Show navigation buttons"
      title="Show the Zoom out, Zoom in and Fit to view buttons at the bottom right of the canvas"
      checked={settings.showNavigation}
      onChange={settings.onShowNavigationChange}
    />
  )
}

export function LegendToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  return (
    <SettingsCheckbox
      label="Show legend"
      title="Show the legend at the bottom left of the canvas"
      checked={settings.showLegend}
      onChange={settings.onShowLegendChange}
    />
  )
}

export function ScaleBarToggle({ settings }: { readonly settings: ViewSettingsModel }) {
  return (
    <SettingsCheckbox
      label="Show scale bar"
      title="Show the scale bar at the bottom right of the canvas"
      checked={settings.showScaleBar}
      onChange={settings.onShowScaleBarChange}
    />
  )
}

function SettingsCheckbox({
  label,
  title,
  checked,
  onChange,
}: {
  readonly label: string
  readonly title: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  const inputId = useId()

  return (
    <label htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        title={title}
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
      <span>{label}</span>
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
