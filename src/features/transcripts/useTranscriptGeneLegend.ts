import type { Color } from '@deck.gl/core'
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { TranscriptFeatureFilterMode } from '../../data/transcriptOverlay'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import {
  EMPTY_TRANSCRIPT_GENE_LEGEND,
  assignTranscriptGeneColors,
  countTranscriptsByGene,
  countTranscriptsByGeneInBins,
  hexToTranscriptColor,
  transcriptGeneColor,
  transcriptGeneLegend,
  type TranscriptGeneLegend,
  type TranscriptGeneLegendItem,
} from './transcriptGeneLegendModel'
import {
  transcriptAggregateBinsForRendering,
  transcriptPointsForRendering,
  type TranscriptLayerState,
} from './transcriptLayerModel'

// The Transcripts section's gene list (plan 15.4-C).
export interface TranscriptGeneLegendModel {
  // Points coloured by gene, or gene markers, are on screen, so the list
  // applies.
  readonly active: boolean
  // Why there is no list, when transcripts are shown another way.
  readonly note: string | null
  readonly items: readonly TranscriptGeneLegendItem[]
  readonly moreCount: number
  readonly hiddenCount: number
  readonly onColorChange: (gene: string, color: string) => void
  readonly onVisibilityChange: (gene: string, visible: boolean) => void
  readonly onShowAll: () => void
}

export interface TranscriptGeneLegendInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly colorMode: TranscriptPointColorMode
  readonly colors: Readonly<Record<string, string>>
  readonly densityColorScale: TranscriptDensityColorScale
  readonly filterMode: TranscriptFeatureFilterMode
  readonly hiddenGenes: readonly string[]
  readonly layerState: TranscriptLayerState
  readonly overlayShown: boolean
  readonly selectedGenes: readonly string[]
  readonly setColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setHiddenGenes: Dispatch<SetStateAction<readonly string[]>>
}

export interface TranscriptGeneLegendResult {
  readonly model: TranscriptGeneLegendModel
  // The canvas legend's list, or null when it does not apply.
  readonly legend: TranscriptGeneLegend | null
  // For the point and gene marker layers; stable while colours and genes are.
  readonly featureColor: (featureName: string) => Color
  readonly hiddenGenes: ReadonlySet<string>
  // Density is drawn as gene markers, so it has no colour scale.
  readonly markersShown: boolean
}

const NO_HIDDEN_GENES: ReadonlySet<string> = new Set()

export function useTranscriptGeneLegend({
  appendDebugEvent,
  colorMode,
  colors,
  densityColorScale,
  filterMode,
  hiddenGenes,
  layerState,
  overlayShown,
  selectedGenes,
  setColors,
  setHiddenGenes,
}: TranscriptGeneLegendInput): TranscriptGeneLegendResult {
  const hiddenSet = useMemo(() => new Set(hiddenGenes), [hiddenGenes])
  // Updated while rendering when the genes change, so a gene's colour stays
  // put as others are added (React's "adjusting state" pattern).
  const genesKey = selectedGenes.join('\n')
  const [assignment, setAssignment] = useState(() => ({
    key: genesKey,
    colors: assignTranscriptGeneColors({}, selectedGenes),
  }))
  let assigned = assignment.colors
  if (assignment.key !== genesKey) {
    assigned = assignTranscriptGeneColors(assignment.colors, selectedGenes)
    setAssignment({ key: genesKey, colors: assigned })
  }
  const featureColor = useCallback(
    (featureName: string) =>
      hexToTranscriptColor(transcriptGeneColor(featureName, assigned, colors)),
    [assigned, colors],
  )
  const points = transcriptPointsForRendering(layerState)
  const bins = transcriptAggregateBinsForRendering(layerState)
  const markersShown =
    overlayShown &&
    densityColorScale === 'gene' &&
    bins.some((bin) => bin.featureGroups !== undefined)
  const counts = useMemo(
    () =>
      markersShown ? countTranscriptsByGeneInBins(bins) : countTranscriptsByGene(points),
    [bins, markersShown, points],
  )
  const pointsShown = overlayShown && points.length > 0
  const active = (pointsShown && colorMode === 'feature') || markersShown
  const legend = useMemo(
    () =>
      active
        ? transcriptGeneLegend({
            assigned,
            counts,
            filterMode,
            hiddenGenes: hiddenSet,
            overrides: colors,
            selectedGenes,
          })
        : EMPTY_TRANSCRIPT_GENE_LEGEND,
    [active, assigned, colors, counts, filterMode, hiddenSet, selectedGenes],
  )

  const onColorChange = useCallback(
    (gene: string, color: string) => {
      setColors((current) =>
        current[gene] === color ? current : { ...current, [gene]: color },
      )
      appendDebugEvent(`Transcript colour ${gene}`, {
        coalesceKey: `transcript-gene-color:${gene}`,
      })
    },
    [appendDebugEvent, setColors],
  )
  const onVisibilityChange = useCallback(
    (gene: string, visible: boolean) => {
      setHiddenGenes((current) =>
        visible
          ? current.filter((hidden) => hidden !== gene)
          : current.includes(gene)
            ? current
            : [...current, gene],
      )
      appendDebugEvent(`Transcripts ${gene} ${visible ? 'shown' : 'hidden'}`)
    },
    [appendDebugEvent, setHiddenGenes],
  )
  const onShowAll = useCallback(() => {
    setHiddenGenes([])
    appendDebugEvent('Transcripts: all genes shown')
  }, [appendDebugEvent, setHiddenGenes])

  return {
    model: {
      active,
      note:
        !overlayShown || markersShown
          ? null
          : colorMode === 'quality' && pointsShown
            ? 'Points are coloured by quality. Set Point color to Feature to list the genes.'
            : !pointsShown
              ? 'Gene colours show when transcripts are drawn as points, or as density with Density color set to Gene markers.'
              : null,
      items: legend.items,
      moreCount: legend.moreCount,
      hiddenCount: hiddenGenes.length,
      onColorChange,
      onVisibilityChange,
      onShowAll,
    },
    legend: active && legend.items.length > 0 ? legend : null,
    featureColor,
    // Genes are hidden only while transcripts are coloured by gene, where
    // the list and Show All are; QV colours show every point.
    hiddenGenes: colorMode === 'feature' || markersShown ? hiddenSet : NO_HIDDEN_GENES,
    markersShown,
  }
}
