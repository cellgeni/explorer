import { micrometers, type BBox } from '../data/coords'
import { VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN } from '../data/visiumHdGridLod'
import type { GridCellDatum } from '../rendering/deckLayers'

const DEFAULT_GRID_CELL_BUCKET_MICROMETERS = 128
const VISIUM_HD_2UM_BIN_MICROMETERS = 2
const VISIUM_HD_RENDER_LOD_BIN_MICROMETERS = 16
const EMPTY_GRID_CELLS: readonly GridCellDatum[] = []

export const GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN = VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN

interface GridCellIndexEntry {
  readonly cell: GridCellDatum
  readonly sourceIndex: number
  readonly bbox: BBox
}

export interface GridCellSpatialIndex {
  readonly bucketSizeMicrometers: number
  readonly buckets: ReadonlyMap<string, readonly GridCellIndexEntry[]>
  readonly cellCount: number
  readonly cells: readonly GridCellDatum[]
  readonly maxCellSpanMicrometers: number
}

export interface GridCellRenderLods {
  readonly exact: readonly GridCellDatum[]
  readonly coarse16um: readonly GridCellDatum[]
  readonly exactBinSizeMicrometers: number | null
}

export function createGridCellSpatialIndex(
  cells: readonly GridCellDatum[],
  options: { readonly bucketSizeMicrometers?: number } = {},
): GridCellSpatialIndex {
  const bucketSizeMicrometers = normalizeBucketSize(options.bucketSizeMicrometers)
  const mutableBuckets = new Map<string, GridCellIndexEntry[]>()
  let maxCellSpanMicrometers = 0

  for (let sourceIndex = 0; sourceIndex < cells.length; sourceIndex += 1) {
    const cell = cells[sourceIndex]

    if (cell === undefined) {
      continue
    }

    const bbox = gridCellBbox(cell)

    if (bbox === null) {
      continue
    }

    const centerX = (bbox.minX + bbox.maxX) / 2
    const centerY = (bbox.minY + bbox.maxY) / 2
    const bucketKey = gridCellBucketKey(centerX, centerY, bucketSizeMicrometers)
    const bucket = mutableBuckets.get(bucketKey)
    const entry = { cell, sourceIndex, bbox }

    maxCellSpanMicrometers = Math.max(
      maxCellSpanMicrometers,
      bbox.maxX - bbox.minX,
      bbox.maxY - bbox.minY,
    )

    if (bucket === undefined) {
      mutableBuckets.set(bucketKey, [entry])
      continue
    }

    bucket.push(entry)
  }

  return {
    bucketSizeMicrometers,
    buckets: mutableBuckets,
    cellCount: cells.length,
    cells,
    maxCellSpanMicrometers,
  }
}

export function gridCellsInBbox(
  index: GridCellSpatialIndex,
  bbox: BBox,
  options: { readonly paddingMicrometers?: number } = {},
): readonly GridCellDatum[] {
  if (index.cellCount === 0) {
    return index.cells
  }

  const queryBbox = padBbox(bbox, options.paddingMicrometers ?? 0)
  const entries = gridCellEntriesInBbox(index, queryBbox)

  if (entries.length === index.cellCount) {
    return index.cells
  }

  entries.sort((left, right) => left.sourceIndex - right.sourceIndex)

  return entries.map((entry) => entry.cell)
}

export function countGridCellsInSpatialIndex(
  index: GridCellSpatialIndex,
  bbox: BBox,
): number {
  if (index.cellCount === 0) {
    return 0
  }

  return gridCellEntriesInBbox(index, bbox).length
}

export function gridCellIntersectsBbox(cell: GridCellDatum, bbox: BBox): boolean {
  const cellBbox = gridCellBbox(cell)

  return cellBbox === null ? false : bboxIntersectsBbox(cellBbox, bbox)
}

export function createGridCellRenderLods(
  cells: readonly GridCellDatum[],
): GridCellRenderLods {
  const exactBinSizeMicrometers = commonGridCellBinSize(cells)

  return {
    exact: cells,
    coarse16um:
      exactBinSizeMicrometers === VISIUM_HD_2UM_BIN_MICROMETERS
        ? aggregateGridCellsForRenderLod(cells, VISIUM_HD_RENDER_LOD_BIN_MICROMETERS)
        : EMPTY_GRID_CELLS,
    exactBinSizeMicrometers,
  }
}

export function selectGridCellsForRenderLod(
  lods: GridCellRenderLods,
  zoom: number,
): readonly GridCellDatum[] {
  if (
    lods.exactBinSizeMicrometers === VISIUM_HD_2UM_BIN_MICROMETERS &&
    zoom < GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN &&
    lods.coarse16um.length > 0
  ) {
    return lods.coarse16um
  }

  return lods.exact
}

export function isRenderLodGridCell(cell: GridCellDatum): boolean {
  return cell.renderLodSourceBinSizeMicrometers !== undefined
}

function gridCellEntriesInBbox(
  index: GridCellSpatialIndex,
  bbox: BBox,
): GridCellIndexEntry[] {
  const bucketQueryBbox = padBbox(bbox, index.maxCellSpanMicrometers)
  const minBucketX = bucketCoordinate(bucketQueryBbox.minX, index.bucketSizeMicrometers)
  const maxBucketX = bucketCoordinate(bucketQueryBbox.maxX, index.bucketSizeMicrometers)
  const minBucketY = bucketCoordinate(bucketQueryBbox.minY, index.bucketSizeMicrometers)
  const maxBucketY = bucketCoordinate(bucketQueryBbox.maxY, index.bucketSizeMicrometers)
  const entries: GridCellIndexEntry[] = []

  for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
      const bucket = index.buckets.get(`${bucketX}:${bucketY}`)

      if (bucket === undefined) {
        continue
      }

      for (const entry of bucket) {
        if (bboxIntersectsBbox(entry.bbox, bbox)) {
          entries.push(entry)
        }
      }
    }
  }

  return entries
}

function aggregateGridCellsForRenderLod(
  cells: readonly GridCellDatum[],
  binSizeMicrometers: number,
): readonly GridCellDatum[] {
  const aggregates = new Map<string, GridCellRenderLodAggregate>()

  for (const cell of cells) {
    const cellBbox = gridCellBbox(cell)

    if (cellBbox === null) {
      continue
    }

    const sourceBinSizeMicrometers =
      cell.binSizeMicrometers ?? VISIUM_HD_2UM_BIN_MICROMETERS
    const col = Math.floor((cell.col * sourceBinSizeMicrometers) / binSizeMicrometers)
    const row = Math.floor((cell.row * sourceBinSizeMicrometers) / binSizeMicrometers)
    const key = `${row}:${col}`
    let aggregate = aggregates.get(key)

    if (aggregate === undefined) {
      aggregate = createGridCellRenderLodAggregate(
        cell,
        row,
        col,
        binSizeMicrometers,
        sourceBinSizeMicrometers,
        cellBbox,
      )
      aggregates.set(key, aggregate)
    }

    aggregateGridCell(aggregate, cell, cellBbox)
  }

  return Array.from(aggregates.values())
    .sort((left, right) => left.row - right.row || left.col - right.col)
    .map(gridCellRenderLodAggregateToDatum)
}

function commonGridCellBinSize(cells: readonly GridCellDatum[]): number | null {
  let binSizeMicrometers: number | null = null

  for (const cell of cells) {
    if (
      cell.binSizeMicrometers === undefined ||
      !Number.isFinite(cell.binSizeMicrometers) ||
      cell.binSizeMicrometers <= 0
    ) {
      return null
    }

    if (binSizeMicrometers === null) {
      binSizeMicrometers = cell.binSizeMicrometers
      continue
    }

    if (cell.binSizeMicrometers !== binSizeMicrometers) {
      return null
    }
  }

  return binSizeMicrometers
}

function createGridCellRenderLodAggregate(
  cell: GridCellDatum,
  row: number,
  col: number,
  binSizeMicrometers: number,
  sourceBinSizeMicrometers: number,
  bbox: BBox,
): GridCellRenderLodAggregate {
  return {
    id: `render-lod-${binSizeMicrometers}um:${row}:${col}`,
    gridId: `${cell.gridId}:render-lod-${binSizeMicrometers}um`,
    row,
    col,
    binSizeMicrometers,
    sourceBinSizeMicrometers,
    bbox,
    count: 0,
    inTissue: false,
    sumFillRed: 0,
    sumFillGreen: 0,
    sumFillBlue: 0,
    sumFillAlpha: 0,
    sumLineRed: 0,
    sumLineGreen: 0,
    sumLineBlue: 0,
    sumLineAlpha: 0,
  }
}

function aggregateGridCell(
  aggregate: GridCellRenderLodAggregate,
  cell: GridCellDatum,
  bbox: BBox,
): void {
  aggregate.count += 1
  aggregate.bbox = bboxUnion(aggregate.bbox, bbox)
  aggregate.inTissue = aggregate.inTissue || cell.inTissue === true
  aggregate.sumFillRed += cell.fillColor[0] ?? 0
  aggregate.sumFillGreen += cell.fillColor[1] ?? 0
  aggregate.sumFillBlue += cell.fillColor[2] ?? 0
  aggregate.sumFillAlpha += cell.fillColor[3] ?? 255
  aggregate.sumLineRed += cell.lineColor[0] ?? 0
  aggregate.sumLineGreen += cell.lineColor[1] ?? 0
  aggregate.sumLineBlue += cell.lineColor[2] ?? 0
  aggregate.sumLineAlpha += cell.lineColor[3] ?? 255
}

function gridCellRenderLodAggregateToDatum(
  aggregate: GridCellRenderLodAggregate,
): GridCellDatum {
  const count = Math.max(aggregate.count, 1)

  return {
    id: aggregate.id,
    gridId: aggregate.gridId,
    row: aggregate.row,
    col: aggregate.col,
    binSizeMicrometers: aggregate.binSizeMicrometers,
    renderLodSourceBinSizeMicrometers: aggregate.sourceBinSizeMicrometers,
    ...(aggregate.inTissue ? { inTissue: true } : {}),
    bbox: aggregate.bbox,
    polygon: gridCellBboxPolygon(aggregate.bbox),
    fillColor: [
      Math.round(aggregate.sumFillRed / count),
      Math.round(aggregate.sumFillGreen / count),
      Math.round(aggregate.sumFillBlue / count),
      Math.round(aggregate.sumFillAlpha / count),
    ],
    lineColor: [
      Math.round(aggregate.sumLineRed / count),
      Math.round(aggregate.sumLineGreen / count),
      Math.round(aggregate.sumLineBlue / count),
      Math.round(aggregate.sumLineAlpha / count),
    ],
  }
}

function gridCellBboxPolygon(bbox: BBox): GridCellDatum['polygon'] {
  return [
    [bbox.minX, -bbox.minY, 0],
    [bbox.maxX, -bbox.minY, 0],
    [bbox.maxX, -bbox.maxY, 0],
    [bbox.minX, -bbox.maxY, 0],
  ]
}

function gridCellBbox(cell: GridCellDatum): BBox | null {
  if (cell.bbox !== undefined) {
    return cell.bbox
  }

  if (cell.polygon.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x = 0, deckY = 0] of cell.polygon) {
    const rawY = -deckY
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, rawY)
    maxY = Math.max(maxY, rawY)
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function bboxIntersectsBbox(left: BBox, right: BBox): boolean {
  return (
    left.maxX >= right.minX &&
    left.minX <= right.maxX &&
    left.maxY >= right.minY &&
    left.minY <= right.maxY
  )
}

function bboxUnion(left: BBox, right: BBox): BBox {
  return {
    minX: micrometers(Math.min(left.minX, right.minX)),
    maxX: micrometers(Math.max(left.maxX, right.maxX)),
    minY: micrometers(Math.min(left.minY, right.minY)),
    maxY: micrometers(Math.max(left.maxY, right.maxY)),
  }
}

function gridCellBucketKey(x: number, y: number, bucketSizeMicrometers: number): string {
  return `${bucketCoordinate(x, bucketSizeMicrometers)}:${bucketCoordinate(
    y,
    bucketSizeMicrometers,
  )}`
}

function bucketCoordinate(value: number, bucketSizeMicrometers: number): number {
  return Math.floor(value / bucketSizeMicrometers)
}

function padBbox(bbox: BBox, paddingMicrometers: number): BBox {
  if (paddingMicrometers <= 0) {
    return bbox
  }

  return {
    minX: micrometers(bbox.minX - paddingMicrometers),
    maxX: micrometers(bbox.maxX + paddingMicrometers),
    minY: micrometers(bbox.minY - paddingMicrometers),
    maxY: micrometers(bbox.maxY + paddingMicrometers),
  }
}

function normalizeBucketSize(bucketSizeMicrometers: number | undefined): number {
  return bucketSizeMicrometers === undefined ||
    !Number.isFinite(bucketSizeMicrometers) ||
    bucketSizeMicrometers <= 0
    ? DEFAULT_GRID_CELL_BUCKET_MICROMETERS
    : bucketSizeMicrometers
}

interface GridCellRenderLodAggregate {
  readonly id: string
  readonly gridId: string
  readonly row: number
  readonly col: number
  readonly binSizeMicrometers: number
  readonly sourceBinSizeMicrometers: number
  bbox: BBox
  count: number
  inTissue: boolean
  sumFillRed: number
  sumFillGreen: number
  sumFillBlue: number
  sumFillAlpha: number
  sumLineRed: number
  sumLineGreen: number
  sumLineBlue: number
  sumLineAlpha: number
}
