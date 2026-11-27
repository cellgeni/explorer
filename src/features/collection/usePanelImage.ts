import { useCallback, useEffect, useRef, useState } from 'react'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import { isAbortError } from '../../utils/abort'
import type {
  AutoChannelContrastLoader,
  DatasetRetainer,
} from '../app-shell/appDependencies'
import {
  channelsToAutoContrastOnLoad,
  createMorphologyChannelSettingsFromChannels,
  type MorphologyChannelDefaults,
  type MorphologyChannelSetting,
} from '../morphology/morphologyChannels'
import type { PanelImage } from './panelImage'

// A panel's image (plan 30-D4, D5): read while the panel asks for it, with
// channel settings of its own. They start from the main view's for channels
// of the same name, so sections compare on one window, and from the image's
// defaults otherwise, auto-contrasted as the main view would.

export interface PanelImageLoaders {
  readonly loadPanelImage: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PanelImage | null>
  readonly retainDataset: DatasetRetainer
  readonly computeAutoChannelContrast: AutoChannelContrastLoader
}

// The main view's image channels and their settings, which a panel starts
// from.
export interface MainImageChannels {
  readonly channels: readonly MorphologyImageChannel[]
  readonly settings: readonly MorphologyChannelSetting[]
}

export type PanelImageStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error'

export interface PanelImageState {
  readonly status: PanelImageStatus
  readonly image: PanelImage | null
  readonly settings: readonly MorphologyChannelSetting[]
  readonly autoContrastChannelIds: readonly string[]
  readonly error: string | null
}

const IDLE: PanelImageState = {
  status: 'idle',
  image: null,
  settings: [],
  autoContrastChannelIds: [],
  error: null,
}
const LOADING: PanelImageState = { ...IDLE, status: 'loading' }

export function usePanelImage({
  url,
  enabled,
  loaders,
  channelSelection,
  mainChannels,
}: {
  readonly url: string
  readonly enabled: boolean
  readonly loaders: PanelImageLoaders
  // The channels the link names; null for the image's defaults.
  readonly channelSelection: readonly string[] | null
  readonly mainChannels: MainImageChannels | null
}): PanelImageState & {
  readonly updateChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
  readonly autoContrast: (channel: MorphologyImageChannel) => void
} {
  // The image read for `url`, kept while the panel hides it, so showing it
  // again keeps its channels; another URL reads its own.
  const [loaded, setLoaded] = useState<{
    readonly url: string
    readonly state: PanelImageState
  } | null>(null)
  // The URL whose image `loaded` holds, for the effect to skip a second read.
  const loadedUrlRef = useRef<string | null>(null)
  // Read when the image loads, not followed afterwards.
  const startRef = useRef({ channelSelection, mainChannels })
  useEffect(() => {
    startRef.current = { channelSelection, mainChannels }
  })
  const controllerRef = useRef<AbortController | null>(null)
  // How many times each channel's window was set, so an auto-contrast that
  // ends after the user set one keeps theirs (as the main view, EXP-051).
  const windowEditsRef = useRef(new Map<string, number>())

  const updateLoaded = useCallback(
    (update: (state: PanelImageState) => PanelImageState) => {
      setLoaded((current) =>
        current === null ? current : { url: current.url, state: update(current.state) },
      )
    },
    [],
  )

  const updateChannel = useCallback(
    (id: string, patch: Partial<Omit<MorphologyChannelSetting, 'id'>>) => {
      if ('contrastMin' in patch || 'contrastMax' in patch) {
        windowEditsRef.current.set(id, (windowEditsRef.current.get(id) ?? 0) + 1)
      }

      updateLoaded((current) => ({
        ...current,
        settings: current.settings.map((setting) =>
          setting.id === id ? { ...setting, ...patch } : setting,
        ),
      }))
    },
    [updateLoaded],
  )

  const runAutoContrast = useCallback(
    (channels: readonly MorphologyImageChannel[], signal: AbortSignal) => {
      if (channels.length === 0) return

      const ids = channels.map((channel) => channel.info.id)
      updateLoaded((current) => ({
        ...current,
        autoContrastChannelIds: [...new Set([...current.autoContrastChannelIds, ...ids])],
      }))

      for (const channel of channels) {
        const id = channel.info.id
        const edits = windowEditsRef.current.get(id) ?? 0

        void loaders
          .computeAutoChannelContrast(channel, { signal })
          .then((contrast) => {
            if (signal.aborted) return

            const windowSet = (windowEditsRef.current.get(id) ?? 0) !== edits
            updateLoaded((current) => ({
              ...current,
              settings: current.settings.map((setting) =>
                setting.id !== id
                  ? setting
                  : windowSet
                    ? { ...setting, histogram: contrast.histogram }
                    : {
                        ...setting,
                        contrastMin: contrast.min,
                        contrastMax: contrast.max,
                        histogram: contrast.histogram,
                      },
              ),
            }))
          })
          .catch(() => {
            // The channel keeps its window; the image still draws.
          })
          .finally(() => {
            updateLoaded((current) => ({
              ...current,
              autoContrastChannelIds: current.autoContrastChannelIds.filter(
                (channelId) => channelId !== id,
              ),
            }))
          })
      }
    },
    [loaders, updateLoaded],
  )

  const autoContrast = useCallback(
    (channel: MorphologyImageChannel) => {
      const signal = controllerRef.current?.signal
      if (signal !== undefined) runAutoContrast([channel], signal)
    },
    [runAutoContrast],
  )

  useEffect(() => {
    if (!enabled) return

    // The dataset stays open while the panel shows its image.
    const release = loaders.retainDataset(url)
    const controller = new AbortController()
    controllerRef.current = controller
    const done = (state: PanelImageState) => {
      if (state.status === 'ready') loadedUrlRef.current = url
      setLoaded({ url, state })
    }

    if (loadedUrlRef.current !== url) {
      windowEditsRef.current = new Map()

      loaders
        .loadPanelImage(url, controller.signal)
        .then((image) => {
          if (controller.signal.aborted) return

          if (image === null) {
            done({ ...IDLE, status: 'none' })
            return
          }

          if (image.kind === 'flat') {
            done({ ...IDLE, status: 'ready', image })
            return
          }

          const { settings, matched } = startingSettings(
            image.image.channelLoaders,
            image.enabledChannelIds,
            startRef.current.channelSelection,
            startRef.current.mainChannels,
            image.channelDefaults,
          )
          done({ ...IDLE, status: 'ready', image, settings })

          if (image.autoContrast) {
            runAutoContrast(
              channelsToAutoContrastOnLoad(image.image.channelLoaders, settings).filter(
                (channel) => !matched.has(channel.info.id),
              ),
              controller.signal,
            )
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return

          done({
            ...IDLE,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }

    return () => {
      controller.abort()
      if (controllerRef.current === controller) controllerRef.current = null
      release()
    }
  }, [enabled, loaders, runAutoContrast, url])

  const state = !enabled ? IDLE : loaded?.url === url ? loaded.state : LOADING

  return { ...state, updateChannel, autoContrast }
}

// A panel's first channel settings: the image's defaults, with the colours
// and windows its dataset manifest or collection sets, then the main view's
// colour, window and shown state for each channel of the same name (case
// aside); the link's channels, when it names them, say which are on.
export function startingSettings(
  channels: readonly MorphologyImageChannel[],
  defaultEnabledIds: readonly string[] | undefined,
  selection: readonly string[] | null,
  main: MainImageChannels | null,
  channelDefaults?: MorphologyChannelDefaults,
): {
  readonly settings: readonly MorphologyChannelSetting[]
  // The channels that took the main view's settings.
  readonly matched: ReadonlySet<string>
} {
  const defaults = createMorphologyChannelSettingsFromChannels(channels, {
    ...(defaultEnabledIds === undefined ? {} : { enabledChannelIds: defaultEnabledIds }),
    ...(channelDefaults === undefined ? {} : { channelDefaults }),
  })
  const mainByName = new Map<string, MorphologyChannelSetting>()

  for (const channel of main?.channels ?? []) {
    const setting = main?.settings.find((candidate) => candidate.id === channel.info.id)
    if (setting !== undefined) mainByName.set(channel.info.name.toLowerCase(), setting)
  }

  const selected =
    selection === null
      ? null
      : new Set(
          channels
            .filter(
              (channel) =>
                selection.includes(channel.info.id) ||
                selection.some(
                  (entry) => entry.toLowerCase() === channel.info.name.toLowerCase(),
                ),
            )
            .map((channel) => channel.info.id),
        )
  const matched = new Set<string>()
  const settings = channels.map((channel, index) => {
    const base = defaults[index] as MorphologyChannelSetting
    const fromMain = mainByName.get(channel.info.name.toLowerCase())
    const enabled = selected?.has(channel.info.id) ?? fromMain?.enabled ?? base.enabled

    if (fromMain === undefined) return { ...base, enabled }

    matched.add(channel.info.id)
    return {
      id: base.id,
      enabled,
      color: fromMain.color,
      contrastMin: fromMain.contrastMin,
      contrastMax: fromMain.contrastMax,
      ...(fromMain.contrastSet === true ? { contrastSet: true as const } : {}),
    }
  })

  return { settings, matched }
}
