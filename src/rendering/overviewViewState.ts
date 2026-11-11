import type { BBox } from '../data/coords'
import type {
  GridCellDatum,
  OverviewCellDatum,
  OverviewViewState,
} from './deckLayerTypes'
import type { CssViewportSize } from './morphologyCanvas'

const DEFAULT_OVERVIEW_VIEW_STATE: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -4,
  minZoom: -10,
  maxZoom: 10,
}

// Until the canvas has been measured, a fit assumes a 720 px square, as every
// fit did before 15.2-E.
export const FIT_FALLBACK_VIEWPORT: CssViewportSize = { width: 720, height: 720 }

// Space left around fitted data, so it does not touch the canvas edges.
export const FIT_PADDING_PIXELS = 24

const FIT_MAX_ZOOM = 4

// An extent in deck.gl coordinates, where y is the data's y negated.
export interface DeckExtent {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export function overviewFitExtent(
  cells: readonly OverviewCellDatum[],
  gridCells: readonly GridCellDatum[] = [],
  imageExtent: BBox | null = null,
): DeckExtent | null {
  if (cells.length === 0 && gridCells.length === 0 && imageExtent === null) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const cell of cells) {
    const [x = 0, y = 0] = cell.position
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  for (const cell of gridCells) {
    for (const [x = 0, y = 0] of cell.polygon) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  if (imageExtent !== null) {
    minX = Math.min(minX, imageExtent.minX)
    maxX = Math.max(maxX, imageExtent.maxX)
    minY = Math.min(minY, -imageExtent.maxY)
    maxY = Math.max(maxY, -imageExtent.minY)
  }

  return { minX, maxX, minY, maxY }
}

// The zoom at which an extent fills the viewport, less the padding on each
// side. Zoom z draws 2^z pixels per µm.
function zoomToFit(
  extent: DeckExtent,
  viewport: CssViewportSize,
  paddingPixels: number,
): number {
  const width = Math.max(viewport.width - 2 * paddingPixels, 1)
  const height = Math.max(viewport.height - 2 * paddingPixels, 1)
  const spanX = Math.max(extent.maxX - extent.minX, 1)
  const spanY = Math.max(extent.maxY - extent.minY, 1)

  return Math.log2(Math.min(width / spanX, height / spanY))
}

function extentCenter(extent: DeckExtent): [number, number, number] {
  return [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2, 0]
}

// Fit to view (UNIFIED_PLAN.md, F18): the whole extent, centred in the real
// canvas.
export function fitExtentViewState(
  extent: DeckExtent | null,
  viewport: CssViewportSize = FIT_FALLBACK_VIEWPORT,
  paddingPixels = 0,
): OverviewViewState {
  if (extent === null) {
    return DEFAULT_OVERVIEW_VIEW_STATE
  }

  return {
    ...DEFAULT_OVERVIEW_VIEW_STATE,
    target: extentCenter(extent),
    zoom: Math.max(
      DEFAULT_OVERVIEW_VIEW_STATE.minZoom,
      Math.min(FIT_MAX_ZOOM, zoomToFit(extent, viewport, paddingPixels)),
    ),
  }
}

export function createOverviewViewState(
  cells: readonly OverviewCellDatum[],
  gridCells: readonly GridCellDatum[] = [],
  imageExtent: BBox | null = null,
  viewport: CssViewportSize = FIT_FALLBACK_VIEWPORT,
  paddingPixels = 0,
): OverviewViewState {
  return fitExtentViewState(
    overviewFitExtent(cells, gridCells, imageExtent),
    viewport,
    paddingPixels,
  )
}

// zoomToBbox: the view that shows a region (in data µm, y down), as the
// cards' Go To buttons ask for. The zoom stays within the view's limits.
export function viewStateForBbox(
  bbox: BBox,
  viewport: CssViewportSize,
  viewState: OverviewViewState,
  paddingPixels = FIT_PADDING_PIXELS,
): OverviewViewState {
  const extent: DeckExtent = {
    minX: bbox.minX,
    maxX: bbox.maxX,
    minY: -bbox.maxY,
    maxY: -bbox.minY,
  }

  return {
    ...viewState,
    target: extentCenter(extent),
    zoom: Math.max(
      viewState.minZoom,
      Math.min(viewState.maxZoom, zoomToFit(extent, viewport, paddingPixels)),
    ),
  }
}

export function extentKey(extent: DeckExtent | null): string {
  return extent === null
    ? 'empty'
    : [extent.minX, extent.maxX, extent.minY, extent.maxY].join(':')
}
