import type { Color, Position } from '@deck.gl/core'
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

const GENE_MARKER_MIN_RADIUS_PIXELS = 1.5
// The smallest marker's radius, as a share of half the square.
const GENE_MARKER_MIN_SHARE = 0.18
const GENE_MARKER_OUTLINE_COLOR: Color = [12, 12, 12, 150]
const GENE_MARKER_OUTLINE_PIXELS = 0.6

// Density squares, or gene markers when the data holds them
// (transcriptAggregateBinsToLayerData gives one or the other).
export function createTranscriptDensityLayer(
  bins: readonly TranscriptAggregateDatum[],
  opacity: number | undefined,
):
  | PolygonLayer<TranscriptAggregateDatum>
  | ScatterplotLayer<TranscriptAggregateDatum>
  | null {
  if (bins.length === 0) {
    return null
  }

  const transcriptOpacity = normalizeLayerOpacity(opacity ?? DEFAULT_LAYER_OPACITY)

  if (bins[0]?.glyphType === 'gene') {
    return createTranscriptGeneMarkerLayer(bins, transcriptOpacity)
  }

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

// Circles in micrometres, so a marker keeps its place in its square at every
// zoom; the pixel minimum keeps single transcripts visible.
function createTranscriptGeneMarkerLayer(
  markers: readonly TranscriptAggregateDatum[],
  transcriptOpacity: number,
): ScatterplotLayer<TranscriptAggregateDatum> {
  return new ScatterplotLayer<TranscriptAggregateDatum>({
    id: 'transcript-gene-markers',
    data: markers,
    pickable: true,
    radiusUnits: 'common',
    radiusMinPixels: GENE_MARKER_MIN_RADIUS_PIXELS,
    stroked: true,
    filled: true,
    opacity: 1,
    lineWidthUnits: 'pixels',
    getPosition: (marker) => marker.position,
    getRadius: (marker) => marker.radiusMicrometers,
    getFillColor: (marker) => colorWithOpacity(marker.fillColor, transcriptOpacity),
    getLineColor: () => colorWithOpacity(GENE_MARKER_OUTLINE_COLOR, transcriptOpacity),
    getLineWidth: GENE_MARKER_OUTLINE_PIXELS,
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

export interface TranscriptPointLayerDataOptions {
  // Colours by gene (15.4-C); the colour from the gene's name otherwise.
  readonly featureColor?: (featureName: string) => Color
  // Genes whose points are not drawn.
  readonly hiddenFeatures?: ReadonlySet<string>
}

export function transcriptPointsToLayerData(
  transcripts: readonly TranscriptPoint[],
  colorMode: TranscriptPointColorMode = DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  {
    featureColor = transcriptFeatureColor,
    hiddenFeatures,
  }: TranscriptPointLayerDataOptions = {},
): readonly TranscriptPointDatum[] {
  const colors = new Map<string, Color>()
  const colorFor = (featureName: string): Color => {
    let color = colors.get(featureName)
    if (color === undefined) {
      color = featureColor(featureName)
      colors.set(featureName, color)
    }
    return color
  }
  const shown =
    hiddenFeatures === undefined || hiddenFeatures.size === 0
      ? transcripts
      : transcripts.filter((transcript) => !hiddenFeatures.has(transcript.featureName))

  return shown.map((transcript) => ({
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
        : colorFor(transcript.featureName),
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

  for (const bin of bins) {
    localDensityMax = Math.max(localDensityMax, bin.count)
  }

  const densityScaleMax =
    options.scaleMax === undefined || options.scaleMax <= 0
      ? localDensityMax
      : options.scaleMax

  if (colorScale === 'gene' && bins.some((bin) => bin.featureGroups !== undefined)) {
    return transcriptGeneMarkers(bins, densityScaleMax, options)
  }

  return bins.map((bin) => {
    const intensity = Math.sqrt(Math.max(bin.count, 0) / Math.max(1, densityScaleMax))

    return {
      id: bin.id,
      position: [bin.position.x, -bin.position.y, 0],
      ...(bin.source === undefined ? {} : { source: bin.source }),
      ...(bin.glyphType === undefined ? {} : { glyphType: bin.glyphType }),
      level: bin.level,
      binX: bin.binX,
      binY: bin.binY,
      count: bin.count,
      ...(bin.sampledShare === undefined ? {} : { sampledShare: bin.sampledShare }),
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
      fillColor: transcriptDensityColor(colorScale, intensity),
    }
  })
}

// One circle per gene in each square, in the gene's colour, at the centre of
// the gene's transcripts there. Its area follows the count, so the square's
// largest possible count fills the square. Larger circles are drawn first, so
// smaller ones stay on top.
function transcriptGeneMarkers(
  bins: readonly TranscriptAggregateBin[],
  scaleMax: number,
  {
    featureColor = transcriptFeatureColor,
    hiddenFeatures,
  }: TranscriptAggregateLayerDataOptions,
): readonly TranscriptAggregateDatum[] {
  const colors = new Map<string, Color>()
  const colorFor = (featureName: string): Color => {
    let color = colors.get(featureName)
    if (color === undefined) {
      color = featureColor(featureName)
      colors.set(featureName, color)
    }
    return color
  }
  const markers: TranscriptAggregateDatum[] = []

  for (const bin of bins) {
    const binSize = bin.binSizeMicrometers ?? bin.radiusMicrometers * 2

    for (const group of bin.featureGroups ?? []) {
      if (group.count <= 0 || hiddenFeatures?.has(group.featureName) === true) {
        continue
      }

      const share = Math.sqrt(Math.min(1, group.count / Math.max(1, scaleMax)))

      markers.push({
        id: `${bin.id}:${group.featureName}`,
        position: [group.position.x, -group.position.y, 0],
        ...(bin.source === undefined ? {} : { source: bin.source }),
        glyphType: 'gene',
        level: bin.level,
        binX: bin.binX,
        binY: bin.binY,
        count: group.count,
        radiusMicrometers: (binSize / 2) * Math.max(GENE_MARKER_MIN_SHARE, share),
        binSizeMicrometers: binSize,
        featureName: group.featureName,
        fillColor: colorFor(group.featureName),
      })
    }
  }

  return markers.sort((left, right) => right.count - left.count)
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
