import type { DataPoint } from '../../data/coords'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { OverviewCellDatum, OverviewViewState } from '../../rendering/deckLayerTypes'
import { cellAreaToEquivalentDiameterMicrometers } from '../cells/cellDetailModel'

// The picture at the start of each Cell Query row (plan 23-D10): the
// dataset's image around the cell, at one field for every row, with the
// cell's outline over it.

// Fields across, in micrometres, for Picture.
export const CELL_PICTURE_FIELDS = [20, 40, 80] as const
export const DEFAULT_CELL_PICTURE_FIELD = 40
// The picture's side in CSS pixels, and the row that holds it.
export const CELL_PICTURE_SIZE = 64
export const CELL_PICTURE_ROW_HEIGHT = 72
// A picture is read once its row has stopped moving for this long (23-D12).
export const CELL_PICTURE_SETTLE_MS = 150
// Every picture's tiles share one store (23-D11): this many requests in
// flight in all, and a cache of this many tiles shared by the channels.
export const CELL_PICTURE_TILE_REQUESTS = 6
export const CELL_PICTURE_TILE_CACHE_TILES = 48
// The ring drawn where a cell has no outline, in CSS pixels.
const FALLBACK_RING_RADIUS = 6

// An outline in the dataset's frame (y down), as the dataset gives it.
export type CellPictureOutline =
  | { readonly kind: 'polygon'; readonly rings: readonly (readonly DataPoint[])[] }
  | { readonly kind: 'circle'; readonly center: DataPoint; readonly radius: number }

// An outline in the picture's pixels.
export type CellPictureShape =
  | { readonly kind: 'path'; readonly d: string }
  | {
      readonly kind: 'circle'
      readonly cx: number
      readonly cy: number
      readonly r: number
      // A ring at the cell's position, not its outline.
      readonly fallback: boolean
    }

// The field a dataset starts with: 40 µm, or for larger spots (Visium's
// 55 µm) the smallest field that shows a whole spot with a margin. Cells
// carry a radius too, from their area, which never narrows the field.
export function defaultCellPictureField(cell: OverviewCellDatum | undefined): number {
  const radius = cell?.radiusMicrometers
  const wanted = radius !== undefined && radius > 0 ? radius * 2 * 1.25 : 0
  if (wanted <= DEFAULT_CELL_PICTURE_FIELD) return DEFAULT_CELL_PICTURE_FIELD
  return (
    CELL_PICTURE_FIELDS.find((field) => field >= wanted) ??
    CELL_PICTURE_FIELDS[CELL_PICTURE_FIELDS.length - 1] ??
    DEFAULT_CELL_PICTURE_FIELD
  )
}

export function cellPictureViewState(
  cell: OverviewCellDatum,
  field: number,
  size = CELL_PICTURE_SIZE,
): OverviewViewState {
  const [x = 0, deckY = 0] = cell.position
  const zoom = Math.log2(size / field)

  return { target: [x, deckY, 0], zoom, minZoom: zoom, maxZoom: zoom }
}

// The outline a dataset element gives, or null for one a picture cannot draw.
export function cellPictureOutline(element: SpatialElement): CellPictureOutline | null {
  const { geometry } = element

  switch (geometry.kind) {
    case 'polygon':
      return geometry.rings.some((ring) => ring.length >= 3)
        ? { kind: 'polygon', rings: geometry.rings }
        : null
    case 'circle':
      return { kind: 'circle', center: geometry.center, radius: geometry.diameter / 2 }
    case 'square':
      return {
        kind: 'polygon',
        rings: [
          [
            geometry.origin,
            { x: geometry.origin.x + geometry.size, y: geometry.origin.y } as DataPoint,
            {
              x: geometry.origin.x + geometry.size,
              y: geometry.origin.y + geometry.size,
            } as DataPoint,
            { x: geometry.origin.x, y: geometry.origin.y + geometry.size } as DataPoint,
          ],
        ],
      }
    case 'grid-cell':
      return null
  }
}

// What a picture draws over the image: the dataset's outline when it has
// one; a spot's circle (Visium); otherwise a ring at the cell's position,
// as large as its area where the dataset gives one.
export function cellPictureShape(
  cell: OverviewCellDatum,
  outline: CellPictureOutline | null,
  field: number,
  {
    spots = false,
    size = CELL_PICTURE_SIZE,
  }: {
    // The dataset's elements are spots, whose circle is their outline.
    readonly spots?: boolean
    readonly size?: number
  } = {},
): CellPictureShape {
  const [x = 0, deckY = 0] = cell.position
  const scale = size / field
  const centreX = x
  const centreY = -deckY
  const toPicture = (point: DataPoint): readonly [number, number] => [
    size / 2 + (point.x - centreX) * scale,
    size / 2 + (point.y - centreY) * scale,
  ]

  if (outline?.kind === 'polygon') {
    const d = outline.rings
      .filter((ring) => ring.length >= 3)
      .map(
        (ring) =>
          `M${ring
            .map((point) => {
              const [px, py] = toPicture(point)
              return `${round(px)} ${round(py)}`
            })
            .join('L')}Z`,
      )
      .join('')
    return { kind: 'path', d }
  }

  if (outline?.kind === 'circle') {
    const [cx, cy] = toPicture(outline.center)
    return { kind: 'circle', cx, cy, r: outline.radius * scale, fallback: false }
  }

  if (spots && cell.radiusMicrometers !== undefined && cell.radiusMicrometers > 0) {
    return {
      kind: 'circle',
      cx: size / 2,
      cy: size / 2,
      r: cell.radiusMicrometers * scale,
      fallback: false,
    }
  }

  const diameter = cellAreaToEquivalentDiameterMicrometers(cell.cellArea)
  return {
    kind: 'circle',
    cx: size / 2,
    cy: size / 2,
    r:
      diameter === undefined || diameter <= 0
        ? FALLBACK_RING_RADIUS
        : Math.max(3, (diameter / 2) * scale),
    fallback: true,
  }
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}
