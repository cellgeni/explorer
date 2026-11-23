import { micrometers, type DataPoint } from '../../data/coords'
import type {
  GeneExpressionBatch,
  GeneExpressionElement,
  SpatialElementId,
} from '../../datasets/spatialDataset'
import { visiumHdSegmentationCellId } from '../../datasets/visiumHdSegmentationIndex'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'

export interface VisiumHdExpressionCellAssignment {
  readonly binId: SpatialElementId
  readonly cellId: SpatialElementId | null
  readonly inNucleus: boolean
  readonly inCell: boolean
}

interface BoundaryCellGeometry {
  readonly id: SpatialElementId
  readonly position: DataPoint
  readonly cellArea?: number
}

interface CellExpressionAccumulator {
  count: number
}

export interface ProjectVisiumHdExpressionResult {
  readonly batch: GeneExpressionBatch
  readonly mappedBinCount: number
  readonly mappedCellCount: number
}

export function visiumHdExpressionBinIds(
  batch: GeneExpressionBatch,
): readonly SpatialElementId[] {
  const binIds = new Set<SpatialElementId>()

  for (const element of batch.elements) {
    binIds.add(element.id)
  }

  return Array.from(binIds)
}

export function projectVisiumHdExpressionToBoundaryCells(
  batch: GeneExpressionBatch,
  assignments: readonly VisiumHdExpressionCellAssignment[],
  boundaries: readonly CellBoundaryDatum[],
): ProjectVisiumHdExpressionResult {
  const boundaryCells = visibleBoundaryCellGeometry(boundaries)

  if (boundaryCells.length === 0) {
    return {
      batch: {
        elements: [],
        genes: batch.genes,
        population: 'all',
        maxCount: 0,
        ...(batch.timing === undefined ? {} : { timing: batch.timing }),
      },
      mappedBinCount: 0,
      mappedCellCount: 0,
    }
  }

  const boundaryCellIds = new Set(boundaryCells.map((cell) => cell.id))
  const expressionByBinId = expressionBinsById(batch.elements)
  const sharesByBinId = visiumHdBinBarcodeShares(assignments, expressionByBinId)
  const expressionByElementId = new Map<SpatialElementId, CellExpressionAccumulator>()
  const mappedCellIds = new Set<SpatialElementId>()

  for (const [binId, shares] of sharesByBinId) {
    const expressionBin = expressionByBinId.get(binId)

    if (expressionBin === undefined) {
      continue
    }

    for (const [cellId, barcodeCount] of shares.cells) {
      if (!boundaryCellIds.has(cellId)) {
        continue
      }

      const count = (expressionBin.count * barcodeCount) / shares.barcodeCount
      const accumulator = expressionByElementId.get(cellId)

      mappedCellIds.add(cellId)

      if (accumulator === undefined) {
        expressionByElementId.set(cellId, { count })
      } else {
        accumulator.count += count
      }
    }
  }

  const elements: GeneExpressionElement[] = []
  let maxCount = 0

  for (const boundaryCell of boundaryCells) {
    const count = expressionByElementId.get(boundaryCell.id)?.count ?? 0

    maxCount = Math.max(maxCount, count)
    elements.push({
      id: boundaryCell.id,
      position: boundaryCell.position,
      count,
      ...(boundaryCell.cellArea === undefined ? {} : { cellArea: boundaryCell.cellArea }),
    })
  }

  return {
    batch: {
      elements,
      genes: batch.genes,
      // Every boundary cell is listed, with 0 where no bin maps to it.
      population: 'all',
      maxCount,
      ...(batch.timing === undefined ? {} : { timing: batch.timing }),
    },
    mappedBinCount: [...sharesByBinId.values()].filter((shares) => shares.cells.size > 0)
      .length,
    mappedCellCount: mappedCellIds.size,
  }
}

export interface VisiumHdBinBarcodeShares {
  // The bin's 2 µm barcodes listed in barcode_mappings.parquet.
  readonly barcodeCount: number
  // How many of them each cell holds, in the cell or its nucleus.
  readonly cells: ReadonlyMap<SpatialElementId, number>
}

// Each bin's barcodes and its cells' part of them. A bin's counts are shared
// among its cells by that part: a cell holding 20 of a 16 µm bin's 64
// barcodes takes 20/64 of each count, as it would if the bin's transcripts
// were spread evenly over it. The part outside every cell goes to no cell.
// At 2 µm a bin is one barcode, so its cell takes all of it.
export function visiumHdBinBarcodeShares(
  assignments: readonly VisiumHdExpressionCellAssignment[],
  binIds?: { has(binId: SpatialElementId): boolean },
): ReadonlyMap<SpatialElementId, VisiumHdBinBarcodeShares> {
  const shares = new Map<
    SpatialElementId,
    { barcodeCount: number; cells: Map<SpatialElementId, number> }
  >()

  for (const assignment of assignments) {
    if (binIds !== undefined && !binIds.has(assignment.binId)) {
      continue
    }

    let binShares = shares.get(assignment.binId)

    if (binShares === undefined) {
      binShares = { barcodeCount: 0, cells: new Map() }
      shares.set(assignment.binId, binShares)
    }

    binShares.barcodeCount += 1

    if (assignment.cellId !== null && (assignment.inCell || assignment.inNucleus)) {
      binShares.cells.set(
        assignment.cellId,
        (binShares.cells.get(assignment.cellId) ?? 0) + 1,
      )
    }
  }

  return shares
}

// A segmented cell's projected count in a projected batch. A MultiPolygon
// cell's later parts (`<cell_id>#2`) share their cell's count, which the
// batch gives the cell's first part.
export function projectedBoundaryCellCount(
  batch: GeneExpressionBatch,
  boundaryId: SpatialElementId,
): number | undefined {
  const cellId = visiumHdSegmentationCellId(boundaryId)

  return (
    batch.elements.find((element) => element.id === boundaryId)?.count ??
    batch.elements.find((element) => element.id === cellId)?.count
  )
}

function expressionBinsById(
  elements: readonly GeneExpressionElement[],
): ReadonlyMap<SpatialElementId, GeneExpressionElement> {
  const expressionByBinId = new Map<SpatialElementId, GeneExpressionElement>()

  for (const element of elements) {
    const existing = expressionByBinId.get(element.id)

    if (existing === undefined) {
      expressionByBinId.set(element.id, element)
      continue
    }

    expressionByBinId.set(element.id, {
      ...existing,
      count: existing.count + element.count,
    })
  }

  return expressionByBinId
}

function visibleBoundaryCellGeometry(
  boundaries: readonly CellBoundaryDatum[],
): readonly BoundaryCellGeometry[] {
  const cells: BoundaryCellGeometry[] = []

  for (const boundary of boundaries) {
    const geometry = boundaryCellGeometry(boundary)

    if (geometry !== null) {
      cells.push(geometry)
    }
  }

  return cells
}

function boundaryCellGeometry(boundary: CellBoundaryDatum): BoundaryCellGeometry | null {
  const polygon = openBoundaryPolygon(boundary.polygon)

  if (polygon.length === 0) {
    return null
  }

  const centroid = boundaryPolygonCentroid(polygon)
  const area = boundaryPolygonArea(polygon)

  return {
    id: boundary.id,
    position: centroid,
    ...(area <= 0 ? {} : { cellArea: area }),
  }
}

function openBoundaryPolygon(
  polygon: readonly CellBoundaryDatum['polygon'][number][],
): readonly CellBoundaryDatum['polygon'][number][] {
  const first = polygon[0]
  const last = polygon.at(-1)

  if (
    first !== undefined &&
    last !== undefined &&
    polygon.length > 1 &&
    first[0] === last[0] &&
    first[1] === last[1]
  ) {
    return polygon.slice(0, -1)
  }

  return polygon
}

function boundaryPolygonCentroid(
  polygon: readonly CellBoundaryDatum['polygon'][number][],
): DataPoint {
  let twiceSignedArea = 0
  let weightedX = 0
  let weightedY = 0

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentX = current[0] ?? 0
    const currentY = -(current[1] ?? 0)
    const nextX = next[0] ?? 0
    const nextY = -(next[1] ?? 0)
    const cross = currentX * nextY - nextX * currentY

    twiceSignedArea += cross
    weightedX += (currentX + nextX) * cross
    weightedY += (currentY + nextY) * cross
  }

  if (Math.abs(twiceSignedArea) > 1e-6) {
    return {
      x: micrometers(weightedX / (3 * twiceSignedArea)),
      y: micrometers(weightedY / (3 * twiceSignedArea)),
    }
  }

  let sumX = 0
  let sumY = 0

  for (const point of polygon) {
    sumX += point[0] ?? 0
    sumY += -(point[1] ?? 0)
  }

  return {
    x: micrometers(sumX / polygon.length),
    y: micrometers(sumY / polygon.length),
  }
}

function boundaryPolygonArea(
  polygon: readonly CellBoundaryDatum['polygon'][number][],
): number {
  let twiceSignedArea = 0

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentX = current[0] ?? 0
    const currentY = -(current[1] ?? 0)
    const nextX = next[0] ?? 0
    const nextY = -(next[1] ?? 0)

    twiceSignedArea += currentX * nextY - nextX * currentY
  }

  return Math.abs(twiceSignedArea) / 2
}
