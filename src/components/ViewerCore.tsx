import { DeckGL } from '@deck.gl/react'
import { useMemo } from 'react'
import {
  createOverviewLayers,
  createOverviewViewState,
  spatialOverviewView,
} from '../rendering/deckLayers'
import type { OverviewCellDatum } from '../rendering/deckLayers'

export type ViewerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ViewerCoreProps {
  readonly cells?: readonly OverviewCellDatum[]
  readonly status?: ViewerLoadStatus
  readonly errorMessage?: string
}

export function ViewerCore({
  cells = [],
  status = 'idle',
  errorMessage,
}: ViewerCoreProps) {
  const layers = useMemo(() => createOverviewLayers(cells), [cells])
  const initialViewState = useMemo(() => createOverviewViewState(cells), [cells])
  const hasCells = cells.length > 0

  return (
    <div className="viewport-frame" role="img" aria-label="Spatial viewer canvas area">
      <canvas className="morphology-canvas" aria-hidden="true" />
      <div className="viewport-grid" aria-hidden="true" />
      {hasCells ? (
        <div className="deckgl-host" aria-hidden="true">
          <DeckGL
            views={spatialOverviewView}
            initialViewState={initialViewState}
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
      {status === 'loading' ? (
        <p className="viewport-message" aria-live="polite">
          Loading overview cells...
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="viewport-message viewport-message-error" aria-live="assertive">
          {errorMessage ?? 'Dataset load failed.'}
        </p>
      ) : null}
    </div>
  )
}
