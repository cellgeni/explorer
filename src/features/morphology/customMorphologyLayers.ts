import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'

export interface CustomMorphologyLayer {
  readonly id: string
  readonly label: string
  readonly image: MorphologyImage
  readonly channels: readonly MorphologyImageChannel[]
}

export type CustomMorphologyLayerLoadState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export function createCustomMorphologyLayer(
  id: string,
  image: MorphologyImage,
): CustomMorphologyLayer {
  const label = customMorphologyLayerLabel(image.url)

  return {
    id,
    label,
    image,
    channels: prefixedCustomLayerChannels(id, label, image),
  }
}

export function customMorphologyLayerChannels(
  layers: readonly CustomMorphologyLayer[],
): readonly MorphologyImageChannel[] {
  return layers.flatMap((layer) => layer.channels)
}

export function customMorphologyLayerChannelIds(
  layer: CustomMorphologyLayer,
): readonly string[] {
  return layer.channels.map((channel) => channel.info.id)
}

export function isCustomMorphologyLayerChannelId(
  layerId: string,
  channelId: string,
): boolean {
  return channelId.startsWith(`${layerId}:`)
}

export function customMorphologyLayerLabel(url: string): string {
  const parsedUrl = new URL(url)
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
  const fileName = pathParts.at(-1)

  return fileName === undefined ? parsedUrl.hostname : decodeURIComponent(fileName)
}

function prefixedCustomLayerChannels(
  layerId: string,
  label: string,
  image: MorphologyImage,
): readonly MorphologyImageChannel[] {
  if (image.channelLoaders.length === 0) {
    return [
      {
        info: {
          id: `${layerId}:image`,
          index: 0,
          name: label,
          color: [255, 255, 255],
          contrast: { min: 0, max: 65_535 },
        },
        loader: image.loader,
      },
    ]
  }

  return image.channelLoaders.map((channel) => ({
    loader: channel.loader,
    info: {
      ...channel.info,
      id: `${layerId}:${channel.info.id}`,
      name: `${label} / ${channel.info.name}`,
    },
  }))
}
