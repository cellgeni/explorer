import type { CSSProperties } from 'react'

// Where the canvas legend sits once moved out of its bottom-left stack
// (ViewerLegend.tsx): how far it is from the view's nearer side and from its
// nearer top or bottom edge, so it keeps to that corner as the view resizes
// and as the legend opens, closes or grows.
export interface LegendPlacement {
  readonly fromRight: boolean
  readonly fromBottom: boolean
  // From the left or right edge, in CSS pixels.
  readonly x: number
  // From the top or bottom edge.
  readonly y: number
}

export interface LegendBox {
  readonly width: number
  readonly height: number
}

// The legend's top left corner in the view.
export interface LegendPoint {
  readonly left: number
  readonly top: number
}

// The stack's inset (viewer.css): a moved legend stays as far inside the view.
export const LEGEND_INSET = 12
// A legend dropped this much nearer the bottom-left corner than the inset
// goes back in the stack.
const DOCK_DISTANCE = 16

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)))
}

// Keeps the whole legend inside the view, or its top left where the view is
// too small for it.
export function clampLegendPoint(
  point: LegendPoint,
  legend: LegendBox,
  view: LegendBox,
): LegendPoint {
  return {
    left: clamp(point.left, LEGEND_INSET, view.width - legend.width - LEGEND_INSET),
    top: clamp(point.top, LEGEND_INSET, view.height - legend.height - LEGEND_INSET),
  }
}

// Where it is drawn: its place, kept inside the view.
export function clampLegendPlacement(
  placement: LegendPlacement,
  legend: LegendBox,
  view: LegendBox,
): LegendPlacement {
  return {
    ...placement,
    x: clamp(placement.x, LEGEND_INSET, view.width - legend.width - LEGEND_INSET),
    y: clamp(placement.y, LEGEND_INSET, view.height - legend.height - LEGEND_INSET),
  }
}

// Where a legend moved to `point` stays, measured from the edges nearer its
// centre. With `dock`, as for a drop, one in the bottom-left corner goes
// back in the stack (null).
export function placeLegend(
  point: LegendPoint,
  legend: LegendBox,
  view: LegendBox,
  dock: boolean,
): LegendPlacement | null {
  const { left, top } = clampLegendPoint(point, legend, view)
  const right = Math.round(view.width - left - legend.width)
  const bottom = Math.round(view.height - top - legend.height)
  const corner = LEGEND_INSET + DOCK_DISTANCE
  if (dock && left <= corner && bottom <= corner) return null

  const fromRight = left + legend.width / 2 > view.width / 2
  const fromBottom = top + legend.height / 2 > view.height / 2
  return {
    fromRight,
    fromBottom,
    x: fromRight ? right : left,
    y: fromBottom ? bottom : top,
  }
}

export function legendPlacementStyle(placement: LegendPlacement): CSSProperties {
  return {
    ...(placement.fromRight ? { right: placement.x } : { left: placement.x }),
    ...(placement.fromBottom ? { bottom: placement.y } : { top: placement.y }),
  }
}

// What the move grip reads out after its name.
export function legendPlacementText(placement: LegendPlacement | null): string {
  if (placement === null) return 'At the bottom left'
  return `${placement.y} px from the ${placement.fromBottom ? 'bottom' : 'top'}, ${placement.x} px from the ${placement.fromRight ? 'right' : 'left'}`
}
