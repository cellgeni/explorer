import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { AutoChannelContrastLoader } from '../app-shell/appDependencies'
import {
  isAbortError,
  shortIdentifier,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { MorphologyLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { morphologyPatchLabel, type MorphologyChannelSetting } from './morphologyChannels'

interface MutableRef<T> {
  current: T
}

interface QueueAutoContrastOptions {
  readonly requestId?: number
  readonly signal?: AbortSignal
}

interface MorphologyWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

interface MorphologyWorkflowLoaders {
  readonly computeAutoChannelContrast: AutoChannelContrastLoader
}

interface MorphologyWorkflowRefs {
  readonly autoContrastChannelIdsRef: MutableRef<Set<string>>
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly loadRequestIdRef: MutableRef<number>
}

interface MorphologyWorkflowSetters {
  readonly setAutoContrastChannelIds: Dispatch<SetStateAction<readonly string[]>>
  readonly setMorphologyChannelSettings: Dispatch<
    SetStateAction<readonly MorphologyChannelSetting[]>
  >
  readonly setMorphologyState: Dispatch<
    SetStateAction<MorphologyLoadState<StructuredLoadError>>
  >
}

interface UseMorphologyWorkflowOptions {
  readonly callbacks: MorphologyWorkflowCallbacks
  readonly loaders: MorphologyWorkflowLoaders
  readonly refs: MorphologyWorkflowRefs
  readonly setters: MorphologyWorkflowSetters
}

interface UseMorphologyWorkflowResult {
  readonly handleAutoContrast: (channel: MorphologyImageChannel) => void
  readonly queueAutoContrast: (
    channels: readonly MorphologyImageChannel[],
    options?: QueueAutoContrastOptions,
  ) => void
  readonly updateMorphologyChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}

export function useMorphologyWorkflow({
  callbacks,
  loaders,
  refs,
  setters,
}: UseMorphologyWorkflowOptions): UseMorphologyWorkflowResult {
  const { appendDebugEvent } = callbacks
  const { computeAutoChannelContrast } = loaders
  const { autoContrastChannelIdsRef, datasetAbortRef, loadRequestIdRef } = refs
  const { setAutoContrastChannelIds, setMorphologyChannelSettings, setMorphologyState } =
    setters

  const updateMorphologyChannel = useCallback(
    (id: string, patch: Partial<Omit<MorphologyChannelSetting, 'id'>>) => {
      setMorphologyChannelSettings((current) =>
        current.map((setting) =>
          setting.id === id ? { ...setting, ...patch } : setting,
        ),
      )
      appendDebugEvent(`${morphologyPatchLabel(patch)} ${shortIdentifier(id)}`, {
        coalesceKey: `morphology-channel:${id}`,
      })
    },
    [appendDebugEvent, setMorphologyChannelSettings],
  )

  const startAutoContrast = useCallback(
    (
      channel: MorphologyImageChannel,
      requestId: number,
      signal: AbortSignal | undefined,
    ) => {
      const channelId = channel.info.id
      void computeAutoChannelContrast(channel, signal === undefined ? {} : { signal })
        .then((contrast) => {
          if (loadRequestIdRef.current !== requestId) {
            return
          }

          updateMorphologyChannel(channelId, {
            contrastMin: contrast.min,
            contrastMax: contrast.max,
            histogram: contrast.histogram,
          })
        })
        .catch((error) => {
          if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
            return
          }

          setMorphologyState({
            status: 'error',
            url: channel.loader.url,
            error: createStructuredLoadError('Image tiles', error),
          })
        })
        .finally(() => {
          if (loadRequestIdRef.current !== requestId) {
            return
          }

          autoContrastChannelIdsRef.current.delete(channelId)
          setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])
        })
    },
    [
      autoContrastChannelIdsRef,
      computeAutoChannelContrast,
      loadRequestIdRef,
      setAutoContrastChannelIds,
      setMorphologyState,
      updateMorphologyChannel,
    ],
  )

  const queueAutoContrast = useCallback(
    (
      channels: readonly MorphologyImageChannel[],
      options: QueueAutoContrastOptions = {},
    ) => {
      const requestId = options.requestId ?? loadRequestIdRef.current
      const signal = options.signal ?? datasetAbortRef.current?.signal
      const channelsToLoad: MorphologyImageChannel[] = []

      for (const channel of channels) {
        const channelId = channel.info.id

        if (autoContrastChannelIdsRef.current.has(channelId)) {
          continue
        }

        autoContrastChannelIdsRef.current.add(channelId)
        channelsToLoad.push(channel)
      }

      if (channelsToLoad.length === 0) {
        return
      }

      setAutoContrastChannelIds([...autoContrastChannelIdsRef.current])

      for (const channel of channelsToLoad) {
        startAutoContrast(channel, requestId, signal)
      }
    },
    [
      autoContrastChannelIdsRef,
      datasetAbortRef,
      loadRequestIdRef,
      setAutoContrastChannelIds,
      startAutoContrast,
    ],
  )

  const handleAutoContrast = useCallback(
    (channel: MorphologyImageChannel) => {
      appendDebugEvent(`Auto contrast ${shortIdentifier(channel.info.id)}`)
      queueAutoContrast([channel])
    },
    [appendDebugEvent, queueAutoContrast],
  )

  return {
    handleAutoContrast,
    queueAutoContrast,
    updateMorphologyChannel,
  }
}
