import { asCellId } from '../../data/cellid'
import type { CellTranscriptZDistribution } from '../../data/cellTranscripts'
import { micrometers, type BBox, type DataPoint } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { DatasetCell } from '../../datasets/xeniumDataset'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { OverviewCellDatum } from '../../rendering/deckLayers'

export const CELL_GENE_EXPRESSION_LIMIT = 100_000
const CELL_DETAIL_BOUNDARY_RADIUS_MICROMETERS = 25

export interface CellGeneExpressionSummary {
  readonly genes: readonly CellGeneExpressionGene[]
  readonly totalCount: number
  readonly hitGeneLimit: boolean
}

export interface CellGeneExpressionGene {
  readonly gene: string
  readonly count: number
  readonly percentTotal: number
}

export interface CellShapeMetrics {
  readonly areaMicrometersSquared?: number
  readonly equivalentDiameterMicrometers?: number
  readonly boundaryAreaMicrometersSquared?: number
  readonly boundaryEquivalentDiameterMicrometers?: number
  readonly perimeterMicrometers?: number
  readonly majorAxisMicrometers?: number
  readonly minorAxisMicrometers?: number
  readonly eccentricity?: number
  readonly circularity?: number
  readonly boundaryPointCount?: number
}

export interface CellLoadErrorSummary {
  readonly title: string
  readonly message: string
}

export type CellDetailState<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellId: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly cellId: string
      readonly expression: CellGeneExpressionSummary
      readonly shape: CellShapeMetrics
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly cellId: string
      readonly error: ErrorType
    }

export type CellTranscriptDistributionState<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellId: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly cellId: string
      readonly distribution: CellTranscriptZDistribution
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly cellId: string
      readonly error: ErrorType
    }

export function overviewCellToDatasetCell(cell: OverviewCellDatum): DatasetCell {
  return {
    id: asCellId(cell.id),
    position: overviewCellToDataPoint(cell),
    ...(cell.transcriptCount === undefined
      ? {}
      : { transcriptCount: cell.transcriptCount }),
    ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
  }
}

function overviewCellToDataPoint(cell: OverviewCellDatum): DataPoint {
  const [x = 0, deckY = 0] = cell.position

  return {
    x: micrometers(x),
    y: micrometers(-deckY),
  }
}

export function selectedCellBoundaryBbox(cell: OverviewCellDatum): BBox {
  const center = overviewCellToDataPoint(cell)
  const cellRadius =
    cell.radiusMicrometers ??
    optionalHalf(cellAreaToEquivalentDiameterMicrometers(cell.cellArea))
  const radius = Math.max(CELL_DETAIL_BOUNDARY_RADIUS_MICROMETERS, cellRadius ?? 0)

  return {
    minX: micrometers(center.x - radius),
    maxX: micrometers(center.x + radius),
    minY: micrometers(center.y - radius),
    maxY: micrometers(center.y + radius),
  }
}

export function cellExpressionSummaryFromStats(
  stats: RoiGeneStats,
): CellGeneExpressionSummary {
  return {
    genes: stats.genes.map((gene) => ({
      gene: gene.gene,
      count: gene.count,
      percentTotal: gene.percentTotal,
    })),
    totalCount: stats.totalCount,
    hitGeneLimit: stats.genes.length >= CELL_GENE_EXPRESSION_LIMIT,
  }
}

export function cellDetailStatusCopy<ErrorType extends CellLoadErrorSummary>(
  state: CellDetailState<ErrorType>,
  selectedCell: OverviewCellDatum | null,
): string {
  if (selectedCell === null) {
    return 'No selection'
  }

  if (state.status === 'loading' && state.cellId === selectedCell.id) {
    return 'Loading'
  }

  if (state.status === 'ready' && state.cellId === selectedCell.id) {
    const noun = state.expression.genes.length === 1 ? 'gene' : 'genes'
    return `${state.expression.genes.length.toLocaleString()} ${noun}`
  }

  if (state.status === 'error' && state.cellId === selectedCell.id) {
    return state.error.title
  }

  return 'Selected'
}

export function summarizeCellShape(
  cell: OverviewCellDatum,
  boundaryElement: SpatialElement | null,
): CellShapeMetrics {
  const boundaryMetrics = polygonShapeMetrics(boundaryElement)
  const area = cell.cellArea ?? boundaryMetrics?.boundaryAreaMicrometersSquared

  return {
    ...(area === undefined ? {} : { areaMicrometersSquared: area }),
    ...optionalMetric(
      'equivalentDiameterMicrometers',
      cellAreaToEquivalentDiameterMicrometers(area),
    ),
    ...(boundaryMetrics ?? {}),
  }
}

function polygonShapeMetrics(
  boundaryElement: SpatialElement | null,
): CellShapeMetrics | null {
  if (
    boundaryElement === null ||
    boundaryElement.geometry.kind !== 'polygon' ||
    boundaryElement.geometry.rings.length === 0
  ) {
    return null
  }

  const ring = boundaryElement.geometry.rings[0]

  if (ring === undefined || ring.length < 3) {
    return null
  }

  return polygonRingShapeMetrics(ring)
}

function polygonRingShapeMetrics(points: readonly DataPoint[]): CellShapeMetrics | null {
  let twiceSignedArea = 0
  let centroidXNumerator = 0
  let centroidYNumerator = 0
  let ixxNumerator = 0
  let iyyNumerator = 0
  let ixyNumerator = 0
  let perimeter = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (current === undefined || next === undefined) {
      continue
    }

    const cross = current.x * next.y - next.x * current.y
    twiceSignedArea += cross
    centroidXNumerator += (current.x + next.x) * cross
    centroidYNumerator += (current.y + next.y) * cross
    ixxNumerator += (current.y * current.y + current.y * next.y + next.y * next.y) * cross
    iyyNumerator += (current.x * current.x + next.x * current.x + next.x * next.x) * cross
    ixyNumerator +=
      (2 * current.x * current.y +
        current.x * next.y +
        next.x * current.y +
        2 * next.x * next.y) *
      cross
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
  }

  const signedArea = twiceSignedArea / 2
  const boundaryArea = Math.abs(signedArea)

  if (boundaryArea <= 0 || perimeter <= 0) {
    return null
  }

  const centroidX = centroidXNumerator / (6 * signedArea)
  const centroidY = centroidYNumerator / (6 * signedArea)
  const ixx = ixxNumerator / 12
  const iyy = iyyNumerator / 12
  const ixy = ixyNumerator / 24
  const varianceX = Math.max(0, iyy / signedArea - centroidX * centroidX)
  const varianceY = Math.max(0, ixx / signedArea - centroidY * centroidY)
  const covarianceXY = ixy / signedArea - centroidX * centroidY
  const discriminant = Math.sqrt(
    Math.max(
      0,
      (varianceX - varianceY) * (varianceX - varianceY) + 4 * covarianceXY * covarianceXY,
    ),
  )
  const majorVariance = Math.max(0, (varianceX + varianceY + discriminant) / 2)
  const minorVariance = Math.max(0, (varianceX + varianceY - discriminant) / 2)
  const majorAxis = majorVariance > 0 ? 4 * Math.sqrt(majorVariance) : undefined
  const minorAxis = minorVariance > 0 ? 4 * Math.sqrt(minorVariance) : undefined
  const eccentricity =
    majorVariance > 0
      ? Math.sqrt(Math.max(0, 1 - minorVariance / majorVariance))
      : undefined

  return {
    boundaryAreaMicrometersSquared: boundaryArea,
    ...optionalMetric(
      'boundaryEquivalentDiameterMicrometers',
      cellAreaToEquivalentDiameterMicrometers(boundaryArea),
    ),
    perimeterMicrometers: perimeter,
    ...optionalMetric('majorAxisMicrometers', majorAxis),
    ...optionalMetric('minorAxisMicrometers', minorAxis),
    ...optionalMetric('eccentricity', eccentricity),
    circularity: (4 * Math.PI * boundaryArea) / (perimeter * perimeter),
    boundaryPointCount: points.length,
  }
}

function cellAreaToEquivalentDiameterMicrometers(
  area: number | undefined,
): number | undefined {
  if (area === undefined || area <= 0 || !Number.isFinite(area)) {
    return undefined
  }

  return Math.sqrt((4 * area) / Math.PI)
}

function optionalHalf(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 2
}

function optionalMetric<Key extends keyof CellShapeMetrics>(
  key: Key,
  value: CellShapeMetrics[Key] | undefined,
): Pick<CellShapeMetrics, Key> | Record<string, never> {
  return value === undefined || !Number.isFinite(Number(value))
    ? {}
    : ({ [key]: value } as Pick<CellShapeMetrics, Key>)
}
