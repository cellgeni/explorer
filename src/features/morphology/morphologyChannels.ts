import type { ChannelHistogram } from '../../data/morphologyContrast'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import type { DatasetManifestChannelSetting } from '../../datasets/datasetManifest'

export interface MorphologyChannelSetting {
  readonly id: string
  readonly enabled: boolean
  readonly color: readonly [number, number, number]
  readonly contrastMin: number
  readonly contrastMax: number
  readonly histogram?: ChannelHistogram
  // The dataset manifest or collection set the window, so it is not
  // auto-contrasted when the image loads or the channel is turned on.
  readonly contrastSet?: true
}

// Channel colours and windows a dataset manifest or collection sets, by
// channel name (any case) or ID.
export type MorphologyChannelDefaults = Readonly<
  Record<string, DatasetManifestChannelSetting>
>

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

interface CreateMorphologyChannelSettingsOptions {
  readonly enabledChannelIds?: readonly string[]
  readonly channelDefaults?: MorphologyChannelDefaults
}

export function createMorphologyChannelSettings(
  image: MorphologyImage,
  options: CreateMorphologyChannelSettingsOptions = {},
): readonly MorphologyChannelSetting[] {
  return createMorphologyChannelSettingsFromChannels(image.channelLoaders, options)
}

export function createMorphologyChannelSettingsFromChannels(
  channels: readonly MorphologyImageChannel[],
  options: CreateMorphologyChannelSettingsOptions = {},
): readonly MorphologyChannelSetting[] {
  const enabledChannelIds =
    options.enabledChannelIds === undefined ? null : new Set(options.enabledChannelIds)

  return channels.map((channel, index) => {
    const defaults = channelDefaultsFor(channel, options.channelDefaults)

    return {
      id: channel.info.id,
      enabled:
        enabledChannelIds === null ? index === 0 : enabledChannelIds.has(channel.info.id),
      color: defaults?.color ?? channel.info.color,
      ...(defaults?.contrast === undefined
        ? {
            contrastMin: channel.info.contrast.min,
            contrastMax: channel.info.contrast.max,
          }
        : {
            contrastMin: defaults.contrast[0],
            contrastMax: defaults.contrast[1],
            contrastSet: true,
          }),
    }
  })
}

// A channel's entry by its ID, else by its name in any case.
function channelDefaultsFor(
  channel: MorphologyImageChannel,
  defaults: MorphologyChannelDefaults | undefined,
): DatasetManifestChannelSetting | undefined {
  if (defaults === undefined) {
    return undefined
  }

  const name = channel.info.name.toLowerCase()

  return (
    defaults[channel.info.id] ??
    Object.entries(defaults).find(([key]) => key.toLowerCase() === name)?.[1]
  )
}

// The names and IDs of the settings that match no channel.
export function unmatchedMorphologyChannelDefaults(
  channels: readonly MorphologyImageChannel[],
  defaults: MorphologyChannelDefaults | undefined,
): readonly string[] {
  return Object.keys(defaults ?? {}).filter(
    (key) =>
      !channels.some(
        (channel) =>
          channel.info.id === key ||
          channel.info.name.toLowerCase() === key.toLowerCase(),
      ),
  )
}

// A collection's settings over the dataset manifest's, channel by channel.
export function mergeMorphologyChannelDefaults(
  manifest: MorphologyChannelDefaults | undefined,
  collection: MorphologyChannelDefaults | undefined,
): MorphologyChannelDefaults | undefined {
  if (manifest === undefined || collection === undefined) {
    return collection ?? manifest
  }

  const collectionNames = new Set(Object.keys(collection).map((key) => key.toLowerCase()))

  return {
    ...Object.fromEntries(
      Object.entries(manifest).filter(([key]) => !collectionNames.has(key.toLowerCase())),
    ),
    ...collection,
  }
}

// Multiplexed images (QPTIFF, CODEX OME-TIFF) can have dozens of channels.
// Blending them all is unreadable and fetches tiles for every one, so an image
// with more channels than this opens with only the first few on, and only the
// channels that are on are auto-contrasted when it loads. Native RGB (H&E
// slides) is drawn without a window, so it is never auto-contrasted; doing so
// would decode every tile of the coarsest level on the main thread. Nor are
// channels whose window a dataset manifest or collection sets.
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
  const setIds = new Set(
    settings
      .filter((setting) => setting.contrastSet === true)
      .map((setting) => setting.id),
  )
  const unset = windowed.filter((channel) => !setIds.has(channel.info.id))

  if (channels.length <= MAX_DEFAULT_ENABLED_CHANNELS) {
    return unset
  }

  const enabledIds = new Set(
    settings.filter((setting) => setting.enabled).map((setting) => setting.id),
  )

  return unset.filter((channel) => enabledIds.has(channel.info.id))
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
    setting?.contrastSet !== true &&
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
