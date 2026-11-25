import { act, renderHook } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import { ShownMorphologyFrame } from './morphologyFrame'
import { useTimePointPlayback } from './useTimePointPlayback'

const url = 'https://example.test/cells.ome.zarr'
const root = { url } as ImagePyramidLoader

function imageAt(
  timePoint: number,
  options: {
    readonly sizeT?: number
    readonly zPlane?: number
    readonly loader?: ImagePyramidLoader
  } = {},
): MorphologyImage {
  return {
    url,
    loader: options.loader ?? root,
    channels: [],
    channelLoaders: [],
    timeSeries: { sizeT: options.sizeT ?? 4, timePoint },
    ...(options.zPlane === undefined
      ? {}
      : { zStack: { sizeZ: 5, zPlane: options.zPlane } }),
  }
}

interface PlayerProps {
  readonly enabled?: boolean
  readonly loader?: ImagePyramidLoader
}

// The hook over an image whose time point it sets, as the plane workflow
// does; `shown` stands for the canvas.
function renderPlayer(
  start: number,
  options: { readonly sizeT?: number; readonly zPlane?: number } = {},
) {
  const shown = new ShownMorphologyFrame()
  const view = renderHook(
    ({ enabled = true, loader }: PlayerProps) => {
      const [timePoint, setTimePoint] = useState(start)
      const image = useMemo(
        () =>
          imageAt(timePoint, { ...options, ...(loader === undefined ? {} : { loader }) }),
        [loader, timePoint],
      )

      return useTimePointPlayback({
        image,
        shownFrame: shown,
        enabled,
        prefetchCount: 2,
        selectTimePoint: setTimePoint,
      })
    },
    { initialProps: {} as PlayerProps },
  )
  const show = (timePoint: number) => {
    act(() => {
      shown.show({
        image: url,
        plane: `${options.zPlane?.toString() ?? ''}:${timePoint.toString()}`,
      })
    })
  }
  const advance = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  return { ...view, show, advance }
}

describe('useTimePointPlayback (plan 28-G)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('asks for the next time point once the shown one has been on for 1/speed s', () => {
    const { result, show, advance } = renderPlayer(0)

    show(0)
    act(() => {
      result.current.play()
    })
    expect(result.current.playing).toBe(true)

    advance(199)
    expect(result.current.prefetchPlanes).toEqual([{ t: 1 }, { t: 2 }])
    advance(1)
    // Time point 1 is asked for; the next waits until the canvas shows it.
    expect(result.current.prefetchPlanes).toEqual([{ t: 2 }, { t: 3 }])
    advance(5000)
    expect(result.current.prefetchPlanes).toEqual([{ t: 2 }, { t: 3 }])

    show(1)
    act(() => {
      result.current.setSpeed(10)
    })
    advance(100)
    expect(result.current.prefetchPlanes).toEqual([{ t: 3 }, { t: 0 }])
  })

  it('loops to the first time point, or stops at the last without Loop', () => {
    const { result, show, advance } = renderPlayer(3)

    show(3)
    act(() => {
      result.current.play()
    })
    advance(200)
    show(0)
    expect(result.current.playing).toBe(true)
    expect(result.current.prefetchPlanes).toEqual([{ t: 1 }, { t: 2 }])

    act(() => {
      result.current.setLoop(false)
    })
    expect(result.current.prefetchPlanes).toEqual([{ t: 1 }, { t: 2 }])
    advance(200)
    show(1)
    advance(200)
    show(2)
    advance(200)
    show(3)
    expect(result.current.prefetchPlanes).toEqual([])
    advance(200)
    expect(result.current.playing).toBe(false)

    // Play at the last time point without Loop starts from the first.
    act(() => {
      result.current.play()
    })
    expect(result.current.playing).toBe(true)
    expect(result.current.startTimePoint).toBe(0)
    expect(result.current.prefetchPlanes).toEqual([{ t: 1 }, { t: 2 }])
  })

  it('reads ahead at the shown z plane', () => {
    const { result, show } = renderPlayer(1, { zPlane: 3 })

    show(1)
    act(() => {
      result.current.play()
    })

    expect(result.current.prefetchPlanes).toEqual([
      { z: 3, t: 2 },
      { z: 3, t: 3 },
    ])
  })

  it('keeps the start time point for the link while it plays', () => {
    const { result, show, advance } = renderPlayer(2)

    show(2)
    expect(result.current.startTimePoint).toBeNull()
    act(() => {
      result.current.play()
    })
    advance(200)
    show(3)
    expect(result.current.startTimePoint).toBe(2)

    act(() => {
      result.current.pause()
    })
    expect(result.current.startTimePoint).toBeNull()
  })

  it('stops for good when disabled, and does not start again', () => {
    const { result, show, rerender } = renderPlayer(0)

    show(0)
    act(() => {
      result.current.play()
    })
    rerender({ enabled: false })
    expect(result.current.playing).toBe(false)

    rerender({ enabled: true })
    expect(result.current.playing).toBe(false)
  })

  it('stops when another image opens', () => {
    const { result, show, rerender } = renderPlayer(0)

    show(0)
    act(() => {
      result.current.play()
    })
    rerender({ loader: { url } as ImagePyramidLoader })

    expect(result.current.playing).toBe(false)
  })

  it('stops when the page is hidden', () => {
    const { result, show } = renderPlayer(0)

    show(0)
    act(() => {
      result.current.play()
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.playing).toBe(false)
  })
})
