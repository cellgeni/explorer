import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ImagePyramidPlane } from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import { isAbortError, type DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import type { MorphologyLoadState } from '../dataset/datasetLoadModel'
import { morphologyLoadFailed, morphologyLoadReady } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'

interface MutableRef<T> {
  current: T
}

interface UseMorphologyPlaneWorkflowOptions {
  readonly callbacks: {
    readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  }
  readonly data: {
    readonly morphologyImage: MorphologyImage | null
  }
  readonly refs: {
    readonly loadRequestIdRef: MutableRef<number>
  }
  readonly setters: {
    readonly setMorphologyImage: Dispatch<SetStateAction<MorphologyImage | null>>
    readonly setMorphologyState: Dispatch<
      SetStateAction<MorphologyLoadState<StructuredLoadError>>
    >
  }
}

interface UseMorphologyPlaneWorkflowResult {
  // The plane being opened, while it opens.
  readonly requestedZPlane: number | null
  readonly requestedTimePoint: number | null
  readonly selectMorphologyZPlane: (zPlane: number) => void
  readonly selectMorphologyTimePoint: (timePoint: number) => void
}

interface PlaneRequest {
  readonly image: MorphologyImage
  readonly plane: ImagePyramidPlane
}

// Opens the dataset image's channels at another z plane or time point. The
// latest request wins: an earlier one still opening is aborted, and the axis
// it changed carries into the new one. Channel colours and contrast windows
// carry over to the new plane.
export function useMorphologyPlaneWorkflow({
  callbacks,
  data,
  refs,
  setters,
}: UseMorphologyPlaneWorkflowOptions): UseMorphologyPlaneWorkflowResult {
  const { appendDebugEvent } = callbacks
  const { morphologyImage } = data
  const { loadRequestIdRef } = refs
  const { setMorphologyImage, setMorphologyState } = setters
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef<PlaneRequest | null>(null)
  const [request, setRequest] = useState<PlaneRequest | null>(null)

  const selectMorphologyPlane = useCallback(
    (requested: ImagePyramidPlane) => {
      const image = morphologyImage
      const openPlane = image?.openPlane

      if (image === null || openPlane === undefined) {
        return
      }

      const pending =
        requestRef.current?.image === image ? requestRef.current.plane : undefined
      const z = requested.z ?? pending?.z ?? image.zStack?.zPlane
      const t = requested.t ?? pending?.t ?? image.timeSeries?.timePoint
      const plane: ImagePyramidPlane = {
        ...(z === undefined ? {} : { z }),
        ...(t === undefined ? {} : { t }),
      }
      const updateRequest = (next: PlaneRequest | null) => {
        requestRef.current = next
        setRequest(next)
      }

      abortRef.current?.abort()
      abortRef.current = null

      if (z === image.zStack?.zPlane && t === image.timeSeries?.timePoint) {
        updateRequest(null)
        return
      }

      const controller = new AbortController()
      const requestId = loadRequestIdRef.current
      const isCurrent = () =>
        !controller.signal.aborted && loadRequestIdRef.current === requestId
      abortRef.current = controller
      updateRequest({ image, plane })

      openPlane(plane, controller.signal)
        .then((next) => {
          if (!isCurrent()) {
            return
          }

          setMorphologyImage((current) => (current === image ? next : current))
          setMorphologyState((current) =>
            current.status === 'error' ? morphologyLoadReady(image.url) : current,
          )
          appendDebugEvent(planeDescription(next), {
            coalesceKey: 'morphology-plane',
          })
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !isCurrent()) {
            return
          }

          setMorphologyState(
            morphologyLoadFailed(
              image.url,
              createStructuredLoadError('Morphology image', error),
            ),
          )
          appendDebugEvent(`${planeDescription(image, plane)} failed`)
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
            updateRequest(null)
          }
        })
    },
    [
      appendDebugEvent,
      loadRequestIdRef,
      morphologyImage,
      setMorphologyImage,
      setMorphologyState,
    ],
  )
  const selectMorphologyZPlane = useCallback(
    (zPlane: number) => {
      selectMorphologyPlane({ z: zPlane })
    },
    [selectMorphologyPlane],
  )
  const selectMorphologyTimePoint = useCallback(
    (timePoint: number) => {
      selectMorphologyPlane({ t: timePoint })
    },
    [selectMorphologyPlane],
  )
  // A request made for an image that has since been replaced is stale.
  const current = request !== null && request.image === morphologyImage ? request : null

  return {
    requestedZPlane: current?.plane.z ?? null,
    requestedTimePoint: current?.plane.t ?? null,
    selectMorphologyZPlane,
    selectMorphologyTimePoint,
  }
}

// "Z plane 3 of 15 · time point 4 of 40", for the image's plane or another.
function planeDescription(
  image: MorphologyImage,
  plane: ImagePyramidPlane = {
    ...(image.zStack === undefined ? {} : { z: image.zStack.zPlane }),
    ...(image.timeSeries === undefined ? {} : { t: image.timeSeries.timePoint }),
  },
): string {
  const parts = [
    image.zStack === undefined || plane.z === undefined
      ? null
      : `Z plane ${(plane.z + 1).toString()} of ${image.zStack.sizeZ.toString()}`,
    image.timeSeries === undefined || plane.t === undefined
      ? null
      : `time point ${(plane.t + 1).toString()} of ${image.timeSeries.sizeT.toString()}`,
  ].filter((part) => part !== null)
  const description = parts.join(' · ')

  return description.charAt(0).toUpperCase() + description.slice(1)
}
