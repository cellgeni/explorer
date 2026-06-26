import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'

const RGB_CHANNELS = [
  { name: 'Red', color: [255, 0, 0] },
  { name: 'Green', color: [0, 255, 0] },
  { name: 'Blue', color: [0, 0, 255] },
] as const

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

export const IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE: CustomMorphologyLayerLoadState<never> =
  { status: 'idle' }

export function customMorphologyLayerLoadStarted(
  url: string,
): CustomMorphologyLayerLoadState<never> {
  return { status: 'loading', url }
}

export function customMorphologyLayerLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): CustomMorphologyLayerLoadState<ErrorType> {
  return { status: 'error', url, error }
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

export function customMorphologyLayerDefaultEnabledChannelIds(
  layer: CustomMorphologyLayer,
): readonly string[] {
  if (isNativeRgbCustomMorphologyLayer(layer)) {
    return layer.channels.map((channel) => channel.info.id)
  }

  const firstChannelId = layer.channels[0]?.info.id
  return firstChannelId === undefined ? [] : [firstChannelId]
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
  if (isNativeRgbCustomMorphologyImage(image)) {
    return image.channelLoaders.map((channel, index) => {
      const rgbChannel = RGB_CHANNELS[index]

      return {
        loader: channel.loader,
        info: {
          ...channel.info,
          id: `${layerId}:${channel.info.id}`,
          name:
            rgbChannel === undefined
              ? `${label} / ${channel.info.name}`
              : `${label} / ${rgbChannel.name}`,
          color: rgbChannel?.color ?? channel.info.color,
          alphaFromIntensity: false,
        },
      }
    })
  }

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

function isNativeRgbCustomMorphologyLayer(layer: CustomMorphologyLayer): boolean {
  return (
    layer.channels.length === RGB_CHANNELS.length &&
    layer.channels.every(
      (channel, index) =>
        channel.info.alphaFromIntensity === false &&
        colorsEqual(channel.info.color, RGB_CHANNELS[index]?.color),
    )
  )
}

function isNativeRgbCustomMorphologyImage(image: MorphologyImage): boolean {
  return (
    image.channelLoaders.length === RGB_CHANNELS.length &&
    image.channelLoaders.every((channel, index) => {
      const expectedName = `channel ${index + 1}`

      return (
        channel.info.contrast.min === 0 &&
        channel.info.contrast.max === 255 &&
        channelFileNameMatchesImage(image.url, channel.info.fileName) &&
        channel.info.name.trim().toLowerCase() === expectedName &&
        (channel.info.ifdIndex === undefined || channel.info.ifdIndex === index)
      )
    })
  )
}

function channelFileNameMatchesImage(
  imageUrl: string,
  fileName: string | undefined,
): boolean {
  if (fileName === undefined) {
    return true
  }

  const channelUrl = new URL(fileName, imageUrl)
  const sourceUrl = new URL(imageUrl)
  channelUrl.hash = ''
  sourceUrl.hash = ''
  return channelUrl.toString() === sourceUrl.toString()
}

function colorsEqual(
  left: readonly [number, number, number],
  right: readonly [number, number, number] | undefined,
): boolean {
  return (
    right !== undefined &&
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2]
  )
}
