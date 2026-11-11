import type { BBox } from '../data/coords'
import type { OverviewViewState } from '../rendering/deckLayerTypes'
import { fitExtentViewState, type DeckExtent } from '../rendering/overviewViewState'
import { rawDataPointToScreen, type ScreenPoint } from './viewerMeasurements'

// The minimap (UNIFIED_PLAN.md, 15.4-D): the whole dataset at the bottom
// right of the canvas, with the view drawn on it. Click or drag to move the
// view there.

// The longer side, in CSS px.
export const MINIMAP_MAX_SIZE = 168
const MINIMAP_MIN_SIDE = 56
const MINIMAP_PADDING = 6
// The view's box never shrinks below this, so it stays visible when zoomed in.
const MINIMAP_MIN_VIEW_BOX = 6
// Without an image, up to this many cells (or bins) are drawn as dots.
export const MINIMAP_POINT_LIMIT = 6_000

export interface MinimapLayout {
  readonly width: number
  readonly height: number
  // Fits the dataset's extent into the minimap.
  readonly viewState: OverviewViewState
}

export function minimapLayout(
  extent: DeckExtent | null,
  maxSize = MINIMAP_MAX_SIZE,
): MinimapLayout | null {
  if (extent === null) return null

  const spanX = Math.max(extent.maxX - extent.minX, 1)
  const spanY = Math.max(extent.maxY - extent.minY, 1)
  const aspect = spanX / spanY
  const width =
    aspect >= 1 ? maxSize : Math.max(MINIMAP_MIN_SIDE, Math.round(maxSize * aspect))
  const height =
    aspect >= 1 ? Math.max(MINIMAP_MIN_SIDE, Math.round(maxSize / aspect)) : maxSize

  return {
    width,
    height,
    viewState: fitExtentViewState(extent, { width, height }, MINIMAP_PADDING),
  }
}

export interface MinimapRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

// The main view's box on the minimap, clipped to it.
export function minimapViewRect(bbox: BBox, layout: MinimapLayout): MinimapRect {
  const viewport = { width: layout.width, height: layout.height }
  const topLeft = rawDataPointToScreen(
    { x: bbox.minX, y: bbox.minY },
    layout.viewState,
    viewport,
  )
  const bottomRight = rawDataPointToScreen(
    { x: bbox.maxX, y: bbox.maxY },
    layout.viewState,
    viewport,
  )
  const centerX = (topLeft.x + bottomRight.x) / 2
  const centerY = (topLeft.y + bottomRight.y) / 2
  const width = Math.max(MINIMAP_MIN_VIEW_BOX, bottomRight.x - topLeft.x)
  const height = Math.max(MINIMAP_MIN_VIEW_BOX, bottomRight.y - topLeft.y)
  const left = clamp(centerX - width / 2, -width, layout.width)
  const top = clamp(centerY - height / 2, -height, layout.height)
  const right = clamp(left + width, 0, layout.width)
  const bottom = clamp(top + height, 0, layout.height)
  const clippedLeft = Math.max(0, left)
  const clippedTop = Math.max(0, top)

  return {
    left: clippedLeft,
    top: clippedTop,
    width: Math.max(0, right - clippedLeft),
    height: Math.max(0, bottom - clippedTop),
  }
}

// The deck.gl target (y is the data's y negated) under a minimap point.
export function minimapDeckTarget(
  point: ScreenPoint,
  layout: MinimapLayout,
): readonly [number, number] {
  const { viewState } = layout
  const scale = 2 ** viewState.zoom
  const x = viewState.target[0] + (point.x - layout.width / 2) / scale
  const y = viewState.target[1] - (point.y - layout.height / 2) / scale
  return [x, y]
}

// Whether the minimap's MorphologyCanvas draws anything: the flat image, the
// enabled channels, or the loader when there are no channels. Otherwise the
// minimap shows dots, so it is never blank (all channels off, say).
export function minimapDrawsImage(
  imageLoader: unknown,
  imageChannels: readonly { readonly enabled: boolean }[],
  flatImage: unknown,
): boolean {
  if (flatImage !== null) return true
  return imageChannels.length > 0
    ? imageChannels.some((channel) => channel.enabled)
    : imageLoader !== null
}

// An even sample of positions (deck.gl coordinates) for the dots.
export function minimapPoints<Element>(
  elements: readonly Element[],
  positionOf: (element: Element) => readonly [number, number] | null,
  limit = MINIMAP_POINT_LIMIT,
): readonly (readonly [number, number])[] {
  const stride = Math.max(1, elements.length / limit)
  const points: (readonly [number, number])[] = []

  for (let index = 0; index < elements.length; index += stride) {
    const element = elements[Math.floor(index)]
    if (element === undefined) continue
    const position = positionOf(element)
    if (position !== null) points.push(position)
  }

  return points
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
