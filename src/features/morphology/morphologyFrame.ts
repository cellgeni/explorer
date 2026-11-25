import { useSyncExternalStore } from 'react'
import type { MorphologyCanvasFrame } from '../../components/MorphologyCanvas'
import type { MorphologyImage } from '../../data/morphologyImage'

// The dataset image's plane as the canvas names it (plan 28-D6), for an image
// with z planes or time points.
export function morphologyImageFrame(
  image: Pick<MorphologyImage, 'url' | 'zStack' | 'timeSeries'> | null,
): MorphologyCanvasFrame | undefined {
  if (image === null || (image.zStack === undefined && image.timeSeries === undefined)) {
    return undefined
  }

  return {
    image: image.url,
    plane: `${image.zStack?.zPlane.toString() ?? ''}:${image.timeSeries?.timePoint.toString() ?? ''}`,
  }
}

export function sameMorphologyFrame(
  a: MorphologyCanvasFrame | null | undefined,
  b: MorphologyCanvasFrame | null | undefined,
): boolean {
  return a?.image === b?.image && a?.plane === b?.plane
}

// The plane the main canvas shows, which is behind the one asked for while
// that one loads (28-D6). The plane controls and Play follow it; it is kept
// out of React state, so a shown plane re-renders only them.
export class ShownMorphologyFrame {
  private frame: MorphologyCanvasFrame | null = null
  private readonly listeners = new Set<() => void>()

  readonly current = (): MorphologyCanvasFrame | null => this.frame

  readonly show = (frame: MorphologyCanvasFrame): void => {
    if (sameMorphologyFrame(this.frame, frame)) {
      return
    }

    this.frame = frame

    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }
}

// The image's plane is on the canvas; true for an image without planes.
export function useMorphologyFrameShown(
  shown: ShownMorphologyFrame,
  frame: MorphologyCanvasFrame | undefined,
): boolean {
  return useSyncExternalStore(
    shown.subscribe,
    () => frame === undefined || sameMorphologyFrame(shown.current(), frame),
  )
}
