import type { LayersList } from '@deck.gl/core'
import { OrthographicView, VERSION as deckVersion } from '@deck.gl/core'
import {
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayers,
  createNucleusBoundaryLayers,
  EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY,
  EMPTY_CELL_BOUNDARY_LAYER_STYLE,
} from './cellBoundaryRenderer'
import {
  cellsWithoutVisibleBoundaryIds,
  createCellPointLayer,
  createGeneExpressionScatterLayer,
  geneExpressionRadiusMaxPixels,
  hasGeneExpressionStyle,
  overviewCellRadiusMaxPixels,
} from './cellPointRenderer'
import { cellPointLayerColors, type CellPointLayerColors } from './cellPointStyle'
import { GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY } from './deckLayerColors'
import type {
  CellBoundaryDatum,
  OverviewCellDatum,
  OverviewLayerOptions,
  TranscriptAggregateDatum,
} from './deckLayerTypes'
import { createGridCellLayer } from './gridCellRenderer'
import {
  createTranscriptDensityLayer,
  createTranscriptFeatureCircleLayer,
  createTranscriptPointLayer,
} from './transcriptRenderer'
import { createGeometricAnnotationLayers } from './geometricAnnotationRenderer'
import {
  DEFAULT_CELL_FILL_OPACITY,
  DEFAULT_LAYER_OPACITY,
  normalizeLayerOpacity,
} from './layerOpacity'

export type {
  BoundaryElementsToLayerDataOptions,
  CellBoundaryDatum,
  CellBoundaryLayerGeometry,
  CellBoundaryLayerGeometryOptions,
  CellBoundaryLayerStyle,
  GeneExpressionElementStyleIndex,
  GeneExpressionElementStyleOptions,
  GeneExpressionColorScale,
  GeneExpressionColorScaleOption,
  GeneExpressionLayerDataOptions,
  GeneExpressionScoreMode,
  GeneExpressionScoreModeOption,
  GeometricAnnotationDatum,
  GridCellDatum,
  GridCellLayerBatchMetadata,
  GridCellLayerDataOptions,
  OverviewCellDatum,
  OverviewLayerOptions,
  OverviewViewState,
  TranscriptAggregateDatum,
  TranscriptAggregateLayerDataOptions,
  TranscriptDensityColorScale,
  TranscriptDensityColorScaleOption,
  TranscriptPointColorMode,
  TranscriptPointColorModeOption,
  TranscriptPointDatum,
} from './deckLayerTypes'
export {
  boundaryElementsToLayerData,
  createCellBoundaryLayerGeometry,
  createCellBoundaryLayerStyle,
  styleCellBoundariesByCells,
  styleCellBoundariesByGeneExpression,
} from './cellBoundaryRenderer'
export { overviewCellsToLayerData } from './cellPointRenderer'
export {
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  GENE_EXPRESSION_SCORE_MODE_OPTIONS,
  geneExpressionScaleGradient,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_POINT_COLOR_MODE_OPTIONS,
  transcriptDensityScaleGradient,
} from './deckLayerColors'
export {
  createGeneExpressionElementStyleIndex,
  expressingElementsByScore,
  geneExpressionElementsToLayerData,
  geneExpressionScoreDomainMax,
  styleCellsByGeneExpression,
  styleGeneExpressionElementsByScale,
  styleGridCellsByGeneExpression,
} from './geneExpressionRenderer'
export { gridCellBatchesToLayerData } from './gridCellRenderer'
export { createOverviewViewState } from './overviewViewState'
export {
  transcriptAggregateBinsToLayerData,
  transcriptPointsToLayerData,
} from './transcriptRenderer'
export { geometricAnnotationsToLayerData } from './geometricAnnotationRenderer'

export const spatialOverviewView = new OrthographicView({
  id: 'spatial-overview',
  flipY: false,
})

export const bundledDeckVersion = deckVersion

// Layers are rebuilt on every view change, so derived arrays are cached by
// their inputs to keep layer data identical between frames.
const transcriptBinSplits = new WeakMap<
  readonly TranscriptAggregateDatum[],
  {
    readonly density: readonly TranscriptAggregateDatum[]
    readonly featureCircles: readonly TranscriptAggregateDatum[]
  }
>()
const cellsWithoutBoundariesCache = new WeakMap<
  readonly OverviewCellDatum[],
  { readonly ids: ReadonlySet<string>; readonly cells: readonly OverviewCellDatum[] }
>()
const cellPointLayerColorsCache = new WeakMap<
  Uint8Array,
  {
    readonly fillOpacity: number
    readonly lineOpacity: number
    readonly colors: CellPointLayerColors
  }
>()

function splitTranscriptAggregateBins(bins: readonly TranscriptAggregateDatum[]): {
  readonly density: readonly TranscriptAggregateDatum[]
  readonly featureCircles: readonly TranscriptAggregateDatum[]
} {
  const cached = transcriptBinSplits.get(bins)

  if (cached !== undefined) {
    return cached
  }

  const split = {
    density: bins.filter((bin) => bin.glyphType !== 'feature-circle'),
    featureCircles: bins.filter((bin) => bin.glyphType === 'feature-circle'),
  }
  transcriptBinSplits.set(bins, split)
  return split
}

function cellsWithoutBoundaries(
  cells: readonly OverviewCellDatum[],
  boundaryCellIds: ReadonlySet<string>,
): readonly OverviewCellDatum[] {
  if (boundaryCellIds.size === 0) {
    return cells
  }

  const cached = cellsWithoutBoundariesCache.get(cells)

  if (cached?.ids === boundaryCellIds) {
    return cached.cells
  }

  const filtered = cellsWithoutVisibleBoundaryIds(cells, boundaryCellIds)
  cellsWithoutBoundariesCache.set(cells, { ids: boundaryCellIds, cells: filtered })
  return filtered
}

function cachedCellPointLayerColors(
  colors: Uint8Array,
  fillOpacity: number,
  lineOpacity: number,
): CellPointLayerColors {
  const cached = cellPointLayerColorsCache.get(colors)

  if (cached?.fillOpacity === fillOpacity && cached.lineOpacity === lineOpacity) {
    return cached.colors
  }

  const layerColors = cellPointLayerColors(colors, fillOpacity, lineOpacity)
  cellPointLayerColorsCache.set(colors, { fillOpacity, lineOpacity, colors: layerColors })
  return layerColors
}

// deck.gl's own default: no cap.
const UNCAPPED_RADIUS_PIXELS = Number.MAX_SAFE_INTEGER

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
  const geneExpressionOverlayElements = options.geneExpressionOverlayElements ?? []
  const boundaryFillLayerEnabled =
    cellBoundaryFillEnabled ||
    options.geneExpressionActive === true ||
    geneExpressionOverlayElements.length > 0
  const cellBoundaryGeometry =
    options.cellBoundaryGeometry ??
    (boundaries.length > 0
      ? createCellBoundaryLayerGeometry(boundaries, {
          includeFill: boundaryFillLayerEnabled,
        })
      : EMPTY_CELL_BOUNDARY_LAYER_GEOMETRY)
  const cellBoundaryStyle = options.cellBoundaryStyle ?? EMPTY_CELL_BOUNDARY_LAYER_STYLE
  const transcriptAggregateBins = options.transcriptAggregateBins ?? []
  const geometricAnnotations = options.geometricAnnotations ?? []
  const gridCells = options.gridCells ?? []
  const gridCellOpacity =
    options.gridCellOpacity === undefined
      ? undefined
      : normalizeLayerOpacity(options.gridCellOpacity)
  const nucleusBoundaries = options.nucleusBoundaries ?? []
  const { density: transcriptDensityBins, featureCircles: transcriptFeatureCircleBins } =
    splitTranscriptAggregateBins(transcriptAggregateBins)
  const transcriptPoints = options.transcriptPoints ?? []
  const visibleGeneExpressionOverlayCells = cellsWithoutBoundaries(
    geneExpressionOverlayElements,
    cellBoundaryGeometry.boundaryCellIds,
  )
  const cellPointPacking = options.cellPointPacking
  // Packed points hide outlined cells on the GPU instead.
  const pointCells =
    cellPointPacking === undefined
      ? cellsWithoutBoundaries(cells, cellBoundaryGeometry.boundaryCellIds)
      : cells
  const geneExpressionActive =
    options.geneExpressionActive ??
    (visibleGeneExpressionOverlayCells.length > 0 ||
      pointCells.some(hasGeneExpressionStyle))
  const pointSizeFullViewScale = options.pointSizeFullViewScale ?? 1
  const effectiveBoundaryFillEnabled = boundaryFillLayerEnabled || geneExpressionActive
  const cellPointFillOpacity = geneExpressionActive
    ? Math.max(cellFillOpacity, GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY)
    : cellFillOpacity
  const cellPointFilled = effectiveBoundaryFillEnabled || cellBoundaryOpacity <= 0
  const layers: LayersList = []

  layers.push(
    ...createCellBoundaryLayers({
      boundaries,
      geometry: cellBoundaryGeometry,
      style: cellBoundaryStyle,
      fillEnabled: effectiveBoundaryFillEnabled,
      cellFillOpacity,
      cellBoundaryOpacity,
      pickable: options.cellBoundaryPickable === true,
    }),
  )
  layers.push(
    ...createNucleusBoundaryLayers(nucleusBoundaries, options.nucleusBoundaryOpacity),
  )
  layers.push(
    createCellPointLayer(pointCells, {
      cellFillOpacity: cellPointFillOpacity,
      cellBoundaryOpacity,
      filled: cellPointFilled,
      pickable: options.cellPointPickable ?? true,
      radiusMaxPixels:
        options.trueSizePoints === true
          ? UNCAPPED_RADIUS_PIXELS
          : overviewCellRadiusMaxPixels(
              options.pointSizeZoomDelta,
              pointSizeFullViewScale,
            ),
      ...(cellPointPacking === undefined
        ? {}
        : {
            packed: {
              geometry: cellPointPacking.geometry,
              colors: cachedCellPointLayerColors(
                cellPointPacking.colors,
                cellPointFillOpacity,
                cellBoundaryOpacity,
              ),
              filterValues: cellPointPacking.filterValues,
              sampleFraction: cellPointPacking.sampleFraction,
            },
          }),
    }),
  )

  const geneExpressionLayer = createGeneExpressionScatterLayer(
    visibleGeneExpressionOverlayCells,
    {
      cellFillOpacity: Math.max(
        cellFillOpacity,
        GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY,
      ),
      cellBoundaryOpacity,
      filled: true,
      radiusMaxPixels:
        options.trueSizePoints === true
          ? UNCAPPED_RADIUS_PIXELS
          : geneExpressionRadiusMaxPixels(
              options.pointSizeZoomDelta,
              pointSizeFullViewScale,
            ),
    },
  )

  if (geneExpressionLayer !== null) {
    layers.push(geneExpressionLayer)
  }

  const transcriptDensityLayer = createTranscriptDensityLayer(
    transcriptDensityBins,
    options.transcriptOpacity,
  )

  if (transcriptDensityLayer !== null) {
    layers.push(transcriptDensityLayer)
  }

  const gridCellLayer = createGridCellLayer(gridCells, {
    fillOpacity: gridCellOpacity ?? cellFillOpacity,
    lineOpacity: gridCellOpacity ?? cellBoundaryOpacity,
    geneExpressionActive,
  })

  if (gridCellLayer !== null) {
    layers.push(gridCellLayer)
  }

  layers.push(...createGeometricAnnotationLayers(geometricAnnotations))

  const transcriptFeatureCircleLayer = createTranscriptFeatureCircleLayer(
    transcriptFeatureCircleBins,
    options.transcriptOpacity,
  )

  if (transcriptFeatureCircleLayer !== null) {
    layers.push(transcriptFeatureCircleLayer)
  }

  const transcriptPointLayer = createTranscriptPointLayer(transcriptPoints, {
    ...(options.transcriptOpacity === undefined
      ? {}
      : { opacity: options.transcriptOpacity }),
    ...(options.transcriptPointSize === undefined
      ? {}
      : { pointSize: options.transcriptPointSize }),
  })

  if (transcriptPointLayer !== null) {
    layers.push(transcriptPointLayer)
  }

  return layers
}
