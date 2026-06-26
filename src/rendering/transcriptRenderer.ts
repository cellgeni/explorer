import type { Position } from '@deck.gl/core'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { TranscriptAggregateBin, TranscriptPoint } from '../data/transcriptOverlay'
import {
  colorWithOpacity,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  transcriptDensityColor,
} from './deckLayerColors'
import type {
  TranscriptAggregateDatum,
  TranscriptAggregateLayerDataOptions,
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
  TranscriptPointDatum,
} from './deckLayerTypes'
import { DEFAULT_LAYER_OPACITY, normalizeLayerOpacity } from './layerOpacity'
import { transcriptFeatureColor, transcriptQualityColor } from './transcriptColors'

export function createTranscriptDensityLayer(
  bins: readonly TranscriptAggregateDatum[],
  opacity: number | undefined,
): PolygonLayer<TranscriptAggregateDatum> | null {
  if (bins.length === 0) {
    return null
  }

  const transcriptOpacity = normalizeLayerOpacity(opacity ?? DEFAULT_LAYER_OPACITY)

  return new PolygonLayer<TranscriptAggregateDatum>({
    id: 'transcript-density-bins',
    data: bins,
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
  })
}

export function createTranscriptFeatureCircleLayer(
  bins: readonly TranscriptAggregateDatum[],
  opacity: number | undefined,
): ScatterplotLayer<TranscriptAggregateDatum> | null {
  if (bins.length === 0) {
    return null
  }

  const transcriptOpacity = normalizeLayerOpacity(opacity ?? DEFAULT_LAYER_OPACITY)

  return new ScatterplotLayer<TranscriptAggregateDatum>({
    id: 'transcript-feature-circles',
    data: bins,
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
  })
}

export function createTranscriptPointLayer(
  transcripts: readonly TranscriptPointDatum[],
  options: {
    readonly opacity?: number
    readonly pointSize?: number
  },
): ScatterplotLayer<TranscriptPointDatum> | null {
  if (transcripts.length === 0) {
    return null
  }

  const transcriptOpacity = normalizeLayerOpacity(
    options.opacity ?? DEFAULT_LAYER_OPACITY,
  )
  const transcriptPointSize = Math.max(1, options.pointSize ?? 2)

  return new ScatterplotLayer<TranscriptPointDatum>({
    id: 'transcript-exact-points',
    data: transcripts,
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
  })
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
