import type { Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type { GeneExpressionCell } from '../datasets/xeniumDataset'
import type { SpatialElement } from '../datasets/spatialDataset'
import { DEFAULT_LAYER_OPACITY, normalizeLayerOpacity } from './layerOpacity'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly radiusMicrometers?: number
  readonly fillColor: Color
  readonly cellCount?: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface OverviewViewState {
  readonly target: [number, number, number]
  readonly zoom: number
  readonly minZoom: number
  readonly maxZoom: number
}

export interface CellBoundaryDatum {
  readonly id: string
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
}

export interface OverviewLayerOptions {
  readonly geneExpressionOpacity?: number
}

export type GeneExpressionColorScale = 'gold' | 'magma' | 'viridis'

export interface GeneExpressionColorScaleOption {
  readonly id: GeneExpressionColorScale
  readonly label: string
}

type ColorStop = readonly [number, number, number, number]

export const DEFAULT_GENE_EXPRESSION_COLOR_SCALE: GeneExpressionColorScale = 'gold'

export const GENE_EXPRESSION_COLOR_SCALE_OPTIONS: readonly GeneExpressionColorScaleOption[] =
  [
    { id: 'gold', label: 'Gold' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
  ]

const GENE_EXPRESSION_COLOR_STOPS: Record<
  GeneExpressionColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  gold: [
    [111, 63, 53, 130],
    [221, 127, 75, 196],
    [255, 221, 99, 245],
  ],
  magma: [
    [45, 15, 71, 130],
    [195, 60, 105, 205],
    [252, 223, 116, 245],
  ],
  viridis: [
    [68, 1, 84, 130],
    [33, 145, 140, 205],
    [253, 231, 37, 245],
  ],
}

const DEFAULT_OVERVIEW_VIEW_STATE: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -4,
  minZoom: -10,
  maxZoom: 10,
}

export const spatialOverviewView = new OrthographicView({
  id: 'spatial-overview',
  flipY: false,
})

export const bundledDeckVersion = deckVersion

export function createOverviewLayers(
  cells: readonly OverviewCellDatum[],
  boundaries: readonly CellBoundaryDatum[] = [],
  hexBoundaries: readonly CellBoundaryDatum[] = [],
  expressionCells: readonly OverviewCellDatum[] = [],
  options: OverviewLayerOptions = {},
): LayersList {
  const geneExpressionOpacity = normalizeLayerOpacity(
    options.geneExpressionOpacity ?? DEFAULT_LAYER_OPACITY,
  )
  const layers: LayersList = [
    new ScatterplotLayer<OverviewCellDatum>({
      id: 'cells-overview-scatter',
      data: cells,
      pickable: true,
      radiusUnits: 'common',
      radiusMinPixels: 1.25,
      radiusMaxPixels: 8,
      getPosition: (cell) => cell.position,
      getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
      getFillColor: (cell) => cell.fillColor,
    }),
  ]

  if (expressionCells.length > 0) {
    layers.push(
      new ScatterplotLayer<OverviewCellDatum>({
        id: 'gene-expression-scatter',
        data: expressionCells,
        pickable: true,
        radiusUnits: 'common',
        radiusMinPixels: 3,
        radiusMaxPixels: 18,
        stroked: true,
        lineWidthMinPixels: 1,
        opacity: geneExpressionOpacity,
        getPosition: (cell) => cell.position,
        getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: [255, 253, 247, 230],
        getLineWidth: 1,
      }),
    )
  }

  if (hexBoundaries.length > 0 && boundaries.length === 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-hexagons',
        data: hexBoundaries,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  if (boundaries.length > 0) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-polygons',
        data: boundaries,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => cell.fillColor,
        getLineColor: (cell) => cell.lineColor,
        getLineWidth: 1,
      }),
    )
  }

  return layers
}

export function overviewCellsToLayerData(
  cells: readonly CellOverviewPoint[],
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  let maxTranscriptCount = 1

  for (const cell of cells) {
    maxTranscriptCount = Math.max(maxTranscriptCount, cell.transcriptCount)
  }

  return cells.map((cell, index) => {
    const intensity = Math.sqrt(Math.max(cell.transcriptCount, 0) / maxTranscriptCount)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.cellId ?? `overview-cell-${index}`,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 2 + intensity * 3,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: [215, 63, 124, 150 + Math.round(intensity * 90)],
      transcriptCount: cell.transcriptCount,
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
    }
  })
}

export function geneExpressionCellsToLayerData(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  colorScale: GeneExpressionColorScale = DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  let maxCount = 1

  for (const cell of cells) {
    maxCount = Math.max(maxCount, cell.count)
  }

  const layerData = cells.map((cell): OverviewCellDatum => {
    const intensity = Math.sqrt(Math.max(cell.count, 0) / maxCount)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.id,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 4 + intensity * 6,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: geneExpressionColor(colorScale, intensity),
      expressionCount: cell.count,
      expressionGenes: genes,
      ...(cell.transcriptCount === undefined
        ? {}
        : { transcriptCount: cell.transcriptCount }),
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
    }
  })

  return styleGeneExpressionCellsByScale(layerData, colorScale)
}

export function styleGeneExpressionCellsByScale(
  cells: readonly OverviewCellDatum[],
  colorScale: GeneExpressionColorScale,
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  let maxExpressionCount = 1

  for (const cell of cells) {
    maxExpressionCount = Math.max(maxExpressionCount, cell.expressionCount ?? 0)
  }

  return cells.map((cell) => {
    const intensity = Math.sqrt(
      Math.max(cell.expressionCount ?? 0, 0) / maxExpressionCount,
    )

    return {
      ...cell,
      fillColor: geneExpressionColor(colorScale, intensity),
    }
  })
}

export function isGeneExpressionColorScale(
  value: string,
): value is GeneExpressionColorScale {
  return GENE_EXPRESSION_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

function geneExpressionColor(
  colorScale: GeneExpressionColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = GENE_EXPRESSION_COLOR_STOPS[colorScale]
  const normalizedIntensity = Math.min(1, Math.max(0, intensity))
  const startStop = normalizedIntensity <= 0.5 ? lowStop : middleStop
  const endStop = normalizedIntensity <= 0.5 ? middleStop : highStop
  const t =
    normalizedIntensity <= 0.5 ? normalizedIntensity * 2 : (normalizedIntensity - 0.5) * 2

  return [
    interpolateColorChannel(startStop[0], endStop[0], t),
    interpolateColorChannel(startStop[1], endStop[1], t),
    interpolateColorChannel(startStop[2], endStop[2], t),
    interpolateColorChannel(startStop[3], endStop[3], t),
  ]
}

function interpolateColorChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}

function cellAreaToRadiusMicrometers(cellArea: number | undefined): number | undefined {
  if (cellArea === undefined || !Number.isFinite(cellArea) || cellArea <= 0) {
    return undefined
  }

  return Math.sqrt(cellArea / Math.PI)
}

export function boundaryElementsToLayerData(
  elements: readonly SpatialElement[],
): readonly CellBoundaryDatum[] {
  const cells: CellBoundaryDatum[] = []

  for (const element of elements) {
    if (element.geometry.kind !== 'polygon') {
      continue
    }

    const ring = element.geometry.rings[0]

    if (ring === undefined || ring.length < 3) {
      continue
    }

    cells.push({
      id: element.id,
      polygon: ring.map((point) => [point.x, -point.y, 0]),
      fillColor: [32, 102, 83, 34],
      lineColor: [246, 242, 232, 210],
    })
  }

  return cells
}

export function createOverviewViewState(
  cells: readonly OverviewCellDatum[],
): OverviewViewState {
  if (cells.length === 0) {
    return DEFAULT_OVERVIEW_VIEW_STATE
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const cell of cells) {
    const [x = 0, y = 0] = cell.position
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  const span = Math.max(maxX - minX, maxY - minY, 1)
  const zoom = Math.max(-10, Math.min(4, Math.log2(720 / span)))

  return {
    ...DEFAULT_OVERVIEW_VIEW_STATE,
    target: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
    zoom,
  }
}
