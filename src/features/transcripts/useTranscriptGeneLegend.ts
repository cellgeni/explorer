import type { Color } from '@deck.gl/core'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { TranscriptFeatureFilterMode } from '../../data/transcriptOverlay'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { SavedGeneSet } from '../genes/geneControlsModel'
import {
  EMPTY_TRANSCRIPT_GENE_LEGEND,
  OTHER_TRANSCRIPT_GENES_ID,
  assignTranscriptGeneColors,
  countTranscriptsByGene,
  countTranscriptsByGeneInBins,
  genesInHiddenSets,
  hexToTranscriptColor,
  transcriptGeneColor,
  transcriptGeneLegend,
  transcriptGeneSetGrouping,
  transcriptGeneSetLegend,
  type TranscriptGeneLegend,
  type TranscriptGeneLegendItem,
  type TranscriptGeneSetGrouping,
} from './transcriptGeneLegendModel'
import {
  transcriptAggregateBinsForRendering,
  transcriptPointsForRendering,
  type TranscriptLayerState,
} from './transcriptLayerModel'

// The Transcripts section's gene list (plan 15.4-C), or its gene set list
// with Point color on Gene set.
export interface TranscriptGeneLegendModel {
  // Points coloured by gene or gene set, or gene markers, are on screen, so
  // the list applies.
  readonly active: boolean
  readonly bySet: boolean
  // Why there is no list, when transcripts are shown another way, or what the
  // list needs.
  readonly note: string | null
  readonly items: readonly TranscriptGeneLegendItem[]
  readonly moreCount: number
  // Hidden genes or sets that can still show; Show All is offered for them.
  readonly hiddenCount: number
  // What a row's count is: points, or transcripts in the gene marker bins.
  readonly countTitle: string
  // A gene, or with `bySet` a gene set's ID.
  readonly onColorChange: (id: string, color: string) => void
  readonly onVisibilityChange: (id: string, visible: boolean) => void
  readonly onShowAll: () => void
}

export interface TranscriptGeneLegendInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly colorMode: TranscriptPointColorMode
  readonly colors: Readonly<Record<string, string>>
  readonly densityColorScale: TranscriptDensityColorScale
  readonly filterMode: TranscriptFeatureFilterMode
  // The saved gene sets, for Point color on Gene set, with their edited
  // colours and the hidden ones, by set ID.
  readonly geneSets: readonly Pick<SavedGeneSet, 'id' | 'name' | 'genes'>[]
  readonly geneSetColors: Readonly<Record<string, string>>
  readonly hiddenGenes: readonly string[]
  readonly hiddenGeneSets: readonly string[]
  readonly layerState: TranscriptLayerState
  readonly overlayShown: boolean
  readonly selectedGenes: readonly string[]
  readonly setColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setGeneSetColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setHiddenGenes: Dispatch<SetStateAction<readonly string[]>>
  readonly setHiddenGeneSets: Dispatch<SetStateAction<readonly string[]>>
}

export interface TranscriptGeneLegendResult {
  readonly model: TranscriptGeneLegendModel
  // The canvas legend's list, or null when it does not apply.
  readonly legend: TranscriptGeneLegend | null
  // For the point and gene marker layers; stable while colours and genes are.
  readonly featureColor: (featureName: string) => Color
  readonly hiddenGenes: ReadonlySet<string>
  // With Point color on Gene set: each gene's set, so gene markers merge a
  // set's genes.
  readonly featureGroup: TranscriptGeneSetGrouping['groupOf'] | undefined
  // Density is drawn as gene markers, so it has no colour scale.
  readonly markersShown: boolean
}

const NO_HIDDEN_GENES: ReadonlySet<string> = new Set()
const NO_SET_NOTE =
  'No gene sets are saved, so every gene is in Other genes. Save sets under Cells › Genes.'

export function useTranscriptGeneLegend({
  appendDebugEvent,
  colorMode,
  colors,
  densityColorScale,
  filterMode,
  geneSets,
  geneSetColors,
  hiddenGenes,
  hiddenGeneSets,
  layerState,
  overlayShown,
  selectedGenes,
  setColors,
  setGeneSetColors,
  setHiddenGenes,
  setHiddenGeneSets,
}: TranscriptGeneLegendInput): TranscriptGeneLegendResult {
  const bySet = colorMode === 'gene-set'
  const hiddenSet = useMemo(() => new Set(hiddenGenes), [hiddenGenes])
  const hiddenGeneSetIds = useMemo(() => new Set(hiddenGeneSets), [hiddenGeneSets])
  const grouping = useMemo(
    () => (bySet ? transcriptGeneSetGrouping(geneSets, geneSetColors) : null),
    [bySet, geneSetColors, geneSets],
  )
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
      hexToTranscriptColor(
        grouping === null
          ? transcriptGeneColor(featureName, assigned, colors)
          : grouping.groupOf(featureName).color,
      ),
    [assigned, colors, grouping],
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
  const active = (pointsShown && colorMode !== 'quality') || markersShown
  const legend = useMemo(
    () =>
      !active
        ? EMPTY_TRANSCRIPT_GENE_LEGEND
        : grouping === null
          ? transcriptGeneLegend({
              assigned,
              counts,
              filterMode,
              hiddenGenes: hiddenSet,
              overrides: colors,
              selectedGenes,
            })
          : transcriptGeneSetLegend({ counts, grouping, hiddenSets: hiddenGeneSetIds }),
    [
      active,
      assigned,
      colors,
      counts,
      filterMode,
      grouping,
      hiddenGeneSetIds,
      hiddenSet,
      selectedGenes,
    ],
  )
  const genesHiddenBySet = useMemo(
    () =>
      grouping === null
        ? NO_HIDDEN_GENES
        : genesInHiddenSets(counts, grouping, hiddenGeneSetIds),
    [counts, grouping, hiddenGeneSetIds],
  )

  const onColorChange = useCallback(
    (id: string, color: string) => {
      const setColor = bySet ? setGeneSetColors : setColors
      setColor((current) =>
        current[id] === color ? current : { ...current, [id]: color },
      )
      appendDebugEvent(bySet ? 'Transcript gene set colour' : `Transcript colour ${id}`, {
        coalesceKey: `transcript-${bySet ? 'gene-set' : 'gene'}-color:${id}`,
      })
    },
    [appendDebugEvent, bySet, setColors, setGeneSetColors],
  )
  const onVisibilityChange = useCallback(
    (id: string, visible: boolean) => {
      const setHidden = bySet ? setHiddenGeneSets : setHiddenGenes
      setHidden((current) =>
        visible
          ? current.filter((hidden) => hidden !== id)
          : current.includes(id)
            ? current
            : [...current, id],
      )
      appendDebugEvent(
        `Transcripts ${bySet ? 'gene set' : id} ${visible ? 'shown' : 'hidden'}`,
      )
    },
    [appendDebugEvent, bySet, setHiddenGeneSets, setHiddenGenes],
  )
  // A gene taken out of the list of selected genes, or a gene set deleted,
  // is no longer hidden: picked again, it shows, and Show All does not stay
  // for it.
  const listsSelected = filterMode === 'selected' && selectedGenes.length > 0
  const geneSetIds = useMemo(
    () => new Set([...geneSets.map((geneSet) => geneSet.id), OTHER_TRANSCRIPT_GENES_ID]),
    [geneSets],
  )
  const previousRef = useRef({ selectedGenes, geneSetIds })
  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = { selectedGenes, geneSetIds }
    // While the list was the selected genes, even when the last one goes.
    if (
      filterMode === 'selected' &&
      previous.selectedGenes.length > 0 &&
      previous.selectedGenes !== selectedGenes
    ) {
      const kept = new Set(selectedGenes)
      const removed = previous.selectedGenes.filter((gene) => !kept.has(gene))
      if (removed.length > 0) {
        setHiddenGenes((current) =>
          current.some((gene) => removed.includes(gene))
            ? current.filter((gene) => !removed.includes(gene))
            : current,
        )
      }
    }
    if (previous.geneSetIds !== geneSetIds) {
      setHiddenGeneSets((current) =>
        current.every((id) => geneSetIds.has(id))
          ? current
          : current.filter((id) => geneSetIds.has(id)),
      )
    }
  }, [filterMode, geneSetIds, selectedGenes, setHiddenGeneSets, setHiddenGenes])
  const hiddenCount = bySet
    ? hiddenGeneSets.filter((id) => geneSetIds.has(id)).length
    : listsSelected
      ? hiddenGenes.filter((gene) => selectedGenes.includes(gene)).length
      : hiddenGenes.length

  const onShowAll = useCallback(() => {
    if (bySet) {
      setHiddenGeneSets([])
      appendDebugEvent('Transcripts: all gene sets shown')
    } else {
      setHiddenGenes([])
      appendDebugEvent('Transcripts: all genes shown')
    }
  }, [appendDebugEvent, bySet, setHiddenGeneSets, setHiddenGenes])

  return {
    model: {
      active,
      bySet,
      note: !overlayShown
        ? null
        : !pointsShown && !markersShown
          ? 'Gene colours show when transcripts are drawn as points, or as density with Density color set to Gene markers.'
          : colorMode === 'quality' && !markersShown
            ? 'Points are coloured by quality. Set Point color to Feature or Gene set to list the genes.'
            : bySet && geneSets.length === 0
              ? NO_SET_NOTE
              : null,
      items: legend.items,
      moreCount: legend.moreCount,
      hiddenCount,
      countTitle: markersShown
        ? 'Transcripts in view, from the gene marker bins'
        : 'Points loaded in view',
      onColorChange,
      onVisibilityChange,
      onShowAll,
    },
    legend: active && legend.items.length > 0 ? legend : null,
    featureColor,
    // Genes are hidden only while transcripts are coloured by gene or gene
    // set, where the list and Show All are; QV colours show every point.
    hiddenGenes:
      grouping !== null
        ? genesHiddenBySet
        : colorMode === 'feature' || markersShown
          ? hiddenSet
          : NO_HIDDEN_GENES,
    featureGroup: grouping?.groupOf,
    markersShown,
  }
}
