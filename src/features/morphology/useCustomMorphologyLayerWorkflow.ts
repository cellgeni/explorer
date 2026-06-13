import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { CustomMorphologyLayerLoader } from '../app-shell/appDependencies'
import {
  abortActiveRequest,
  isAbortError,
  shortDatasetLabel,
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
  createCustomMorphologyLayer,
  customMorphologyLayerDefaultEnabledChannelIds,
  customMorphologyLayerChannelIds,
  isCustomMorphologyLayerChannelId,
  type CustomMorphologyLayer,
  type CustomMorphologyLayerLoadState,
} from './customMorphologyLayers'
import { normalizeCustomMorphologyLayerUrl } from '../../data/morphologyImage'

interface MutableRef<T> {
  current: T
}

interface UseCustomMorphologyLayerWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly customLayers: readonly CustomMorphologyLayer[]
  readonly customLayerAbortRef: MutableRef<AbortController | null>
  readonly customLayerIdRef: MutableRef<number>
  readonly customLayerRequestIdRef: MutableRef<number>
  readonly loadCustomMorphologyLayer: CustomMorphologyLayerLoader
  readonly loadRequestIdRef: MutableRef<number>
  readonly setCustomLayerLoadState: Dispatch<
    SetStateAction<CustomMorphologyLayerLoadState<StructuredLoadError>>
  >
  readonly setCustomLayers: Dispatch<SetStateAction<readonly CustomMorphologyLayer[]>>
  readonly setMorphologyChannelSettings: Dispatch<
    SetStateAction<readonly MorphologyChannelSetting[]>
  >
}

interface UseCustomMorphologyLayerWorkflowResult {
  readonly handleLoadCustomLayer: (url: string) => Promise<boolean>
  readonly handleRemoveCustomLayer: (layerId: string) => void
}

export function useCustomMorphologyLayerWorkflow({
  appendDebugEvent,
  customLayers,
  customLayerAbortRef,
  customLayerIdRef,
  customLayerRequestIdRef,
  loadCustomMorphologyLayer,
  loadRequestIdRef,
  setCustomLayerLoadState,
  setCustomLayers,
  setMorphologyChannelSettings,
}: UseCustomMorphologyLayerWorkflowOptions): UseCustomMorphologyLayerWorkflowResult {
  const handleLoadCustomLayer = useCallback(
    async (url: string) => {
      let normalizedUrl: string

      try {
        normalizedUrl = normalizeCustomMorphologyLayerUrl(url)
      } catch (error) {
        const trimmedUrl = url.trim()
        setCustomLayerLoadState({
          status: 'error',
          url: trimmedUrl.length === 0 ? url : trimmedUrl,
          error: createStructuredLoadError('Morphology image', error),
        })
        appendDebugEvent('Custom layer URL invalid')
        return false
      }

      if (customLayers.some((layer) => layer.image.url === normalizedUrl)) {
        appendDebugEvent('Custom layer already loaded', {
          coalesceKey: `custom-layer:${normalizedUrl}`,
        })
        return true
      }

      abortActiveRequest(customLayerAbortRef)
      customLayerRequestIdRef.current += 1
      const requestId = customLayerRequestIdRef.current
      const datasetRequestId = loadRequestIdRef.current
      const abortController = new AbortController()
      customLayerAbortRef.current = abortController
      setCustomLayerLoadState({ status: 'loading', url: normalizedUrl })
      appendDebugEvent(`Loading custom layer ${shortDatasetLabel(normalizedUrl)}`)

      try {
        const image = await loadCustomMorphologyLayer(normalizedUrl, {
          signal: abortController.signal,
        })

        if (
          customLayerRequestIdRef.current !== requestId ||
          loadRequestIdRef.current !== datasetRequestId
        ) {
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
        setCustomLayerLoadState({ status: 'idle' })
        appendDebugEvent(
          `Custom layer ready: ${layer.channels.length.toLocaleString()} channels`,
        )
        return true
      } catch (error) {
        if (
          isAbortError(error) ||
          customLayerRequestIdRef.current !== requestId ||
          loadRequestIdRef.current !== datasetRequestId
        ) {
          return false
        }

        setCustomLayerLoadState({
          status: 'error',
          url: normalizedUrl,
          error: createStructuredLoadError('Morphology image', error),
        })
        appendDebugEvent('Custom layer failed')
        return false
      } finally {
        if (customLayerAbortRef.current === abortController) {
          customLayerAbortRef.current = null
        }
      }
    },
    [
      appendDebugEvent,
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
