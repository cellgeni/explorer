import type { Color, LayersList, Position } from '@deck.gl/core'
import { PathLayer, PolygonLayer, SolidPolygonLayer } from '@deck.gl/layers'
import type { SpatialElement } from '../datasets/spatialDataset'
import { annotationPaletteColor, normalizeAnnotationColor } from './annotationPalette'
import {
  boundaryFillColor,
  boundaryLineColor,
  CELL_BOUNDARY_HIT_AREA_OPACITY,
  CELL_BOUNDARY_LINE_WIDTH_PIXELS,
  colorWithFillOpacity,
  colorWithOpacity,
  DEFAULT_CELL_BOUNDARY_FILL_COLOR,
  DEFAULT_CELL_BOUNDARY_LINE_COLOR,
} from './deckLayerColors'
import type {
  BoundaryElementsToLayerDataOptions,
  CellBoundaryDatum,
  CellBoundaryFillGeometryData,
  CellBoundaryFillLayerData,
  CellBoundaryLayerGeometry,
  CellBoundaryLayerGeometryOptions,
  CellBoundaryLayerStyle,
  CellBoundaryPathGeometryData,
  CellBoundaryPathLayerData,
  OverviewCellDatum,
} from './deckLayerTypes'
import { DEFAULT_LAYER_OPACITY, normalizeLayerOpacity } from './layerOpacity'

const EMPTY_CELL_BOUNDARY_PATH_GEOMETRY: CellBoundaryPathGeometryData = {
  length: 0,
  startIndices: new Uint32Array(1),
  attributes: {
    getPath: { value: new Float32Array(0), size: 3 },
  },
}
const EMPTY_CELL_BOUNDARY_FILL_GEOMETRY: CellBoundaryFillGeometryData = {
  length: 0,
  startIndices: new Uint32Array(1),
  attributes: {
    getPolygon: { value: new Float32Array(0), size: 3 },
  },
}
export const EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY: CellBoundaryLayerGeometry = {
  pathLayerData: EMPTY_CELL_BOUNDARY_PATH_GEOMETRY,
  fillLayerData: EMPTY_CELL_BOUNDARY_FILL_GEOMETRY,
  pathCellIds: [],
  fillCellIds: [],
  pathLineColors: [],
  fillColors: [],
  boundaryCellIds: new Set<string>(),
}
export const EMPTY_CELL_BOUNDARY_LAYER_STYLE: CellBoundaryLayerStyle = {
  fillColorByCellId: new Map<string, Color>(),
  lineColorByCellId: new Map<string, Color>(),
}

interface CellBoundaryLayerDataCache {
  fillData?: CellBoundaryFillLayerData
  fillOpacity?: number
  fillStyle?: CellBoundaryLayerStyle
  pathData?: CellBoundaryPathLayerData
  pathOpacity?: number
  pathStyle?: CellBoundaryLayerStyle
}

interface CellBoundaryGeometryBuildResult<
  LayerData extends CellBoundaryPathGeometryData | CellBoundaryFillGeometryData,
> {
  readonly layerData: LayerData
  readonly cellIds: readonly string[]
  readonly colors: readonly Color[]
}

interface CellBoundaryLayerOptions {
  readonly boundaries: readonly CellBoundaryDatum[]
  readonly geometry: CellBoundaryLayerGeometry
  readonly style: CellBoundaryLayerStyle
  readonly fillEnabled: boolean
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly pickable: boolean
}

const cellBoundaryLayerDataCache = new WeakMap<
  CellBoundaryLayerGeometry,
  CellBoundaryLayerDataCache
>()

export function createCellBoundaryLayers(options: CellBoundaryLayerOptions): LayersList {
  const layers: LayersList = []

  if (options.geometry.pathLayerData.length === 0) {
    return layers
  }

  if (options.fillEnabled) {
    const boundaryFillData = cellBoundaryFillLayerDataWithColors(
      options.geometry,
      options.style,
      options.cellFillOpacity,
    )

    if (boundaryFillData.length > 0) {
      layers.push(
        new SolidPolygonLayer<unknown>({
          id: 'cell-boundary-fills',
          data: boundaryFillData,
          dataComparator: hasSameCellBoundaryLayerGeometry,
          pickable: false,
          filled: true,
          extruded: false,
          _normalize: false,
          opacity: 1,
          getPolygon: () => [],
          getFillColor: [32, 102, 83, 34],
          updateTriggers: {
            getFillColor: [options.cellFillOpacity, options.style],
          },
        }),
      )
    }
  }

  const boundaryPathData = cellBoundaryPathLayerDataWithColors(
    options.geometry,
    options.style,
    options.cellBoundaryOpacity,
  )

  if (boundaryPathData.length > 0) {
    layers.push(
      new PathLayer<unknown>({
        id: 'cell-boundary-paths',
        data: boundaryPathData,
        dataComparator: hasSameCellBoundaryLayerGeometry,
        pickable: false,
        _pathType: 'loop',
        opacity: 1,
        widthUnits: 'pixels',
        widthMinPixels: CELL_BOUNDARY_LINE_WIDTH_PIXELS,
        getPath: () => [],
        getColor: DEFAULT_CELL_BOUNDARY_LINE_COLOR,
        getWidth: CELL_BOUNDARY_LINE_WIDTH_PIXELS,
        updateTriggers: {
          getColor: [options.cellBoundaryOpacity, options.style],
        },
      }),
    )
  }

  if (options.pickable) {
    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'cell-boundary-hit-areas',
        data: options.boundaries,
        pickable: true,
        stroked: false,
        filled: true,
        opacity: CELL_BOUNDARY_HIT_AREA_OPACITY,
        getPolygon: (boundary) => boundary.polygon,
        getFillColor: [0, 0, 0, 1],
      }),
    )
  }

  return layers
}

export function createNucleusBoundaryLayers(
  boundaries: readonly CellBoundaryDatum[],
  opacity: number | undefined,
): LayersList {
  if (boundaries.length === 0) {
    return []
  }

  const nucleusBoundaryOpacity = normalizeLayerOpacity(opacity ?? DEFAULT_LAYER_OPACITY)

  return [
    new PolygonLayer<CellBoundaryDatum>({
      id: 'nucleus-segmentation-polygons',
      data: boundaries,
      pickable: false,
      stroked: true,
      filled: true,
      opacity: 1,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 0.5,
      getPolygon: (boundary) => boundary.polygon,
      getFillColor: (boundary) =>
        colorWithOpacity(boundary.fillColor, nucleusBoundaryOpacity),
      getLineColor: (boundary) =>
        colorWithOpacity(boundary.lineColor, nucleusBoundaryOpacity),
      getLineWidth: 0.5,
      updateTriggers: {
        getFillColor: [nucleusBoundaryOpacity],
        getLineColor: [nucleusBoundaryOpacity],
      },
    }),
  ]
}

export function createCellBoundaryLayerGeometry(
  boundaries: readonly CellBoundaryDatum[],
  options: CellBoundaryLayerGeometryOptions = {},
): CellBoundaryLayerGeometry {
  if (boundaries.length === 0) {
    return EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY
  }

  const includeFill = options.includeFill ?? true
  const pathLayerData = cellBoundariesToPathLayerGeometry(boundaries)
  const fillLayerData = includeFill
    ? cellBoundariesToFillLayerGeometry(boundaries)
    : {
        layerData: EMPTY_CELL_BOUNDARY_FILL_GEOMETRY,
        cellIds: [],
        colors: [],
      }
  const boundaryCellIds = new Set<string>()

  for (const cellId of pathLayerData.cellIds) {
    boundaryCellIds.add(cellId)
  }

  if (boundaryCellIds.size === 0) {
    return EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY
  }

  return {
    pathLayerData: pathLayerData.layerData,
    fillLayerData: fillLayerData.layerData,
    pathCellIds: pathLayerData.cellIds,
    fillCellIds: fillLayerData.cellIds,
    pathLineColors: pathLayerData.colors,
    fillColors: fillLayerData.colors,
    boundaryCellIds,
  }
}

export function createCellBoundaryLayerStyle(
  geometry: CellBoundaryLayerGeometry,
  cells: readonly OverviewCellDatum[],
  expressionCells: readonly OverviewCellDatum[],
): CellBoundaryLayerStyle {
  if (
    geometry.boundaryCellIds.size === 0 ||
    (cells.length === 0 && expressionCells.length === 0)
  ) {
    return EMPTY_CELL_BOUNDARY_LAYER_STYLE
  }

  const fillColorByCellId = new Map<string, Color>()
  const lineColorByCellId = new Map<string, Color>()

  for (const cell of cells) {
    if (!geometry.boundaryCellIds.has(cell.id)) {
      continue
    }

    fillColorByCellId.set(cell.id, boundaryFillColor(cell.fillColor))
    lineColorByCellId.set(cell.id, boundaryLineColor(cell.fillColor))
  }

  for (const cell of expressionCells) {
    if (!geometry.boundaryCellIds.has(cell.id)) {
      continue
    }

    fillColorByCellId.set(cell.id, cell.fillColor)
    lineColorByCellId.set(cell.id, boundaryLineColor(cell.fillColor))
  }

  if (fillColorByCellId.size === 0 && lineColorByCellId.size === 0) {
    return EMPTY_CELL_BOUNDARY_LAYER_STYLE
  }

  return { fillColorByCellId, lineColorByCellId }
}

export function boundaryElementsToLayerData(
  elements: readonly SpatialElement[],
  options: BoundaryElementsToLayerDataOptions = {},
): readonly CellBoundaryDatum[] {
  const cells: CellBoundaryDatum[] = []
  const defaultFillColor = options.fillColor ?? DEFAULT_CELL_BOUNDARY_FILL_COLOR
  const defaultLineColor = options.lineColor ?? DEFAULT_CELL_BOUNDARY_LINE_COLOR
  const annotationPaletteByLabel = new Map<string, string>()

  for (const element of elements) {
    if (element.geometry.kind !== 'polygon') {
      continue
    }

    const ring = element.geometry.rings[0]

    if (ring === undefined || ring.length < 3) {
      continue
    }

    const style = boundaryStyleFromElementMetadata(
      element,
      defaultFillColor,
      defaultLineColor,
      annotationPaletteByLabel,
    )

    cells.push({
      id: element.id,
      polygon: ring.map((point) => [point.x, -point.y, 0]),
      fillColor: style.fillColor,
      lineColor: style.lineColor,
      ...(style.annotationLabel === undefined
        ? {}
        : { annotationLabel: style.annotationLabel }),
    })
  }

  return cells
}

export function styleCellBoundariesByCells(
  boundaries: readonly CellBoundaryDatum[],
  cells: readonly OverviewCellDatum[],
): readonly CellBoundaryDatum[] {
  if (boundaries.length === 0 || cells.length === 0) {
    return boundaries
  }

  const cellById = new Map<string, OverviewCellDatum>()

  for (const cell of cells) {
    cellById.set(cell.id, cell)
  }

  return boundaries.map((boundary) => {
    const cell = cellById.get(boundary.id)

    if (cell === undefined) {
      return boundary
    }

    return {
      ...boundary,
      fillColor: boundaryFillColor(cell.fillColor),
      lineColor: boundaryLineColor(cell.fillColor),
    }
  })
}

export function styleCellBoundariesByGeneExpression(
  boundaries: readonly CellBoundaryDatum[],
  expressionCells: readonly OverviewCellDatum[],
): readonly CellBoundaryDatum[] {
  if (boundaries.length === 0 || expressionCells.length === 0) {
    return boundaries
  }

  const expressionByCellId = new Map<string, OverviewCellDatum>()

  for (const cell of expressionCells) {
    expressionByCellId.set(cell.id, cell)
  }

  let hasExpressionMatch = false
  const styledBoundaries = boundaries.map((boundary) => {
    const expressionCell = expressionByCellId.get(boundary.id)

    if (expressionCell === undefined) {
      return boundary
    }

    hasExpressionMatch = true
    return {
      ...boundary,
      fillColor: expressionCell.fillColor,
      lineColor: boundaryLineColor(expressionCell.fillColor),
      ...(expressionCell.expressionCount === undefined
        ? {}
        : { expressionCount: expressionCell.expressionCount }),
      ...(expressionCell.expressionGenes === undefined
        ? {}
        : { expressionGenes: expressionCell.expressionGenes }),
    }
  })

  return hasExpressionMatch ? styledBoundaries : boundaries
}

function cellBoundariesToFillLayerGeometry(
  boundaries: readonly CellBoundaryDatum[],
): CellBoundaryGeometryBuildResult<CellBoundaryFillGeometryData> {
  let polygonCount = 0
  let vertexCount = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    polygonCount += 1
    vertexCount += boundary.polygon.length

    if (!isClosedBoundaryPolygon(boundary.polygon)) {
      vertexCount += 1
    }
  }

  const startIndices = new Uint32Array(polygonCount + 1)
  const positions = new Float32Array(vertexCount * 3)
  const cellIds: string[] = []
  const colors: Color[] = []

  let polygonIndex = 0
  let vertexIndex = 0
  let positionIndex = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    startIndices[polygonIndex] = vertexIndex
    cellIds.push(boundary.id)
    colors.push(boundary.fillColor)

    for (const point of boundary.polygon) {
      positions[positionIndex] = point[0] ?? 0
      positions[positionIndex + 1] = point[1] ?? 0
      positions[positionIndex + 2] = point[2] ?? 0
      positionIndex += 3
      vertexIndex += 1
    }

    if (!isClosedBoundaryPolygon(boundary.polygon)) {
      const firstPoint = boundary.polygon[0]!
      positions[positionIndex] = firstPoint[0] ?? 0
      positions[positionIndex + 1] = firstPoint[1] ?? 0
      positions[positionIndex + 2] = firstPoint[2] ?? 0
      positionIndex += 3
      vertexIndex += 1
    }

    polygonIndex += 1
  }

  startIndices[polygonIndex] = vertexIndex

  return {
    layerData: {
      length: polygonCount,
      startIndices,
      attributes: {
        getPolygon: { value: positions, size: 3 },
      },
    },
    cellIds,
    colors,
  }
}

function cellBoundariesToPathLayerGeometry(
  boundaries: readonly CellBoundaryDatum[],
): CellBoundaryGeometryBuildResult<CellBoundaryPathGeometryData> {
  let pathCount = 0
  let vertexCount = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    pathCount += 1
    vertexCount += boundary.polygon.length
  }

  const startIndices = new Uint32Array(pathCount + 1)
  const positions = new Float32Array(vertexCount * 3)
  const cellIds: string[] = []
  const colors: Color[] = []

  let pathIndex = 0
  let vertexIndex = 0
  let positionIndex = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    startIndices[pathIndex] = vertexIndex
    cellIds.push(boundary.id)
    colors.push(boundary.lineColor)

    for (const point of boundary.polygon) {
      positions[positionIndex] = point[0] ?? 0
      positions[positionIndex + 1] = point[1] ?? 0
      positions[positionIndex + 2] = point[2] ?? 0
      positionIndex += 3
      vertexIndex += 1
    }

    pathIndex += 1
  }

  startIndices[pathIndex] = vertexIndex

  return {
    layerData: {
      length: pathCount,
      startIndices,
      attributes: {
        getPath: { value: positions, size: 3 },
      },
    },
    cellIds,
    colors,
  }
}

function cellBoundaryFillLayerDataWithColors(
  geometry: CellBoundaryLayerGeometry,
  style: CellBoundaryLayerStyle,
  cellFillOpacity: number,
): CellBoundaryFillLayerData {
  const cache = cellBoundaryLayerDataCacheForGeometry(geometry)

  if (
    cache.fillData !== undefined &&
    cache.fillStyle === style &&
    cache.fillOpacity === cellFillOpacity
  ) {
    return cache.fillData
  }

  const colors = cellBoundaryColorBuffer(
    geometry.fillLayerData.startIndices,
    geometry.fillCellIds,
    geometry.fillColors,
    style.fillColorByCellId,
    cellFillOpacity,
    { finalAlpha: true },
  )
  const data = {
    length: geometry.fillLayerData.length,
    startIndices: geometry.fillLayerData.startIndices,
    geometryKey: geometry.fillLayerData,
    attributes: {
      ...geometry.fillLayerData.attributes,
      getFillColor: { value: colors, size: 4 },
    },
  }

  cache.fillData = data
  cache.fillStyle = style
  cache.fillOpacity = cellFillOpacity

  return data
}

function cellBoundaryPathLayerDataWithColors(
  geometry: CellBoundaryLayerGeometry,
  style: CellBoundaryLayerStyle,
  cellBoundaryOpacity: number,
): CellBoundaryPathLayerData {
  const cache = cellBoundaryLayerDataCacheForGeometry(geometry)

  if (
    cache.pathData !== undefined &&
    cache.pathStyle === style &&
    cache.pathOpacity === cellBoundaryOpacity
  ) {
    return cache.pathData
  }

  const colors = cellBoundaryColorBuffer(
    geometry.pathLayerData.startIndices,
    geometry.pathCellIds,
    geometry.pathLineColors,
    style.lineColorByCellId,
    cellBoundaryOpacity,
  )
  const data = {
    length: geometry.pathLayerData.length,
    startIndices: geometry.pathLayerData.startIndices,
    geometryKey: geometry.pathLayerData,
    attributes: {
      ...geometry.pathLayerData.attributes,
      getColor: { value: colors, size: 4 },
    },
  }

  cache.pathData = data
  cache.pathStyle = style
  cache.pathOpacity = cellBoundaryOpacity

  return data
}

function cellBoundaryLayerDataCacheForGeometry(
  geometry: CellBoundaryLayerGeometry,
): CellBoundaryLayerDataCache {
  let cache = cellBoundaryLayerDataCache.get(geometry)

  if (cache === undefined) {
    cache = {}
    cellBoundaryLayerDataCache.set(geometry, cache)
  }

  return cache
}

function cellBoundaryColorBuffer(
  startIndices: Uint32Array,
  cellIds: readonly string[],
  baseColors: readonly Color[],
  styleColorByCellId: ReadonlyMap<string, Color>,
  opacity: number,
  options: { readonly finalAlpha?: boolean } = {},
): Uint8Array {
  const vertexCount = startIndices[startIndices.length - 1] ?? 0
  const colors = new Uint8Array(vertexCount * 4)

  for (let cellIndex = 0; cellIndex < cellIds.length; cellIndex += 1) {
    const startIndex = startIndices[cellIndex] ?? 0
    const endIndex = startIndices[cellIndex + 1] ?? startIndex
    const cellId = cellIds[cellIndex] ?? ''
    const baseColor = baseColors[cellIndex] ?? [0, 0, 0, 255]
    const styleColor = styleColorByCellId.get(cellId) ?? baseColor
    const color =
      options.finalAlpha === true
        ? colorWithFillOpacity(styleColor, opacity)
        : colorWithOpacity(styleColor, opacity)

    for (let vertexIndex = startIndex; vertexIndex < endIndex; vertexIndex += 1) {
      const colorIndex = vertexIndex * 4
      colors[colorIndex] = color[0] ?? 0
      colors[colorIndex + 1] = color[1] ?? 0
      colors[colorIndex + 2] = color[2] ?? 0
      colors[colorIndex + 3] = color[3] ?? 255
    }
  }

  return colors
}

function hasSameCellBoundaryLayerGeometry(data: unknown, oldData?: unknown): boolean {
  return (
    cellBoundaryLayerGeometryKey(data) !== undefined &&
    cellBoundaryLayerGeometryKey(data) === cellBoundaryLayerGeometryKey(oldData)
  )
}

function cellBoundaryLayerGeometryKey(
  data: unknown,
): CellBoundaryPathGeometryData | CellBoundaryFillGeometryData | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined
  }

  return (data as Partial<CellBoundaryPathLayerData | CellBoundaryFillLayerData>)
    .geometryKey
}

function isClosedBoundaryPolygon(polygon: readonly Position[]): boolean {
  const firstPoint = polygon[0]
  const lastPoint = polygon.at(-1)

  if (firstPoint === undefined || lastPoint === undefined) {
    return false
  }

  return (
    (firstPoint[0] ?? 0) === (lastPoint[0] ?? 0) &&
    (firstPoint[1] ?? 0) === (lastPoint[1] ?? 0) &&
    (firstPoint[2] ?? 0) === (lastPoint[2] ?? 0)
  )
}

const ANNOTATED_SEGMENTATION_FILL_ALPHA = 82
const ANNOTATED_SEGMENTATION_LINE_ALPHA = 210

function boundaryStyleFromElementMetadata(
  element: SpatialElement,
  defaultFillColor: Color,
  defaultLineColor: Color,
  annotationPaletteByLabel: Map<string, string>,
): {
  readonly fillColor: Color
  readonly lineColor: Color
  readonly annotationLabel?: string
} {
  const annotation = element.metadata?.segmentation?.annotation

  if (annotation === undefined) {
    return { fillColor: defaultFillColor, lineColor: defaultLineColor }
  }

  const annotationLabel = annotation.label
  const paletteColor =
    annotation.color ??
    (annotationLabel === undefined
      ? undefined
      : annotationPaletteColorForLabel(annotationLabel, annotationPaletteByLabel))
  const fillColor = hexToBoundaryColor(
    annotation.fillColor ?? paletteColor,
    ANNOTATED_SEGMENTATION_FILL_ALPHA,
  )
  const lineColor = hexToBoundaryColor(
    annotation.lineColor ?? paletteColor,
    ANNOTATED_SEGMENTATION_LINE_ALPHA,
  )

  return {
    fillColor: fillColor ?? defaultFillColor,
    lineColor: lineColor ?? defaultLineColor,
    ...(annotationLabel === undefined ? {} : { annotationLabel }),
  }
}

function annotationPaletteColorForLabel(
  label: string,
  paletteByLabel: Map<string, string>,
): string {
  const existing = paletteByLabel.get(label)

  if (existing !== undefined) {
    return existing
  }

  const color = annotationPaletteColor(paletteByLabel.size)
  paletteByLabel.set(label, color)
  return color
}

function hexToBoundaryColor(hexColor: string | undefined, alpha: number): Color | null {
  if (hexColor === undefined) {
    return null
  }

  const normalized = normalizeAnnotationColor(hexColor)

  if (normalized === null) {
    return null
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    alpha,
  ]
}
