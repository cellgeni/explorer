import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { MorphologyLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { MorphologyChannelSetting } from './morphologyChannels'
import { useMorphologyWorkflow } from './useMorphologyWorkflow'

const histogram = { bins: [1, 2], maxCount: 2, min: 0, max: 10, sampleCount: 3 }
const channel: MorphologyImageChannel = {
  info: {
    id: 'dapi',
    index: 0,
    name: 'DAPI',
    color: [0, 0, 255],
    contrast: { min: 0, max: 100 },
  },
  loader: {
    url: 'https://example.test/image.ome.tif',
  } as MorphologyImageChannel['loader'],
}

interface Snapshot {
  readonly autoContrastChannelIds: readonly string[]
  readonly debugMessages: readonly string[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyState: MorphologyLoadState<StructuredLoadError>
}

let api: ReturnType<typeof useMorphologyWorkflow>
let snapshot: Snapshot

function Probe({
  computeAutoChannelContrast,
  onReady,
}: {
  readonly computeAutoChannelContrast: Parameters<
    typeof useMorphologyWorkflow
  >[0]['computeAutoChannelContrast']
  readonly onReady: (
    nextApi: ReturnType<typeof useMorphologyWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
}) {
  const [autoContrastChannelIds, setAutoContrastChannelIds] = React.useState<
    readonly string[]
  >([])
  const [morphologyChannelSettings, setMorphologyChannelSettings] = React.useState<
    readonly MorphologyChannelSetting[]
  >([
    {
      id: 'dapi',
      enabled: true,
      color: [0, 0, 255],
      contrastMin: 0,
      contrastMax: 100,
    },
  ])
  const [morphologyState, setMorphologyState] = React.useState<
    MorphologyLoadState<StructuredLoadError>
  >({ status: 'ready', url: channel.loader.url })
  const autoContrastChannelIdsRef = React.useRef<Set<string>>(new Set())
  const datasetAbortRef = React.useRef<AbortController | null>(null)
  const loadRequestIdRef = React.useRef(1)
  const debugMessagesRef = React.useRef<string[]>([])

  const nextApi = useMorphologyWorkflow({
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    autoContrastChannelIdsRef,
    computeAutoChannelContrast,
    datasetAbortRef,
    loadRequestIdRef,
    setAutoContrastChannelIds,
    setMorphologyChannelSettings,
    setMorphologyState,
  })

  React.useEffect(() => {
    onReady(nextApi, {
      autoContrastChannelIds,
      debugMessages: debugMessagesRef.current,
      morphologyChannelSettings,
      morphologyState,
    })
  })

  return null
}

describe('useMorphologyWorkflow', () => {
  it('queues auto contrast and applies channel contrast results', async () => {
    const computeAutoChannelContrast = vi.fn(async () => ({
      min: 5,
      max: 95,
      histogram,
    }))

    render(
      <Probe
        computeAutoChannelContrast={computeAutoChannelContrast}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleAutoContrast(channel)
    })
    expect(snapshot.autoContrastChannelIds).toEqual(['dapi'])

    await act(async () => {
      await Promise.resolve()
    })

    expect(computeAutoChannelContrast).toHaveBeenCalledWith(channel, {})
    expect(snapshot.autoContrastChannelIds).toEqual([])
    expect(snapshot.morphologyChannelSettings[0]).toMatchObject({
      contrastMin: 5,
      contrastMax: 95,
      histogram,
    })
    expect(snapshot.debugMessages).toContain('Auto contrast dapi')
    expect(snapshot.debugMessages).toContain('Channel contrast dapi')
  })

  it('marks morphology state as errored when auto contrast fails', async () => {
    const computeAutoChannelContrast = vi.fn(async () => {
      throw new Error('decode failed')
    })

    render(
      <Probe
        computeAutoChannelContrast={computeAutoChannelContrast}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.queueAutoContrast([channel])
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(snapshot.morphologyState.status).toBe('error')
    expect(
      snapshot.morphologyState.status === 'error'
        ? snapshot.morphologyState.error.source
        : '',
    ).toBe('Image tiles')
    expect(snapshot.autoContrastChannelIds).toEqual([])
  })
})
