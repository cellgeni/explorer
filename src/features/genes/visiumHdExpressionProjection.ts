import { micrometers, type DataPoint } from '../../data/coords'
import type { SpatialElementId } from '../../datasets/spatialDataset'
import type {
  GeneExpressionBatch,
  GeneExpressionElement,
} from '../../datasets/xeniumDataset'
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

  for (const cell of batch.cells) {
    binIds.add(cell.id)
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
        cells: [],
        genes: batch.genes,
        maxCount: 0,
        ...(batch.timing === undefined ? {} : { timing: batch.timing }),
      },
      mappedBinCount: 0,
      mappedCellCount: 0,
    }
  }

  const boundaryCellIds = new Set(boundaryCells.map((cell) => cell.id))
  const expressionByBinId = expressionBinsById(batch.cells)
  const assignmentWeightsByBinId = new Map<
    SpatialElementId,
    Map<SpatialElementId, number>
  >()

  for (const assignment of assignments) {
    if (
      assignment.cellId === null ||
      (!assignment.inCell && !assignment.inNucleus) ||
      !expressionByBinId.has(assignment.binId)
    ) {
      continue
    }

    let cellWeights = assignmentWeightsByBinId.get(assignment.binId)

    if (cellWeights === undefined) {
      cellWeights = new Map<SpatialElementId, number>()
      assignmentWeightsByBinId.set(assignment.binId, cellWeights)
    }

    cellWeights.set(assignment.cellId, (cellWeights.get(assignment.cellId) ?? 0) + 1)
  }

  const expressionByElementId = new Map<SpatialElementId, CellExpressionAccumulator>()
  const mappedCellIds = new Set<SpatialElementId>()

  for (const [binId, cellWeights] of assignmentWeightsByBinId) {
    const expressionBin = expressionByBinId.get(binId)

    if (expressionBin === undefined) {
      continue
    }

    let totalWeight = 0

    for (const weight of cellWeights.values()) {
      totalWeight += weight
    }

    if (totalWeight <= 0) {
      continue
    }

    for (const [cellId, weight] of cellWeights) {
      if (!boundaryCellIds.has(cellId)) {
        continue
      }

      const count = (expressionBin.count * weight) / totalWeight
      const accumulator = expressionByElementId.get(cellId)

      mappedCellIds.add(cellId)

      if (accumulator === undefined) {
        expressionByElementId.set(cellId, { count })
      } else {
        accumulator.count += count
      }
    }
  }

  const cells: GeneExpressionElement[] = []
  let maxCount = 0

  for (const boundaryCell of boundaryCells) {
    const count = expressionByElementId.get(boundaryCell.id)?.count ?? 0

    maxCount = Math.max(maxCount, count)
    cells.push({
      id: boundaryCell.id,
      position: boundaryCell.position,
      count,
      ...(boundaryCell.cellArea === undefined ? {} : { cellArea: boundaryCell.cellArea }),
    })
  }

  return {
    batch: {
      cells,
      genes: batch.genes,
      maxCount,
      ...(batch.timing === undefined ? {} : { timing: batch.timing }),
    },
    mappedBinCount: assignmentWeightsByBinId.size,
    mappedCellCount: mappedCellIds.size,
  }
}

function expressionBinsById(
  cells: readonly GeneExpressionElement[],
): ReadonlyMap<SpatialElementId, GeneExpressionElement> {
  const expressionByBinId = new Map<SpatialElementId, GeneExpressionElement>()

  for (const cell of cells) {
    const existing = expressionByBinId.get(cell.id)

    if (existing === undefined) {
      expressionByBinId.set(cell.id, cell)
      continue
    }

    expressionByBinId.set(cell.id, {
      ...existing,
      count: existing.count + cell.count,
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
