import { micrometers } from '../data/coords'
import {
  morphologyViewportBbox,
  type CssViewportSize,
} from '../rendering/morphologyCanvas'
import type { OverviewViewState } from '../rendering/deckLayerTypes'
import {
  rawDataPointToScreen,
  safeMicrometersPerPixel,
  type ViewerDistanceUnit,
} from './viewerMeasurements'

// µm axes (plan 15.4-E): rulers along the top and left edges of
// the canvas with the data coordinates, in the scale bar's unit. The bottom
// edge holds the legend, the readout and the zoom buttons.

// Ticks at least this far apart, at 1, 2 or 5 × 10ⁿ, so labels fit.
export const AXIS_TICK_SPACING_PIXELS = 80
// The rulers' depth; ticks under the corner, or at the far edge, are left
// out. The top ruler ends with the unit.
export const AXIS_BAND_PIXELS = 20
const AXIS_EDGE_MARGIN_PIXELS = 12
const AXIS_UNIT_MARGIN_PIXELS = 48

export interface AxisTick {
  // Along the axis, in canvas px.
  readonly position: number
  readonly label: string
}

export interface AxesModel {
  readonly x: readonly AxisTick[]
  readonly y: readonly AxisTick[]
  // "µm", "px" or "units".
  readonly unitLabel: string
}

export function viewerAxesModel(
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  unit: ViewerDistanceUnit,
  micrometersPerPixel: number,
  physicalUnitLabel = 'µm',
): AxesModel | null {
  const scale = 2 ** viewState.zoom
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null
  }

  const unitMicrometers = unit === 'px' ? safeMicrometersPerPixel(micrometersPerPixel) : 1
  const step = niceStepAtLeast(AXIS_TICK_SPACING_PIXELS / (scale * unitMicrometers))
  const bbox = morphologyViewportBbox(viewState, viewport)
  const label = (value: number) => formatAxisValue(value, step)

  const inside = (size: number, endMargin: number) => (tick: AxisTick) =>
    tick.position >= AXIS_BAND_PIXELS + AXIS_EDGE_MARGIN_PIXELS &&
    tick.position <= size - endMargin

  return {
    x: axisValues(bbox.minX / unitMicrometers, bbox.maxX / unitMicrometers, step)
      .map((value) => ({
        position: rawDataPointToScreen(
          { x: micrometers(value * unitMicrometers), y: bbox.minY },
          viewState,
          viewport,
        ).x,
        label: label(value),
      }))
      .filter(inside(viewport.width, AXIS_UNIT_MARGIN_PIXELS)),
    y: axisValues(bbox.minY / unitMicrometers, bbox.maxY / unitMicrometers, step)
      .map((value) => ({
        position: rawDataPointToScreen(
          { x: bbox.minX, y: micrometers(value * unitMicrometers) },
          viewState,
          viewport,
        ).y,
        label: label(value),
      }))
      .filter(inside(viewport.height, AXIS_EDGE_MARGIN_PIXELS)),
    unitLabel: unit === 'px' ? 'px' : physicalUnitLabel,
  }
}

// The smallest 1, 2 or 5 × 10ⁿ at least this large.
export function niceStepAtLeast(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 1

  const base = 10 ** Math.floor(Math.log10(distance))
  const normalized = distance / base
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10

  return Number((multiplier * base).toPrecision(12))
}

// Multiples of step from min to max.
function axisValues(min: number, max: number, step: number): readonly number[] {
  const values: number[] = []
  const first = Math.ceil(min / step)
  const last = Math.floor(max / step)

  // A view far wider than the step would mean a runaway list.
  if (last - first > 200) return values

  for (let index = first; index <= last; index += 1) {
    // Rounded, so 0.1 × 3 reads 0.3.
    values.push(Number((index * step).toPrecision(12)))
  }

  return values
}

// "12,000", "1.5", "0.25": as many decimals as the step needs.
export function formatAxisValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)))
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
