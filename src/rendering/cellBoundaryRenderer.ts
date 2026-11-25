import type {
  Color,
  GetPickingInfoParams,
  LayersList,
  PickingInfo,
  Position,
} from '@deck.gl/core'
import { PathLayer, PolygonLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { earcut } from '@math.gl/polygon'
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
  boundaries: [],
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
  fillIndices?: CellBoundaryFillIndices
  hitAreaData?: CellBoundaryFillLayerData
  pathData?: CellBoundaryPathLayerData
  pathOpacity?: number
  pathStyle?: CellBoundaryLayerStyle
}

interface CellBoundaryLayerOptions {
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
          // The rings are closed and their triangles given (fillIndices).
          _normalize: false,
          opacity: 1,
          getPolygon: () => [],
          getFillColor: DEFAULT_CELL_BOUNDARY_FILL_COLOR,
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
        // deck.gl draws binary paths open even with 'loop', so the geometry
        // repeats each ring's first vertex to draw the closing edge.
        _pathType: 'open',
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
      new CellBoundaryHitAreaLayer({
        id: 'cell-boundary-hit-areas',
        data: cellBoundaryHitAreaLayerData(options.geometry),
        dataComparator: hasSameCellBoundaryLayerGeometry,
        cells: options.geometry.boundaries,
        pickable: true,
        filled: true,
        extruded: false,
        _normalize: false,
        opacity: CELL_BOUNDARY_HIT_AREA_OPACITY,
        getPolygon: () => [],
        getFillColor: [0, 0, 0, 1],
      }),
    )
  }

  return layers
}

// The outlines a pointer can hover or click, drawn from the fills' rings and
// triangles. The data is packed, so a pick is matched to its outline by index.
class CellBoundaryHitAreaLayer extends SolidPolygonLayer<
  unknown,
  { readonly cells: readonly CellBoundaryDatum[] }
> {
  static override layerName = 'CellBoundaryHitAreaLayer'
  // deck.gl merges these with the SolidPolygonLayer defaults.
  static override defaultProps = {
    cells: { type: 'object', value: [], compare: false },
  } as unknown as typeof SolidPolygonLayer.defaultProps

  override getPickingInfo(params: GetPickingInfoParams): PickingInfo {
    const info = super.getPickingInfo(params)

    if (info.index >= 0) {
      info.object = this.props.cells[info.index]
    }

    return info
  }
}

export const NUCLEUS_BOUNDARY_LAYER_ID = 'nucleus-segmentation-polygons'

// Nuclei can be hovered and picked; a click selects the nucleus's cell.
// Outlines are as wide as cell outlines; their colour tells them apart.
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
      id: NUCLEUS_BOUNDARY_LAYER_ID,
      data: boundaries,
      pickable: true,
      stroked: true,
      filled: true,
      opacity: 1,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: CELL_BOUNDARY_LINE_WIDTH_PIXELS,
      getPolygon: (boundary) => boundary.polygon,
      getFillColor: (boundary) =>
        colorWithOpacity(boundary.fillColor, nucleusBoundaryOpacity),
      getLineColor: (boundary) =>
        colorWithOpacity(boundary.lineColor, nucleusBoundaryOpacity),
      getLineWidth: CELL_BOUNDARY_LINE_WIDTH_PIXELS,
      updateTriggers: {
        getFillColor: [nucleusBoundaryOpacity],
        getLineColor: [nucleusBoundaryOpacity],
      },
    }),
  ]
}

// The paths, fills and hit areas share one set of rings, built when the
// outlines change; colours and the fill being on or off rebuild none of it
// (optimization pass, O4).
export function createCellBoundaryLayerGeometry(
  boundaries: readonly CellBoundaryDatum[],
): CellBoundaryLayerGeometry {
  if (boundaries.length === 0) {
    return EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY
  }

  const rings = closedBoundaryRings(boundaries)

  if (rings.boundaries.length === 0) {
    return EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY
  }

  const positions = { value: rings.positions, size: 3 }

  return {
    pathLayerData: {
      length: rings.boundaries.length,
      startIndices: rings.startIndices,
      attributes: { getPath: positions },
    },
    fillLayerData: {
      length: rings.boundaries.length,
      startIndices: rings.startIndices,
      attributes: { getPolygon: positions },
    },
    boundaries: rings.boundaries,
    boundaryCellIds: new Set(rings.boundaries.map((boundary) => boundary.id)),
  }
}

export interface CellBoundaryStyleSource {
  // The colour of an outlined cell's point (its observation colour, then gene
  // expression), which fills the outline. Left out, outlines keep their own.
  readonly cellColor?: (cellId: string) => Color | undefined
  // Gene expression by element ID: an outline with a matching ID takes its
  // colour, fill on or off.
  readonly expressionByElementId?: ReadonlyMap<string, OverviewCellDatum>
}

// Colours by outline, read by ID for the outlines drawn, so they cost the
// same however many cells express a gene or which part of the slide is in
// view.
export function createCellBoundaryLayerStyle(
  geometry: CellBoundaryLayerGeometry,
  source: CellBoundaryStyleSource,
): CellBoundaryLayerStyle {
  const { cellColor, expressionByElementId } = source

  if (
    geometry.boundaryCellIds.size === 0 ||
    (cellColor === undefined && (expressionByElementId?.size ?? 0) === 0)
  ) {
    return EMPTY_CELL_BOUNDARY_LAYER_STYLE
  }

  const fillColorByCellId = new Map<string, Color>()
  const lineColorByCellId = new Map<string, Color>()

  for (const cellId of geometry.boundaryCellIds) {
    const expressionElement = expressionByElementId?.get(cellId)

    if (expressionElement !== undefined) {
      fillColorByCellId.set(cellId, expressionElement.fillColor)
      lineColorByCellId.set(cellId, boundaryLineColor(expressionElement.fillColor))
      continue
    }

    const color = cellColor?.(cellId)

    if (color !== undefined) {
      fillColorByCellId.set(cellId, boundaryFillColor(color))
      lineColorByCellId.set(cellId, boundaryLineColor(color))
    }
  }

  if (fillColorByCellId.size === 0) {
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
    )

    const cellId = element.metadata?.segmentation?.cellId

    cells.push({
      id: element.id,
      ...(cellId === undefined ? {} : { cellId }),
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
  expressionElements: readonly OverviewCellDatum[],
): readonly CellBoundaryDatum[] {
  if (boundaries.length === 0 || expressionElements.length === 0) {
    return boundaries
  }

  const expressionByElementId = new Map<string, OverviewCellDatum>()

  for (const cell of expressionElements) {
    expressionByElementId.set(cell.id, cell)
  }

  let hasExpressionMatch = false
  const styledBoundaries = boundaries.map((boundary) => {
    const styledBoundary = styleCellBoundaryByGeneExpression(
      boundary,
      expressionByElementId,
    )

    hasExpressionMatch ||= styledBoundary !== boundary
    return styledBoundary
  })

  return hasExpressionMatch ? styledBoundaries : boundaries
}

// One outline as styleCellBoundariesByGeneExpression styles it, for the
// outline a card shows rather than every outline drawn.
export function styleCellBoundaryByGeneExpression(
  boundary: CellBoundaryDatum,
  expressionByElementId: ReadonlyMap<string, OverviewCellDatum>,
): CellBoundaryDatum {
  const expressionElement = expressionByElementId.get(boundary.id)

  if (expressionElement === undefined) {
    return boundary
  }

  return {
    ...boundary,
    fillColor: expressionElement.fillColor,
    lineColor: boundaryLineColor(expressionElement.fillColor),
    ...(expressionElement.expressionCount === undefined
      ? {}
      : { expressionCount: expressionElement.expressionCount }),
    ...(expressionElement.expressionGenes === undefined
      ? {}
      : { expressionGenes: expressionElement.expressionGenes }),
  }
}

interface ClosedBoundaryRings {
  readonly startIndices: Uint32Array
  readonly positions: Float32Array
  readonly boundaries: readonly CellBoundaryDatum[]
}

// Packs boundaries with 3+ vertices into one position buffer. A ring that
// does not end on its first vertex (Atera cells, imported segmentations) gets
// it repeated, so fills and outlines both draw the closing edge.
function closedBoundaryRings(
  boundaries: readonly CellBoundaryDatum[],
): ClosedBoundaryRings {
  let ringCount = 0
  let vertexCount = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    ringCount += 1
    vertexCount += boundary.polygon.length

    if (!isClosedBoundaryPolygon(boundary.polygon)) {
      vertexCount += 1
    }
  }

  const startIndices = new Uint32Array(ringCount + 1)
  const positions = new Float32Array(vertexCount * 3)
  // The input itself when every boundary makes a ring, as is usual.
  const ringBoundaries: CellBoundaryDatum[] | null =
    ringCount === boundaries.length ? null : []

  let ringIndex = 0
  let vertexIndex = 0
  let positionIndex = 0

  for (const boundary of boundaries) {
    if (boundary.polygon.length < 3) {
      continue
    }

    startIndices[ringIndex] = vertexIndex

    ringBoundaries?.push(boundary)

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

    ringIndex += 1
  }

  startIndices[ringIndex] = vertexIndex

  return { startIndices, positions, boundaries: ringBoundaries ?? boundaries }
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
    geometry,
    (boundary) => boundary.fillColor,
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
      indices: cellBoundaryFillIndices(geometry),
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
    geometry,
    (boundary) => boundary.lineColor,
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

function cellBoundaryHitAreaLayerData(
  geometry: CellBoundaryLayerGeometry,
): CellBoundaryFillLayerData {
  const cache = cellBoundaryLayerDataCacheForGeometry(geometry)

  if (cache.hitAreaData === undefined) {
    cache.hitAreaData = {
      length: geometry.fillLayerData.length,
      startIndices: geometry.fillLayerData.startIndices,
      geometryKey: geometry.fillLayerData,
      attributes: {
        ...geometry.fillLayerData.attributes,
        indices: cellBoundaryFillIndices(geometry),
      },
    }
  }

  return cache.hitAreaData
}

// deck.gl takes `attributes.indices` as the triangles of binary polygons
// drawn with `_normalize: false`; one descriptor per array, so it is uploaded
// once.
interface CellBoundaryFillIndices {
  readonly value: Uint32Array
  readonly size: 1
}

// The fills' triangles, cut once per set of outlines and shared by the fill
// and hit area layers, which would otherwise each cut their own whenever they
// are created (deck.gl's own earcut call, on the same closed rings).
function cellBoundaryFillIndices(
  geometry: CellBoundaryLayerGeometry,
): CellBoundaryFillIndices {
  const cache = cellBoundaryLayerDataCacheForGeometry(geometry)

  if (cache.fillIndices !== undefined) {
    return cache.fillIndices
  }

  const { startIndices } = geometry.fillLayerData
  const positions = geometry.fillLayerData.attributes.getPolygon.value as Float32Array
  const ringTriangles: number[][] = []
  let indexCount = 0

  for (let ring = 0; ring < geometry.fillLayerData.length; ring += 1) {
    const triangles = earcut(
      positions.subarray(startIndices[ring]! * 3, startIndices[ring + 1]! * 3),
      undefined,
      3,
    )

    ringTriangles.push(triangles)
    indexCount += triangles.length
  }

  const indices = new Uint32Array(indexCount)
  let offset = 0

  ringTriangles.forEach((triangles, ring) => {
    const start = startIndices[ring]!

    for (const index of triangles) {
      indices[offset] = start + index
      offset += 1
    }
  })

  cache.fillIndices = { value: indices, size: 1 }
  return cache.fillIndices
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
  geometry: CellBoundaryLayerGeometry,
  baseColorOf: (boundary: CellBoundaryDatum) => Color,
  styleColorByCellId: ReadonlyMap<string, Color>,
  opacity: number,
  options: { readonly finalAlpha?: boolean } = {},
): Uint8Array {
  const { startIndices } = geometry.pathLayerData
  const vertexCount = startIndices[startIndices.length - 1] ?? 0
  const colors = new Uint8Array(vertexCount * 4)

  for (let cellIndex = 0; cellIndex < geometry.boundaries.length; cellIndex += 1) {
    const startIndex = startIndices[cellIndex] ?? 0
    const endIndex = startIndices[cellIndex + 1] ?? startIndex
    const boundary = geometry.boundaries[cellIndex]!
    const styleColor = styleColorByCellId.get(boundary.id) ?? baseColorOf(boundary)
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
    (annotationLabel === undefined ? undefined : labelHashColor(annotationLabel))
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

// A label's palette colour from a hash of the label (FNV-1a), the same in
// every view whatever other labels it shows (EXP-048). Readers that know a
// file's labels, such as Visium HD segmentations, give each its own colour.
function labelHashColor(label: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 0x01000193)
  }

  return annotationPaletteColor(hash >>> 0)
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
