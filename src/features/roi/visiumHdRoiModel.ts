import type { Position } from '@deck.gl/core'
import type { RoiDrawMode } from '../../components/ViewerCore'
import { micrometers, type BBox, type DataPoint } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { GridCellDatum } from '../../rendering/deckLayers'

export const VISIUM_HD_ROI_BIN_EXPORT_LIMIT = 50_000

export type VisiumHdRoiState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly binSizeMicrometers?: number
      readonly bbox: BBox
      readonly selection: RoiSelection
      readonly bins: readonly VisiumHdRoiBin[]
      readonly hitBinLimit: boolean
    }

export const IDLE_VISIUM_HD_ROI_STATE: VisiumHdRoiState = { status: 'idle' }

export interface VisiumHdRoiBin {
  readonly barcode: string
  readonly gridId: string
  readonly row: number
  readonly col: number
  readonly center: DataPoint
  readonly binSizeMicrometers?: number
  readonly inTissue?: boolean
  readonly fullresRow?: number
  readonly fullresCol?: number
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface VisiumHdRoiSelectionResult {
  readonly bins: readonly VisiumHdRoiBin[]
  readonly hitBinLimit: boolean
}

export interface VisiumHdRoiSummary {
  readonly binCount: number
  readonly inTissueCount: number | undefined
  readonly binSizeMicrometers: number | undefined
}

export function visiumHdRoiStatusCopy(
  roiState: VisiumHdRoiState,
  roiMode: RoiDrawMode,
): string {
  if (roiMode === 'box') {
    return 'Drawing box'
  }

  if (roiMode === 'lasso') {
    return 'Drawing lasso'
  }

  if (roiState.status === 'ready') {
    const noun = roiState.bins.length === 1 ? 'bin' : 'bins'
    return `${roiState.bins.length.toLocaleString()}${
      roiState.hitBinLimit ? '+' : ''
    } ${noun}`
  }

  return 'Idle'
}

export function summarizeVisiumHdRoiBins(
  bins: readonly VisiumHdRoiBin[],
): VisiumHdRoiSummary | null {
  if (bins.length === 0) {
    return {
      binCount: 0,
      inTissueCount: undefined,
      binSizeMicrometers: undefined,
    }
  }

  let inTissueCount = 0
  let hasTissueValue = false
  let binSizeMicrometers: number | undefined

  for (const bin of bins) {
    if (bin.inTissue !== undefined) {
      hasTissueValue = true

      if (bin.inTissue) {
        inTissueCount += 1
      }
    }

    binSizeMicrometers ??= bin.binSizeMicrometers
  }

  return {
    binCount: bins.length,
    inTissueCount: hasTissueValue ? inTissueCount : undefined,
    binSizeMicrometers,
  }
}

export function selectVisiumHdGridCellsInRoi(
  cells: readonly GridCellDatum[],
  selection: RoiSelection,
  limit = VISIUM_HD_ROI_BIN_EXPORT_LIMIT,
): VisiumHdRoiSelectionResult {
  const normalizedLimit = normalizeSelectionLimit(limit)
  const bins: VisiumHdRoiBin[] = []
  let selectedCount = 0

  for (const cell of cells) {
    const center = gridCellDatumCenter(cell)

    if (!pointInBbox(center, selection.bbox)) {
      continue
    }

    if (selection.kind === 'lasso' && !pointInPolygon(center, selection.points)) {
      continue
    }

    selectedCount += 1

    if (bins.length < normalizedLimit) {
      bins.push(gridCellDatumToRoiBin(cell, center))
    }
  }

  return {
    bins,
    hitBinLimit: selectedCount > bins.length,
  }
}

export function visiumHdRoiBinsToCsv(bins: readonly VisiumHdRoiBin[]): string {
  const rows = [
    [
      'barcode',
      'bin_size_um',
      'array_row',
      'array_col',
      'fullres_row',
      'fullres_col',
      'in_tissue',
      'x_centroid',
      'y_centroid',
      'expression_count',
      'expression_genes',
    ],
    ...bins.map((bin) => [
      bin.barcode,
      String(bin.binSizeMicrometers ?? ''),
      String(bin.row),
      String(bin.col),
      String(bin.fullresRow ?? ''),
      String(bin.fullresCol ?? ''),
      bin.inTissue === undefined ? '' : String(bin.inTissue),
      String(bin.center.x),
      String(bin.center.y),
      String(bin.expressionCount ?? ''),
      bin.expressionGenes?.join(';') ?? '',
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

export function gridCellDatumCenter(cell: GridCellDatum): DataPoint {
  const [x, deckY] = averageDeckPosition(cell.polygon)

  return {
    x: micrometers(x),
    y: micrometers(-deckY),
  }
}

export function gridCellDatumDeckCenter(
  cell: GridCellDatum,
): readonly [number, number, number] {
  const [x, deckY, z] = averageDeckPosition(cell.polygon)

  return [x, deckY, z]
}

function gridCellDatumToRoiBin(cell: GridCellDatum, center: DataPoint): VisiumHdRoiBin {
  return {
    barcode: cell.id,
    gridId: cell.gridId,
    row: cell.row,
    col: cell.col,
    center,
    ...(cell.binSizeMicrometers === undefined
      ? {}
      : { binSizeMicrometers: cell.binSizeMicrometers }),
    ...(cell.inTissue === undefined ? {} : { inTissue: cell.inTissue }),
    ...(cell.fullresRow === undefined ? {} : { fullresRow: cell.fullresRow }),
    ...(cell.fullresCol === undefined ? {} : { fullresCol: cell.fullresCol }),
    ...(cell.expressionCount === undefined
      ? {}
      : { expressionCount: cell.expressionCount }),
    ...(cell.expressionGenes === undefined
      ? {}
      : { expressionGenes: cell.expressionGenes }),
  }
}

function averageDeckPosition(
  polygon: readonly Position[],
): readonly [number, number, number] {
  if (polygon.length === 0) {
    return [0, 0, 0]
  }

  let xTotal = 0
  let yTotal = 0
  let zTotal = 0

  for (const point of polygon) {
    xTotal += point[0] ?? 0
    yTotal += point[1] ?? 0
    zTotal += point[2] ?? 0
  }

  return [xTotal / polygon.length, yTotal / polygon.length, zTotal / polygon.length]
}

function normalizeSelectionLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return VISIUM_HD_ROI_BIN_EXPORT_LIMIT
  }

  return Math.max(0, Math.floor(limit))
}

function pointInBbox(point: DataPoint, bbox: BBox): boolean {
  return (
    point.x >= bbox.minX &&
    point.x <= bbox.maxX &&
    point.y >= bbox.minY &&
    point.y <= bbox.maxY
  )
}

function pointInPolygon(point: DataPoint, polygon: readonly DataPoint[]): boolean {
  if (polygon.length < 3) {
    return false
  }

  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (current === undefined || previous === undefined) {
      continue
    }

    if (pointOnSegment(point, previous, current)) {
      return true
    }

    const crossesY =
      (current.y > point.y && previous.y <= point.y) ||
      (previous.y > point.y && current.y <= point.y)

    if (!crossesY) {
      continue
    }

    const intersectX =
      previous.x +
      ((point.y - previous.y) * (current.x - previous.x)) / (current.y - previous.y)

    if (intersectX >= point.x) {
      inside = !inside
    }
  }

  return inside
}

function pointOnSegment(point: DataPoint, start: DataPoint, end: DataPoint): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y)

  if (Math.abs(cross) > 1e-9) {
    return false
  }

  const dot =
    (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)

  if (dot < 0) {
    return false
  }

  const lengthSquared =
    (end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y)

  return dot <= lengthSquared
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
