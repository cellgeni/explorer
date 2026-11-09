import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { MorphologyLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { useMorphologyZPlaneWorkflow } from './useMorphologyZPlaneWorkflow'

type OpenPlane = (zPlane: number, signal?: AbortSignal) => Promise<MorphologyImage>

function stackImage(zPlane: number, openPlane: OpenPlane): MorphologyImage {
  return {
    url: 'https://example.test/stack.ome.tif',
    loader: {} as MorphologyImage['loader'],
    channels: [],
    channelLoaders: [],
    zStack: { sizeZ: 5, zPlane, openPlane },
  }
}

interface Deferred {
  readonly zPlane: number
  readonly signal: AbortSignal | undefined
  readonly resolve: (image: MorphologyImage) => void
  readonly reject: (error: unknown) => void
}

interface Snapshot {
  readonly api: ReturnType<typeof useMorphologyZPlaneWorkflow>
  readonly image: MorphologyImage | null
  readonly morphologyState: MorphologyLoadState<StructuredLoadError>
}

let api: Snapshot['api']
let image: Snapshot['image']
let morphologyState: Snapshot['morphologyState']

function Probe({
  initialImage,
  loadRequestIdRef,
  onReady,
}: {
  readonly initialImage: MorphologyImage
  readonly loadRequestIdRef: { current: number }
  readonly onReady: (snapshot: Snapshot) => void
}) {
  const [morphologyImage, setMorphologyImage] = React.useState<MorphologyImage | null>(
    initialImage,
  )
  const [state, setMorphologyState] = React.useState<
    MorphologyLoadState<StructuredLoadError>
  >({ status: 'ready', url: initialImage.url })

  const nextApi = useMorphologyZPlaneWorkflow({
    callbacks: { appendDebugEvent: () => undefined },
    data: { morphologyImage },
    refs: { loadRequestIdRef },
    setters: { setMorphologyImage, setMorphologyState },
  })

  React.useEffect(() => {
    onReady({ api: nextApi, image: morphologyImage, morphologyState: state })
  })

  return null
}

function renderProbe() {
  const requests: Deferred[] = []
  const openPlane = vi.fn(
    (zPlane: number, signal?: AbortSignal) =>
      new Promise<MorphologyImage>((resolve, reject) => {
        requests.push({ zPlane, signal, resolve, reject })
      }),
  )
  const loadRequestIdRef = { current: 1 }

  render(
    <Probe
      initialImage={stackImage(2, openPlane)}
      loadRequestIdRef={loadRequestIdRef}
      onReady={(snapshot) => {
        api = snapshot.api
        image = snapshot.image
        morphologyState = snapshot.morphologyState
      }}
    />,
  )

  return { loadRequestIdRef, openPlane, requests }
}

describe('useMorphologyZPlaneWorkflow', () => {
  it('shows the requested plane until it opens, and the latest request wins', async () => {
    const { openPlane, requests } = renderProbe()

    act(() => {
      api.selectMorphologyZPlane(3)
    })
    expect(api.requestedZPlane).toBe(3)

    act(() => {
      api.selectMorphologyZPlane(4)
    })
    expect(requests[0]?.signal?.aborted).toBe(true)
    expect(api.requestedZPlane).toBe(4)

    await act(async () => {
      requests[0]?.resolve(stackImage(3, openPlane))
      requests[1]?.resolve(stackImage(4, openPlane))
    })

    expect(image?.zStack?.zPlane).toBe(4)
    expect(api.requestedZPlane).toBeNull()
  })

  it('ignores a plane that opens after another dataset starts loading', async () => {
    const { loadRequestIdRef, openPlane, requests } = renderProbe()

    act(() => {
      api.selectMorphologyZPlane(0)
    })
    loadRequestIdRef.current = 2
    await act(async () => {
      requests[0]?.resolve(stackImage(0, openPlane))
    })

    expect(image?.zStack?.zPlane).toBe(2)
  })

  it('keeps the current plane and reports an error when a plane fails to open', async () => {
    const { requests } = renderProbe()

    act(() => {
      api.selectMorphologyZPlane(1)
    })
    await act(async () => {
      requests[0]?.reject(new Error('HTTP 500'))
    })

    expect(image?.zStack?.zPlane).toBe(2)
    expect(api.requestedZPlane).toBeNull()
    expect(morphologyState.status).toBe('error')
  })
})
