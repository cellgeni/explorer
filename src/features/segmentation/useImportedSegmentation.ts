import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BBox } from '../../data/coords'
import {
  openImportedSegmentation,
  type ImportedSegmentation,
  type SegmentationPlacement,
} from '../../datasets/importedSegmentation'
import type { SegmentationSource } from '../../datasets/segmentationSource'
import { isAbortError, type AppendDebugEvent } from '../app-shell/appRuntimeModel'
import { readErrorMessage } from '../errors/loadErrorModel'

// The segmentation imported onto the open image (plan 25): one at a time,
// read against the image's pixel size, and dropped when another dataset
// opens.

export type ImportedSegmentationState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading'
      readonly source: SegmentationSource
      // Polygons read so far, while a polygon file is read.
      readonly shapeCount?: number
    }
  | {
      readonly status: 'ready'
      readonly source: SegmentationSource
      readonly segmentation: ImportedSegmentation
    }
  | {
      readonly status: 'error'
      readonly source: SegmentationSource
      readonly message: string
    }

export const IDLE_IMPORTED_SEGMENTATION_STATE: ImportedSegmentationState = {
  status: 'idle',
}

export interface UseImportedSegmentationOptions {
  // The open image dataset; null when none is open (or it is not an image).
  readonly datasetUrl: string | null
  // The open image's placement; null until it is read.
  readonly placement: SegmentationPlacement | null
  readonly appendDebugEvent: AppendDebugEvent
  // Called when a segmentation is ready, to show its outlines.
  readonly onReady?: () => void
  readonly open?: typeof openImportedSegmentation
}

export interface ImportedSegmentationController {
  readonly state: ImportedSegmentationState
  // The ready segmentation, else null.
  readonly segmentation: ImportedSegmentation | null
  readonly load: (source: SegmentationSource) => void
  readonly clear: () => void
  // Outlines in a box, for the boundary requests; undefined without a ready
  // segmentation.
  readonly viewportCellCount: ((bbox: BBox) => number) | undefined
}

export function useImportedSegmentation({
  datasetUrl,
  placement,
  appendDebugEvent,
  onReady,
  open = openImportedSegmentation,
}: UseImportedSegmentationOptions): ImportedSegmentationController {
  const [state, setState] = useState<ImportedSegmentationState>(
    IDLE_IMPORTED_SEGMENTATION_STATE,
  )
  const abortRef = useRef<AbortController | null>(null)
  const onReadyRef = useRef(onReady)
  // A load asked for before the image's placement is known.
  const queuedRef = useRef<SegmentationSource | null>(null)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const start = useCallback(
    (source: SegmentationSource, imagePlacement: SegmentationPlacement) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const startedAt = performance.now()
      setState({ status: 'loading', source })
      appendDebugEvent(`Segmentation loading: ${source.url}`, {
        coalesceKey: 'segmentation',
      })

      open(source, imagePlacement, {
        signal: controller.signal,
        onProgress: (shapeCount) => {
          if (abortRef.current === controller) {
            setState({ status: 'loading', source, shapeCount })
          }
        },
      }).then(
        (segmentation) => {
          if (abortRef.current !== controller) {
            return
          }

          abortRef.current = null
          setState({ status: 'ready', source, segmentation })
          const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
          appendDebugEvent(
            segmentation.shapeCount === undefined
              ? `Segmentation ready: label mask ${segmentation.name} in ${seconds} s`
              : `Segmentation ready: ${segmentation.shapeCount.toLocaleString()} outlines from ${segmentation.name} in ${seconds} s`,
            { coalesceKey: 'segmentation' },
          )
          onReadyRef.current?.()
        },
        (cause: unknown) => {
          if (abortRef.current !== controller || isAbortError(cause)) {
            return
          }

          abortRef.current = null
          const message = readErrorMessage(cause)
          setState({ status: 'error', source, message })
          appendDebugEvent(`Segmentation failed: ${message}`, {
            coalesceKey: 'segmentation',
          })
        },
      )
    },
    [appendDebugEvent, open],
  )

  const load = useCallback(
    (source: SegmentationSource) => {
      if (placement === null) {
        queuedRef.current = source
        setState({ status: 'loading', source })
        return
      }

      queuedRef.current = null
      start(source, placement)
    },
    [placement, start],
  )

  const clear = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    queuedRef.current = null
    setState(IDLE_IMPORTED_SEGMENTATION_STATE)
  }, [])

  // Another dataset drops the segmentation.
  useEffect(() => clear, [clear, datasetUrl])

  useEffect(() => {
    const queued = queuedRef.current

    if (queued !== null && placement !== null) {
      queuedRef.current = null
      start(queued, placement)
    }
  }, [placement, start])

  const segmentation = state.status === 'ready' ? state.segmentation : null
  const viewportCellCount = useMemo(
    () =>
      segmentation === null
        ? undefined
        : (bbox: BBox) => segmentation.estimateCount(bbox),
    [segmentation],
  )

  return { state, segmentation, load, clear, viewportCellCount }
}
