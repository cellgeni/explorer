import type { Dispatch, SetStateAction } from 'react'
import type {
  MorphologyImageChannel,
  MorphologyImageZStack,
} from '../../data/morphologyImage'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'

// The dataset image: opacity, z plane, channels and custom image layers
// (UNIFIED_PLAN.md, 15.2-A). Opacities are 0–1; the controls show percent.
export interface ImageSectionModel {
  readonly opacity: number
  readonly onOpacityPercentChange: (percent: number) => void
  readonly zStack: MorphologyImageZStack | undefined
  readonly requestedZPlane: number | null
  readonly onZPlaneChange: (zPlane: number) => void
  readonly channels: readonly MorphologyImageChannel[]
  readonly channelSettings: readonly MorphologyChannelSetting[]
  readonly autoContrastChannelIds: readonly string[]
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly onUpdateChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
  readonly customLayers: CustomImageLayersModel
}

export interface CustomImageLayersModel {
  // A dataset is loaded, so layers can be added.
  readonly loadEnabled: boolean
  readonly layers: readonly CustomMorphologyLayer[]
  readonly loadState: CustomMorphologyLayerLoadState
  // By image URL.
  readonly opacities: Readonly<Record<string, number>>
  // Resolves true when the layer loaded.
  readonly onLoad: (url: string) => Promise<boolean>
  readonly onRemove: (layerId: string) => void
  readonly onOpacityPercentChange: (imageUrl: string, percent: number) => void
}

export interface ImageSectionModelInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly autoContrastChannelIds: readonly string[]
  readonly customLayerLoadState: CustomMorphologyLayerLoadState
  readonly customLayerOpacities: Readonly<Record<string, number>>
  readonly customLayers: readonly CustomMorphologyLayer[]
  readonly handleAutoContrast: (channel: MorphologyImageChannel) => void
  readonly handleLoadCustomLayer: (url: string) => Promise<boolean>
  readonly handleRemoveCustomLayer: (layerId: string) => void
  readonly imageLayerOpacity: number
  readonly loadEnabled: boolean
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly morphologyZStack: MorphologyImageZStack | undefined
  readonly requestedMorphologyZPlane: number | null
  readonly selectMorphologyZPlane: (zPlane: number) => void
  readonly setCustomLayerOpacity: (imageUrl: string, opacity: number) => void
  readonly setImageLayerOpacity: Dispatch<SetStateAction<number>>
  readonly updateMorphologyChannel: ImageSectionModel['onUpdateChannel']
}

export function useImageSectionModel({
  appendDebugEvent,
  autoContrastChannelIds,
  customLayerLoadState,
  customLayerOpacities,
  customLayers,
  handleAutoContrast,
  handleLoadCustomLayer,
  handleRemoveCustomLayer,
  imageLayerOpacity,
  loadEnabled,
  morphologyChannelSettings,
  morphologyChannels,
  morphologyZStack,
  requestedMorphologyZPlane,
  selectMorphologyZPlane,
  setCustomLayerOpacity,
  setImageLayerOpacity,
  updateMorphologyChannel,
}: ImageSectionModelInput): ImageSectionModel {
  return {
    opacity: imageLayerOpacity,
    onOpacityPercentChange: (nextPercent) => {
      setImageLayerOpacity(percentToOpacity(nextPercent))
      appendDebugEvent(`Dataset image opacity: ${nextPercent}%`, {
        coalesceKey: 'image-opacity',
      })
    },
    zStack: morphologyZStack,
    requestedZPlane: requestedMorphologyZPlane,
    onZPlaneChange: selectMorphologyZPlane,
    channels: morphologyChannels,
    channelSettings: morphologyChannelSettings,
    autoContrastChannelIds,
    onAutoContrast: handleAutoContrast,
    onUpdateChannel: updateMorphologyChannel,
    customLayers: {
      loadEnabled,
      layers: customLayers,
      loadState: customLayerLoadState,
      opacities: customLayerOpacities,
      onLoad: handleLoadCustomLayer,
      onRemove: handleRemoveCustomLayer,
      onOpacityPercentChange: (imageUrl, nextPercent) => {
        setCustomLayerOpacity(imageUrl, percentToOpacity(nextPercent))
        appendDebugEvent(`Custom image opacity: ${nextPercent}%`, {
          coalesceKey: `custom-image-opacity:${imageUrl}`,
        })
      },
    },
  }
}
