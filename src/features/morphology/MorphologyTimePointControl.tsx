import { useId } from 'react'
import { morphologyTimePointLabel, type TimeSeriesSummary } from './morphologyTimePoint'

interface MorphologyTimePointControlProps {
  readonly timeSeries: TimeSeriesSummary
  // The time point being opened, shown until it replaces
  // `timeSeries.timePoint`.
  readonly requestedTimePoint: number | null
  readonly onTimePointChange: (timePoint: number) => void
}

// The dataset image's time point (plan 28), as the z plane control is.
export function MorphologyTimePointControl({
  timeSeries,
  requestedTimePoint,
  onTimePointChange,
}: MorphologyTimePointControlProps) {
  const inputId = useId()
  const timePoint = requestedTimePoint ?? timeSeries.timePoint
  const label = morphologyTimePointLabel(timeSeries, timePoint)

  return (
    <div
      className="layer-opacity-control time-point-control"
      aria-busy={requestedTimePoint !== null}
    >
      <div className="layer-opacity-header">
        <label htmlFor={inputId}>Time point</label>
        <span>{requestedTimePoint === null ? label : `${label} …`}</span>
      </div>
      <input
        id={inputId}
        type="range"
        min="0"
        max={timeSeries.sizeT - 1}
        step="1"
        value={timePoint}
        aria-valuetext={label}
        title="Time point"
        onChange={(event) => {
          onTimePointChange(event.currentTarget.valueAsNumber)
        }}
      />
    </div>
  )
}
