import type { Color } from '@deck.gl/core'

type ColorStop = readonly [number, number, number, number]

const TRANSCRIPT_FEATURE_PALETTE: readonly Color[] = [
  [76, 211, 194, 235],
  [248, 197, 80, 235],
  [231, 97, 126, 235],
  [147, 197, 253, 235],
  [167, 139, 250, 235],
  [132, 204, 22, 235],
  [251, 146, 60, 235],
  [244, 114, 182, 235],
]

export function transcriptFeatureColor(featureName: string): Color {
  let hash = 0

  for (let index = 0; index < featureName.length; index += 1) {
    hash = (hash * 31 + featureName.charCodeAt(index)) >>> 0
  }

  return (
    TRANSCRIPT_FEATURE_PALETTE[hash % TRANSCRIPT_FEATURE_PALETTE.length] ?? [
      76, 211, 194, 235,
    ]
  )
}

export function transcriptQualityColor(qv: number): Color {
  const t = Math.max(0, Math.min(1, qv / 40))
  return interpolateColorStops(
    [127, 77, 35, 170],
    [221, 127, 75, 215],
    [58, 176, 145, 245],
    Math.sqrt(t),
  )
}

function interpolateColorStops(
  lowStop: ColorStop,
  middleStop: ColorStop,
  highStop: ColorStop,
  intensity: number,
): Color {
  const normalizedIntensity = Math.min(1, Math.max(0, intensity))
  const startStop = normalizedIntensity <= 0.5 ? lowStop : middleStop
  const endStop = normalizedIntensity <= 0.5 ? middleStop : highStop
  const t =
    normalizedIntensity <= 0.5 ? normalizedIntensity * 2 : (normalizedIntensity - 0.5) * 2

  return [
    interpolateColorChannel(startStop[0], endStop[0], t),
    interpolateColorChannel(startStop[1], endStop[1], t),
    interpolateColorChannel(startStop[2], endStop[2], t),
    interpolateColorChannel(startStop[3], endStop[3], t),
  ]
}

function interpolateColorChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}
