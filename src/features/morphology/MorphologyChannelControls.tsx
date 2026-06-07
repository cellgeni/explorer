import type { ChannelHistogram } from '../../data/morphologyContrast'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from './morphologyChannels'

const EMPTY_HISTOGRAM_BINS = Array.from({ length: 32 }, () => 0)

interface MorphologyChannelControlsProps {
  readonly autoContrastChannelIds: readonly string[]
  readonly channels: readonly MorphologyImageChannel[]
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly settings: readonly MorphologyChannelSetting[]
  readonly onUpdate: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}

export function MorphologyChannelControls({
  autoContrastChannelIds,
  channels,
  onAutoContrast,
  settings,
  onUpdate,
}: MorphologyChannelControlsProps) {
  if (channels.length === 0) {
    return null
  }

  return (
    <div className="channel-controls" aria-label="Image channels">
      {channels.map((channel) => {
        const setting = settings.find((candidate) => candidate.id === channel.info.id)
        const color = setting?.color ?? channel.info.color
        const contrastMin = setting?.contrastMin ?? channel.info.contrast.min
        const contrastMax = setting?.contrastMax ?? channel.info.contrast.max
        const isAutoContrastLoading = autoContrastChannelIds.includes(channel.info.id)
        const histogram = setting?.histogram

        return (
          <div className="channel-control" key={channel.info.id}>
            <label className="channel-toggle">
              <input
                type="checkbox"
                checked={setting?.enabled ?? false}
                onChange={(event) => {
                  onUpdate(channel.info.id, { enabled: event.currentTarget.checked })
                }}
              />
              <span>{channel.info.name}</span>
            </label>
            <input
              className="channel-color"
              type="color"
              aria-label={`${channel.info.name} color`}
              value={rgbToHex(color)}
              onChange={(event) => {
                onUpdate(channel.info.id, { color: hexToRgb(event.currentTarget.value) })
              }}
            />
            <button
              className="channel-auto-button"
              type="button"
              aria-label={`${channel.info.name} auto contrast`}
              disabled={isAutoContrastLoading}
              onClick={() => {
                onAutoContrast(channel)
              }}
            >
              {isAutoContrastLoading ? '...' : 'Auto'}
            </button>
            <div className="channel-contrast">
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} minimum`}
                value={contrastMin}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMin: event.currentTarget.valueAsNumber,
                  })
                }}
              />
              <input
                type="number"
                inputMode="numeric"
                aria-label={`${channel.info.name} maximum`}
                value={contrastMax}
                onChange={(event) => {
                  onUpdate(channel.info.id, {
                    contrastMax: event.currentTarget.valueAsNumber,
                  })
                }}
              />
            </div>
            <ChannelHistogramView histogram={histogram} label={channel.info.name} />
          </div>
        )
      })}
    </div>
  )
}

function ChannelHistogramView({
  histogram,
  label,
}: {
  readonly histogram: ChannelHistogram | undefined
  readonly label: string
}) {
  const bins = histogram?.bins ?? EMPTY_HISTOGRAM_BINS
  const maxCount = histogram?.maxCount ?? 1

  return (
    <div
      className="channel-histogram"
      aria-label={`${label} histogram`}
      title={
        histogram === undefined
          ? `${label} histogram`
          : `${label} histogram, ${histogram.sampleCount.toLocaleString()} samples`
      }
    >
      {bins.map((count, index) => (
        <span
          className="channel-histogram-bar"
          key={index}
          style={{ transform: `scaleY(${Math.max(0.04, count / maxCount)})` }}
        />
      ))}
    </div>
  )
}

function rgbToHex(color: readonly [number, number, number]): string {
  return `#${color.map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = value.trim().replace(/^#/, '')

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return [255, 255, 255]
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
