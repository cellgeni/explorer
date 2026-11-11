import type { Dispatch, SetStateAction } from 'react'
import type { ViewerCoordinateUnit } from '../../components/ViewerCore'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'

// Viewer settings and the measure tool: Settings and the Measure tool's
// popover (UNIFIED_PLAN.md, 15.2-A).
export interface ViewSettingsModel {
  readonly showHoverTooltips: boolean
  readonly onShowHoverTooltipsChange: (enabled: boolean) => void
  // The minimap (15.4-D).
  readonly showMinimap: boolean
  readonly onShowMinimapChange: (enabled: boolean) => void
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly onCoordinateUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly measure: MeasureToolModel
}

export interface MeasureToolModel {
  readonly enabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
  readonly unit: ViewerCoordinateUnit
  readonly onUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly onClear: () => void
}

export interface ViewSettingsModelInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly handleMagicLensLeave: () => void
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly setCoordinateUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setMeasurementEnabled: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementResetKey: Dispatch<SetStateAction<number>>
  readonly setMeasurementUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setShowHoverTooltips: Dispatch<SetStateAction<boolean>>
  readonly setShowMinimap: Dispatch<SetStateAction<boolean>>
  readonly showHoverTooltips: boolean
  readonly showMinimap: boolean
}

export function useViewSettingsModel({
  appendDebugEvent,
  coordinateUnit,
  handleMagicLensLeave,
  measurementEnabled,
  measurementUnit,
  setCoordinateUnit,
  setMeasurementEnabled,
  setMeasurementResetKey,
  setMeasurementUnit,
  setShowHoverTooltips,
  setShowMinimap,
  showHoverTooltips,
  showMinimap,
}: ViewSettingsModelInput): ViewSettingsModel {
  return {
    showMinimap,
    onShowMinimapChange: (nextEnabled) => {
      if (showMinimap === nextEnabled) return

      setShowMinimap(nextEnabled)
      appendDebugEvent(nextEnabled ? 'Minimap shown' : 'Minimap hidden', {
        coalesceKey: 'minimap-visible',
      })
    },
    showHoverTooltips,
    onShowHoverTooltipsChange: (nextEnabled) => {
      if (showHoverTooltips === nextEnabled) {
        return
      }

      setShowHoverTooltips(nextEnabled)
      appendDebugEvent(
        nextEnabled ? 'Hover tooltips enabled' : 'Hover tooltips disabled',
        { coalesceKey: 'hover-tooltips-visible' },
      )
    },
    coordinateUnit,
    onCoordinateUnitChange: (nextUnit) => {
      if (coordinateUnit === nextUnit) {
        return
      }

      setCoordinateUnit(nextUnit)
      appendDebugEvent(`Mouse coordinates: ${nextUnit === 'um' ? 'µm' : 'px'}`, {
        coalesceKey: 'coordinate-unit',
      })
    },
    measure: {
      enabled: measurementEnabled,
      onEnabledChange: (nextEnabled) => {
        if (measurementEnabled === nextEnabled) {
          return
        }

        // Measuring replaces any other tool (activeTool, 15.1-G).
        setMeasurementEnabled(nextEnabled)

        if (nextEnabled) {
          handleMagicLensLeave()
        } else {
          setMeasurementResetKey((current) => current + 1)
        }

        appendDebugEvent(
          nextEnabled ? 'Distance measure enabled' : 'Distance measure disabled',
          { coalesceKey: 'measurement-mode' },
        )
      },
      unit: measurementUnit,
      onUnitChange: (nextUnit) => {
        if (measurementUnit === nextUnit) {
          return
        }

        setMeasurementUnit(nextUnit)
        appendDebugEvent(`Measure unit: ${nextUnit === 'um' ? 'µm' : 'px'}`, {
          coalesceKey: 'measurement-unit',
        })
      },
      onClear: () => {
        setMeasurementResetKey((current) => current + 1)
        appendDebugEvent('Distance measure cleared', {
          coalesceKey: 'measurement-clear',
        })
      },
    },
  }
}
