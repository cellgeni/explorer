import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { TiffPyramidLoader } from '../../tiff/loader'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from './customMorphologyLayers'
import type { MorphologyChannelSetting } from './morphologyChannels'
import { useCustomMorphologyLayerWorkflow } from './useCustomMorphologyLayerWorkflow'

interface Snapshot {
  readonly customLayerState: CustomMorphologyLayerLoadState<StructuredLoadError>
  readonly customLayers: readonly CustomMorphologyLayer[]
  readonly debugMessages: readonly string[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
}

let api: ReturnType<typeof useCustomMorphologyLayerWorkflow>
let snapshot: Snapshot

function Probe({
  loadCustomMorphologyLayer,
  onReady,
}: {
  readonly loadCustomMorphologyLayer: Parameters<
    typeof useCustomMorphologyLayerWorkflow
  >[0]['loadCustomMorphologyLayer']
  readonly onReady: (
    nextApi: ReturnType<typeof useCustomMorphologyLayerWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
}) {
  const [customLayers, setCustomLayers] = React.useState<
    readonly CustomMorphologyLayer[]
  >([])
  const [customLayerState, setCustomLayerState] = React.useState<
    CustomMorphologyLayerLoadState<StructuredLoadError>
  >({ status: 'idle' })
  const [morphologyChannelSettings, setMorphologyChannelSettings] = React.useState<
    readonly MorphologyChannelSetting[]
  >([])
  const debugMessagesRef = React.useRef<string[]>([])
  const customLayerAbortRef = React.useRef<AbortController | null>(null)
  const customLayerIdRef = React.useRef(0)
  const customLayerRequestIdRef = React.useRef(0)
  const loadRequestIdRef = React.useRef(11)

  const nextApi = useCustomMorphologyLayerWorkflow({
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    customLayers,
    customLayerAbortRef,
    customLayerIdRef,
    customLayerRequestIdRef,
    loadCustomMorphologyLayer,
    loadRequestIdRef,
    setCustomLayerLoadState: setCustomLayerState,
    setCustomLayers,
    setMorphologyChannelSettings,
  })

  React.useEffect(() => {
    onReady(nextApi, {
      customLayerState,
      customLayers,
      debugMessages: debugMessagesRef.current,
      morphologyChannelSettings,
    })
  })

  return null
}

describe('useCustomMorphologyLayerWorkflow', () => {
  it('loads and removes a custom image layer', async () => {
    const loader = {} as TiffPyramidLoader
    const image: MorphologyImage = {
      url: 'https://example.test/layers/remote.ome.tif',
      loader,
      channels: [],
      channelLoaders: [
        {
          info: {
            id: 'Channel:0',
            index: 0,
            name: 'DAPI',
            color: [88, 144, 255],
            contrast: { min: 0, max: 65_535 },
          },
          loader,
        },
      ],
    }
    const loadCustomMorphologyLayer = vi.fn(async () => image)

    render(
      <Probe
        loadCustomMorphologyLayer={loadCustomMorphologyLayer}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      const loaded = await api.handleLoadCustomLayer(
        'https://example.test/layers/remote.ome.tif',
      )
      expect(loaded).toBe(true)
    })

    expect(loadCustomMorphologyLayer).toHaveBeenCalledWith(
      'https://example.test/layers/remote.ome.tif',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.customLayerState.status).toBe('idle')
    expect(snapshot.customLayers).toHaveLength(1)
    expect(snapshot.morphologyChannelSettings[0]).toMatchObject({
      id: 'custom-layer:1:Channel:0',
      enabled: true,
    })
    expect(snapshot.debugMessages).toContain('Custom layer ready: 1 channels')

    act(() => {
      api.handleRemoveCustomLayer('custom-layer:1')
    })

    expect(snapshot.customLayers).toHaveLength(0)
    expect(snapshot.morphologyChannelSettings).toHaveLength(0)
  })

  it('enables all native RGB custom channels when loaded', async () => {
    const loader = {} as TiffPyramidLoader
    const image: MorphologyImage = {
      url: 'https://example.test/layers/rgb.ome.tif',
      loader,
      channels: [],
      channelLoaders: [
        {
          info: {
            id: 'Channel:0:0',
            index: 0,
            name: 'Channel 1',
            color: [88, 144, 255],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 0,
          },
          loader,
        },
        {
          info: {
            id: 'Channel:0:1',
            index: 1,
            name: 'Channel 2',
            color: [32, 166, 122],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 1,
          },
          loader,
        },
        {
          info: {
            id: 'Channel:0:2',
            index: 2,
            name: 'Channel 3',
            color: [240, 200, 75],
            contrast: { min: 0, max: 255 },
            fileName: 'rgb.ome.tif',
            ifdIndex: 2,
          },
          loader,
        },
      ],
    }

    render(
      <Probe
        loadCustomMorphologyLayer={vi.fn(async () => image)}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      const loaded = await api.handleLoadCustomLayer(
        'https://example.test/layers/rgb.ome.tif',
      )
      expect(loaded).toBe(true)
    })

    expect(snapshot.morphologyChannelSettings).toEqual([
      expect.objectContaining({
        id: 'custom-layer:1:Channel:0:0',
        enabled: true,
        color: [255, 0, 0],
      }),
      expect.objectContaining({
        id: 'custom-layer:1:Channel:0:1',
        enabled: true,
        color: [0, 255, 0],
      }),
      expect.objectContaining({
        id: 'custom-layer:1:Channel:0:2',
        enabled: true,
        color: [0, 0, 255],
      }),
    ])
  })

  it('surfaces invalid custom layer URLs', async () => {
    render(
      <Probe
        loadCustomMorphologyLayer={vi.fn(async () => {
          throw new Error('unused')
        })}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      const loaded = await api.handleLoadCustomLayer('file:///tmp/remote.ome.tif')
      expect(loaded).toBe(false)
    })

    expect(snapshot.customLayerState).toMatchObject({
      status: 'error',
      error: {
        source: 'Morphology image',
        message: 'Custom image layer URLs must use HTTP or HTTPS.',
      },
    })
    expect(snapshot.debugMessages).toContain('Custom layer URL invalid')
  })
})
