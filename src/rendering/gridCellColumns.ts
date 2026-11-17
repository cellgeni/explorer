import type { Color } from '@deck.gl/core'
import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type {
  GridCellBatch,
  SpatialGrid,
  SpatialGridBasis,
} from '../datasets/spatialDataset'
import { gridCellCorners } from '../datasets/spatialGrid'
import type { GridCellDatum } from './deckLayerTypes'

export interface GridCellColumnsFields {
  readonly gridId: string
  readonly basis: SpatialGridBasis
  readonly length: number
  readonly ids: readonly string[]
  readonly rows: Int32Array
  readonly cols: Int32Array
  readonly binSizeMicrometers?: number
  readonly inTissue?: ArrayLike<number>
  readonly fullresRows?: ArrayLike<number>
  readonly fullresCols?: ArrayLike<number>
  // Set when these bins are drawn in place of finer selected ones, which are
  // what a card or a query is about.
  readonly renderLodSourceBinSizeMicrometers?: number
}

export type GridCellColumnsMetadata = Pick<
  GridCellColumnsFields,
  | 'binSizeMicrometers'
  | 'inTissue'
  | 'fullresRows'
  | 'fullresCols'
  | 'renderLodSourceBinSizeMicrometers'
>

// A grid's bins as columns, with no object per bin: a bin's square comes from
// the grid basis and its row and column. The 3.4 million 2 µm bins of a Visium
// HD run cost their IDs and a few typed arrays; `gridCellAt` builds one bin's
// object when a card, a tooltip or an export needs it.
//
// The per-bin arrays sit in a private field, behind getters. React's
// development build lists what changed in a component's props, entry by entry
// for any array it can enumerate, which for a new tier of 2 µm bins ran the
// tab out of memory.
export class GridCellColumns {
  readonly gridId: string
  readonly basis: SpatialGridBasis
  readonly length: number
  readonly binSizeMicrometers: number | undefined
  readonly renderLodSourceBinSizeMicrometers: number | undefined
  readonly #bins: Pick<
    GridCellColumnsFields,
    'ids' | 'rows' | 'cols' | 'inTissue' | 'fullresRows' | 'fullresCols'
  >

  constructor(fields: GridCellColumnsFields) {
    this.gridId = fields.gridId
    this.basis = fields.basis
    this.length = fields.length
    this.binSizeMicrometers = fields.binSizeMicrometers
    this.renderLodSourceBinSizeMicrometers = fields.renderLodSourceBinSizeMicrometers
    this.#bins = fields
  }

  get ids(): readonly string[] {
    return this.#bins.ids
  }

  get rows(): Int32Array {
    return this.#bins.rows
  }

  get cols(): Int32Array {
    return this.#bins.cols
  }

  get inTissue(): ArrayLike<number> | undefined {
    return this.#bins.inTissue
  }

  get fullresRows(): ArrayLike<number> | undefined {
    return this.#bins.fullresRows
  }

  get fullresCols(): ArrayLike<number> | undefined {
    return this.#bins.fullresCols
  }
}

export const DEFAULT_GRID_CELL_FILL_COLOR: Color = [34, 120, 108, 28]
export const DEFAULT_GRID_CELL_LINE_COLOR: Color = [22, 90, 82, 150]

export const EMPTY_GRID_CELL_COLUMNS = new GridCellColumns({
  gridId: '',
  basis: {
    origin: { x: micrometers(0), y: micrometers(0) },
    rowStep: { x: micrometers(0), y: micrometers(1) },
    colStep: { x: micrometers(1), y: micrometers(0) },
  },
  length: 0,
  ids: [],
  rows: new Int32Array(0),
  cols: new Int32Array(0),
})

// The batch's own arrays, not copies.
export function gridCellColumnsFromBatch(
  grid: SpatialGrid,
  batch: GridCellBatch,
  metadata: GridCellColumnsMetadata = {},
): GridCellColumns {
  return new GridCellColumns({
    ...metadata,
    gridId: grid.id,
    basis: grid.basis,
    length: Math.min(batch.ids.length, batch.rows.length, batch.cols.length),
    ids: batch.ids,
    rows: batch.rows,
    cols: batch.cols,
  })
}

export function isRenderLodGridCellColumns(columns: GridCellColumns): boolean {
  return columns.renderLodSourceBinSizeMicrometers !== undefined
}

// Bin `index`'s centre, in data µm (y down).
export function gridCellCenterXAt(columns: GridCellColumns, index: number): number {
  const { origin, rowStep, colStep } = columns.basis
  return (
    origin.x +
    (columns.rows[index] ?? 0) * rowStep.x +
    (columns.cols[index] ?? 0) * colStep.x
  )
}

export function gridCellCenterYAt(columns: GridCellColumns, index: number): number {
  const { origin, rowStep, colStep } = columns.basis
  return (
    origin.y +
    (columns.rows[index] ?? 0) * rowStep.y +
    (columns.cols[index] ?? 0) * colStep.y
  )
}

export function gridCellCenterAt(columns: GridCellColumns, index: number): DataPoint {
  return {
    x: micrometers(gridCellCenterXAt(columns, index)),
    y: micrometers(gridCellCenterYAt(columns, index)),
  }
}

// Half the width and height of every bin's bounding box.
export function gridCellHalfExtent(basis: SpatialGridBasis): {
  readonly x: number
  readonly y: number
} {
  return {
    x: (Math.abs(basis.rowStep.x) + Math.abs(basis.colStep.x)) / 2,
    y: (Math.abs(basis.rowStep.y) + Math.abs(basis.colStep.y)) / 2,
  }
}

// One bin as an object, in the default colours.
export function gridCellAt(columns: GridCellColumns, index: number): GridCellDatum {
  const row = columns.rows[index] ?? 0
  const col = columns.cols[index] ?? 0
  const polygon = gridCellCorners(columns.basis, row, col).map(
    (point): [number, number, number] => [point.x, -point.y, 0],
  )
  const inTissue = columns.inTissue?.[index]
  const fullresRow = columns.fullresRows?.[index]
  const fullresCol = columns.fullresCols?.[index]

  return {
    id: columns.ids[index] ?? '',
    gridId: columns.gridId,
    row,
    col,
    ...(columns.binSizeMicrometers === undefined
      ? {}
      : { binSizeMicrometers: columns.binSizeMicrometers }),
    ...(inTissue === undefined ? {} : { inTissue: inTissue === 1 }),
    ...(fullresRow === undefined ? {} : { fullresRow }),
    ...(fullresCol === undefined ? {} : { fullresCol }),
    ...(columns.renderLodSourceBinSizeMicrometers === undefined
      ? {}
      : {
          renderLodSourceBinSizeMicrometers: columns.renderLodSourceBinSizeMicrometers,
        }),
    bbox: polygonBbox(polygon),
    polygon,
    fillColor: DEFAULT_GRID_CELL_FILL_COLOR,
    lineColor: DEFAULT_GRID_CELL_LINE_COLOR,
  }
}

// A linear scan of the IDs: for a link or a selection, not for every frame.
export function gridCellById(
  columns: GridCellColumns,
  id: string,
): GridCellDatum | undefined {
  const index = columns.ids.indexOf(id)
  return index < 0 || index >= columns.length ? undefined : gridCellAt(columns, index)
}

const columnsBboxCache = new WeakMap<GridCellColumns, BBox | null>()

// The box around every bin, in data µm (y down).
export function gridCellColumnsBbox(columns: GridCellColumns): BBox | null {
  const cached = columnsBboxCache.get(columns)

  if (cached !== undefined) {
    return cached
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < columns.length; index += 1) {
    const x = gridCellCenterXAt(columns, index)
    const y = gridCellCenterYAt(columns, index)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const half = gridCellHalfExtent(columns.basis)
  const bbox =
    Number.isFinite(minX) &&
    Number.isFinite(maxX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxY)
      ? {
          minX: micrometers(minX - half.x),
          maxX: micrometers(maxX + half.x),
          minY: micrometers(minY - half.y),
          maxY: micrometers(maxY + half.y),
        }
      : null

  columnsBboxCache.set(columns, bbox)
  return bbox
}

// Bins grouped by square tiles of rows and columns. Each tile keeps the box
// around its bins, so a query tests a few thousand tiles and only the bins of
// tiles the query's edge crosses.
export interface GridCellTileIndex {
  readonly columns: GridCellColumns
  readonly tileCount: number
  // Each tile's bins are order[tileStarts[tile]] up to tileStarts[tile + 1],
  // in their order in the columns.
  readonly tileStarts: Uint32Array
  readonly order: Uint32Array
  // minX, minY, maxX, maxY of each tile's bins, in data µm (y down).
  readonly tileBounds: Float64Array
}

const GRID_CELL_TILE_SIZE = 32
// Sparse grids with far-apart bins get larger tiles, so the tile arrays stay
// near the bin count.
const GRID_CELL_MIN_TILE_LIMIT = 4096

const tileIndexCache = new WeakMap<GridCellColumns, GridCellTileIndex>()

export function gridCellTileIndex(columns: GridCellColumns): GridCellTileIndex {
  const cached = tileIndexCache.get(columns)

  if (cached !== undefined) {
    return cached
  }

  const index = createGridCellTileIndex(columns)
  tileIndexCache.set(columns, index)
  return index
}

function createGridCellTileIndex(columns: GridCellColumns): GridCellTileIndex {
  const { length, rows, cols } = columns

  if (length === 0) {
    return {
      columns,
      tileCount: 0,
      tileStarts: new Uint32Array(1),
      order: new Uint32Array(0),
      tileBounds: new Float64Array(0),
    }
  }

  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let index = 0; index < length; index += 1) {
    const row = rows[index] ?? 0
    const col = cols[index] ?? 0
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
  }

  const tileLimit = Math.max(GRID_CELL_MIN_TILE_LIMIT, length)
  let tileSize = GRID_CELL_TILE_SIZE
  let tileRows = Math.floor((maxRow - minRow) / tileSize) + 1
  let tileCols = Math.floor((maxCol - minCol) / tileSize) + 1

  while (tileRows * tileCols > tileLimit) {
    tileSize *= 2
    tileRows = Math.floor((maxRow - minRow) / tileSize) + 1
    tileCols = Math.floor((maxCol - minCol) / tileSize) + 1
  }

  const tileCount = tileRows * tileCols
  const tileOf = new Uint32Array(length)
  const tileStarts = new Uint32Array(tileCount + 1)

  for (let index = 0; index < length; index += 1) {
    const tile =
      Math.floor(((rows[index] ?? 0) - minRow) / tileSize) * tileCols +
      Math.floor(((cols[index] ?? 0) - minCol) / tileSize)
    tileOf[index] = tile
    tileStarts[tile + 1] = (tileStarts[tile + 1] ?? 0) + 1
  }

  for (let tile = 0; tile < tileCount; tile += 1) {
    tileStarts[tile + 1] = (tileStarts[tile + 1] ?? 0) + (tileStarts[tile] ?? 0)
  }

  const cursor = tileStarts.slice(0, tileCount)
  const order = new Uint32Array(length)
  const tileBounds = new Float64Array(tileCount * 4)

  for (let tile = 0; tile < tileCount; tile += 1) {
    tileBounds[tile * 4] = Number.POSITIVE_INFINITY
    tileBounds[tile * 4 + 1] = Number.POSITIVE_INFINITY
    tileBounds[tile * 4 + 2] = Number.NEGATIVE_INFINITY
    tileBounds[tile * 4 + 3] = Number.NEGATIVE_INFINITY
  }

  for (let index = 0; index < length; index += 1) {
    const tile = tileOf[index] ?? 0
    const x = gridCellCenterXAt(columns, index)
    const y = gridCellCenterYAt(columns, index)
    const bounds = tile * 4

    order[cursor[tile] ?? 0] = index
    cursor[tile] = (cursor[tile] ?? 0) + 1
    if (x < (tileBounds[bounds] ?? 0)) tileBounds[bounds] = x
    if (y < (tileBounds[bounds + 1] ?? 0)) tileBounds[bounds + 1] = y
    if (x > (tileBounds[bounds + 2] ?? 0)) tileBounds[bounds + 2] = x
    if (y > (tileBounds[bounds + 3] ?? 0)) tileBounds[bounds + 3] = y
  }

  const half = gridCellHalfExtent(columns.basis)

  for (let tile = 0; tile < tileCount; tile += 1) {
    tileBounds[tile * 4] = (tileBounds[tile * 4] ?? 0) - half.x
    tileBounds[tile * 4 + 1] = (tileBounds[tile * 4 + 1] ?? 0) - half.y
    tileBounds[tile * 4 + 2] = (tileBounds[tile * 4 + 2] ?? 0) + half.x
    tileBounds[tile * 4 + 3] = (tileBounds[tile * 4 + 3] ?? 0) + half.y
  }

  return { columns, tileCount, tileStarts, order, tileBounds }
}

// The bins whose squares meet `bbox` (data µm, y down), in their order in the
// columns; null when that is every bin.
export function gridCellIndicesInBbox(
  index: GridCellTileIndex,
  bbox: BBox,
): Uint32Array | null {
  const count = countGridCellsInBbox(index, bbox)

  if (count === index.columns.length) {
    return null
  }

  const indices = new Uint32Array(count)
  const meetsBbox = gridCellBboxTest(index.columns, bbox)
  let cursor = 0
  let tilesHit = 0

  forEachTileInBbox(index, bbox, (start, end, whole) => {
    tilesHit += 1

    if (whole) {
      indices.set(index.order.subarray(start, end), cursor)
      cursor += end - start
      return
    }

    for (let position = start; position < end; position += 1) {
      const cellIndex = index.order[position] ?? 0

      if (meetsBbox(cellIndex)) {
        indices[cursor] = cellIndex
        cursor += 1
      }
    }
  })

  return tilesHit > 1 ? indices.sort() : indices
}

export function countGridCellsInBbox(index: GridCellTileIndex, bbox: BBox): number {
  const meetsBbox = gridCellBboxTest(index.columns, bbox)
  let count = 0

  forEachTileInBbox(index, bbox, (start, end, whole) => {
    if (whole) {
      count += end - start
      return
    }

    for (let position = start; position < end; position += 1) {
      if (meetsBbox(index.order[position] ?? 0)) {
        count += 1
      }
    }
  })

  return count
}

// The last bin, in column order, whose box holds the point (data µm, y down);
// -1 when none does.
export function gridCellIndexAtPoint(
  index: GridCellTileIndex,
  x: number,
  y: number,
): number {
  const point: BBox = {
    minX: micrometers(x),
    maxX: micrometers(x),
    minY: micrometers(y),
    maxY: micrometers(y),
  }
  const meetsPoint = gridCellBboxTest(index.columns, point)
  let found = -1

  forEachTileInBbox(index, point, (start, end) => {
    for (let position = start; position < end; position += 1) {
      const cellIndex = index.order[position] ?? 0

      if (cellIndex > found && meetsPoint(cellIndex)) {
        found = cellIndex
      }
    }
  })

  return found
}

function forEachTileInBbox(
  index: GridCellTileIndex,
  bbox: BBox,
  visit: (start: number, end: number, whole: boolean) => void,
): void {
  const { tileBounds, tileStarts } = index

  for (let tile = 0; tile < index.tileCount; tile += 1) {
    const start = tileStarts[tile] ?? 0
    const end = tileStarts[tile + 1] ?? 0

    if (start === end) {
      continue
    }

    const minX = tileBounds[tile * 4] ?? 0
    const minY = tileBounds[tile * 4 + 1] ?? 0
    const maxX = tileBounds[tile * 4 + 2] ?? 0
    const maxY = tileBounds[tile * 4 + 3] ?? 0

    if (maxX < bbox.minX || minX > bbox.maxX || maxY < bbox.minY || minY > bbox.maxY) {
      continue
    }

    visit(
      start,
      end,
      minX >= bbox.minX && maxX <= bbox.maxX && minY >= bbox.minY && maxY <= bbox.maxY,
    )
  }
}

// Whether a bin's box meets `bbox`, as a bin's centre within `bbox` grown by
// half a bin.
function gridCellBboxTest(
  columns: GridCellColumns,
  bbox: BBox,
): (index: number) => boolean {
  const { rows, cols } = columns
  const { origin, rowStep, colStep } = columns.basis
  const half = gridCellHalfExtent(columns.basis)
  const minX = bbox.minX - half.x
  const maxX = bbox.maxX + half.x
  const minY = bbox.minY - half.y
  const maxY = bbox.maxY + half.y

  return (index) => {
    const row = rows[index] ?? 0
    const col = cols[index] ?? 0
    const x = origin.x + row * rowStep.x + col * colStep.x
    const y = origin.y + row * rowStep.y + col * colStep.y

    return x >= minX && x <= maxX && y >= minY && y <= maxY
  }
}

function polygonBbox(polygon: readonly (readonly [number, number, number])[]): BBox {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x, deckY] of polygon) {
    const rawY = -deckY
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
