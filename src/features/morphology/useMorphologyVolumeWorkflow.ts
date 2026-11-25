import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImagePyramidVolumeLevel } from '../../data/imagePyramid'
import {
  chooseVolumeLevel,
  MAX_VOLUME_CHANNELS,
  volumeTextureData,
  type VolumeTextureData,
} from '../../data/imageVolume'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import type { VolumeLayerChannel } from '../../rendering/volumeLayer'
import type { MorphologyChannelSetting } from './morphologyChannels'

// A channel read for the 3D view, with its colour and contrast.
export interface MorphologyVolumeChannel extends VolumeLayerChannel {
  readonly id: string
}

export interface MorphologyVolumeState {
  // The level read, or null when no level fits the 3D view.
  readonly level: ImagePyramidVolumeLevel | null
  readonly levelCount: number
  // The enabled channels read so far, in channel order.
  readonly channels: readonly MorphologyVolumeChannel[]
  // Channels turned on in the image controls, including any past the
  // MAX_VOLUME_CHANNELS the 3D view draws.
  readonly enabledChannelCount: number
  // Planes read of the channels still loading.
  readonly progress: { readonly planesRead: number; readonly planesTotal: number } | null
  readonly error: string | null
  // The channels drawn are the image's time point's, all read: false while
  // another time point's are drawn as this one's are read (plan 28-D11).
  readonly frameShown: boolean
}

// The dataset image's levels the 3D view can read: an OME-Zarr z-stack's.
export function morphologyVolumeLevels(
  image: MorphologyImage | null,
): readonly ImagePyramidVolumeLevel[] {
  return image === null || image.loader.loadVolume === undefined
    ? []
    : (image.loader.volumeLevels?.() ?? [])
}

// The enabled channels of the dataset image, in channel order. The 3D view
// draws the first MAX_VOLUME_CHANNELS.
function enabledMorphologyChannels(
  image: MorphologyImage | null,
  settings: readonly MorphologyChannelSetting[],
): readonly MorphologyImageChannel[] {
  const enabled = new Set(
    settings.filter((setting) => setting.enabled).map((setting) => setting.id),
  )

  return (image?.channelLoaders ?? []).filter((channel) => enabled.has(channel.info.id))
}

interface LoadedVolumes {
  // The image, level and time point the volumes belong to.
  readonly key: string
  readonly volumes: ReadonlyMap<string, VolumeTextureData>
  // Planes read so far, by channel id.
  readonly progress: ReadonlyMap<string, number>
  // Why a channel could not be read; it is not read again for this source.
  readonly errors: ReadonlyMap<string, string>
  // The volumes of the time point drawn before, drawn until this one's are
  // all read (28-D11).
  readonly held: ReadonlyMap<string, VolumeTextureData> | null
}

const NO_VOLUMES: LoadedVolumes = {
  key: '',
  volumes: new Map(),
  progress: new Map(),
  errors: new Map(),
  held: null,
}

// Reads the enabled channels of a z-stack, whole, at the finest level that
// fits the 3D view. Volumes are kept while the image, level and time point
// stay, so turning a channel off and on does not read it again; another z
// plane is the same image. Another time point is read whole while the last
// one stays drawn, as the 2D view swaps whole planes (28-D11). Volumes are
// dropped with the 3D view.
export function useMorphologyVolumeWorkflow({
  image,
  settings,
}: {
  readonly image: MorphologyImage | null
  readonly settings: readonly MorphologyChannelSetting[]
}): MorphologyVolumeState {
  const levels = useMemo(() => morphologyVolumeLevels(image), [image])
  const enabledChannels = useMemo(
    () => enabledMorphologyChannels(image, settings),
    [image, settings],
  )
  const channels = useMemo(
    () => enabledChannels.slice(0, MAX_VOLUME_CHANNELS),
    [enabledChannels],
  )
  const level = useMemo(
    () => chooseVolumeLevel(levels, { channelCount: channels.length }),
    [channels.length, levels],
  )
  const sourceKey =
    image === null || level === null
      ? null
      : volumeSourceKey(image.url, level.level, image.timeSeries?.timePoint)
  const [loaded, setLoaded] = useState<LoadedVolumes>(NO_VOLUMES)

  // Another image, level or time point: drop the volumes read for the last
  // one, holding what was drawn for a time point.
  if (loaded.key !== sourceKey && loaded !== NO_VOLUMES) {
    setLoaded(volumesFor(sourceKey, loaded))
  }

  // Reads in flight, by channel id, for the source they read.
  const readsRef = useRef<{
    key: string | null
    controllers: Map<string, AbortController>
  }>({ key: null, controllers: new Map() })
  const current = loaded.key === sourceKey ? loaded : NO_VOLUMES
  const wantedIds = channels.map((channel) => channel.info.id)
  const missingIds = wantedIds.filter(
    (id) => !current.volumes.has(id) && !current.errors.has(id),
  )
  const missingKey = missingIds.join('\n')

  // This time point's volumes are all read or failed: draw them instead.
  if (current.held !== null && missingIds.length === 0) {
    setLoaded({ ...current, held: null })
  }

  useEffect(() => {
    const reads = readsRef.current

    if (reads.key !== sourceKey) {
      for (const controller of reads.controllers.values()) {
        controller.abort()
      }

      reads.controllers.clear()
      reads.key = sourceKey
    }

    const missing = new Set(missingKey === '' ? [] : missingKey.split('\n'))

    // Turning a channel off stops its read.
    for (const [id, controller] of reads.controllers) {
      if (!missing.has(id)) {
        controller.abort()
        reads.controllers.delete(id)
      }
    }

    if (sourceKey === null || level === null) {
      return
    }

    for (const channel of channels) {
      const id = channel.info.id
      const loadVolume = channel.loader.loadVolume?.bind(channel.loader)

      if (!missing.has(id) || reads.controllers.has(id) || loadVolume === undefined) {
        continue
      }

      const controller = new AbortController()
      // A stopped read can settle after a newer read of the same channel id
      // has taken its place; only the read in flight reports or ends.
      const inFlight = () =>
        !controller.signal.aborted && reads.controllers.get(id) === controller
      const update = (change: (state: LoadedVolumes) => LoadedVolumes) => {
        if (!inFlight()) {
          return
        }

        setLoaded((state) =>
          change(state.key === sourceKey ? state : volumesFor(sourceKey, state)),
        )
      }

      // An aborted read settles after the read that replaced it started, so
      // it forgets only itself.
      const forgetRead = () => {
        if (reads.controllers.get(id) === controller) {
          reads.controllers.delete(id)
        }
      }

      reads.controllers.set(id, controller)
      loadVolume(level.level, controller.signal, (planesRead) => {
        update((state) => ({
          ...state,
          progress: withEntry(state.progress, id, planesRead),
        }))
      }).then(
        (volume) => {
          if (!inFlight()) {
            return
          }

          const texture = volumeTextureData(volume)

          update((state) => ({
            ...state,
            volumes: withEntry(state.volumes, id, texture),
            progress: withoutEntry(state.progress, id),
          }))
          forgetRead()
        },
        (error: unknown) => {
          if (!inFlight()) {
            return
          }

          update((state) => ({
            ...state,
            progress: withoutEntry(state.progress, id),
            errors: withEntry(
              state.errors,
              id,
              `Could not read ${channel.info.name} in 3D: ${errorMessage(error)}`,
            ),
          }))
          forgetRead()
        },
      )
    }
  }, [channels, level, missingKey, sourceKey])

  useEffect(() => {
    const reads = readsRef.current

    return () => {
      for (const controller of reads.controllers.values()) {
        controller.abort()
      }

      reads.controllers.clear()
      reads.key = null
    }
  }, [])

  const volumes = current.held ?? current.volumes
  const loadedChannels = useMemo(
    () =>
      channels.flatMap((channel) => {
        const id = channel.info.id
        const texture = volumes.get(id)
        const setting = settings.find((candidate) => candidate.id === id)

        return texture === undefined || setting === undefined
          ? []
          : [
              {
                id,
                texture,
                color: setting.color,
                contrastMin: setting.contrastMin,
                contrastMax: setting.contrastMax,
              },
            ]
      }),
    [channels, settings, volumes],
  )
  const error = wantedIds
    .map((id) => current.errors.get(id))
    .find((message) => message !== undefined)

  return {
    level,
    levelCount: levels.length,
    channels: loadedChannels,
    enabledChannelCount: enabledChannels.length,
    progress:
      level === null || missingIds.length === 0
        ? null
        : {
            planesRead: missingIds.reduce(
              (sum, id) => sum + (current.progress.get(id) ?? 0),
              0,
            ),
            planesTotal: missingIds.length * level.depth,
          },
    error: error ?? null,
    // Nothing is read when no level fits the 3D view.
    frameShown: level === null || (current.held === null && missingIds.length === 0),
  }
}

// The volumes for a source: none, or for another time point of the image and
// level, the last time point's drawn volumes, held while this one's are read.
function volumesFor(key: string | null, last: LoadedVolumes): LoadedVolumes {
  if (key === null || volumeImageKey(key) !== volumeImageKey(last.key)) {
    return key === null ? NO_VOLUMES : { ...NO_VOLUMES, key }
  }

  const held = last.held ?? last.volumes
  return { ...NO_VOLUMES, key, held: held.size === 0 ? null : held }
}

// The image root, level and time point. A plane loader's URL names its z
// plane, which the volume covers.
function volumeSourceKey(url: string, level: number, timePoint: number | undefined) {
  return `${imageRootUrl(url)}\n${level.toString()}\n${timePoint?.toString() ?? ''}`
}

function volumeImageKey(key: string): string {
  return key.slice(0, key.lastIndexOf('\n'))
}

function imageRootUrl(url: string): string {
  const hashIndex = url.indexOf('#')
  return hashIndex < 0 ? url : url.slice(0, hashIndex)
}

function withEntry<T>(map: ReadonlyMap<string, T>, key: string, value: T) {
  return new Map(map).set(key, value)
}

function withoutEntry<T>(map: ReadonlyMap<string, T>, key: string) {
  const next = new Map(map)
  next.delete(key)
  return next
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
