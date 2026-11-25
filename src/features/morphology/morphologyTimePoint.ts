import type { MorphologyImageTimeSeries } from '../../data/morphologyImage'

export type TimeSeriesSummary = Pick<
  MorphologyImageTimeSeries,
  'sizeT' | 'timePoint' | 'timeStep'
>

// One-based position, plus the time since the first point when the time axis
// has a unit (plan 28-D3): "22 / 40 · 31.5 min".
export function morphologyTimePointLabel(
  timeSeries: Pick<TimeSeriesSummary, 'sizeT' | 'timeStep'>,
  timePoint: number,
): string {
  const position = `${(timePoint + 1).toString()} / ${timeSeries.sizeT.toString()}`

  if (timeSeries.timeStep === undefined) {
    return position
  }

  const elapsed = Number((timePoint * timeSeries.timeStep.value).toFixed(2))

  return `${position} · ${elapsed.toLocaleString()} ${timeSeries.timeStep.unit}`
}
