import { useMemo } from 'react'
import type { MorphologyCanvasChannel } from '../../components/MorphologyCanvas'
import { micrometers, type BBox } from '../../data/coords'
import type { MorphologyImage, MorphologyImageChannel } from '../../data/morphologyImage'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type {
  AnnotationColorStyle,
  CellMetadataColorStyle,
  ObservationColorMode,
} from '../../rendering/cellStyling'
import { styleOverviewCellsByObservation } from '../../rendering/cellStyling'
import {
  boundaryElementsToLayerData,
  geneExpressionCellsToLayerData,
  geneExpressionScoreDomainMax,
  styleGeneExpressionCellsByScale,
  transcriptAggregateBinsToLayerData,
  transcriptPointsToLayerData,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
  type GridCellDatum,
  type OverviewCellDatum,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import { overviewCellsToBbox } from '../cells/cellDetailModel'
import {
  geneExpressionScaleKeyFor,
  type GeneExpressionScaleDomain,
} from '../genes/geneControlsModel'
import {
  estimateVisibleTranscriptsFromCells,
  transcriptAggregateBinsForRendering,
  transcriptAggregateScaleMaxForRendering,
  transcriptDensityScaleValueLabels,
  transcriptPointsForRendering,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import {
  normalizeChannelContrast,
  type MorphologyChannelSetting,
} from '../morphology/morphologyChannels'
import { readTimestamp } from './appRuntimeModel'
import type { AnnotationState } from '../annotations/annotationModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'

const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_MORPHOLOGY_CHANNEL_OPACITIES: ReadonlyMap<string, number> = new Map()
const EMPTY_GRID_CELLS: readonly GridCellDatum[] = []

interface UseViewerLayerDataOptions {
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly annotationColors: Readonly<Record<string, string>>
  readonly cellMetadataTrack: CellMetadataColorStyle | null
  readonly observationColorMode: ObservationColorMode
  readonly overviewCells: readonly OverviewCellDatum[]
  readonly gridCells?: readonly GridCellDatum[]
  readonly currentViewportBbox: BBox | null
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly selectedGenes: readonly string[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionScaleDomain: GeneExpressionScaleDomain
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly transcriptLayerState: TranscriptLayerState<StructuredLoadError>
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly morphologyImage: MorphologyImage | null
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyChannelOpacities?: ReadonlyMap<string, number>
  readonly boundaryElements: readonly SpatialElement[]
}

export function useViewerLayerData({
  annotationState,
  annotationColors,
  cellMetadataTrack,
  observationColorMode,
  overviewCells,
  gridCells = EMPTY_GRID_CELLS,
  currentViewportBbox,
  geneExpressionScaleDatasetUrl,
  geneExpressionScoreMode,
  selectedGenes,
  geneExpressionBatch,
  geneExpressionScaleDomain,
  geneExpressionColorScale,
  transcriptLayerState,
  transcriptPointColorMode,
  transcriptDensityColorScale,
  morphologyImage,
  morphologyChannels,
  morphologyChannelSettings,
  morphologyChannelOpacities = EMPTY_MORPHOLOGY_CHANNEL_OPACITIES,
  boundaryElements,
}: UseViewerLayerDataOptions) {
  const annotationStyleColors = useMemo(
    () =>
      annotationState.status === 'ready'
        ? annotationState.annotations.map((annotation, annotationIndex) => ({
            id: annotation.id,
            cellIds: annotation.cellIds,
            color:
              annotationColors[annotation.id] ?? annotationPaletteColor(annotationIndex),
          }))
        : [],
    [annotationColors, annotationState],
  )
  const activeAnnotationStyleColors =
    observationColorMode === 'annotations'
      ? annotationStyleColors
      : EMPTY_ANNOTATION_STYLE_COLORS
  const activeCellMetadataTrack =
    observationColorMode === 'metadata' ? cellMetadataTrack : null
  const viewerObservationColorMode: ObservationColorMode =
    observationColorMode === 'annotations' && activeAnnotationStyleColors.length > 0
      ? 'annotations'
      : observationColorMode === 'metadata' && activeCellMetadataTrack !== null
        ? 'metadata'
        : 'transcript-count'
  const styledOverviewCells = useMemo(() => {
    if (observationColorMode !== 'cell-area') {
      return overviewCells
    }

    return styleOverviewCellsByObservation(overviewCells, 'cell-area')
  }, [observationColorMode, overviewCells])
  const overviewExtent = useMemo(
    () => spatialLayerDataToBbox(overviewCells, gridCells),
    [gridCells, overviewCells],
  )
  const geneExpressionScaleKey = useMemo(
    () =>
      geneExpressionScaleKeyFor(
        geneExpressionScaleDatasetUrl,
        geneExpressionScoreMode,
        selectedGenes,
      ),
    [geneExpressionScaleDatasetUrl, geneExpressionScoreMode, selectedGenes],
  )
  const currentGeneExpressionScaleMax = useMemo(
    () =>
      geneExpressionBatch === null
        ? 0
        : geneExpressionScoreDomainMax(
            geneExpressionBatch.cells,
            geneExpressionBatch.genes,
            geneExpressionScoreMode,
          ),
    [geneExpressionBatch, geneExpressionScoreMode],
  )
  const storedGeneExpressionScaleMax =
    geneExpressionScaleDomain.key === geneExpressionScaleKey
      ? geneExpressionScaleDomain.max
      : 0
  const geneExpressionScaleMax = Math.max(
    storedGeneExpressionScaleMax,
    currentGeneExpressionScaleMax,
  )
  const geneExpressionLayerData = useMemo(() => {
    if (geneExpressionBatch === null) {
      return { cells: [], durationMs: 0 }
    }

    const startedAt = readTimestamp()
    const cells = geneExpressionCellsToLayerData(
      geneExpressionBatch.cells,
      geneExpressionBatch.genes,
      geneExpressionColorScale,
      geneExpressionScoreMode,
      { scaleMax: geneExpressionScaleMax },
    )

    return { cells, durationMs: Math.max(0, readTimestamp() - startedAt) }
  }, [
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionScaleMax,
    geneExpressionScoreMode,
  ])
  const geneExpressionCells = geneExpressionLayerData.cells
  const geneExpressionLayerDataDurationMs = geneExpressionLayerData.durationMs
  const styledGeneExpressionLayerData = useMemo(() => {
    const startedAt = readTimestamp()
    const cells = styleGeneExpressionCellsByScale(
      geneExpressionCells,
      geneExpressionColorScale,
      {
        scaleMax: geneExpressionScaleMax,
      },
    )

    return { cells, durationMs: Math.max(0, readTimestamp() - startedAt) }
  }, [geneExpressionCells, geneExpressionColorScale, geneExpressionScaleMax])
  const styledGeneExpressionCells = styledGeneExpressionLayerData.cells
  const geneExpressionRestyleDurationMs = styledGeneExpressionLayerData.durationMs
  const transcriptLayerPoints = useMemo(
    () =>
      transcriptPointsToLayerData(
        transcriptPointsForRendering(transcriptLayerState),
        transcriptPointColorMode,
      ),
    [transcriptLayerState, transcriptPointColorMode],
  )
  const transcriptDensityScaleMax =
    transcriptAggregateScaleMaxForRendering(transcriptLayerState)
  const transcriptDensityScaleLabels = transcriptDensityScaleValueLabels(
    transcriptDensityScaleMax,
  )
  const transcriptLayerAggregateBins = useMemo(() => {
    return transcriptAggregateBinsToLayerData(
      transcriptAggregateBinsForRendering(transcriptLayerState),
      transcriptDensityColorScale,
      transcriptDensityScaleMax === undefined
        ? {}
        : { scaleMax: transcriptDensityScaleMax },
    )
  }, [transcriptDensityColorScale, transcriptDensityScaleMax, transcriptLayerState])
  const visibleTranscriptEstimate = useMemo(
    () =>
      currentViewportBbox === null
        ? 0
        : estimateVisibleTranscriptsFromCells(overviewCells, currentViewportBbox),
    [currentViewportBbox, overviewCells],
  )
  const morphologyCanvasChannels = useMemo<readonly MorphologyCanvasChannel[]>(
    () =>
      morphologyChannels.map((channel) => {
        const setting = morphologyChannelSettings.find(
          (candidate) => candidate.id === channel.info.id,
        )
        const contrast = normalizeChannelContrast({
          min: setting?.contrastMin ?? channel.info.contrast.min,
          max: setting?.contrastMax ?? channel.info.contrast.max,
        })

        return {
          id: channel.info.id,
          loader: channel.loader,
          enabled: setting?.enabled ?? false,
          color: setting?.color ?? channel.info.color,
          contrast,
          opacity: morphologyChannelOpacities.get(channel.info.id) ?? 1,
          ...(channel.info.alphaFromIntensity === undefined
            ? {}
            : { alphaFromIntensity: channel.info.alphaFromIntensity }),
        }
      }),
    [morphologyChannelOpacities, morphologyChannelSettings, morphologyChannels],
  )
  const morphologyMicrometersPerPixel = morphologyImage?.loader.units?.micrometersPerPixel
  const boundaryLayerData = useMemo(
    () => boundaryElementsToLayerData(boundaryElements),
    [boundaryElements],
  )

  return {
    activeAnnotationStyleColors,
    activeCellMetadataTrack,
    annotationStyleColors,
    boundaryLayerData,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionScaleKey,
    geneExpressionScaleMax,
    morphologyCanvasChannels,
    morphologyMicrometersPerPixel,
    overviewExtent,
    styledGeneExpressionCells,
    styledOverviewCells,
    transcriptDensityScaleLabels,
    transcriptDensityScaleMax,
    transcriptLayerAggregateBins,
    transcriptLayerPoints,
    viewerObservationColorMode,
    visibleTranscriptEstimate,
  }
}

function spatialLayerDataToBbox(
  cells: readonly OverviewCellDatum[],
  gridCells: readonly GridCellDatum[],
): BBox | null {
  const cellBbox = overviewCellsToBbox(cells)

  if (gridCells.length === 0) {
    return cellBbox
  }

  let minX = cellBbox?.minX ?? Number.POSITIVE_INFINITY
  let maxX = cellBbox?.maxX ?? Number.NEGATIVE_INFINITY
  let minY = cellBbox?.minY ?? Number.POSITIVE_INFINITY
  let maxY = cellBbox?.maxY ?? Number.NEGATIVE_INFINITY

  for (const cell of gridCells) {
    for (const [x = 0, deckY = 0] of cell.polygon) {
      const rawY = -deckY
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, rawY)
      maxY = Math.max(maxY, rawY)
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
