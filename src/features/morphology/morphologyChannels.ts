import type { ChannelHistogram } from '../../data/morphologyContrast'
import type { MorphologyImage } from '../../data/morphologyImage'

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
  const enabledChannelIds =
    options.enabledChannelIds === undefined ? null : new Set(options.enabledChannelIds)

  return image.channelLoaders.map((channel, index) => ({
    id: channel.info.id,
    enabled:
      enabledChannelIds === null ? index === 0 : enabledChannelIds.has(channel.info.id),
    color: channel.info.color,
    contrastMin: channel.info.contrast.min,
    contrastMax: channel.info.contrast.max,
  }))
}

export function normalizeChannelContrast(options: {
  readonly min: number
  readonly max: number
}): { readonly lo: number; readonly hi: number } {
  const lo = Number.isFinite(options.min) ? options.min : 0
  const hi = Number.isFinite(options.max) ? options.max : lo + 1

  return hi > lo ? { lo, hi } : { lo, hi: lo + 1 }
}
