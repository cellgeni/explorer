import type { CSSProperties } from 'react'
import type { DataPoint } from '../data/coords'
import { scaleFromZoom } from '../data/coords'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { OverviewViewState } from '../rendering/deckLayers'

export const DEFAULT_MICROMETERS_PER_PIXEL = 0.2125

const SCALE_BAR_TARGET_WIDTH_PIXELS = 96
const SCALE_BAR_MIN_WIDTH_PIXELS = 44
const SCALE_BAR_MAX_VIEWPORT_RATIO = 0.5

export type ViewerDistanceUnit = 'um' | 'px'

export interface MeasurementLine {
  readonly start: DataPoint
  readonly end: DataPoint
}

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface ScaleBarModel {
  readonly label: string
  readonly widthPixels: number
}

export interface MeasurementOverlayModel {
  readonly start: ScreenPoint
  readonly end: ScreenPoint
  readonly label: string
  readonly labelStyle: CSSProperties
  readonly isDraft: boolean
}

export function rawDataPointToScreen(
  point: DataPoint,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): ScreenPoint {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  }
}

export function measurementOverlayModel(
  measurement: MeasurementLine & { readonly isDraft: boolean },
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  unit: ViewerDistanceUnit,
  micrometersPerPixel: number,
): MeasurementOverlayModel {
  const start = rawDataPointToScreen(measurement.start, viewState, viewport)
  const end = rawDataPointToScreen(measurement.end, viewState, viewport)
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }

  return {
    start,
    end,
    isDraft: measurement.isDraft,
    label: formatMeasurementDistance(
      measurementDistanceMicrometers(measurement),
      unit,
      micrometersPerPixel,
    ),
    labelStyle: {
      left: Math.max(8, Math.min(viewport.width - 8, midpoint.x)),
      top: Math.max(24, Math.min(viewport.height - 8, midpoint.y - 8)),
    },
  }
}

export function hasMinimumMeasurementDistance(
  measurement: MeasurementLine,
  viewState: OverviewViewState,
): boolean {
  return measurementDistanceMicrometers(measurement) * scaleFromZoom(viewState.zoom) >= 3
}

export function measurementDistanceMicrometers(measurement: MeasurementLine): number {
  return Math.hypot(
    measurement.end.x - measurement.start.x,
    measurement.end.y - measurement.start.y,
  )
}

export function formatMeasurementDistance(
  distanceMicrometers: number,
  unit: ViewerDistanceUnit,
  micrometersPerPixel: number,
): string {
  if (unit === 'px') {
    return `${formatScaleDistance(distanceMicrometers / safeMicrometersPerPixel(micrometersPerPixel))} px`
  }

  return `${formatScaleDistance(distanceMicrometers)} μm`
}

export function scaleBarModel(
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  unit: ViewerDistanceUnit,
  micrometersPerPixel: number,
): ScaleBarModel | null {
  const scale = scaleFromZoom(viewState.zoom)
  const targetWidthPixels = Math.max(
    SCALE_BAR_MIN_WIDTH_PIXELS,
    Math.min(
      SCALE_BAR_TARGET_WIDTH_PIXELS,
      viewport.width * SCALE_BAR_MAX_VIEWPORT_RATIO,
    ),
  )

  if (!Number.isFinite(scale) || scale <= 0 || targetWidthPixels <= 0) {
    return null
  }

  const pixelSize = safeMicrometersPerPixel(micrometersPerPixel)
  const unitMicrometers = unit === 'px' ? pixelSize : 1
  const rawUnitDistance = targetWidthPixels / (scale * unitMicrometers)
  const unitDistance = niceScaleDistance(rawUnitDistance)
  const widthPixels = unitDistance * unitMicrometers * scale

  return {
    label: `${formatScaleDistance(unitDistance)} ${unit === 'px' ? 'px' : 'μm'}`,
    widthPixels,
  }
}

export function safeMicrometersPerPixel(micrometersPerPixel: number): number {
  return Number.isFinite(micrometersPerPixel) && micrometersPerPixel > 0
    ? micrometersPerPixel
    : DEFAULT_MICROMETERS_PER_PIXEL
}

export function formatCoordinateValue(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
    useGrouping: false,
  })
}

function niceScaleDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) {
    return 1
  }

  const exponent = Math.floor(Math.log10(distance))
  const base = 10 ** exponent
  const normalizedDistance = distance / base
  const multiplier = normalizedDistance >= 5 ? 5 : normalizedDistance >= 2 ? 2 : 1

  return multiplier * base
}

function formatScaleDistance(distance: number): string {
  if (distance >= 100) {
    return Math.round(distance).toLocaleString()
  }

  if (distance >= 10) {
    return formatScaleDistanceWithPrecision(distance, 1)
  }

  if (distance >= 1) {
    return formatScaleDistanceWithPrecision(distance, 2)
  }

  const fractionDigits = Math.min(
    6,
    Math.max(2, Math.ceil(Math.abs(Math.log10(distance))) + 1),
  )

  return formatScaleDistanceWithPrecision(distance, fractionDigits)
}

function formatScaleDistanceWithPrecision(
  distance: number,
  fractionDigits: number,
): string {
  return Number(distance.toFixed(fractionDigits)).toLocaleString()
}
