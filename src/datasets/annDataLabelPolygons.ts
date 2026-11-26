import { micrometers, type BBox, type DataPoint } from '../data/coords'
import { shapeRing, type SpatialDataShapes } from './spatialDataShapes'
import type { SpatialElement, SpatialElementId } from './spatialDataset'

// Polygon labels (Parquet, GeoJSON, WKT) that a collection or H5AD manifest
// pairs with an AnnData table, drawn as its cell boundaries. Each polygon's
// ID (the file's `cell_id` or other ID column, as the imported-segmentation
// readers find it) names its cell: the cell with that obs name, or with that
// value in an obs column, such as a WebAtlas Xenium table's `cell_id` beside
// obs names 1, 2, ....

// Where a polygon's cell may be named: the obs names, or an obs column, by
// row.
export interface PolygonCellCandidate {
  // The obs column; undefined for the obs names.
  readonly column?: string
  readonly values: readonly (string | null)[]
}

export interface PolygonCellMatch {
  readonly candidate: PolygonCellCandidate
  // The cell each polygon outlines, by polygon; undefined where none does.
  readonly cellIds: readonly (string | undefined)[]
  // Polygons with a cell.
  readonly count: number
}

// The candidate naming the most polygons' cells (the first among equals), or
// null when none names any. A cell with several polygons keeps its largest.
export function matchPolygonCells(
  shapes: SpatialDataShapes,
  rowCellIds: readonly string[],
  candidates: readonly PolygonCellCandidate[],
): PolygonCellMatch | null {
  const polygonIds = new Set(shapes.ids)
  let best: PolygonCellCandidate | null = null
  let bestRows = 0

  for (const candidate of candidates) {
    let rows = 0

    for (const value of candidate.values) {
      if (value !== null && polygonIds.has(value)) {
        rows += 1
      }
    }

    if (rows > bestRows) {
      best = candidate
      bestRows = rows
    }
  }

  if (best === null) {
    return null
  }

  const cellByValue = new Map<string, string>()

  best.values.forEach((value, row) => {
    const cellId = rowCellIds[row]

    if (value !== null && cellId !== undefined) {
      cellByValue.set(value, cellId)
    }
  })

  const cellIds: (string | undefined)[] = new Array<string | undefined>(shapes.ids.length)
  const polygonByCell = new Map<string, number>()

  shapes.ids.forEach((id, polygon) => {
    const cellId = cellByValue.get(id)

    if (cellId === undefined) {
      return
    }

    const kept = polygonByCell.get(cellId)

    if (kept === undefined || (shapes.areas[polygon] ?? 0) > (shapes.areas[kept] ?? 0)) {
      if (kept !== undefined) {
        cellIds[kept] = undefined
      }

      polygonByCell.set(cellId, polygon)
      cellIds[polygon] = cellId
    }
  })

  return { candidate: best, cellIds, count: polygonByCell.size }
}

// Elements kept for reuse before older ones are let go: a view's cells keep
// their objects across viewport requests, and a Cell card's read between two
// of them does not drop the view's.
const KEPT_ELEMENTS = 50_000

export class AnnDataLabelPolygons {
  readonly shapes: SpatialDataShapes
  private readonly cellIds: readonly (string | undefined)[]
  private current = new Map<number, SpatialElement<SpatialElementId>>()
  private previous = new Map<number, SpatialElement<SpatialElementId>>()

  constructor(shapes: SpatialDataShapes, cellIds: readonly (string | undefined)[]) {
    this.shapes = shapes
    this.cellIds = cellIds
  }

  // The outlines of cells whose polygons meet `bbox`.
  elements(bbox: BBox): SpatialElement<SpatialElementId>[] {
    if (this.current.size > KEPT_ELEMENTS) {
      this.previous = this.current
      this.current = new Map()
    }

    const { bounds } = this.shapes
    const elements: SpatialElement<SpatialElementId>[] = []

    for (let polygon = 0, offset = 0; offset < bounds.length; polygon += 1, offset += 4) {
      const cellId = this.cellIds[polygon]

      if (
        cellId === undefined ||
        (bounds[offset] ?? 0) > bbox.maxX ||
        (bounds[offset + 1] ?? 0) > bbox.maxY ||
        (bounds[offset + 2] ?? 0) < bbox.minX ||
        (bounds[offset + 3] ?? 0) < bbox.minY
      ) {
        continue
      }

      let element = this.current.get(polygon) ?? this.previous.get(polygon)

      if (element === undefined) {
        element = this.element(polygon, cellId)
      }

      this.current.set(polygon, element)
      elements.push(element)
    }

    return elements
  }

  private element(polygon: number, cellId: string): SpatialElement<SpatialElementId> {
    const ring = shapeRing(this.shapes, polygon)
    const points: DataPoint[] = []

    for (let offset = 0; offset < ring.length; offset += 2) {
      points.push({
        x: micrometers(ring[offset] ?? 0),
        y: micrometers(ring[offset + 1] ?? 0),
      })
    }

    return { id: cellId, geometry: { kind: 'polygon', rings: [points] } }
  }
}

// Polygons far outside the image, or squeezed into its corner, usually mean
// the wrong coordinate units. `width` and `height` are the image's in µm.
export function polygonPlacementWarning(
  shapes: SpatialDataShapes,
  image: { readonly width: number; readonly height: number },
  inImagePixels: boolean,
): string | undefined {
  const { bounds } = shapes
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let offset = 0; offset < bounds.length; offset += 4) {
    maxX = Math.max(maxX, bounds[offset + 2] ?? 0)
    maxY = Math.max(maxY, bounds[offset + 3] ?? 0)
  }

  if (maxX > image.width * 1.05 || maxY > image.height * 1.05) {
    return `Attached label polygons reach beyond the image; if they look too large, their coordinates may be in other units: set labelsCoordinates to "${inImagePixels ? 'micrometers' : 'image-pixels'}"`
  }

  if (inImagePixels && maxX < image.width / 2 && maxY < image.height / 2) {
    return 'Attached label polygons cover only the top-left part of the image; if they look shrunk, their coordinates may be micrometres: set labelsCoordinates to "micrometers"'
  }

  return undefined
}
