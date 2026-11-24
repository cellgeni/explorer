import type { ImagePyramidLoader } from '../data/imagePyramid'
import type { MorphologyCanvasChannel } from './MorphologyCanvas'

// The channels a MorphologyCanvas draws: the enabled ones, or the loader's
// image in white when it is given no channels. A screenshot draws the same
// (plan 27).
export function visibleMorphologyChannels(
  loader: ImagePyramidLoader | null | undefined,
  channels: readonly MorphologyCanvasChannel[] | undefined,
): readonly MorphologyCanvasChannel[] {
  if (channels !== undefined && channels.length > 0) {
    return channels.filter((channel) => channel.enabled)
  }

  if (loader === null || loader === undefined) {
    return []
  }

  return [
    {
      id: loader.url,
      loader,
      enabled: true,
      color: [255, 255, 255],
      opacity: 1,
    },
  ]
}
