import type { Position } from '@deck.gl/core'
import { micrometers } from '../data/coords'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import { rawDataPointToScreen } from './viewerMeasurements'

// The selected cell, spot or bin as App describes it, in world coordinates
// (plan 15.1-D). Points and spots get a ring; bins and cells
// with a boundary get their outline.
export type ViewerSelectionHighlight =
  | {
      readonly kind: 'point'
      readonly id: string
      readonly position: Position
      // The point's radius in world units, or 0 when it is drawn in pixels.
      readonly radius: number
    }
  | {
      readonly kind: 'polygon'
      readonly id: string
      readonly polygon: readonly Position[]
    }

export type SelectionOverlayModel =
  | {
      readonly kind: 'ring'
      readonly cx: number
      readonly cy: number
      readonly r: number
    }
  | { readonly kind: 'outline'; readonly d: string }

// The ring stays visible around tiny points and leaves a gap around big ones.
const MIN_RING_RADIUS_PIXELS = 7
const RING_GAP_PIXELS = 3

function worldToScreen(
  position: Position,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
) {
  // World y is the data y negated (the view does not flip y).
  return rawDataPointToScreen(
    { x: micrometers(position[0] ?? 0), y: micrometers(-(position[1] ?? 0)) },
    viewState,
    viewport,
  )
}

export function selectionOverlayModel(
  highlight: ViewerSelectionHighlight | null,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): SelectionOverlayModel | null {
  if (highlight === null || viewport.width <= 0 || viewport.height <= 0) {
    return null
  }

  if (highlight.kind === 'point') {
    const center = worldToScreen(highlight.position, viewState, viewport)
    const radius = highlight.radius * 2 ** viewState.zoom + RING_GAP_PIXELS

    return {
      kind: 'ring',
      cx: center.x,
      cy: center.y,
      r: Math.max(MIN_RING_RADIUS_PIXELS, radius),
    }
  }

  if (highlight.polygon.length < 3) {
    return null
  }

  const d = highlight.polygon
    .map((position, index) => {
      const point = worldToScreen(position, viewState, viewport)
      return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    })
    .join(' ')

  return { kind: 'outline', d: `${d} Z` }
}
