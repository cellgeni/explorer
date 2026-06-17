import type { BinaryAttribute, Color, LayersList, Position } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import {
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
} from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import type {
  TranscriptAggregateBin,
  TranscriptAggregateFeatureSummary,
  TranscriptCellAssignment,
  TranscriptPoint,
} from '../data/transcriptOverlay'
import type { GeneExpressionCell } from '../datasets/xeniumDataset'
import { gridCellCorners } from '../datasets/spatialGrid'
import type {
  GridCellBatch,
  SpatialElement,
  SpatialGrid,
} from '../datasets/spatialDataset'
import { annotationPaletteColor, normalizeAnnotationColor } from './annotationPalette'
import {
  DEFAULT_CELL_FILL_OPACITY,
  DEFAULT_LAYER_OPACITY,
  normalizeLayerOpacity,
} from './layerOpacity'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly radiusMicrometers?: number
  readonly fillColor: Color
  readonly cellCount?: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
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
  readonly annotationLabel?: string
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
}

export interface GridCellDatum {
  readonly id: string
  readonly gridId: string
  readonly row: number
  readonly col: number
  readonly binSizeMicrometers?: number
  readonly inTissue?: boolean
  readonly fullresRow?: number
  readonly fullresCol?: number
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface GridCellLayerDataOptions {
  readonly metadata?: readonly GridCellLayerBatchMetadata[]
}

export interface GridCellLayerBatchMetadata {
  readonly binSizeMicrometers?: number
  readonly inTissue?: ArrayLike<number>
  readonly fullresRows?: ArrayLike<number>
  readonly fullresCols?: ArrayLike<number>
}

export interface CellBoundaryLayerGeometryOptions {
  readonly includeFill?: boolean
}

export interface BoundaryElementsToLayerDataOptions {
  readonly fillColor?: Color
  readonly lineColor?: Color
}

interface CellBoundaryPathGeometryData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPath: BinaryAttribute
  }
}

interface CellBoundaryFillGeometryData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPolygon: BinaryAttribute
  }
}

export interface CellBoundaryLayerGeometry {
  readonly pathLayerData: CellBoundaryPathGeometryData
  readonly fillLayerData: CellBoundaryFillGeometryData
  readonly pathCellIds: readonly string[]
  readonly fillCellIds: readonly string[]
  readonly pathLineColors: readonly Color[]
  readonly fillColors: readonly Color[]
  readonly boundaryCellIds: ReadonlySet<string>
}

export interface CellBoundaryLayerStyle {
  readonly fillColorByCellId: ReadonlyMap<string, Color>
  readonly lineColorByCellId: ReadonlyMap<string, Color>
}

interface CellBoundaryPathLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly geometryKey: CellBoundaryPathGeometryData
  readonly attributes: Record<string, BinaryAttribute>
}

interface CellBoundaryFillLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly geometryKey: CellBoundaryFillGeometryData
  readonly attributes: Record<string, BinaryAttribute>
}

export interface TranscriptPointDatum {
  readonly id: string
  readonly transcriptId?: string
  readonly position: Position
  readonly featureName: string
  readonly fovName: string | null
  readonly cellId: string | null
  readonly cellAssignment?: TranscriptCellAssignment
  readonly qv: number
  readonly zLocation?: number
  readonly overlapsNucleus?: boolean
  readonly isGene?: boolean
  readonly nucleusDistance?: number
  readonly fillColor: Color
}

export interface TranscriptAggregateDatum {
  readonly id: string
  readonly position: Position
  readonly source?: 'cell-summary' | 'native-zarr'
  readonly glyphType?: 'density' | 'feature-circle'
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly count: number
  readonly radiusMicrometers: number
  readonly binSizeMicrometers?: number
  readonly binTotalCount?: number
  readonly selectedGeneCount?: number
  readonly omittedFeatureCount?: number
  readonly omittedTranscriptCount?: number
  readonly topFeatures?: readonly TranscriptAggregateFeatureSummary[]
  readonly featureName?: string
  readonly fovName?: string
  readonly fillColor: Color
}

export interface OverviewLayerOptions {
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly cellBoundaryFillEnabled?: boolean
  readonly cellBoundaryPickable?: boolean
  readonly nucleusBoundaries?: readonly CellBoundaryDatum[]
  readonly nucleusBoundaryOpacity?: number
  readonly gridCells?: readonly GridCellDatum[]
  readonly gridCellOpacity?: number
  readonly cellBoundaryGeometry?: CellBoundaryLayerGeometry
  readonly cellBoundaryStyle?: CellBoundaryLayerStyle
  readonly geneExpressionActive?: boolean
  readonly geneExpressionOverlayCells?: readonly OverviewCellDatum[]
  readonly transcriptAggregateBins?: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints?: readonly TranscriptPointDatum[]
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
}

export type GeneExpressionColorScale =
  | 'gold'
  | 'magma'
  | 'viridis'
  | 'plasma'
  | 'cividis'
  | 'teal'
  | 'rose'
  | 'glasbey'
export type GeneExpressionScoreMode = 'sum' | 'mean' | 'z-score'
export type TranscriptDensityColorScale =
  | 'thermal'
  | 'magma'
  | 'viridis'
  | 'cividis'
  | 'teal'
export type TranscriptPointColorMode = 'feature' | 'quality'

export interface GeneExpressionColorScaleOption {
  readonly id: GeneExpressionColorScale
  readonly label: string
}

export interface TranscriptDensityColorScaleOption {
  readonly id: TranscriptDensityColorScale
  readonly label: string
}

export interface TranscriptPointColorModeOption {
  readonly id: TranscriptPointColorMode
  readonly label: string
}

export interface GeneExpressionScoreModeOption {
  readonly id: GeneExpressionScoreMode
  readonly label: string
}

export interface GeneExpressionLayerDataOptions {
  readonly scaleMax?: number
}

export interface GeneExpressionCellStyleOptions {
  readonly binMicrometers?: number
  readonly styleUnmatchedCells?: boolean
}

export interface GeneExpressionCellStyleIndex {
  readonly expressionByCellId: ReadonlyMap<string, OverviewCellDatum>
  readonly expressionByBinKey?: ReadonlyMap<string, OverviewCellDatum>
  readonly binMicrometers?: number
}

export interface TranscriptAggregateLayerDataOptions {
  readonly scaleMax?: number
}

type ColorStop = readonly [number, number, number, number]

interface GeneExpressionBinStyle {
  count: number
  maxAlpha: number
  sumRed: number
  sumGreen: number
  sumBlue: number
  sumExpressionCount: number
  hasExpressionCount: boolean
  expressionGenes: readonly string[] | undefined
}

export const DEFAULT_GENE_EXPRESSION_COLOR_SCALE: GeneExpressionColorScale = 'plasma'
export const DEFAULT_GENE_EXPRESSION_SCORE_MODE: GeneExpressionScoreMode = 'sum'
export const DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE: TranscriptDensityColorScale =
  'thermal'
export const DEFAULT_TRANSCRIPT_POINT_COLOR_MODE: TranscriptPointColorMode = 'feature'

export const GENE_EXPRESSION_COLOR_SCALE_OPTIONS: readonly GeneExpressionColorScaleOption[] =
  [
    { id: 'gold', label: 'Gold' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'plasma', label: 'Plasma' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
    { id: 'rose', label: 'Rose' },
    { id: 'glasbey', label: 'Glasbey' },
  ]

export const GENE_EXPRESSION_SCORE_MODE_OPTIONS: readonly GeneExpressionScoreModeOption[] =
  [
    { id: 'sum', label: 'Sum' },
    { id: 'mean', label: 'Mean' },
    { id: 'z-score', label: 'Z-score' },
  ]

export const TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS: readonly TranscriptDensityColorScaleOption[] =
  [
    { id: 'thermal', label: 'Thermal' },
    { id: 'magma', label: 'Magma' },
    { id: 'viridis', label: 'Viridis' },
    { id: 'cividis', label: 'Cividis' },
    { id: 'teal', label: 'Teal' },
  ]

export const TRANSCRIPT_POINT_COLOR_MODE_OPTIONS: readonly TranscriptPointColorModeOption[] =
  [
    { id: 'feature', label: 'Feature' },
    { id: 'quality', label: 'QV' },
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
  plasma: [
    [13, 8, 135, 130],
    [203, 71, 119, 205],
    [240, 249, 33, 245],
  ],
  cividis: [
    [0, 32, 76, 130],
    [127, 124, 88, 205],
    [255, 233, 69, 245],
  ],
  teal: [
    [13, 59, 74, 130],
    [31, 151, 139, 205],
    [193, 230, 143, 245],
  ],
  rose: [
    [64, 18, 77, 130],
    [211, 69, 114, 205],
    [255, 188, 121, 245],
  ],
  glasbey: [
    [214, 0, 0, 130],
    [140, 59, 255, 205],
    [1, 135, 0, 245],
  ],
}

const TRANSCRIPT_DENSITY_COLOR_STOPS: Record<
  TranscriptDensityColorScale,
  readonly [ColorStop, ColorStop, ColorStop]
> = {
  thermal: [
    [29, 78, 86, 96],
    [239, 137, 80, 180],
    [255, 223, 91, 246],
  ],
  magma: [
    [0, 0, 4, 96],
    [183, 55, 121, 180],
    [252, 253, 191, 246],
  ],
  viridis: [
    [68, 1, 84, 96],
    [32, 144, 140, 180],
    [253, 231, 37, 246],
  ],
  cividis: [
    [0, 34, 78, 96],
    [125, 124, 82, 180],
    [255, 233, 69, 246],
  ],
  teal: [
    [13, 59, 74, 96],
    [37, 172, 166, 180],
    [198, 255, 221, 246],
  ],
}

const DEFAULT_OVERVIEW_VIEW_STATE: OverviewViewState = {
  target: [0, 0, 0],
  zoom: -4,
  minZoom: -10,
  maxZoom: 10,
}

const DEFAULT_OVERVIEW_CELL_FILL_RGB = [72, 68, 58] as const
const GENE_EXPRESSION_ZERO_FILL_COLOR: Color = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 84]
const GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY = 0.5
const CELL_BOUNDARY_HIT_AREA_OPACITY = 0.01
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
const EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY: CellBoundaryLayerGeometry = {
  pathLayerData: EMPTY_CELL_BOUNDARY_PATH_GEOMETRY,
  fillLayerData: EMPTY_CELL_BOUNDARY_FILL_GEOMETRY,
  pathCellIds: [],
  fillCellIds: [],
  pathLineColors: [],
  fillColors: [],
  boundaryCellIds: new Set<string>(),
}
const EMPTY_CELL_BOUNDARY_LAYER_STYLE: CellBoundaryLayerStyle = {
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
const cellBoundaryLayerDataCache = new WeakMap<
  CellBoundaryLayerGeometry,
  CellBoundaryLayerDataCache
>()

export const spatialOverviewView = new OrthographicView({
  id: 'spatial-overview',
  flipY: false,
})

export const bundledDeckVersion = deckVersion

export function createOverviewLayers(
  cells: readonly OverviewCellDatum[],
  boundaries: readonly CellBoundaryDatum[] = [],
  options: OverviewLayerOptions = {},
): LayersList {
  const cellFillOpacity = normalizeLayerOpacity(
    options.cellFillOpacity ?? DEFAULT_CELL_FILL_OPACITY,
  )
  const cellBoundaryOpacity = normalizeLayerOpacity(
    options.cellBoundaryOpacity ?? DEFAULT_LAYER_OPACITY,
  )
  const cellBoundaryFillEnabled = options.cellBoundaryFillEnabled ?? false
  const geneExpressionOverlayCells = options.geneExpressionOverlayCells ?? []
  const boundaryFillLayerEnabled =
    cellBoundaryFillEnabled ||
    options.geneExpressionActive === true ||
    geneExpressionOverlayCells.length > 0
  const cellBoundaryGeometry =
    options.cellBoundaryGeometry ??
    (boundaries.length > 0
      ? createCellBoundaryLayerGeometry(boundaries, {
          includeFill: boundaryFillLayerEnabled,
        })
      : EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY)
  const cellBoundaryStyle = options.cellBoundaryStyle ?? EMPTY_CELL_BOUNDARY_LAYER_STYLE
  const transcriptAggregateBins = options.transcriptAggregateBins ?? []
  const gridCells = options.gridCells ?? []
  const nucleusBoundaries = options.nucleusBoundaries ?? []
  const transcriptDensityBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType !== 'feature-circle',
  )
  const transcriptFeatureCircleBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType === 'feature-circle',
  )
  const transcriptPoints = options.transcriptPoints ?? []
  const visibleGeneExpressionOverlayCells =
    cellBoundaryGeometry.boundaryCellIds.size === 0
      ? geneExpressionOverlayCells
      : geneExpressionOverlayCells.filter(
          (cell) => !cellBoundaryGeometry.boundaryCellIds.has(cell.id),
        )
  const pointCells = cellsWithoutVisibleBoundaryIds(
    cells,
    cellBoundaryGeometry.boundaryCellIds,
  )
  const geneExpressionActive =
    options.geneExpressionActive ??
    (visibleGeneExpressionOverlayCells.length > 0 ||
      pointCells.some(hasGeneExpressionStyle))
  const effectiveBoundaryFillEnabled = boundaryFillLayerEnabled || geneExpressionActive
  const cellPointFillOpacity = geneExpressionActive
    ? Math.max(cellFillOpacity, GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY)
    : cellFillOpacity
  const cellPointLayer = new ScatterplotLayer<OverviewCellDatum>({
    id: 'cells-overview-scatter',
    data: pointCells,
    pickable: true,
    radiusUnits: 'common',
    radiusMinPixels: 0.12,
    radiusMaxPixels: 24,
    stroked: true,
    filled: effectiveBoundaryFillEnabled,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getFillColor: (cell) => colorWithFillOpacity(cell.fillColor, cellPointFillOpacity),
    getLineColor: (cell) =>
      colorWithOpacity(cellPointOutlineColor(cell.fillColor), cellBoundaryOpacity),
    getLineWidth: 1,
    updateTriggers: {
      getFillColor: [cellPointFillOpacity],
      getLineColor: [cellBoundaryOpacity],
    },
  })
  const layers: LayersList = []

  if (cellBoundaryGeometry.pathLayerData.length > 0) {
    if (effectiveBoundaryFillEnabled) {
      const boundaryFillData = cellBoundaryFillLayerDataWithColors(
        cellBoundaryGeometry,
        cellBoundaryStyle,
        cellFillOpacity,
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
              getFillColor: [cellFillOpacity, cellBoundaryStyle],
            },
          }),
        )
      }
    }

    const boundaryPathData = cellBoundaryPathLayerDataWithColors(
      cellBoundaryGeometry,
      cellBoundaryStyle,
      cellBoundaryOpacity,
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
          widthMinPixels: 1,
          getPath: () => [],
          getColor: [32, 102, 83, 190],
          getWidth: 1,
          updateTriggers: {
            getColor: [cellBoundaryOpacity, cellBoundaryStyle],
          },
        }),
      )
    }

    if (options.cellBoundaryPickable === true) {
      layers.push(
        new PolygonLayer<CellBoundaryDatum>({
          id: 'cell-boundary-hit-areas',
          data: boundaries,
          pickable: true,
          stroked: false,
          filled: true,
          opacity: CELL_BOUNDARY_HIT_AREA_OPACITY,
          getPolygon: (boundary) => boundary.polygon,
          getFillColor: [0, 0, 0, 1],
        }),
      )
    }
  }

  if (nucleusBoundaries.length > 0) {
    const nucleusBoundaryOpacity = normalizeLayerOpacity(
      options.nucleusBoundaryOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new PolygonLayer<CellBoundaryDatum>({
        id: 'nucleus-segmentation-polygons',
        data: nucleusBoundaries,
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
    )
  }

  layers.push(cellPointLayer)

  if (visibleGeneExpressionOverlayCells.length > 0) {
    const expressionFillOpacity = Math.max(
      cellFillOpacity,
      GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY,
    )

    layers.push(
      new ScatterplotLayer<OverviewCellDatum>({
        id: 'gene-expression-scatter',
        data: visibleGeneExpressionOverlayCells,
        pickable: false,
        radiusUnits: 'common',
        radiusMinPixels: 1.5,
        radiusMaxPixels: 28,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getPosition: (cell) => cell.position,
        getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
        getFillColor: (cell) =>
          colorWithFillOpacity(cell.fillColor, expressionFillOpacity),
        getLineColor: (cell) =>
          colorWithOpacity(cellPointOutlineColor(cell.fillColor), cellBoundaryOpacity),
        getLineWidth: 1,
        updateTriggers: {
          getFillColor: [expressionFillOpacity],
          getLineColor: [cellBoundaryOpacity],
        },
      }),
    )
  }

  if (transcriptDensityBins.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new PolygonLayer<TranscriptAggregateDatum>({
        id: 'transcript-density-bins',
        data: transcriptDensityBins,
        pickable: true,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.25,
        getPolygon: transcriptDensitySquarePolygon,
        getFillColor: (bin) => colorWithOpacity(bin.fillColor, transcriptOpacity),
        getLineColor: () => colorWithOpacity([255, 253, 247, 120], transcriptOpacity),
        getLineWidth: 0.25,
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getLineColor: [transcriptOpacity],
        },
      }),
    )
  }

  if (gridCells.length > 0) {
    const gridCellOpacity = normalizeLayerOpacity(
      options.gridCellOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new PolygonLayer<GridCellDatum>({
        id: 'spatial-grid-cells',
        data: gridCells,
        pickable: true,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.25,
        getPolygon: (cell) => cell.polygon,
        getFillColor: (cell) => colorWithOpacity(cell.fillColor, gridCellOpacity),
        getLineColor: (cell) => colorWithOpacity(cell.lineColor, gridCellOpacity),
        getLineWidth: 0.25,
        updateTriggers: {
          getFillColor: [gridCellOpacity],
          getLineColor: [gridCellOpacity],
        },
      }),
    )
  }

  if (transcriptFeatureCircleBins.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )

    layers.push(
      new ScatterplotLayer<TranscriptAggregateDatum>({
        id: 'transcript-feature-circles',
        data: transcriptFeatureCircleBins,
        pickable: true,
        radiusUnits: 'common',
        radiusMinPixels: 2,
        radiusMaxPixels: 18,
        stroked: true,
        filled: true,
        opacity: 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.75,
        getPosition: (bin) => bin.position,
        getRadius: (bin) => bin.radiusMicrometers,
        getFillColor: (bin) => colorWithOpacity(bin.fillColor, transcriptOpacity),
        getLineColor: () => colorWithOpacity([12, 12, 10, 160], transcriptOpacity),
        getLineWidth: 0.75,
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getLineColor: [transcriptOpacity],
        },
      }),
    )
  }

  if (transcriptPoints.length > 0) {
    const transcriptOpacity = normalizeLayerOpacity(
      options.transcriptOpacity ?? DEFAULT_LAYER_OPACITY,
    )
    const transcriptPointSize = Math.max(1, options.transcriptPointSize ?? 2)

    layers.push(
      new ScatterplotLayer<TranscriptPointDatum>({
        id: 'transcript-exact-points',
        data: transcriptPoints,
        pickable: true,
        radiusUnits: 'pixels',
        radiusMinPixels: 1,
        radiusMaxPixels: 8,
        stroked: false,
        filled: true,
        opacity: 1,
        getPosition: (transcript) => transcript.position,
        getRadius: transcriptPointSize,
        getFillColor: (transcript) =>
          colorWithOpacity(transcript.fillColor, transcriptOpacity),
        updateTriggers: {
          getFillColor: [transcriptOpacity],
          getRadius: [transcriptPointSize],
        },
      }),
    )
  }

  return layers
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

interface CellBoundaryGeometryBuildResult<
  LayerData extends CellBoundaryPathGeometryData | CellBoundaryFillGeometryData,
> {
  readonly layerData: LayerData
  readonly cellIds: readonly string[]
  readonly colors: readonly Color[]
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
      fillColor: [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 150 + Math.round(intensity * 90)],
      transcriptCount: cell.transcriptCount,
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
      ...(cell.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: cell.segmentationMethod }),
    }
  })
}

export function geneExpressionCellsToLayerData(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  colorScale: GeneExpressionColorScale = DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  scoreMode: GeneExpressionScoreMode = DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  const scores = scoreExpressionCells(cells, genes, scoreMode)
  const scoreDenominator = expressionScoreDenominator(scores, options.scaleMax)

  const layerData = cells.map((cell, index): OverviewCellDatum => {
    const score = scores[index] ?? 0
    const intensity = Math.sqrt(Math.max(score, 0) / scoreDenominator)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.id,
      position: [cell.position.x, -cell.position.y, 0],
      radiusPixels: 4 + intensity * 6,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: geneExpressionColor(colorScale, intensity),
      expressionCount: score,
      expressionGenes: genes,
      ...(cell.transcriptCount === undefined
        ? {}
        : { transcriptCount: cell.transcriptCount }),
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
      ...(cell.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: cell.segmentationMethod }),
    }
  })

  return styleGeneExpressionCellsByScale(layerData, colorScale, options)
}

export function transcriptPointsToLayerData(
  transcripts: readonly TranscriptPoint[],
  colorMode: TranscriptPointColorMode = DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
): readonly TranscriptPointDatum[] {
  return transcripts.map((transcript) => ({
    id: transcript.id,
    ...(transcript.transcriptId === undefined
      ? {}
      : { transcriptId: transcript.transcriptId }),
    position: [transcript.position.x, -transcript.position.y, 0],
    featureName: transcript.featureName,
    fovName: transcript.fovName,
    cellId: transcript.cellId,
    ...(transcript.cellAssignment === undefined
      ? {}
      : { cellAssignment: transcript.cellAssignment }),
    qv: transcript.qv,
    ...(transcript.zLocation === undefined ? {} : { zLocation: transcript.zLocation }),
    ...(transcript.overlapsNucleus === undefined
      ? {}
      : { overlapsNucleus: transcript.overlapsNucleus }),
    ...(transcript.isGene === undefined ? {} : { isGene: transcript.isGene }),
    ...(transcript.nucleusDistance === undefined
      ? {}
      : { nucleusDistance: transcript.nucleusDistance }),
    fillColor:
      colorMode === 'quality'
        ? transcriptQualityColor(transcript.qv)
        : transcriptFeatureColor(transcript.featureName),
  }))
}

export function transcriptAggregateBinsToLayerData(
  bins: readonly TranscriptAggregateBin[],
  colorScale: TranscriptDensityColorScale = DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  options: TranscriptAggregateLayerDataOptions = {},
): readonly TranscriptAggregateDatum[] {
  if (bins.length === 0) {
    return []
  }

  let localDensityMax = 1
  let localFeatureCircleMax = 1

  for (const bin of bins) {
    if (bin.glyphType === 'feature-circle') {
      localFeatureCircleMax = Math.max(localFeatureCircleMax, bin.count)
    } else {
      localDensityMax = Math.max(localDensityMax, bin.count)
    }
  }

  const densityScaleMax =
    options.scaleMax === undefined || options.scaleMax <= 0
      ? localDensityMax
      : options.scaleMax

  return bins.map((bin) => {
    const denominator =
      bin.glyphType === 'feature-circle' ? localFeatureCircleMax : densityScaleMax
    const intensity = Math.sqrt(Math.max(bin.count, 0) / Math.max(1, denominator))

    return {
      id: bin.id,
      position: [bin.position.x, -bin.position.y, 0],
      ...(bin.source === undefined ? {} : { source: bin.source }),
      ...(bin.glyphType === undefined ? {} : { glyphType: bin.glyphType }),
      level: bin.level,
      binX: bin.binX,
      binY: bin.binY,
      count: bin.count,
      radiusMicrometers: Math.max(4, bin.radiusMicrometers * (0.35 + intensity * 0.65)),
      ...(bin.binSizeMicrometers === undefined
        ? {}
        : { binSizeMicrometers: bin.binSizeMicrometers }),
      ...(bin.binTotalCount === undefined ? {} : { binTotalCount: bin.binTotalCount }),
      ...(bin.selectedGeneCount === undefined
        ? {}
        : { selectedGeneCount: bin.selectedGeneCount }),
      ...(bin.omittedFeatureCount === undefined
        ? {}
        : { omittedFeatureCount: bin.omittedFeatureCount }),
      ...(bin.omittedTranscriptCount === undefined
        ? {}
        : { omittedTranscriptCount: bin.omittedTranscriptCount }),
      ...(bin.topFeatures === undefined ? {} : { topFeatures: bin.topFeatures }),
      ...(bin.featureName === undefined ? {} : { featureName: bin.featureName }),
      ...(bin.fovName === undefined ? {} : { fovName: bin.fovName }),
      fillColor:
        bin.glyphType === 'feature-circle' && bin.featureName !== undefined
          ? transcriptFeatureColor(bin.featureName)
          : transcriptDensityColor(colorScale, intensity),
    }
  })
}

function transcriptDensitySquarePolygon(
  bin: TranscriptAggregateDatum,
): readonly Position[] {
  const [x = 0, y = 0, z = 0] = bin.position
  const halfSize = Math.max(1, (bin.binSizeMicrometers ?? bin.radiusMicrometers * 2) / 2)

  return [
    [x - halfSize, y + halfSize, z],
    [x + halfSize, y + halfSize, z],
    [x + halfSize, y - halfSize, z],
    [x - halfSize, y - halfSize, z],
  ]
}

export function styleGeneExpressionCellsByScale(
  cells: readonly OverviewCellDatum[],
  colorScale: GeneExpressionColorScale,
  options: GeneExpressionLayerDataOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const scoreDenominator = expressionScoreDenominator(
    cells.map((cell) => cell.expressionCount ?? 0),
    options.scaleMax,
  )

  return cells.map((cell) => {
    const intensity = Math.sqrt(Math.max(cell.expressionCount ?? 0, 0) / scoreDenominator)

    return {
      ...cell,
      fillColor: geneExpressionColor(colorScale, intensity),
    }
  })
}

export function geneExpressionScoreDomainMax(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
): number {
  return maxExpressionScore(scoreExpressionCells(cells, genes, scoreMode))
}

export function isGeneExpressionColorScale(
  value: string,
): value is GeneExpressionColorScale {
  return GENE_EXPRESSION_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isGeneExpressionScoreMode(
  value: string,
): value is GeneExpressionScoreMode {
  return GENE_EXPRESSION_SCORE_MODE_OPTIONS.some((option) => option.id === value)
}

export function isTranscriptDensityColorScale(
  value: string,
): value is TranscriptDensityColorScale {
  return TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.some((option) => option.id === value)
}

export function isTranscriptPointColorMode(
  value: string,
): value is TranscriptPointColorMode {
  return TRANSCRIPT_POINT_COLOR_MODE_OPTIONS.some((option) => option.id === value)
}

function scoreExpressionCells(
  cells: readonly GeneExpressionCell[],
  genes: readonly string[],
  scoreMode: GeneExpressionScoreMode,
): readonly number[] {
  const geneCount = Math.max(genes.length, 1)

  if (scoreMode === 'sum') {
    return cells.map((cell) => cell.count)
  }

  const meanScores = cells.map((cell) => cell.count / geneCount)

  if (scoreMode === 'mean') {
    return meanScores
  }

  let total = 0

  for (const score of meanScores) {
    total += score
  }

  const mean = total / meanScores.length
  let squaredDistanceTotal = 0

  for (const score of meanScores) {
    squaredDistanceTotal += (score - mean) ** 2
  }

  const standardDeviation = Math.sqrt(squaredDistanceTotal / meanScores.length)

  if (standardDeviation === 0) {
    return meanScores.map(() => 0)
  }

  return meanScores.map((score) => (score - mean) / standardDeviation)
}

function expressionScoreDenominator(
  scores: readonly number[],
  scaleMax: number | undefined,
): number {
  const maxScore =
    scaleMax === undefined || scaleMax <= 0 ? maxExpressionScore(scores) : scaleMax

  return maxScore > 0 ? maxScore : 1
}

function maxExpressionScore(scores: readonly number[]): number {
  let maxScore = 0

  for (const score of scores) {
    maxScore = Math.max(maxScore, score)
  }

  return maxScore
}

function geneExpressionColor(
  colorScale: GeneExpressionColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = GENE_EXPRESSION_COLOR_STOPS[colorScale]
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

function transcriptDensityColor(
  colorScale: TranscriptDensityColorScale,
  intensity: number,
): Color {
  const [lowStop, middleStop, highStop] = TRANSCRIPT_DENSITY_COLOR_STOPS[colorScale]
  return interpolateColorStops(lowStop, middleStop, highStop, intensity)
}

function interpolateColorStops(
  lowStop: ColorStop,
  middleStop: ColorStop,
  highStop: ColorStop,
  intensity: number,
): Color {
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
  options: BoundaryElementsToLayerDataOptions = {},
): readonly CellBoundaryDatum[] {
  const cells: CellBoundaryDatum[] = []
  const defaultFillColor = options.fillColor ?? [32, 102, 83, 34]
  const defaultLineColor = options.lineColor ?? [32, 102, 83, 190]
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

export function gridCellBatchesToLayerData(
  grids: readonly SpatialGrid[],
  batches: readonly GridCellBatch[],
  options: GridCellLayerDataOptions = {},
): readonly GridCellDatum[] {
  if (grids.length === 0 || batches.length === 0) {
    return []
  }

  const gridById = new Map(grids.map((grid) => [grid.id, grid]))
  const cells: GridCellDatum[] = []

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]

    if (batch === undefined) {
      continue
    }

    const grid = gridById.get(batch.gridId)
    const metadata = options.metadata?.[batchIndex]

    if (grid === undefined) {
      continue
    }

    for (let index = 0; index < batch.rows.length; index += 1) {
      const id = batch.ids[index]

      if (id === undefined) {
        continue
      }

      const row = batch.rows[index] ?? 0
      const col = batch.cols[index] ?? 0

      cells.push({
        id,
        gridId: grid.id,
        row,
        col,
        ...(metadata?.binSizeMicrometers === undefined
          ? {}
          : { binSizeMicrometers: metadata.binSizeMicrometers }),
        ...(metadata?.inTissue?.[index] === undefined
          ? {}
          : { inTissue: metadata.inTissue[index] === 1 }),
        ...(metadata?.fullresRows?.[index] === undefined
          ? {}
          : { fullresRow: metadata.fullresRows[index] }),
        ...(metadata?.fullresCols?.[index] === undefined
          ? {}
          : { fullresCol: metadata.fullresCols[index] }),
        polygon: gridCellCorners(grid, row, col).map((point) => [point.x, -point.y, 0]),
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
      })
    }
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

export function styleCellsByGeneExpression(
  cells: readonly OverviewCellDatum[],
  expressionSource: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
  options: GeneExpressionCellStyleOptions = {},
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const styleIndex = isOverviewCellDatumArray(expressionSource)
    ? createGeneExpressionCellStyleIndex(expressionSource, options)
    : expressionSource
  const styleUnmatchedCells = options.styleUnmatchedCells ?? false

  if (
    styleIndex.expressionByCellId.size === 0 &&
    (styleIndex.expressionByBinKey?.size ?? 0) === 0 &&
    !styleUnmatchedCells
  ) {
    return cells
  }

  let hasExpressionStyle = false
  const styledCells = cells.map((cell) => {
    const expressionCell =
      styleIndex.expressionByCellId.get(cell.id) ??
      (styleIndex.expressionByBinKey === undefined ||
      styleIndex.binMicrometers === undefined
        ? undefined
        : styleIndex.expressionByBinKey.get(
            positionBinKey(cell.position, styleIndex.binMicrometers),
          ))

    if (expressionCell === undefined) {
      if (!styleUnmatchedCells) {
        return cell
      }

      hasExpressionStyle = true

      return {
        ...cell,
        fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
        expressionCount: 0,
      }
    }

    hasExpressionStyle = true
    return {
      ...cell,
      fillColor: expressionCell.fillColor,
      ...(expressionCell.expressionCount === undefined
        ? {}
        : { expressionCount: expressionCell.expressionCount }),
      ...(expressionCell.expressionGenes === undefined
        ? {}
        : { expressionGenes: expressionCell.expressionGenes }),
    }
  })

  return hasExpressionStyle ? styledCells : cells
}

export function styleGridCellsByGeneExpression(
  cells: readonly GridCellDatum[],
  expressionSource: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
  options: GeneExpressionCellStyleOptions = {},
): readonly GridCellDatum[] {
  if (cells.length === 0) {
    return cells
  }

  const styleIndex = isOverviewCellDatumArray(expressionSource)
    ? createGeneExpressionCellStyleIndex(expressionSource, options)
    : expressionSource
  const styleUnmatchedCells = options.styleUnmatchedCells ?? false

  if (styleIndex.expressionByCellId.size === 0 && !styleUnmatchedCells) {
    return cells
  }

  let hasExpressionStyle = false
  const styledCells = cells.map((cell) => {
    const expressionCell = styleIndex.expressionByCellId.get(cell.id)

    if (expressionCell === undefined) {
      if (!styleUnmatchedCells) {
        return cell
      }

      hasExpressionStyle = true

      return {
        ...cell,
        fillColor: GENE_EXPRESSION_ZERO_FILL_COLOR,
        lineColor: boundaryLineColor(GENE_EXPRESSION_ZERO_FILL_COLOR),
        expressionCount: 0,
      }
    }

    hasExpressionStyle = true
    return {
      ...cell,
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

  return hasExpressionStyle ? styledCells : cells
}

function hasGeneExpressionStyle(cell: OverviewCellDatum): boolean {
  return cell.expressionCount !== undefined || cell.expressionGenes !== undefined
}

export function createGeneExpressionCellStyleIndex(
  expressionCells: readonly OverviewCellDatum[],
  options: GeneExpressionCellStyleOptions = {},
): GeneExpressionCellStyleIndex {
  const expressionByCellId = new Map<string, OverviewCellDatum>()
  const binMicrometers = normalizeGeneExpressionBinMicrometers(options.binMicrometers)

  for (const cell of expressionCells) {
    expressionByCellId.set(cell.id, cell)
  }

  if (binMicrometers === undefined) {
    return { expressionByCellId }
  }

  return {
    expressionByCellId,
    expressionByBinKey: expressionBinStylesByKey(expressionCells, binMicrometers),
    binMicrometers,
  }
}

function isOverviewCellDatumArray(
  value: readonly OverviewCellDatum[] | GeneExpressionCellStyleIndex,
): value is readonly OverviewCellDatum[] {
  return Array.isArray(value)
}

function expressionBinStylesByKey(
  expressionCells: readonly OverviewCellDatum[],
  binMicrometers: number,
): ReadonlyMap<string, OverviewCellDatum> {
  const bins = new Map<string, GeneExpressionBinStyle>()

  for (const cell of expressionCells) {
    const key = positionBinKey(cell.position, binMicrometers)
    const bin = bins.get(key)
    const alpha = cell.fillColor[3] ?? 220
    const red = cell.fillColor[0] ?? 0
    const green = cell.fillColor[1] ?? 0
    const blue = cell.fillColor[2] ?? 0
    const expressionCount = cell.expressionCount ?? 0

    if (bin === undefined) {
      bins.set(key, {
        count: 1,
        maxAlpha: alpha,
        sumRed: red,
        sumGreen: green,
        sumBlue: blue,
        sumExpressionCount: expressionCount,
        hasExpressionCount: cell.expressionCount !== undefined,
        expressionGenes: cell.expressionGenes,
      })
      continue
    }

    bin.count += 1
    bin.maxAlpha = Math.max(bin.maxAlpha, alpha)
    bin.sumRed += red
    bin.sumGreen += green
    bin.sumBlue += blue
    bin.sumExpressionCount += expressionCount
    bin.hasExpressionCount = bin.hasExpressionCount || cell.expressionCount !== undefined
    bin.expressionGenes ??= cell.expressionGenes
  }

  const styles = new Map<string, OverviewCellDatum>()

  for (const [key, bin] of bins) {
    styles.set(key, {
      id: `expression-style-bin:${key}`,
      position: [0, 0, 0],
      radiusPixels: 0,
      fillColor: [
        Math.round(bin.sumRed / bin.count),
        Math.round(bin.sumGreen / bin.count),
        Math.round(bin.sumBlue / bin.count),
        Math.min(245, bin.maxAlpha + bin.count * 2),
      ],
      ...(bin.hasExpressionCount ? { expressionCount: bin.sumExpressionCount } : {}),
      ...(bin.expressionGenes === undefined
        ? {}
        : { expressionGenes: bin.expressionGenes }),
    })
  }

  return styles
}

function positionBinKey(position: Position, binMicrometers: number): string {
  const [x = 0, deckY = 0] = position
  const rawY = -deckY

  return `${Math.floor(x / binMicrometers)}:${Math.floor(rawY / binMicrometers)}`
}

function normalizeGeneExpressionBinMicrometers(
  binMicrometers: number | undefined,
): number | undefined {
  if (binMicrometers === undefined || !Number.isFinite(binMicrometers)) {
    return undefined
  }

  return binMicrometers > 0 ? binMicrometers : undefined
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
    }
  })

  return hasExpressionMatch ? styledBoundaries : boundaries
}

function boundaryFillColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(88, Math.max(28, color[3] ?? 64)),
  ]
}

function boundaryLineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(235, Math.max(160, color[3] ?? 210)),
  ]
}

function cellPointOutlineColor(color: Color): Color {
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.min(245, Math.max(160, color[3] ?? 210)),
  ]
}

function transcriptFeatureColor(featureName: string): Color {
  const palette: readonly Color[] = [
    [76, 211, 194, 235],
    [248, 197, 80, 235],
    [231, 97, 126, 235],
    [147, 197, 253, 235],
    [167, 139, 250, 235],
    [132, 204, 22, 235],
    [251, 146, 60, 235],
    [244, 114, 182, 235],
  ]
  let hash = 0

  for (let index = 0; index < featureName.length; index += 1) {
    hash = (hash * 31 + featureName.charCodeAt(index)) >>> 0
  }

  return palette[hash % palette.length] ?? [76, 211, 194, 235]
}

function transcriptQualityColor(qv: number): Color {
  const t = Math.max(0, Math.min(1, qv / 40))
  return interpolateColorStops(
    [127, 77, 35, 170],
    [221, 127, 75, 215],
    [58, 176, 145, 245],
    Math.sqrt(t),
  )
}

function colorWithOpacity(color: Color, opacity: number): Color {
  const normalizedOpacity = normalizeLayerOpacity(opacity)

  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round((color[3] ?? 255) * normalizedOpacity),
  ]
}

function colorWithFillOpacity(color: Color, opacity: number): Color {
  const normalizedOpacity = normalizeLayerOpacity(opacity)

  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round(255 * normalizedOpacity),
  ]
}

function cellsWithoutVisibleBoundaryIds(
  cells: readonly OverviewCellDatum[],
  boundaryCellIds: ReadonlySet<string>,
): readonly OverviewCellDatum[] {
  if (cells.length === 0 || boundaryCellIds.size === 0) {
    return cells
  }

  return cells.filter((cell) => !boundaryCellIds.has(cell.id))
}

export function createOverviewViewState(
  cells: readonly OverviewCellDatum[],
  gridCells: readonly GridCellDatum[] = [],
): OverviewViewState {
  if (cells.length === 0 && gridCells.length === 0) {
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

  for (const cell of gridCells) {
    for (const [x = 0, y = 0] of cell.polygon) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  const span = Math.max(maxX - minX, maxY - minY, 1)
  const zoom = Math.max(-10, Math.min(4, Math.log2(720 / span)))

  return {
    ...DEFAULT_OVERVIEW_VIEW_STATE,
    target: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
    zoom,
  }
}
