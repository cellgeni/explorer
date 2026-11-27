import type { Dispatch, SetStateAction } from 'react'
import type {
  MorphologyImageChannel,
  MorphologyImageTimeSeries,
  MorphologyImageZStack,
} from '../../data/morphologyImage'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type { MorphologyCanvasFrame } from '../../components/MorphologyCanvas'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import type { ShownMorphologyFrame } from '../morphology/morphologyFrame'
import type { TimePointPlaybackControls } from '../morphology/MorphologyTimePointControl'
import type { TimePointPlayback } from '../morphology/useTimePointPlayback'

// The dataset image: opacity, z plane, time point, channels and custom image
// layers (plan 15.2-A). Opacities are 0–1; the controls show percent.
export interface ImageSectionModel {
  readonly opacity: number
  readonly onOpacityPercentChange: (percent: number) => void
  readonly zStack: MorphologyImageZStack | undefined
  readonly requestedZPlane: number | null
  readonly onZPlaneChange: (zPlane: number) => void
  readonly timeSeries: MorphologyImageTimeSeries | undefined
  readonly requestedTimePoint: number | null
  readonly onTimePointChange: (timePoint: number) => void
  // Play, Speed and Loop; null in the 3D view (plan 28-D11).
  readonly playback: TimePointPlaybackControls | null
  // The image's plane, and the plane the canvas shows (28-D6).
  readonly frame: MorphologyCanvasFrame | undefined
  readonly shownFrame: ShownMorphologyFrame
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
  // Shows the image again in a panel beside the main view (plan 30-D8);
  // null without an image, or in the 3D view.
  readonly beside: ImageBesideModel | null
}

export interface ImageBesideModel {
  // Panels of this image already shown.
  readonly shown: number
  // No room for another panel.
  readonly full: boolean
  readonly onShow: () => void
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
  readonly morphologyTimeSeries: MorphologyImageTimeSeries | undefined
  readonly requestedMorphologyTimePoint: number | null
  readonly selectMorphologyTimePoint: (timePoint: number) => void
  readonly morphologyFrame: MorphologyCanvasFrame | undefined
  readonly shownMorphologyFrame: ShownMorphologyFrame
  readonly timePointPlayback: TimePointPlayback
  readonly setCustomLayerOpacity: (imageUrl: string, opacity: number) => void
  readonly setImageLayerOpacity: Dispatch<SetStateAction<number>>
  readonly updateMorphologyChannel: ImageSectionModel['onUpdateChannel']
  readonly volumeViewAvailable: boolean
  readonly volumeViewOpen: boolean
  readonly setVolumeViewOpen: (open: boolean) => void
  readonly beside?: ImageBesideModel | null
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
  morphologyTimeSeries,
  requestedMorphologyTimePoint,
  selectMorphologyTimePoint,
  morphologyFrame,
  shownMorphologyFrame,
  timePointPlayback,
  setCustomLayerOpacity,
  setImageLayerOpacity,
  updateMorphologyChannel,
  volumeViewAvailable,
  volumeViewOpen,
  setVolumeViewOpen,
  beside = null,
}: ImageSectionModelInput): ImageSectionModel {
  return {
    beside: volumeViewOpen ? null : beside,
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
    timeSeries: morphologyTimeSeries,
    requestedTimePoint: requestedMorphologyTimePoint,
    // Moving the slider stops Play (28-D10).
    onTimePointChange: (timePoint) => {
      timePointPlayback.pause()
      selectMorphologyTimePoint(timePoint)
    },
    playback: volumeViewOpen
      ? null
      : {
          playing: timePointPlayback.playing,
          speed: timePointPlayback.speed,
          loop: timePointPlayback.loop,
          onPlayingChange: (playing) => {
            if (playing) {
              timePointPlayback.play()
            } else {
              timePointPlayback.pause()
            }
            appendDebugEvent(playing ? 'Time points: play' : 'Time points: pause')
          },
          onSpeedChange: (speed) => {
            timePointPlayback.setSpeed(speed)
            appendDebugEvent(`Time points: ${speed.toString()} per second`)
          },
          onLoopChange: (loop) => {
            timePointPlayback.setLoop(loop)
            appendDebugEvent(loop ? 'Time points: loop' : 'Time points: no loop')
          },
        },
    frame: morphologyFrame,
    shownFrame: shownMorphologyFrame,
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
