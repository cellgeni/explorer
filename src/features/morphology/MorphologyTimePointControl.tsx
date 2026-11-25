import { useId } from 'react'
import { Checkbox, IconButton, PauseIcon, PlayIcon, Select } from '../../components/ui'
import { morphologyTimePointLabel, type TimeSeriesSummary } from './morphologyTimePoint'
import { TIME_POINT_SPEEDS } from './useTimePointPlayback'

// Play, Speed and Loop (plan 28-D7).
export interface TimePointPlaybackControls {
  readonly playing: boolean
  readonly speed: number
  readonly loop: boolean
  readonly onPlayingChange: (playing: boolean) => void
  readonly onSpeedChange: (speed: number) => void
  readonly onLoopChange: (loop: boolean) => void
}

interface MorphologyTimePointControlProps {
  readonly timeSeries: TimeSeriesSummary
  // The time point being opened, shown until it replaces
  // `timeSeries.timePoint`.
  readonly requestedTimePoint: number | null
  // False while the canvas still shows another time point (28-D6).
  readonly frameShown?: boolean
  readonly onTimePointChange: (timePoint: number) => void
  // Left out where Play is not offered: the 3D view (28-D11).
  readonly playback?: TimePointPlaybackControls | null
}

const SPEED_OPTIONS = TIME_POINT_SPEEDS.map((speed) => ({
  value: speed.toString(),
  label: `${speed.toString()} per second`,
}))

// The dataset image's time point (plan 28), as the z plane control is.
export function MorphologyTimePointControl({
  timeSeries,
  requestedTimePoint,
  frameShown = true,
  onTimePointChange,
  playback = null,
}: MorphologyTimePointControlProps) {
  const inputId = useId()
  const timePoint = requestedTimePoint ?? timeSeries.timePoint
  const label = morphologyTimePointLabel(timeSeries, timePoint)
  const busy = requestedTimePoint !== null || !frameShown

  return (
    <div className="layer-opacity-control time-point-control" aria-busy={busy}>
      <div className="layer-opacity-header">
        <label htmlFor={inputId}>Time point</label>
        <span>{busy ? `${label} …` : label}</span>
      </div>
      <div className="time-point-slider-row">
        {playback === null ? null : (
          <IconButton
            title={playback.playing ? 'Pause time points' : 'Play time points'}
            icon={playback.playing ? <PauseIcon /> : <PlayIcon />}
            className="time-point-play"
            onClick={() => {
              playback.onPlayingChange(!playback.playing)
            }}
          />
        )}
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
      {playback === null ? null : (
        <div className="time-point-play-options">
          <Select
            title="Time points shown a second while playing"
            label="Speed"
            value={playback.speed.toString()}
            options={SPEED_OPTIONS}
            className="ui-field--inline"
            onChange={(value) => {
              playback.onSpeedChange(Number(value))
            }}
          />
          <Checkbox
            title="Start again from the first time point after the last"
            label="Loop"
            checked={playback.loop}
            onChange={playback.onLoopChange}
          />
        </div>
      )}
    </div>
  )
}
