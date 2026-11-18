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
  readonly enabledChannelCount: number
  // Planes read of the channels still loading.
  readonly progress: { readonly planesRead: number; readonly planesTotal: number } | null
  readonly error: string | null
}

// The dataset image's levels the 3D view can read: an OME-Zarr z-stack's.
export function morphologyVolumeLevels(
  image: MorphologyImage | null,
): readonly ImagePyramidVolumeLevel[] {
  return image === null || image.loader.loadVolume === undefined
    ? []
    : (image.loader.volumeLevels?.() ?? [])
}

// The enabled channels of the dataset image that the 3D view draws, at most
// MAX_VOLUME_CHANNELS.
export function morphologyVolumeChannels(
  image: MorphologyImage | null,
  settings: readonly MorphologyChannelSetting[],
): readonly MorphologyImageChannel[] {
  const enabled = new Set(
    settings.filter((setting) => setting.enabled).map((setting) => setting.id),
  )

  return (image?.channelLoaders ?? [])
    .filter((channel) => enabled.has(channel.info.id))
    .slice(0, MAX_VOLUME_CHANNELS)
}

interface LoadedVolumes {
  // The image and level the volumes belong to.
  readonly key: string
  readonly volumes: ReadonlyMap<string, VolumeTextureData>
  // Planes read so far, by channel id.
  readonly progress: ReadonlyMap<string, number>
  // Why a channel could not be read; it is not read again for this source.
  readonly errors: ReadonlyMap<string, string>
}

const NO_VOLUMES: LoadedVolumes = {
  key: '',
  volumes: new Map(),
  progress: new Map(),
  errors: new Map(),
}

// Reads the enabled channels of a z-stack, whole, at the finest level that
// fits the 3D view. Volumes are kept while the image and level stay, so
// turning a channel off and on does not read it again; another z plane is the
// same image. They are dropped with the 3D view.
export function useMorphologyVolumeWorkflow({
  image,
  settings,
}: {
  readonly image: MorphologyImage | null
  readonly settings: readonly MorphologyChannelSetting[]
}): MorphologyVolumeState {
  const levels = useMemo(() => morphologyVolumeLevels(image), [image])
  const channels = useMemo(
    () => morphologyVolumeChannels(image, settings),
    [image, settings],
  )
  const level = useMemo(
    () => chooseVolumeLevel(levels, { channelCount: channels.length }),
    [channels.length, levels],
  )
  const sourceKey =
    image === null || level === null
      ? null
      : `${imageRootUrl(image.url)}\n${level.level.toString()}`
  const [loaded, setLoaded] = useState<LoadedVolumes>(NO_VOLUMES)

  // Another image or level: drop the volumes read for the last one.
  if (loaded.key !== sourceKey && loaded !== NO_VOLUMES) {
    setLoaded(NO_VOLUMES)
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
      const update = (change: (state: LoadedVolumes) => LoadedVolumes) => {
        if (controller.signal.aborted) {
          return
        }

        setLoaded((state) =>
          change(state.key === sourceKey ? state : { ...NO_VOLUMES, key: sourceKey }),
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
          const texture = volumeTextureData(volume)

          update((state) => ({
            ...state,
            volumes: withEntry(state.volumes, id, texture),
            progress: withoutEntry(state.progress, id),
          }))
          forgetRead()
        },
        (error: unknown) => {
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

  const volumes = current.volumes
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
    enabledChannelCount: channels.length,
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
  }
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
