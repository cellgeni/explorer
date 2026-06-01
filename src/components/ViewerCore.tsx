import { DeckGL } from '@deck.gl/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MorphologyCanvas } from './MorphologyCanvas'
import {
  createOverviewLayers,
  createOverviewViewState,
  spatialOverviewView,
} from '../rendering/deckLayers'
import { aggregateOverviewCells, overviewCellsInBbox } from '../rendering/cellAggregation'
import { hexCellBoundariesForVisibleCells } from '../rendering/hexCellBoundaries'
import { morphologyViewportBbox } from '../rendering/morphologyCanvas'
import type { ViewStateChangeParameters } from '@deck.gl/core'
import type { BBox } from '../data/coords'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { MorphologyCanvasChannel } from './MorphologyCanvas'
import type { CellBoundaryDatum, OverviewCellDatum } from '../rendering/deckLayers'
import type { OverviewViewState } from '../rendering/deckLayers'

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly expressionCells?: readonly OverviewCellDatum[]
  readonly boundaries?: readonly CellBoundaryDatum[]
  readonly imageLoader?: TiffPyramidLoader | null
  readonly imageChannels?: readonly MorphologyCanvasChannel[]
  readonly imageOpacity?: number
  readonly geneExpressionOpacity?: number
  readonly status?: ViewerLoadStatus
  readonly imageStatus?: ViewerLoadStatus
  readonly boundaryStatus?: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly hexBoundaryMaxVisibleCells?: number
  readonly onImageTileError?: (error: Error) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
}

export interface ViewerViewportDetail {
  readonly bbox: BBox
  readonly visibleCellCount: number
  readonly viewState: OverviewViewState
}

export function ViewerCore({
  cells = [],
  expressionCells = [],
  boundaries = [],
  imageLoader = null,
  imageChannels = [],
  imageOpacity = 1,
  geneExpressionOpacity = 1,
  status = 'idle',
  imageStatus = 'idle',
  boundaryStatus = 'idle',
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  hexBoundaryMaxVisibleCells = 0,
  onImageTileError,
  onViewportChange,
  onCellClick,
}: ViewerCoreProps) {
  const fittedViewState = useMemo(() => createOverviewViewState(cells), [cells])
  const resetKey = viewStateKey(fittedViewState)

  return (
    <ViewerSurface
      key={resetKey}
      cells={cells}
      expressionCells={expressionCells}
      boundaries={boundaries}
      imageLoader={imageLoader}
      imageChannels={imageChannels}
      imageOpacity={imageOpacity}
      geneExpressionOpacity={geneExpressionOpacity}
      initialViewState={fittedViewState}
      status={status}
      imageStatus={imageStatus}
      boundaryStatus={boundaryStatus}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      {...(imageErrorMessage === undefined ? {} : { imageErrorMessage })}
      {...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage })}
      hexBoundaryMaxVisibleCells={hexBoundaryMaxVisibleCells}
      {...(onImageTileError === undefined ? {} : { onImageTileError })}
      {...(onViewportChange === undefined ? {} : { onViewportChange })}
      {...(onCellClick === undefined ? {} : { onCellClick })}
    />
  )
}

interface ViewerSurfaceProps {
  readonly cells: readonly OverviewCellDatum[]
  readonly expressionCells: readonly OverviewCellDatum[]
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly imageLoader: TiffPyramidLoader | null
  readonly imageChannels: readonly MorphologyCanvasChannel[]
  readonly imageOpacity: number
  readonly geneExpressionOpacity: number
  readonly initialViewState: OverviewViewState
  readonly status: ViewerLoadStatus
  readonly imageStatus: ViewerLoadStatus
  readonly boundaryStatus: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly boundaryErrorMessage?: string
  readonly hexBoundaryMaxVisibleCells: number
  readonly onImageTileError?: (error: Error) => void
  readonly onViewportChange?: (detail: ViewerViewportDetail) => void
  readonly onCellClick?: (cell: OverviewCellDatum) => void
}

function ViewerSurface({
  cells,
  expressionCells,
  boundaries,
  imageLoader,
  imageChannels,
  imageOpacity,
  geneExpressionOpacity,
  initialViewState,
  status,
  imageStatus,
  boundaryStatus,
  errorMessage,
  imageErrorMessage,
  boundaryErrorMessage,
  hexBoundaryMaxVisibleCells,
  onImageTileError,
  onViewportChange,
  onCellClick,
}: ViewerSurfaceProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewState, setViewState] = useState<OverviewViewState>(initialViewState)
  const [viewport, setViewport] = useState<CssViewportSize>({
    width: 0,
    height: 0,
  })
  const viewportBbox = useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null
    }

    return morphologyViewportBbox(viewState, viewport)
  }, [viewState, viewport])
  const visibleCells = useMemo(
    () => (viewportBbox === null ? cells : overviewCellsInBbox(cells, viewportBbox)),
    [cells, viewportBbox],
  )
  const displayCells = useMemo(
    () => aggregateOverviewCells(visibleCells, viewState),
    [visibleCells, viewState],
  )
  const hexBoundaries = useMemo(
    () =>
      hexCellBoundariesForVisibleCells(visibleCells, {
        maxCells: hexBoundaryMaxVisibleCells,
      }),
    [hexBoundaryMaxVisibleCells, visibleCells],
  )
  const layers = useMemo(
    () =>
      createOverviewLayers(displayCells, boundaries, hexBoundaries, expressionCells, {
        geneExpressionOpacity,
      }),
    [boundaries, displayCells, expressionCells, geneExpressionOpacity, hexBoundaries],
  )
  const hasCells = cells.length > 0
  const hasImage = imageLoader !== null || imageChannels.length > 0
  const visibleCellCount = visibleCells.length
  const viewportMessage = readViewportMessage(status, imageStatus, boundaryStatus, {
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(imageErrorMessage === undefined ? {} : { imageErrorMessage }),
    ...(boundaryErrorMessage === undefined ? {} : { boundaryErrorMessage }),
  })
  const handleViewStateChange = useCallback(
    ({ viewState: nextViewState }: ViewStateChangeParameters) => {
      setViewState(normaliseViewState(nextViewState))
    },
    [],
  )
  const handleDeckClick = useCallback(
    (info: { readonly object?: unknown }) => {
      if (onCellClick === undefined || !isOverviewCellDatum(info.object)) {
        return
      }

      onCellClick(info.object)
    },
    [onCellClick],
  )

  useEffect(() => {
    const frame = frameRef.current

    if (frame === null) {
      return
    }

    const updateViewport = () => {
      const rect = frame.getBoundingClientRect()
      setViewport({
        width: rect.width || frame.clientWidth,
        height: rect.height || frame.clientHeight,
      })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(frame)

    return () => {
      window.removeEventListener('resize', updateViewport)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (onViewportChange === undefined || !hasCells || viewportBbox === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      onViewportChange({
        bbox: viewportBbox,
        visibleCellCount,
        viewState,
      })
    }, 180)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [hasCells, onViewportChange, viewState, viewportBbox, visibleCellCount])

  return (
    <div
      ref={frameRef}
      className="viewport-frame"
      role="img"
      aria-label="Spatial viewer canvas area"
    >
      {!hasImage ? <div className="viewport-grid" aria-hidden="true" /> : null}
      <MorphologyCanvas
        channels={imageChannels}
        loader={imageLoader}
        opacity={imageOpacity}
        viewState={viewState}
        {...(onImageTileError === undefined ? {} : { onTileError: onImageTileError })}
      />
      {hasCells ? (
        <div className="deckgl-host" aria-hidden="true">
          <DeckGL
            views={spatialOverviewView}
            viewState={viewState}
            onViewStateChange={handleViewStateChange}
            onClick={handleDeckClick}
            controller
            layers={layers}
          />
        </div>
      ) : null}
      {!hasCells ? (
        <div className="deck-layer-surface">
          <div className="cell-field" aria-hidden="true">
            <span className="cell-node cell-node-a" />
            <span className="cell-node cell-node-b" />
            <span className="cell-node cell-node-c" />
            <span className="cell-node cell-node-d" />
          </div>
        </div>
      ) : null}
      {viewportMessage === null ? null : (
        <p
          className={`viewport-message${viewportMessage.kind === 'error' ? ' viewport-message-error' : ''}`}
          aria-live={viewportMessage.kind === 'error' ? 'assertive' : 'polite'}
        >
          {viewportMessage.text}
        </p>
      )}
    </div>
  )
}

function readViewportMessage(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  messages: {
    readonly errorMessage?: string
    readonly imageErrorMessage?: string
    readonly boundaryErrorMessage?: string
  },
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading') {
    return { kind: 'info', text: 'Loading overview cells…' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? 'Dataset load failed.',
    }
  }

  if (imageStatus === 'loading') {
    return { kind: 'info', text: 'Reading OME-TIFF image…' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? 'OME-TIFF image load failed.',
    }
  }

  if (boundaryStatus === 'loading') {
    return { kind: 'info', text: 'Loading cell boundaries…' }
  }

  if (boundaryStatus === 'error') {
    return {
      kind: 'error',
      text: messages.boundaryErrorMessage ?? 'Cell boundary load failed.',
    }
  }

  return null
}

function normaliseViewState(viewState: {
  readonly target?: readonly [number, number] | readonly [number, number, number]
  readonly zoom?: number
  readonly minZoom?: number
  readonly maxZoom?: number
}): OverviewViewState {
  const target = viewState.target ?? [0, 0, 0]

  return {
    target: [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0],
    zoom: viewState.zoom ?? 0,
    minZoom: viewState.minZoom ?? -10,
    maxZoom: viewState.maxZoom ?? 10,
  }
}

function viewStateKey(viewState: OverviewViewState): string {
  return `${viewState.target.join(':')}:${viewState.zoom}`
}

function isOverviewCellDatum(value: unknown): value is OverviewCellDatum {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<OverviewCellDatum>

  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.position) &&
    typeof candidate.radiusPixels === 'number'
  )
}
