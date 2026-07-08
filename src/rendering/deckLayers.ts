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
import { GENE_EXPRESSION_OVERLAY_MIN_FILL_OPACITY } from './deckLayerColors'
import type {
  CellBoundaryDatum,
  OverviewCellDatum,
  OverviewLayerOptions,
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
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  isTranscriptDensityColorScale,
  isTranscriptPointColorMode,
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_POINT_COLOR_MODE_OPTIONS,
} from './deckLayerColors'
export {
  createGeneExpressionElementStyleIndex,
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
  const transcriptDensityBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType !== 'feature-circle',
  )
  const transcriptFeatureCircleBins = transcriptAggregateBins.filter(
    (bin) => bin.glyphType === 'feature-circle',
  )
  const transcriptPoints = options.transcriptPoints ?? []
  const visibleGeneExpressionOverlayCells =
    cellBoundaryGeometry.boundaryCellIds.size === 0
      ? geneExpressionOverlayElements
      : geneExpressionOverlayElements.filter(
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
      radiusMaxPixels: overviewCellRadiusMaxPixels(
        options.pointSizeZoomDelta,
        pointSizeFullViewScale,
      ),
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
      radiusMaxPixels: geneExpressionRadiusMaxPixels(
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
