export const DEFAULT_LAYER_OPACITY = 1

export function normalizeLayerOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LAYER_OPACITY
  }

  return Math.min(1, Math.max(0, value))
}

export function opacityToPercent(value: number): number {
  return Math.round(normalizeLayerOpacity(value) * 100)
}

export function percentToOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LAYER_OPACITY
  }

  return normalizeLayerOpacity(value / 100)
}
