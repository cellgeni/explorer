import { useEffect, useRef, useState } from 'react'
import type { LinkedViewState } from '../../components/linkedView'
import type { SpatialElement } from '../../datasets/spatialDataset'
import {
  boundaryRequestCovers,
  normalizeBoundaryCellLimit,
  paddedBoundaryBbox,
  shouldLoadBoundaryPolygons,
  type BoundaryRequestArea,
  type BoundaryViewportCandidate,
} from '../../rendering/boundaryViewport'
import { isAbortError } from '../../utils/abort'
import {
  panelBoundaryCandidate,
  type PanelBoundaryLoaders,
  type PanelSize,
} from './panelBoundaries'

// A panel's cell outlines while its `Cell boundaries` is on (plan 30-D9).
// Once the panel's view has rested, as the main view's report does, they are
// read for the view and a margin around it, when fewer cells than the
// Boundary limit are in view; the outlines drawn stay until the next ones
// come. A margin that holds too many is read again without it.

export type PanelBoundaryStatus =
  // Off, or not read yet.
  | 'idle'
  // Reading whether the dataset has outlines.
  | 'checking'
  // The dataset has none.
  | 'none'
  // Too many cells in view: zoom in.
  | 'zoom'
  | 'loading'
  | 'ready'
  | 'error'

export interface PanelBoundaryState {
  readonly status: PanelBoundaryStatus
  readonly elements: readonly SpatialElement[]
  // The cells in view when they were last counted.
  readonly visibleCellCount: number
  readonly error: string | null
}

// How long a panel's view rests before its outlines are read: the main
// view's report delay.
export const PANEL_BOUNDARY_DELAY_MS = 180

const NO_ELEMENTS: readonly SpatialElement[] = []
const IDLE: PanelBoundaryState = {
  status: 'idle',
  elements: NO_ELEMENTS,
  visibleCellCount: 0,
  error: null,
}
const CHECKING: PanelBoundaryState = { ...IDLE, status: 'checking' }
const NONE: PanelBoundaryState = { ...IDLE, status: 'none' }

interface Support {
  readonly url: string
  readonly has: boolean
  readonly error: string | null
}

export function usePanelBoundaries({
  url,
  enabled,
  loaders,
  positions,
  view,
  size,
  cellLimit,
}: {
  readonly url: string
  readonly enabled: boolean
  readonly loaders: PanelBoundaryLoaders
  // The section's cells (interleaved x, y), to count those in view; null
  // until its preview is read.
  readonly positions: Float32Array | null
  // The view the panel shows, and its size; null until known.
  readonly view: LinkedViewState | null
  readonly size: PanelSize | null
  readonly cellLimit: number
}): PanelBoundaryState {
  const [support, setSupport] = useState<Support | null>(null)
  // The URL `support` was read for without an error, so it is not read again.
  const supportUrlRef = useRef<string | null>(null)
  const [read, setRead] = useState<{
    readonly url: string
    readonly state: PanelBoundaryState
  } | null>(null)
  const areaRef = useRef<{
    readonly url: string
    readonly area: BoundaryRequestArea
  } | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled) return undefined

    // The dataset stays open while the panel draws its outlines, so those a
    // source reads whole are kept.
    const release = loaders.retainDataset(url)
    const controller = new AbortController()

    if (supportUrlRef.current !== url) {
      loaders.hasCellBoundaries(url, controller.signal).then(
        (has) => {
          if (controller.signal.aborted) return
          supportUrlRef.current = url
          setSupport({ url, has, error: null })
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return
          setSupport({ url, has: false, error: errorMessage(error) })
        },
      )
    }

    return () => {
      controller.abort()
      // A read in flight stops with the outlines; the next asks again.
      controllerRef.current?.abort()
      controllerRef.current = null
      areaRef.current = null
      release()
    }
  }, [enabled, loaders, url])

  const has = enabled && support?.url === url && support.error === null && support.has
  const viewX = view?.target[0]
  const viewY = view?.target[1]
  const viewZoom = view?.zoom
  const width = size?.width
  const height = size?.height

  useEffect(() => {
    if (
      !has ||
      positions === null ||
      viewX === undefined ||
      viewY === undefined ||
      viewZoom === undefined ||
      width === undefined ||
      height === undefined
    ) {
      return undefined
    }

    const readFor = (candidate: BoundaryViewportCandidate, padded: boolean): void => {
      if (!shouldLoadBoundaryPolygons(candidate, { cellLimit })) {
        controllerRef.current?.abort()
        controllerRef.current = null
        areaRef.current = null
        setRead({
          url,
          state: {
            status: 'zoom',
            elements: NO_ELEMENTS,
            visibleCellCount: candidate.visibleCellCount,
            error: null,
          },
        })
        return
      }

      const area = areaRef.current?.url === url ? areaRef.current.area : null
      if (padded && boundaryRequestCovers(area, candidate)) return

      const bbox = padded ? paddedBoundaryBbox(candidate, { cellLimit }) : candidate.bbox
      areaRef.current = { url, area: { bbox, zoom: candidate.viewState.zoom } }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setRead((current) => ({
        url,
        state: {
          status: 'loading',
          elements: current?.url === url ? current.state.elements : NO_ELEMENTS,
          visibleCellCount: candidate.visibleCellCount,
          error: null,
        },
      }))

      loaders
        .loadBoundaryElements(url, bbox, { signal: controller.signal, cellLimit })
        .then((batch) => {
          if (controller.signal.aborted) return

          if (batch.overLimit !== undefined) {
            // Nothing is drawn here, so the next view asks again.
            areaRef.current = null

            // The margin held more outlines than the limit, but the view
            // holds fewer: read the view alone.
            if (
              padded &&
              candidate.visibleCellCount < normalizeBoundaryCellLimit(cellLimit)
            ) {
              readFor(candidate, false)
              return
            }

            setRead({
              url,
              state: {
                status: 'zoom',
                elements: NO_ELEMENTS,
                visibleCellCount: batch.overLimit.count ?? candidate.visibleCellCount,
                error: null,
              },
            })
            return
          }

          setRead({
            url,
            state: {
              status: 'ready',
              elements: batch.elements,
              visibleCellCount: candidate.visibleCellCount,
              error: null,
            },
          })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return

          areaRef.current = null
          setRead({
            url,
            state: {
              status: 'error',
              elements: NO_ELEMENTS,
              visibleCellCount: candidate.visibleCellCount,
              error: errorMessage(error),
            },
          })
        })
    }

    const timer = setTimeout(() => {
      readFor(
        panelBoundaryCandidate(
          { target: [viewX, viewY], zoom: viewZoom },
          { width, height },
          positions,
        ),
        true,
      )
    }, PANEL_BOUNDARY_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [cellLimit, has, height, loaders, positions, url, viewX, viewY, viewZoom, width])

  if (!enabled) return IDLE
  if (support?.url !== url) return CHECKING
  if (support.error !== null) {
    return { ...IDLE, status: 'error', error: support.error }
  }
  if (!support.has) return NONE

  return read?.url === url ? read.state : IDLE
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
