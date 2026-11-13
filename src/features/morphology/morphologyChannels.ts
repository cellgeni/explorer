import type { ChannelHistogram } from '../../data/morphologyContrast'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'

export interface MorphologyChannelSetting {
  readonly id: string
  readonly enabled: boolean
  readonly color: readonly [number, number, number]
  readonly contrastMin: number
  readonly contrastMax: number
  readonly histogram?: ChannelHistogram
}

export function morphologyPatchLabel(
  patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
): string {
  if ('enabled' in patch) {
    return patch.enabled ? 'Channel enabled' : 'Channel disabled'
  }

  if ('color' in patch) {
    return 'Channel color'
  }

  if ('contrastMin' in patch || 'contrastMax' in patch) {
    return 'Channel contrast'
  }

  return 'Channel updated'
}

export function createMorphologyChannelSettings(
  image: MorphologyImage,
  options: { readonly enabledChannelIds?: readonly string[] } = {},
): readonly MorphologyChannelSetting[] {
  return createMorphologyChannelSettingsFromChannels(image.channelLoaders, options)
}

export function createMorphologyChannelSettingsFromChannels(
  channels: readonly MorphologyImageChannel[],
  options: { readonly enabledChannelIds?: readonly string[] } = {},
): readonly MorphologyChannelSetting[] {
  const enabledChannelIds =
    options.enabledChannelIds === undefined ? null : new Set(options.enabledChannelIds)

  return channels.map((channel, index) => ({
    id: channel.info.id,
    enabled:
      enabledChannelIds === null ? index === 0 : enabledChannelIds.has(channel.info.id),
    color: channel.info.color,
    contrastMin: channel.info.contrast.min,
    contrastMax: channel.info.contrast.max,
  }))
}

// Multiplexed images (QPTIFF, CODEX OME-TIFF) can have dozens of channels.
// Blending them all is unreadable and fetches tiles for every one, so an image
// with more channels than this opens with only the first few on, and only the
// channels that are on are auto-contrasted when it loads. Native RGB (H&E
// slides) is drawn without a window, so it is never auto-contrasted; doing so
// would decode every tile of the coarsest level on the main thread.
export const MAX_DEFAULT_ENABLED_CHANNELS = 6

export function defaultEnabledChannelIds(
  channels: readonly MorphologyImageChannel[],
): readonly string[] {
  return channels.slice(0, MAX_DEFAULT_ENABLED_CHANNELS).map((channel) => channel.info.id)
}

export function channelsToAutoContrastOnLoad(
  channels: readonly MorphologyImageChannel[],
  settings: readonly MorphologyChannelSetting[],
): readonly MorphologyImageChannel[] {
  const windowed = channels.filter((channel) => !isTrueColorChannel(channel))

  if (channels.length <= MAX_DEFAULT_ENABLED_CHANNELS) {
    return windowed
  }

  const enabledIds = new Set(
    settings.filter((setting) => setting.enabled).map((setting) => setting.id),
  )

  return windowed.filter((channel) => enabledIds.has(channel.info.id))
}

function isTrueColorChannel(channel: MorphologyImageChannel): boolean {
  return (channel.info.samplesPerPixel ?? 1) > 1
}

// A channel that was off when the image loaded still has the default window
// of its pixel type, which usually shows it nearly black. Native RGB keeps
// its full window.
export function needsAutoContrastOnEnable(
  channel: MorphologyImageChannel,
  setting: MorphologyChannelSetting | undefined,
): boolean {
  return (
    channel.info.alphaFromIntensity !== false &&
    setting?.histogram === undefined &&
    (setting?.contrastMin ?? channel.info.contrast.min) === channel.info.contrast.min &&
    (setting?.contrastMax ?? channel.info.contrast.max) === channel.info.contrast.max
  )
}

export function normalizeChannelContrast(options: {
  readonly min: number
  readonly max: number
}): { readonly lo: number; readonly hi: number } {
  const lo = Number.isFinite(options.min) ? options.min : 0
  const hi = Number.isFinite(options.max) ? options.max : lo + 1

  return hi > lo ? { lo, hi } : { lo, hi: lo + 1 }
}
