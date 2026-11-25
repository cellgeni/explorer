import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImagePyramidLoader, ImagePyramidPlane } from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import { sameMorphologyFrame, type ShownMorphologyFrame } from './morphologyFrame'

// Time points a second (plan 28-D7).
export const TIME_POINT_SPEEDS: readonly number[] = [1, 2, 5, 10, 20]
export const DEFAULT_TIME_POINT_SPEED = 5

const NO_PLANES: readonly ImagePyramidPlane[] = []

interface UseTimePointPlaybackOptions {
  readonly image: MorphologyImage | null
  readonly shownFrame: ShownMorphologyFrame
  // False stops Play for good: in the 3D view, during a screenshot, or once a
  // plane fails to open (28-D10).
  readonly enabled: boolean
  // Time points read ahead while Play runs (28-D8).
  readonly prefetchCount: number
  readonly selectTimePoint: (timePoint: number) => void
}

export interface TimePointPlayback {
  readonly playing: boolean
  readonly speed: number
  readonly loop: boolean
  // The time point Play started from, while it runs: the link keeps it until
  // Play stops (28-D12).
  readonly startTimePoint: number | null
  // The next time points, for the canvas to read ahead.
  readonly prefetchPlanes: readonly ImagePyramidPlane[]
  readonly play: () => void
  readonly pause: () => void
  readonly setSpeed: (speed: number) => void
  readonly setLoop: (loop: boolean) => void
}

interface PlaySession {
  // The image playing; another one stops Play.
  readonly loader: ImagePyramidLoader
  readonly startTimePoint: number
}

// Plays the dataset image's time points (plan 28-G). The next time point is
// asked for once the shown one has been on the canvas for 1/speed seconds,
// and the canvas shows it once it is whole (28-D6), so a slow time point
// delays the next and none is skipped.
export function useTimePointPlayback({
  image,
  shownFrame,
  enabled,
  prefetchCount,
  selectTimePoint,
}: UseTimePointPlaybackOptions): TimePointPlayback {
  const timeSeries = image?.timeSeries
  const loader = image?.loader ?? null
  const [session, setSession] = useState<PlaySession | null>(null)
  const [speed, setSpeed] = useState(DEFAULT_TIME_POINT_SPEED)
  const [loop, setLoop] = useState(true)
  const playing =
    session !== null && enabled && timeSeries !== undefined && session.loader === loader

  // Stopped for good, so it does not start again on its own.
  if (session !== null && !playing) {
    setSession(null)
  }

  const timePoint = timeSeries?.timePoint
  const sizeT = timeSeries?.sizeT
  const zPlane = image?.zStack?.zPlane
  const frameImage = image?.url
  const framePlane = `${zPlane?.toString() ?? ''}:${timePoint?.toString() ?? ''}`

  useEffect(() => {
    if (
      !playing ||
      timePoint === undefined ||
      sizeT === undefined ||
      frameImage === undefined
    ) {
      return
    }

    const frame = { image: frameImage, plane: framePlane }
    let timer: ReturnType<typeof setTimeout> | undefined
    const startTimer = () => {
      if (timer !== undefined || !sameMorphologyFrame(shownFrame.current(), frame)) {
        return
      }

      timer = setTimeout(() => {
        const next = timePoint + 1

        if (next < sizeT) {
          selectTimePoint(next)
        } else if (loop) {
          selectTimePoint(0)
        } else {
          setSession(null)
        }
      }, 1000 / speed)
    }

    startTimer()
    const unsubscribe = shownFrame.subscribe(startTimer)

    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [
    frameImage,
    framePlane,
    loop,
    playing,
    selectTimePoint,
    shownFrame,
    sizeT,
    speed,
    timePoint,
  ])

  // A hidden page gets no animation frames and slowed timers.
  useEffect(() => {
    if (!playing) {
      return
    }

    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        setSession(null)
      }
    }

    document.addEventListener('visibilitychange', stopWhenHidden)

    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [playing])

  const play = useCallback(() => {
    if (image === null || timeSeries === undefined || !enabled) {
      return
    }

    // At the end with Loop off, Play starts again from the first.
    const atEnd = !loop && timeSeries.timePoint >= timeSeries.sizeT - 1
    const startTimePoint = atEnd ? 0 : timeSeries.timePoint

    if (atEnd) {
      selectTimePoint(0)
    }

    setSession({ loader: image.loader, startTimePoint })
  }, [enabled, image, loop, selectTimePoint, timeSeries])
  const pause = useCallback(() => {
    setSession(null)
  }, [])
  const prefetchPlanes = useMemo(() => {
    if (!playing || timePoint === undefined || sizeT === undefined) {
      return NO_PLANES
    }

    const planes: ImagePyramidPlane[] = []

    for (let step = 1; step <= prefetchCount; step += 1) {
      const next: number = timePoint + step

      if (next >= sizeT && !loop) {
        break
      }

      const t: number = next % sizeT

      if (t === timePoint) {
        break
      }

      planes.push({ ...(zPlane === undefined ? {} : { z: zPlane }), t })
    }

    return planes
  }, [loop, playing, prefetchCount, sizeT, timePoint, zPlane])

  return {
    playing,
    speed,
    loop,
    startTimePoint: playing ? session.startTimePoint : null,
    prefetchPlanes,
    play,
    pause,
    setSpeed,
    setLoop,
  }
}
