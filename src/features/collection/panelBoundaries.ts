import type { LinkedViewState } from '../../components/linkedView'
import { micrometers, type BBox } from '../../data/coords'
import type { BoundaryViewportCandidate } from '../../rendering/boundaryViewport'
import type {
  BoundaryElementsLoader,
  DatasetRetainer,
} from '../app-shell/appDependencies'

// A panel's cell boundaries (plan 30-D9): read for the panel's own view as
// the main view reads its own, once fewer cells than the Boundary limit are
// in it, from the dataset the panel's preview opened.

export interface PanelBoundaryLoaders {
  // Whether the dataset has cell outlines to draw.
  readonly hasCellBoundaries: (url: string, signal: AbortSignal) => Promise<boolean>
  readonly loadBoundaryElements: BoundaryElementsLoader
  readonly retainDataset: DatasetRetainer
}

// A panel's size on screen, in CSS pixels.
export interface PanelSize {
  readonly width: number
  readonly height: number
}

// The part of the section a panel shows, in the dataset's coordinates.
export function panelViewBbox(view: LinkedViewState, size: PanelSize): BBox {
  const scale = 2 ** view.zoom
  const halfWidth = size.width / 2 / scale
  const halfHeight = size.height / 2 / scale
  const [x, deckY] = view.target

  return {
    minX: micrometers(x - halfWidth),
    maxX: micrometers(x + halfWidth),
    minY: micrometers(-deckY - halfHeight),
    maxY: micrometers(-deckY + halfHeight),
  }
}

// How many of the cells (interleaved x, y) lie in the box.
export function cellsInBox(positions: Float32Array, bbox: BBox): number {
  let count = 0

  for (let index = 0; index < positions.length; index += 2) {
    const x = positions[index] ?? Number.NaN
    const y = positions[index + 1] ?? Number.NaN

    if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY) {
      count += 1
    }
  }

  return count
}

// A panel's view as the main view's boundary rules take it.
export function panelBoundaryCandidate(
  view: LinkedViewState,
  size: PanelSize,
  positions: Float32Array,
): BoundaryViewportCandidate {
  const bbox = panelViewBbox(view, size)

  return {
    bbox,
    visibleCellCount: cellsInBox(positions, bbox),
    viewState: {
      target: [view.target[0], view.target[1], 0],
      zoom: view.zoom,
      minZoom: view.zoom,
      maxZoom: view.zoom,
    },
  }
}
