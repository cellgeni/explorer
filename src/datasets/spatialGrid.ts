import { micrometers, type BBox, type DataPoint, type Micrometers } from '../data/coords'
import type { SpatialGrid, SpatialGridBasis } from './spatialDataset'

export type PolygonWinding = 'clockwise' | 'counterclockwise'

export interface GridBasisFitSample {
  readonly row: number
  readonly col: number
  readonly point: DataPoint
}

type GridLike = SpatialGrid | SpatialGridBasis
type Vector3 = [number, number, number]
type Matrix3 = [Vector3, Vector3, Vector3]
type AugmentedRow = [number, number, number, number]

export function gridCellCenter(grid: GridLike, row: number, col: number): DataPoint {
  const basis = gridBasis(grid)
  return gridPointAt(basis, row, col)
}

export function gridCellCorners(
  grid: GridLike,
  row: number,
  col: number,
  options: { readonly winding?: PolygonWinding } = {},
): readonly [DataPoint, DataPoint, DataPoint, DataPoint] {
  const basis = gridBasis(grid)
  const corners: readonly [DataPoint, DataPoint, DataPoint, DataPoint] = [
    gridPointAt(basis, row - 0.5, col - 0.5),
    gridPointAt(basis, row - 0.5, col + 0.5),
    gridPointAt(basis, row + 0.5, col + 0.5),
    gridPointAt(basis, row + 0.5, col - 0.5),
  ]

  if (options.winding === undefined) {
    return corners
  }

  const isCounterclockwise = signedPolygonArea(corners) > 0

  if (
    (options.winding === 'counterclockwise' && isCounterclockwise) ||
    (options.winding === 'clockwise' && !isCounterclockwise)
  ) {
    return corners
  }

  return [corners[3], corners[2], corners[1], corners[0]]
}

export function gridCellIntersectsBbox(
  grid: GridLike,
  row: number,
  col: number,
  bbox: BBox,
): boolean {
  const corners = gridCellCorners(grid, row, col)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const corner of corners) {
    minX = Math.min(minX, corner.x)
    maxX = Math.max(maxX, corner.x)
    minY = Math.min(minY, corner.y)
    maxY = Math.max(maxY, corner.y)
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
}

export function fitGridBasis(samples: readonly GridBasisFitSample[]): SpatialGridBasis {
  if (samples.length < 3) {
    throw new Error('At least three grid samples are required to fit a basis.')
  }

  const normal: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const rhsX: Vector3 = [0, 0, 0]
  const rhsY: Vector3 = [0, 0, 0]

  for (const sample of samples) {
    assertFinite(sample.row, 'sample.row')
    assertFinite(sample.col, 'sample.col')

    const vector: Vector3 = [1, sample.row, sample.col]

    for (let row = 0; row < 3; row += 1) {
      const rowValue = vector[row] ?? 0
      const normalRow = normal[row]

      if (normalRow === undefined) {
        throw new Error('Unexpected grid normal equation row.')
      }

      rhsX[row] = (rhsX[row] ?? 0) + rowValue * sample.point.x
      rhsY[row] = (rhsY[row] ?? 0) + rowValue * sample.point.y

      for (let col = 0; col < 3; col += 1) {
        normalRow[col] = (normalRow[col] ?? 0) + rowValue * (vector[col] ?? 0)
      }
    }
  }

  const [originX, rowStepX, colStepX] = solve3x3(normal, rhsX)
  const [originY, rowStepY, colStepY] = solve3x3(normal, rhsY)

  return {
    origin: { x: micrometers(originX), y: micrometers(originY) },
    rowStep: { x: micrometers(rowStepX), y: micrometers(rowStepY) },
    colStep: { x: micrometers(colStepX), y: micrometers(colStepY) },
  }
}

export function deriveNestedGridBasis(
  finestBasis: SpatialGridBasis,
  scaleFactor: number,
): SpatialGridBasis {
  assertPositiveIntegerScale(scaleFactor, 'Nested grid scale factor')

  const centerOffset = (scaleFactor - 1) / 2
  const rowStep = scaleVector(finestBasis.rowStep, scaleFactor)
  const colStep = scaleVector(finestBasis.colStep, scaleFactor)

  return {
    origin: {
      x: micrometers(
        finestBasis.origin.x +
          centerOffset * (finestBasis.rowStep.x + finestBasis.colStep.x),
      ),
      y: micrometers(
        finestBasis.origin.y +
          centerOffset * (finestBasis.rowStep.y + finestBasis.colStep.y),
      ),
    },
    rowStep,
    colStep,
  }
}

export function deriveSubdividedGridBasis(
  coarserBasis: SpatialGridBasis,
  scaleFactor: number,
): SpatialGridBasis {
  assertPositiveIntegerScale(scaleFactor, 'Subdivided grid scale factor')

  const rowStep = divideVector(coarserBasis.rowStep, scaleFactor)
  const colStep = divideVector(coarserBasis.colStep, scaleFactor)
  const centerOffset = (scaleFactor - 1) / 2

  return {
    origin: {
      x: micrometers(coarserBasis.origin.x - centerOffset * (rowStep.x + colStep.x)),
      y: micrometers(coarserBasis.origin.y - centerOffset * (rowStep.y + colStep.y)),
    },
    rowStep,
    colStep,
  }
}

export function signedPolygonArea(points: readonly DataPoint[]): number {
  let area = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (current === undefined || next === undefined) {
      continue
    }

    area += current.x * next.y - next.x * current.y
  }

  return area / 2
}

function gridBasis(grid: GridLike): SpatialGridBasis {
  return 'basis' in grid ? grid.basis : grid
}

function gridPointAt(basis: SpatialGridBasis, row: number, col: number): DataPoint {
  assertFinite(row, 'row')
  assertFinite(col, 'col')

  return {
    x: micrometers(basis.origin.x + row * basis.rowStep.x + col * basis.colStep.x),
    y: micrometers(basis.origin.y + row * basis.rowStep.y + col * basis.colStep.y),
  }
}

function scaleVector(
  vector: { readonly x: Micrometers; readonly y: Micrometers },
  scale: number,
): { readonly x: Micrometers; readonly y: Micrometers } {
  return {
    x: micrometers(vector.x * scale),
    y: micrometers(vector.y * scale),
  }
}

function divideVector(
  vector: { readonly x: Micrometers; readonly y: Micrometers },
  divisor: number,
): { readonly x: Micrometers; readonly y: Micrometers } {
  return {
    x: micrometers(vector.x / divisor),
    y: micrometers(vector.y / divisor),
  }
}

function assertPositiveIntegerScale(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer, received ${value}.`)
  }
}

function solve3x3(matrix: Matrix3, rhs: Vector3): readonly [number, number, number] {
  const augmented: [AugmentedRow, AugmentedRow, AugmentedRow] = [
    [matrix[0][0], matrix[0][1], matrix[0][2], rhs[0]],
    [matrix[1][0], matrix[1][1], matrix[1][2], rhs[1]],
    [matrix[2][0], matrix[2][1], matrix[2][2], rhs[2]],
  ]

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let pivotRow = pivot

    for (let row = pivot + 1; row < 3; row += 1) {
      const candidateRow = augmented[row]
      const currentPivotRow = augmented[pivotRow]

      if (
        candidateRow !== undefined &&
        currentPivotRow !== undefined &&
        Math.abs(candidateRow[pivot] ?? 0) > Math.abs(currentPivotRow[pivot] ?? 0)
      ) {
        pivotRow = row
      }
    }

    if (pivotRow !== pivot) {
      const current = augmented[pivot]
      const replacement = augmented[pivotRow]
      if (current !== undefined && replacement !== undefined) {
        augmented[pivot] = replacement
        augmented[pivotRow] = current
      }
    }

    const pivotValues = augmented[pivot]

    if (pivotValues === undefined) {
      throw new Error('Unexpected grid pivot row.')
    }

    const pivotValue = pivotValues[pivot]

    if (pivotValue === undefined || Math.abs(pivotValue) < 1e-12) {
      throw new Error('Grid basis samples are singular and cannot be fitted.')
    }

    for (let col = pivot; col < 4; col += 1) {
      pivotValues[col] = (pivotValues[col] ?? 0) / pivotValue
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) {
        continue
      }

      const targetRow = augmented[row]

      if (targetRow === undefined) {
        throw new Error('Unexpected grid elimination row.')
      }

      const factor = targetRow[pivot] ?? 0

      for (let col = pivot; col < 4; col += 1) {
        targetRow[col] = (targetRow[col] ?? 0) - factor * (pivotValues[col] ?? 0)
      }
    }
  }

  return [augmented[0][3] ?? 0, augmented[1][3] ?? 0, augmented[2][3] ?? 0]
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, received ${value}.`)
  }
}
