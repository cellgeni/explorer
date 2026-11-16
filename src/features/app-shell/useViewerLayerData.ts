import type { Color } from '@deck.gl/core'
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
  geneExpressionElementsToLayerData,
  geneExpressionScoreSpread,
  styleGeneExpressionElementsByScale,
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
  EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
  geneExpressionScaleKeyFor,
  type GeneExpressionScaleDomain,
} from '../genes/geneControlsModel'
import {
  estimateVisibleTranscripts,
  transcriptAggregateBinsForRendering,
  transcriptAggregateScaleMaxForRendering,
  transcriptDensityScaleValueLabels,
  transcriptPointsForRendering,
  type TranscriptCapabilityState,
  type TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import {
  normalizeChannelContrast,
  type MorphologyChannelSetting,
} from '../morphology/morphologyChannels'
import { readTimestamp } from './appRuntimeModel'
import type { AnnotationState } from '../annotations/annotationModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  AUTO_GENE_SCALE_RANGE,
  EMPTY_GENE_SCORE_SPREAD,
  geneScaleBounds,
  type GeneScaleRange,
} from '../genes/geneScaleRange'

const EMPTY_ANNOTATION_STYLE_COLORS: readonly AnnotationColorStyle[] = []
const EMPTY_MORPHOLOGY_CHANNEL_OPACITIES: ReadonlyMap<string, number> = new Map()
const EMPTY_GRID_CELLS: readonly GridCellDatum[] = []
const EMPTY_SPATIAL_ELEMENTS: readonly SpatialElement[] = []

interface ViewerLayerAnnotationOptions {
  // The shown classes of the shown sets.
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly annotationColors: Readonly<Record<string, string>>
  // A set is shown, even if all its classes are unchecked: cells stay in
  // annotation colours and fade instead of going back to the default.
  readonly annotationSetShown: boolean
}

interface ViewerLayerCellOptions {
  readonly cellMetadataTrack: CellMetadataColorStyle | null
  readonly observationColorMode: ObservationColorMode
  readonly overviewCells: readonly OverviewCellDatum[]
  readonly gridCells?: readonly GridCellDatum[]
  readonly currentViewportBbox: BBox | null
}

interface ViewerLayerGeneExpressionOptions {
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly selectedGenes: readonly string[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionScaleDomain: GeneExpressionScaleDomain
  readonly geneExpressionColorScale: GeneExpressionColorScale
  // The Gene scale's range; Auto when left out.
  readonly geneExpressionScaleRange?: GeneScaleRange
}

interface ViewerLayerTranscriptOptions {
  // Its transcripts.zarr.zip grid counts, when read, give the visible
  // transcript estimate.
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly transcriptLayerState: TranscriptLayerState<StructuredLoadError>
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  // The transcript gene legend (15.4-C): each gene's colour, and genes whose
  // points are hidden. Both must be stable between renders.
  readonly transcriptGeneColor?: (featureName: string) => Color
  readonly hiddenTranscriptGenes?: ReadonlySet<string>
}

interface ViewerLayerMorphologyOptions {
  readonly morphologyImage: MorphologyImage | null
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyChannelOpacities?: ReadonlyMap<string, number>
}

interface ViewerLayerBoundaryOptions {
  readonly boundaryElements: readonly SpatialElement[]
  readonly nucleusBoundaryElements?: readonly SpatialElement[]
}

interface UseViewerLayerDataOptions {
  readonly annotations: ViewerLayerAnnotationOptions
  readonly cells: ViewerLayerCellOptions
  readonly geneExpression: ViewerLayerGeneExpressionOptions
  readonly transcripts: ViewerLayerTranscriptOptions
  readonly morphology: ViewerLayerMorphologyOptions
  readonly boundaries: ViewerLayerBoundaryOptions
}

export function useViewerLayerData({
  annotations,
  boundaries,
  cells,
  geneExpression,
  morphology,
  transcripts,
}: UseViewerLayerDataOptions) {
  const { annotationColors, annotationState, annotationSetShown } = annotations
  const {
    cellMetadataTrack,
    currentViewportBbox,
    gridCells = EMPTY_GRID_CELLS,
    observationColorMode,
    overviewCells,
  } = cells
  const {
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionScaleDatasetUrl,
    geneExpressionScaleDomain,
    geneExpressionScaleRange = AUTO_GENE_SCALE_RANGE,
    geneExpressionScoreMode,
    selectedGenes,
  } = geneExpression
  const {
    hiddenTranscriptGenes,
    transcriptCapabilityState,
    transcriptDensityColorScale,
    transcriptGeneColor,
    transcriptLayerState,
    transcriptPointColorMode,
  } = transcripts
  const {
    morphologyChannelOpacities = EMPTY_MORPHOLOGY_CHANNEL_OPACITIES,
    morphologyChannelSettings,
    morphologyChannels,
    morphologyImage,
  } = morphology
  const { boundaryElements, nucleusBoundaryElements = EMPTY_SPATIAL_ELEMENTS } =
    boundaries
  const annotationStyleColors = useMemo(
    () =>
      annotationState.status === 'ready'
        ? annotationState.annotations.map((annotation, annotationIndex) => ({
            id: annotation.id,
            label: annotation.label,
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
    observationColorMode === 'annotations' &&
    (activeAnnotationStyleColors.length > 0 ||
      (annotationSetShown && annotationState.status === 'ready'))
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
  const currentGeneExpressionScoreSpread = useMemo(
    () =>
      geneExpressionBatch === null
        ? EMPTY_GENE_SCORE_SPREAD
        : geneExpressionScoreSpread(
            geneExpressionBatch.elements,
            geneExpressionBatch.genes,
            geneExpressionScoreMode,
          ),
    [geneExpressionBatch, geneExpressionScoreMode],
  )
  const storedGeneExpressionScaleDomain =
    geneExpressionScaleDomain.key === geneExpressionScaleKey
      ? geneExpressionScaleDomain
      : EMPTY_GENE_EXPRESSION_SCALE_DOMAIN
  // Auto keeps the highest top seen for these genes, so the scale does not
  // shrink as the view moves.
  const geneExpressionAutoScaleMax = Math.max(
    storedGeneExpressionScaleDomain.top,
    currentGeneExpressionScoreSpread.top,
  )
  const geneExpressionHighestScore = Math.max(
    storedGeneExpressionScaleDomain.highest,
    currentGeneExpressionScoreSpread.highest,
  )
  const { min: geneExpressionScaleMin, max: geneExpressionScaleMax } = geneScaleBounds(
    geneExpressionScaleRange,
    geneExpressionAutoScaleMax,
  )
  const geneExpressionLayerData = useMemo(() => {
    if (geneExpressionBatch === null) {
      return { elements: [], durationMs: 0 }
    }

    const startedAt = readTimestamp()
    const elements = geneExpressionElementsToLayerData(
      geneExpressionBatch.elements,
      geneExpressionBatch.genes,
      geneExpressionColorScale,
      geneExpressionScoreMode,
      { scaleMin: geneExpressionScaleMin, scaleMax: geneExpressionScaleMax },
    )

    return { elements, durationMs: Math.max(0, readTimestamp() - startedAt) }
  }, [
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionScaleMax,
    geneExpressionScaleMin,
    geneExpressionScoreMode,
  ])
  const geneExpressionElements = geneExpressionLayerData.elements
  const geneExpressionLayerDataDurationMs = geneExpressionLayerData.durationMs
  const styledGeneExpressionLayerData = useMemo(() => {
    const startedAt = readTimestamp()
    const elements = styleGeneExpressionElementsByScale(
      geneExpressionElements,
      geneExpressionColorScale,
      {
        scaleMin: geneExpressionScaleMin,
        scaleMax: geneExpressionScaleMax,
      },
    )

    return { elements, durationMs: Math.max(0, readTimestamp() - startedAt) }
  }, [
    geneExpressionElements,
    geneExpressionColorScale,
    geneExpressionScaleMax,
    geneExpressionScaleMin,
  ])
  const styledGeneExpressionElements = styledGeneExpressionLayerData.elements
  const geneExpressionRestyleDurationMs = styledGeneExpressionLayerData.durationMs
  const transcriptLayerPoints = useMemo(
    () =>
      transcriptPointsToLayerData(
        transcriptPointsForRendering(transcriptLayerState),
        transcriptPointColorMode,
        {
          ...(transcriptGeneColor === undefined
            ? {}
            : { featureColor: transcriptGeneColor }),
          ...(hiddenTranscriptGenes === undefined
            ? {}
            : { hiddenFeatures: hiddenTranscriptGenes }),
        },
      ),
    [
      hiddenTranscriptGenes,
      transcriptGeneColor,
      transcriptLayerState,
      transcriptPointColorMode,
    ],
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
        : estimateVisibleTranscripts(
            transcriptCapabilityState,
            overviewCells,
            currentViewportBbox,
          ),
    [currentViewportBbox, overviewCells, transcriptCapabilityState],
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
  const nucleusBoundaryLayerData = useMemo(
    () =>
      boundaryElementsToLayerData(nucleusBoundaryElements, {
        fillColor: [63, 118, 190, 38],
        lineColor: [128, 188, 255, 170],
      }),
    [nucleusBoundaryElements],
  )

  return {
    activeAnnotationStyleColors,
    activeCellMetadataTrack,
    annotationStyleColors,
    boundaryLayerData,
    nucleusBoundaryLayerData,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionAutoScaleMax,
    geneExpressionHighestScore,
    geneExpressionScaleKey,
    geneExpressionScaleMax,
    geneExpressionScaleMin,
    morphologyCanvasChannels,
    morphologyMicrometersPerPixel,
    overviewExtent,
    styledGeneExpressionElements,
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
