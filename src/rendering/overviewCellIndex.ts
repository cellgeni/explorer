import type { BBox } from '../data/coords'
import type { OverviewCellDatum } from './deckLayerTypes'

// Bucket grid over overview cell centres, stored as packed arrays, for exact
// viewport counts and click lookups without scanning every cell.

export interface OverviewCellIndex {
  readonly count: number
  readonly xs: Float64Array
  // Raw (unflipped) y, matching viewport boxes.
  readonly ys: Float64Array
  readonly minX: number
  readonly minY: number
  readonly bucketSize: number
  readonly columns: number
  readonly rows: number
  // Cells of bucket b are cellOrder[bucketStarts[b] .. bucketStarts[b + 1]],
  // in their original order.
  readonly bucketStarts: Uint32Array
  readonly cellOrder: Uint32Array
  readonly maxRadius: number
}

const TARGET_CELLS_PER_BUCKET = 32
const MAX_BUCKETS_PER_AXIS = 4_096

export function createOverviewCellIndex(
  cells: readonly OverviewCellDatum[],
): OverviewCellIndex {
  const count = cells.length
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxRadius = 0

  for (let index = 0; index < count; index += 1) {
    const cell = cells[index]
    const x = cell?.position[0] ?? 0
    const y = -(cell?.position[1] ?? 0)
    xs[index] = x
    ys[index] = y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxRadius = Math.max(
      maxRadius,
      cell === undefined ? 0 : (cell.radiusMicrometers ?? cell.radiusPixels),
    )
  }

  if (count === 0) {
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }

  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const bucketSize = Math.max(
    Math.sqrt((width * height * TARGET_CELLS_PER_BUCKET) / Math.max(count, 1)),
    width / MAX_BUCKETS_PER_AXIS,
    height / MAX_BUCKETS_PER_AXIS,
    1e-6,
  )
  const columns = Math.floor(width / bucketSize) + 1
  const rows = Math.floor(height / bucketSize) + 1
  const bucketOfCell = new Uint32Array(count)
  const bucketStarts = new Uint32Array(columns * rows + 1)

  for (let index = 0; index < count; index += 1) {
    const column = Math.floor(((xs[index] ?? 0) - minX) / bucketSize)
    const row = Math.floor(((ys[index] ?? 0) - minY) / bucketSize)
    const bucket = row * columns + column
    bucketOfCell[index] = bucket
    bucketStarts[bucket + 1] = (bucketStarts[bucket + 1] ?? 0) + 1
  }

  for (let bucket = 0; bucket < columns * rows; bucket += 1) {
    bucketStarts[bucket + 1] =
      (bucketStarts[bucket + 1] ?? 0) + (bucketStarts[bucket] ?? 0)
  }

  const cursor = bucketStarts.slice(0, columns * rows)
  const cellOrder = new Uint32Array(count)

  for (let index = 0; index < count; index += 1) {
    const bucket = bucketOfCell[index] ?? 0
    const position = cursor[bucket] ?? 0
    cellOrder[position] = index
    cursor[bucket] = position + 1
  }

  return {
    count,
    xs,
    ys,
    minX,
    minY,
    bucketSize,
    columns,
    rows,
    bucketStarts,
    cellOrder,
    maxRadius,
  }
}

// Cells whose centre lies inside the box (edges included), as
// overviewCellsInBbox counts them.
export function countOverviewCellsInBbox(index: OverviewCellIndex, bbox: BBox): number {
  let count = 0

  forEachBucketInBbox(index, bbox, (start, end, inside) => {
    if (inside) {
      count += end - start
      return
    }

    for (let cursor = start; cursor < end; cursor += 1) {
      const cell = index.cellOrder[cursor] ?? 0

      if (pointInBbox(index.xs[cell] ?? 0, index.ys[cell] ?? 0, bbox)) {
        count += 1
      }
    }
  })

  return count
}

// Indices of cells whose centre is within `radius` of the box, in their
// original order.
export function overviewCellIndicesNear(
  index: OverviewCellIndex,
  x: number,
  y: number,
  radius = index.maxRadius,
): number[] {
  const bbox = {
    minX: x - radius,
    maxX: x + radius,
    minY: y - radius,
    maxY: y + radius,
  } as BBox
  const indices: number[] = []

  forEachBucketInBbox(index, bbox, (start, end) => {
    for (let cursor = start; cursor < end; cursor += 1) {
      const cell = index.cellOrder[cursor] ?? 0

      if (pointInBbox(index.xs[cell] ?? 0, index.ys[cell] ?? 0, bbox)) {
        indices.push(cell)
      }
    }
  })

  return indices.sort((left, right) => left - right)
}

function forEachBucketInBbox(
  index: OverviewCellIndex,
  bbox: BBox,
  visit: (start: number, end: number, inside: boolean) => void,
): void {
  if (index.count === 0) {
    return
  }

  const firstColumn = Math.max(0, Math.floor((bbox.minX - index.minX) / index.bucketSize))
  const lastColumn = Math.min(
    index.columns - 1,
    Math.floor((bbox.maxX - index.minX) / index.bucketSize),
  )
  const firstRow = Math.max(0, Math.floor((bbox.minY - index.minY) / index.bucketSize))
  const lastRow = Math.min(
    index.rows - 1,
    Math.floor((bbox.maxY - index.minY) / index.bucketSize),
  )

  for (let row = firstRow; row <= lastRow; row += 1) {
    const bucketMinY = index.minY + row * index.bucketSize
    const rowInside = bucketMinY >= bbox.minY && bucketMinY + index.bucketSize < bbox.maxY

    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const bucket = row * index.columns + column
      const start = index.bucketStarts[bucket] ?? 0
      const end = index.bucketStarts[bucket + 1] ?? start

      if (end <= start) {
        continue
      }

      const bucketMinX = index.minX + column * index.bucketSize
      const inside =
        rowInside && bucketMinX >= bbox.minX && bucketMinX + index.bucketSize < bbox.maxX
      visit(start, end, inside)
    }
  }
}

function pointInBbox(x: number, y: number, bbox: BBox): boolean {
  return x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY
}
