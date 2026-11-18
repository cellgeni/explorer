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
// (plan 15.2-A). Opacities are 0–1; the controls show percent.
export interface ImageSectionModel {
  readonly opacity: number
  readonly onOpacityPercentChange: (percent: number) => void
  readonly zStack: MorphologyImageZStack | undefined
  readonly requestedZPlane: number | null
  readonly onZPlaneChange: (zPlane: number) => void
  // Set when the dataset image is a z-stack the 3D view can show.
  readonly volumeView: ImageVolumeViewModel | null
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

export interface ImageVolumeViewModel {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
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
  readonly volumeViewAvailable: boolean
  readonly volumeViewOpen: boolean
  readonly setVolumeViewOpen: (open: boolean) => void
}

// The Image section's View: one z plane at a time, or the 3D view.
export type ImageView = '2d' | '3d'

export function parseImageView(value: string | undefined): ImageView | undefined {
  return value === '2d' || value === '3d' ? value : undefined
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
  volumeViewAvailable,
  volumeViewOpen,
  setVolumeViewOpen,
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
    volumeView: volumeViewAvailable
      ? {
          open: volumeViewOpen,
          onOpenChange: (open) => {
            setVolumeViewOpen(open)
            appendDebugEvent(open ? 'Image view: 3D' : 'Image view: 2D')
          },
        }
      : null,
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
