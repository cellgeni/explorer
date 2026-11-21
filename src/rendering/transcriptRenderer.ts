import type { Color, Position } from '@deck.gl/core'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type {
  TranscriptAggregateBin,
  TranscriptAggregateFeatureGroup,
  TranscriptPoint,
} from '../data/transcriptOverlay'
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
// Genes a merged (gene set) marker's hover card lists, as for a square.
const GENE_MARKER_GROUP_SUMMARY_LIMIT = 4

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
// smaller ones stay on top. With `featureGroup`, one circle per group (gene
// set) instead, at the centre of its genes' transcripts.
function transcriptGeneMarkers(
  bins: readonly TranscriptAggregateBin[],
  scaleMax: number,
  {
    featureColor = transcriptFeatureColor,
    hiddenFeatures,
    featureGroup,
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

    const shown = (bin.featureGroups ?? []).filter(
      (group) => group.count > 0 && hiddenFeatures?.has(group.featureName) !== true,
    )

    for (const group of featureGroup === undefined
      ? shown.map(singleGeneMarkerGroup)
      : mergeGeneMarkerGroups(shown, featureGroup)) {
      const share = Math.sqrt(Math.min(1, group.count / Math.max(1, scaleMax)))

      markers.push({
        id: `${bin.id}:${group.id}`,
        position: [group.x, -group.y, 0],
        ...(bin.source === undefined ? {} : { source: bin.source }),
        glyphType: 'gene',
        level: bin.level,
        binX: bin.binX,
        binY: bin.binY,
        count: group.count,
        radiusMicrometers: (binSize / 2) * Math.max(GENE_MARKER_MIN_SHARE, share),
        binSizeMicrometers: binSize,
        // A merged marker lists its genes' counts, as a square of several
        // selected genes does.
        ...(group.genes.length > 1
          ? {
              selectedGeneCount: group.genes.length,
              topFeatures: group.genes.slice(0, GENE_MARKER_GROUP_SUMMARY_LIMIT),
            }
          : {}),
        featureName: group.label,
        // Every gene of a group has the group's colour.
        fillColor: colorFor(group.genes[0]?.featureName ?? group.label),
      })
    }
  }

  return markers.sort((left, right) => right.count - left.count)
}

interface GeneMarkerGroup {
  readonly id: string
  readonly label: string
  readonly count: number
  readonly x: number
  readonly y: number
  // Most transcripts first.
  readonly genes: readonly { readonly featureName: string; readonly count: number }[]
}

function singleGeneMarkerGroup(group: TranscriptAggregateFeatureGroup): GeneMarkerGroup {
  return {
    id: group.featureName,
    label: group.featureName,
    count: group.count,
    x: group.position.x,
    y: group.position.y,
    genes: [{ featureName: group.featureName, count: group.count }],
  }
}

// One marker per group, its count summed and its centre weighted by count.
function mergeGeneMarkerGroups(
  groups: readonly TranscriptAggregateFeatureGroup[],
  featureGroup: NonNullable<TranscriptAggregateLayerDataOptions['featureGroup']>,
): GeneMarkerGroup[] {
  const merged = new Map<
    string,
    {
      label: string
      count: number
      sumX: number
      sumY: number
      genes: { readonly featureName: string; readonly count: number }[]
    }
  >()

  for (const group of groups) {
    const { id, label } = featureGroup(group.featureName)
    let entry = merged.get(id)

    if (entry === undefined) {
      entry = { label, count: 0, sumX: 0, sumY: 0, genes: [] }
      merged.set(id, entry)
    }

    entry.count += group.count
    entry.sumX += group.position.x * group.count
    entry.sumY += group.position.y * group.count
    entry.genes.push({ featureName: group.featureName, count: group.count })
  }

  return [...merged].map(([id, entry]) => ({
    id,
    label: entry.label,
    count: entry.count,
    x: entry.sumX / entry.count,
    y: entry.sumY / entry.count,
    genes: entry.genes.sort((left, right) => right.count - left.count),
  }))
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
