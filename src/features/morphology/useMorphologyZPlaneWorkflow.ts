import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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

interface UseMorphologyZPlaneWorkflowOptions {
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

interface UseMorphologyZPlaneWorkflowResult {
  // The plane being opened, while it opens.
  readonly requestedZPlane: number | null
  readonly selectMorphologyZPlane: (zPlane: number) => void
}

interface ZPlaneRequest {
  readonly image: MorphologyImage
  readonly zPlane: number
}

// Opens the dataset image's channels at another z plane. The latest request
// wins: an earlier one still opening is aborted. Channel colours and contrast
// windows carry over to the new plane.
export function useMorphologyZPlaneWorkflow({
  callbacks,
  data,
  refs,
  setters,
}: UseMorphologyZPlaneWorkflowOptions): UseMorphologyZPlaneWorkflowResult {
  const { appendDebugEvent } = callbacks
  const { morphologyImage } = data
  const { loadRequestIdRef } = refs
  const { setMorphologyImage, setMorphologyState } = setters
  const abortRef = useRef<AbortController | null>(null)
  const [request, setRequest] = useState<ZPlaneRequest | null>(null)

  const selectMorphologyZPlane = useCallback(
    (zPlane: number) => {
      const image = morphologyImage
      const zStack = image?.zStack

      if (image === null || zStack === undefined) {
        return
      }

      abortRef.current?.abort()
      abortRef.current = null

      if (zPlane === zStack.zPlane) {
        setRequest(null)
        return
      }

      const controller = new AbortController()
      const requestId = loadRequestIdRef.current
      const isCurrent = () =>
        !controller.signal.aborted && loadRequestIdRef.current === requestId
      abortRef.current = controller
      setRequest({ image, zPlane })

      zStack
        .openPlane(zPlane, controller.signal)
        .then((next) => {
          if (!isCurrent()) {
            return
          }

          setMorphologyImage((current) => (current === image ? next : current))
          setMorphologyState((current) =>
            current.status === 'error' ? morphologyLoadReady(image.url) : current,
          )
          appendDebugEvent(
            `Z plane ${((next.zStack?.zPlane ?? zPlane) + 1).toString()} of ${zStack.sizeZ.toString()}`,
            { coalesceKey: 'morphology-z-plane' },
          )
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
          appendDebugEvent(`Z plane ${(zPlane + 1).toString()} failed`)
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null
            setRequest(null)
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

  return {
    // A request made for an image that has since been replaced is stale.
    requestedZPlane:
      request !== null && request.image === morphologyImage ? request.zPlane : null,
    selectMorphologyZPlane,
  }
}
