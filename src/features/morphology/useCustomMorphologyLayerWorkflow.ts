import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { CustomMorphologyLayerLoader } from '../app-shell/appDependencies'
import {
  isAbortError,
  shortDatasetLabel,
  startLatestRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  createMorphologyChannelSettingsFromChannels,
  type MorphologyChannelSetting,
} from './morphologyChannels'
import {
  IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE,
  createCustomMorphologyLayer,
  customMorphologyLayerLoadFailed,
  customMorphologyLayerLoadStarted,
  customMorphologyLayerDefaultEnabledChannelIds,
  customMorphologyLayerChannelIds,
  isCustomMorphologyLayerChannelId,
  type CustomMorphologyLayer,
  type CustomMorphologyLayerLoadState,
} from './customMorphologyLayers'
import { normalizeCustomMorphologyLayerUrl } from '../../data/morphologyImage'
import type { FallbackNotifier } from '../../data/fallbackNotice'

interface MutableRef<T> {
  current: T
}

interface CustomMorphologyLayerWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly appendFallbackNotice?: FallbackNotifier
}

interface CustomMorphologyLayerWorkflowData {
  readonly customLayers: readonly CustomMorphologyLayer[]
}

interface CustomMorphologyLayerWorkflowLoaders {
  readonly loadCustomMorphologyLayer: CustomMorphologyLayerLoader
}

interface CustomMorphologyLayerWorkflowRefs {
  readonly customLayerAbortRef: MutableRef<AbortController | null>
  readonly customLayerIdRef: MutableRef<number>
  readonly customLayerRequestIdRef: MutableRef<number>
  readonly loadRequestIdRef: MutableRef<number>
}

interface CustomMorphologyLayerWorkflowSetters {
  readonly setCustomLayerLoadState: Dispatch<
    SetStateAction<CustomMorphologyLayerLoadState<StructuredLoadError>>
  >
  readonly setCustomLayers: Dispatch<SetStateAction<readonly CustomMorphologyLayer[]>>
  readonly setMorphologyChannelSettings: Dispatch<
    SetStateAction<readonly MorphologyChannelSetting[]>
  >
}

interface UseCustomMorphologyLayerWorkflowOptions {
  readonly callbacks: CustomMorphologyLayerWorkflowCallbacks
  readonly data: CustomMorphologyLayerWorkflowData
  readonly loaders: CustomMorphologyLayerWorkflowLoaders
  readonly refs: CustomMorphologyLayerWorkflowRefs
  readonly setters: CustomMorphologyLayerWorkflowSetters
}

interface UseCustomMorphologyLayerWorkflowResult {
  readonly handleLoadCustomLayer: (url: string) => Promise<boolean>
  readonly handleRemoveCustomLayer: (layerId: string) => void
}

export function useCustomMorphologyLayerWorkflow({
  callbacks,
  data,
  loaders,
  refs,
  setters,
}: UseCustomMorphologyLayerWorkflowOptions): UseCustomMorphologyLayerWorkflowResult {
  const { appendDebugEvent, appendFallbackNotice } = callbacks
  const { customLayers } = data
  const { loadCustomMorphologyLayer } = loaders
  const {
    customLayerAbortRef,
    customLayerIdRef,
    customLayerRequestIdRef,
    loadRequestIdRef,
  } = refs
  const { setCustomLayerLoadState, setCustomLayers, setMorphologyChannelSettings } =
    setters

  const handleLoadCustomLayer = useCallback(
    async (url: string) => {
      let normalizedUrl: string

      try {
        normalizedUrl = normalizeCustomMorphologyLayerUrl(url)
      } catch (error) {
        const trimmedUrl = url.trim()
        setCustomLayerLoadState(
          customMorphologyLayerLoadFailed(
            trimmedUrl.length === 0 ? url : trimmedUrl,
            createStructuredLoadError('Morphology image', error),
          ),
        )
        appendDebugEvent('Custom layer URL invalid')
        return false
      }

      if (customLayers.some((layer) => layer.image.url === normalizedUrl)) {
        appendDebugEvent('Custom layer already loaded', {
          coalesceKey: `custom-layer:${normalizedUrl}`,
        })
        return true
      }

      const request = startLatestRequest({
        abortRef: customLayerAbortRef,
        requestIdRef: customLayerRequestIdRef,
      })
      const datasetRequestId = loadRequestIdRef.current
      setCustomLayerLoadState(customMorphologyLayerLoadStarted(normalizedUrl))
      appendDebugEvent(`Loading custom layer ${shortDatasetLabel(normalizedUrl)}`)

      try {
        const image = await loadCustomMorphologyLayer(normalizedUrl, {
          signal: request.signal,
          ...(appendFallbackNotice === undefined
            ? {}
            : { onFallback: appendFallbackNotice }),
        })

        if (!request.isCurrent() || loadRequestIdRef.current !== datasetRequestId) {
          return false
        }

        customLayerIdRef.current += 1
        const layer = createCustomMorphologyLayer(
          `custom-layer:${customLayerIdRef.current}`,
          image,
        )
        const settings = createMorphologyChannelSettingsFromChannels(layer.channels, {
          enabledChannelIds: customMorphologyLayerDefaultEnabledChannelIds(layer),
        })

        setCustomLayers((current) =>
          current.some((candidate) => candidate.image.url === image.url)
            ? current
            : [...current, layer],
        )
        setMorphologyChannelSettings((current) => [...current, ...settings])
        setCustomLayerLoadState(IDLE_CUSTOM_MORPHOLOGY_LAYER_LOAD_STATE)
        appendDebugEvent(
          `Custom layer ready: ${layer.channels.length.toLocaleString()} channels`,
        )
        return true
      } catch (error) {
        if (
          isAbortError(error) ||
          !request.isCurrent() ||
          loadRequestIdRef.current !== datasetRequestId
        ) {
          return false
        }

        setCustomLayerLoadState(
          customMorphologyLayerLoadFailed(
            normalizedUrl,
            createStructuredLoadError('Morphology image', error),
          ),
        )
        appendDebugEvent('Custom layer failed')
        return false
      } finally {
        request.complete()
      }
    },
    [
      appendDebugEvent,
      appendFallbackNotice,
      customLayerAbortRef,
      customLayerIdRef,
      customLayerRequestIdRef,
      customLayers,
      loadCustomMorphologyLayer,
      loadRequestIdRef,
      setCustomLayerLoadState,
      setCustomLayers,
      setMorphologyChannelSettings,
    ],
  )

  const handleRemoveCustomLayer = useCallback(
    (layerId: string) => {
      const layer = customLayers.find((candidate) => candidate.id === layerId)

      if (layer === undefined) {
        return
      }

      const removedChannelIds = customMorphologyLayerChannelIds(layer)
      setCustomLayers((current) =>
        current.filter((candidate) => candidate.id !== layerId),
      )
      setMorphologyChannelSettings((current) =>
        current.filter(
          (setting) =>
            !removedChannelIds.includes(setting.id) &&
            !isCustomMorphologyLayerChannelId(layerId, setting.id),
        ),
      )
      appendDebugEvent('Custom layer removed', {
        coalesceKey: `custom-layer-remove:${layerId}`,
      })
    },
    [appendDebugEvent, customLayers, setCustomLayers, setMorphologyChannelSettings],
  )

  return { handleLoadCustomLayer, handleRemoveCustomLayer }
}
