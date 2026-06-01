import { DeckGL } from '@deck.gl/react'
import { useCallback, useMemo, useState } from 'react'
import { MorphologyCanvas } from './MorphologyCanvas'
import {
  createOverviewLayers,
  createOverviewViewState,
  spatialOverviewView,
} from '../rendering/deckLayers'
import type { ViewStateChangeParameters } from '@deck.gl/core'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { OverviewCellDatum } from '../rendering/deckLayers'
import type { OverviewViewState } from '../rendering/deckLayers'

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly imageLoader?: TiffPyramidLoader | null
  readonly status?: ViewerLoadStatus
  readonly imageStatus?: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly onImageTileError?: (error: Error) => void
}

export function ViewerCore({
  cells = [],
  imageLoader = null,
  status = 'idle',
  imageStatus = 'idle',
  errorMessage,
  imageErrorMessage,
  onImageTileError,
}: ViewerCoreProps) {
  const fittedViewState = useMemo(() => createOverviewViewState(cells), [cells])
  const resetKey = viewStateKey(fittedViewState)

  return (
    <ViewerSurface
      key={resetKey}
      cells={cells}
      imageLoader={imageLoader}
      initialViewState={fittedViewState}
      status={status}
      imageStatus={imageStatus}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      {...(imageErrorMessage === undefined ? {} : { imageErrorMessage })}
      {...(onImageTileError === undefined ? {} : { onImageTileError })}
    />
  )
}

interface ViewerSurfaceProps {
  readonly cells: readonly OverviewCellDatum[]
  readonly imageLoader: TiffPyramidLoader | null
  readonly initialViewState: OverviewViewState
  readonly status: ViewerLoadStatus
  readonly imageStatus: ViewerLoadStatus
  readonly errorMessage?: string
  readonly imageErrorMessage?: string
  readonly onImageTileError?: (error: Error) => void
}

function ViewerSurface({
  cells,
  imageLoader,
  initialViewState,
  status,
  imageStatus,
  errorMessage,
  imageErrorMessage,
  onImageTileError,
}: ViewerSurfaceProps) {
  const layers = useMemo(() => createOverviewLayers(cells), [cells])
  const [viewState, setViewState] = useState<OverviewViewState>(initialViewState)
  const hasCells = cells.length > 0
  const viewportMessage = readViewportMessage(status, imageStatus, {
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(imageErrorMessage === undefined ? {} : { imageErrorMessage }),
  })
  const handleViewStateChange = useCallback(
    ({ viewState: nextViewState }: ViewStateChangeParameters) => {
      setViewState(normaliseViewState(nextViewState))
    },
    [],
  )

  return (
    <div className="viewport-frame" role="img" aria-label="Spatial viewer canvas area">
      {imageLoader === null ? <div className="viewport-grid" aria-hidden="true" /> : null}
      <MorphologyCanvas
        loader={imageLoader}
        viewState={viewState}
        {...(onImageTileError === undefined ? {} : { onTileError: onImageTileError })}
      />
      {hasCells ? (
        <div className="deckgl-host" aria-hidden="true">
          <DeckGL
            views={spatialOverviewView}
            viewState={viewState}
            onViewStateChange={handleViewStateChange}
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
  messages: {
    readonly errorMessage?: string
    readonly imageErrorMessage?: string
  },
): { readonly kind: 'info' | 'error'; readonly text: string } | null {
  if (status === 'loading') {
    return { kind: 'info', text: 'Loading overview cells...' }
  }

  if (status === 'error') {
    return {
      kind: 'error',
      text: messages.errorMessage ?? 'Dataset load failed.',
    }
  }

  if (imageStatus === 'loading') {
    return { kind: 'info', text: 'Reading OME-TIFF image...' }
  }

  if (imageStatus === 'error') {
    return {
      kind: 'error',
      text: messages.imageErrorMessage ?? 'OME-TIFF image load failed.',
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
