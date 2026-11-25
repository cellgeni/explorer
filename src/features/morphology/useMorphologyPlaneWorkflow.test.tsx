import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidPlane } from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { MorphologyLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { useMorphologyPlaneWorkflow } from './useMorphologyPlaneWorkflow'

type OpenPlane = (
  plane: ImagePyramidPlane,
  signal?: AbortSignal,
) => Promise<MorphologyImage>

function stackImage(
  zPlane: number,
  openPlane: OpenPlane,
  timePoint = 0,
): MorphologyImage {
  return {
    url: 'https://example.test/stack.ome.zarr',
    loader: {} as MorphologyImage['loader'],
    channels: [],
    channelLoaders: [],
    zStack: { sizeZ: 5, zPlane },
    timeSeries: { sizeT: 10, timePoint },
    openPlane,
  }
}

interface Deferred {
  readonly plane: ImagePyramidPlane
  readonly signal: AbortSignal | undefined
  readonly resolve: (image: MorphologyImage) => void
  readonly reject: (error: unknown) => void
}

interface Snapshot {
  readonly api: ReturnType<typeof useMorphologyPlaneWorkflow>
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

  const nextApi = useMorphologyPlaneWorkflow({
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
    (plane: ImagePyramidPlane, signal?: AbortSignal) =>
      new Promise<MorphologyImage>((resolve, reject) => {
        requests.push({ plane, signal, resolve, reject })
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

describe('useMorphologyPlaneWorkflow', () => {
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

  // Plan 28.
  it('opens another time point at the same z plane', async () => {
    const { openPlane, requests } = renderProbe()

    act(() => {
      api.selectMorphologyTimePoint(6)
    })
    expect(api.requestedTimePoint).toBe(6)
    expect(api.requestedZPlane).toBe(2)
    expect(requests[0]?.plane).toEqual({ z: 2, t: 6 })

    await act(async () => {
      requests[0]?.resolve(stackImage(2, openPlane, 6))
    })

    expect(image?.timeSeries?.timePoint).toBe(6)
    expect(api.requestedTimePoint).toBeNull()
  })

  it('keeps a z plane still opening when a time point is asked for', async () => {
    const { requests } = renderProbe()

    act(() => {
      api.selectMorphologyZPlane(4)
    })
    act(() => {
      api.selectMorphologyTimePoint(1)
    })

    expect(requests[0]?.signal?.aborted).toBe(true)
    expect(requests[1]?.plane).toEqual({ z: 4, t: 1 })

    // Back to the shown plane: nothing to open, and the request is dropped.
    act(() => {
      api.selectMorphologyZPlane(2)
    })
    act(() => {
      api.selectMorphologyTimePoint(0)
    })

    expect(requests[2]?.signal?.aborted).toBe(true)
    expect(requests).toHaveLength(3)
    expect(api.requestedZPlane).toBeNull()
    expect(api.requestedTimePoint).toBeNull()
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
