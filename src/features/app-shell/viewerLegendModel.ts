import type {
  CategoryLegendItem,
  ViewerLegendSection,
} from '../../components/viewerLegendTypes'
import {
  cellAreaScaleGradient,
  metadataScaleGradient,
  type ObservationColorMode,
} from '../../rendering/cellStyling'
import {
  geneExpressionScaleGradient,
  transcriptDensityScaleGradient,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
  type TranscriptDensityColorScale,
  type TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  TRANSCRIPT_QUALITY_SCALE_MAX,
  transcriptQualityGradient,
} from '../../rendering/transcriptColors'
import { withMicrometers } from '../../data/units'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import { transcriptGenesLabel } from '../transcripts/transcriptLabels'
import type { TranscriptDensityContent } from '../transcripts/transcriptLayerModel'

const GENE_NAME_LIMIT = 3

const SCORE_MODE_LABELS: Record<GeneExpressionScoreMode, string> = {
  sum: 'Sum',
  mean: 'Mean',
  'z-score': 'Mean z-score',
}

export interface ViewerLegendInput {
  // False while the layer panel hides the cells (15.2-C), so their colour
  // scale leaves the legend. Defaults to true.
  readonly cellsVisible?: boolean
  readonly colorMode: ObservationColorMode
  readonly genes: {
    readonly names: readonly string[]
    readonly scoreMode: GeneExpressionScoreMode
    readonly colorScale: GeneExpressionColorScale
    readonly scaleMax: number
    readonly loading: boolean
  }
  // The loaded annotations with their colours, or null when none are loaded.
  readonly annotations: {
    readonly setLabel: string | null
    readonly items: readonly Omit<CategoryLegendItem, 'visible'>[]
    readonly hiddenIds: ReadonlySet<string>
  } | null
  readonly metadataTrack: {
    readonly label: string
    readonly min: number
    readonly max: number
  } | null
  // The largest cell area, in µm², or null without areas.
  readonly cellAreaMax: number | null
  readonly transcripts: {
    readonly density: {
      readonly colorScale: TranscriptDensityColorScale
      readonly labels: readonly [string, string, string]
      readonly content: TranscriptDensityContent
    } | null
    readonly pointColorMode: TranscriptPointColorMode | null
  }
}

// The legend for what the canvas shows: the cell colour mode, then the
// transcripts when they are drawn as density or coloured by quality. A list
// of categories goes last, so it cannot push a scale out of view.
// Transcript count is the plain default and needs no legend; colouring
// points by feature gets its own legend in 15.4-C.
export function viewerLegendSections(input: ViewerLegendInput): ViewerLegendSection[] {
  const sections: ViewerLegendSection[] = []
  const cellSection = input.cellsVisible === false ? null : cellColorLegendSection(input)

  if (cellSection !== null) sections.push(cellSection)

  const { density, pointColorMode } = input.transcripts

  if (density !== null) {
    sections.push({
      kind: 'continuous',
      id: 'transcript-density',
      title: 'Transcript density',
      detail: transcriptDensityDetail(density.content),
      gradient: transcriptDensityScaleGradient(density.colorScale),
      min: density.labels[0],
      max: density.labels[2],
    })
  } else if (pointColorMode === 'quality') {
    sections.push({
      kind: 'continuous',
      id: 'transcript-quality',
      title: 'Transcript quality (QV)',
      gradient: transcriptQualityGradient(),
      min: '0',
      max: `${TRANSCRIPT_QUALITY_SCALE_MAX}+`,
    })
  }

  return [
    ...sections.filter((section) => section.kind === 'continuous'),
    ...sections.filter((section) => section.kind === 'categories'),
  ]
}

function cellColorLegendSection(input: ViewerLegendInput): ViewerLegendSection | null {
  switch (input.colorMode) {
    case 'gene-expression': {
      const { names, scoreMode, colorScale, scaleMax, loading } = input.genes
      if (names.length === 0) return null

      return {
        kind: 'continuous',
        id: 'cells',
        title: geneListLabel(names),
        detail: loading
          ? 'Loading expression'
          : names.length === 1
            ? 'Expression per cell'
            : `${SCORE_MODE_LABELS[scoreMode]} of ${names.length.toLocaleString()} genes per cell`,
        gradient: geneExpressionScaleGradient(colorScale),
        min: '0',
        max: formatGeneScaleValue(scaleMax),
      }
    }
    case 'annotations': {
      const annotations = input.annotations
      if (annotations === null || annotations.items.length === 0) return null
      const prefix = annotations.setLabel === null ? null : `${annotations.setLabel}: `

      return {
        kind: 'categories',
        id: 'cells',
        title: annotations.setLabel ?? 'Annotations',
        items: annotations.items.map((item) => ({
          ...item,
          label:
            prefix !== null && item.label.startsWith(prefix)
              ? item.label.slice(prefix.length)
              : item.label,
          visible: !annotations.hiddenIds.has(item.id),
        })),
      }
    }
    case 'metadata': {
      const track = input.metadataTrack
      if (track === null) return null

      return {
        kind: 'continuous',
        id: 'cells',
        title: track.label,
        gradient: metadataScaleGradient(),
        min: formatLegendNumber(track.min),
        max: formatLegendNumber(track.max),
      }
    }
    case 'cell-area': {
      if (input.cellAreaMax === null) return null

      return {
        kind: 'continuous',
        id: 'cells',
        title: 'Cell area',
        detail: 'µm², square-root scale',
        gradient: cellAreaScaleGradient(),
        min: '0',
        max: formatLegendNumber(input.cellAreaMax),
      }
    }
    case 'transcript-count':
      return null
  }
}

// "SNAP25", "SNAP25, GAD1, MBP" or "SNAP25, GAD1, MBP +2".
export function geneListLabel(names: readonly string[]): string {
  const shown = names.slice(0, GENE_NAME_LIMIT).join(', ')
  const rest = names.length - GENE_NAME_LIMIT

  return rest > 0 ? `${shown} +${rest.toLocaleString()}` : shown
}

function formatLegendNumber(value: number): string {
  if (!Number.isFinite(value)) return '–'

  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : Math.abs(value) < 1000 ? 1 : 0,
  })
}

// "SNAP25 transcripts per 40 µm bin", "Transcripts of 8 selected genes per
// 40 µm bin" or "All transcripts per 160 µm bin" (15.1-J).
export function transcriptDensityDetail(content: TranscriptDensityContent): string {
  const bin =
    content.binSizeMicrometers === undefined
      ? 'per bin'
      : `per ${withMicrometers(Math.round(content.binSizeMicrometers).toLocaleString())} bin`
  const genes = transcriptGenesLabel(content.featureNames)

  if (content.featureNames.length === 0) {
    return content.source === 'cell-summary'
      ? `Transcripts in cells ${bin}`
      : `All transcripts ${bin}`
  }

  return content.featureNames.length > 3
    ? `Transcripts of ${genes} ${bin}`
    : `${genes} transcripts ${bin}`
}
