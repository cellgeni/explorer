import { useEffect } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import { formatShareableState, type ShareableViewState } from '../../data/shareableState'

interface ShareableDatasetHashOptions {
  readonly annotationUrl: string
  readonly customImageOpacities: readonly number[] | undefined
  readonly customImageUrls: readonly string[]
  readonly datasetUrl: string
}

interface ShareableViewHashOptions {
  readonly activeControlHudTab: string
  readonly activeRoiSelection: RoiSelection | null
  readonly shareableViewState: ShareableViewState | undefined
}

interface ShareableLayerHashOptions {
  readonly boundaryCellLimit: number
  readonly coordinateUnit: string
  readonly imageOpacity: number
  readonly cellFillOpacity: number
  readonly showCellBoundaries: boolean
  readonly showNucleusBoundaries: boolean
  readonly showHoverTooltips: boolean
  readonly cellBoundaryOpacity: number
  readonly morphologyEnabledChannelIds: readonly string[] | undefined
  readonly measurementUnit: string
  readonly observationColorMode: string
  readonly shouldLoadMorphology: boolean
}

interface ShareableGeneHashOptions {
  readonly geneExpressionColorScale: string
  readonly geneExpressionDetailMode: string
  readonly geneExpressionScoreMode: string
  readonly selectedGenes: readonly string[]
}

interface ShareableTranscriptHashOptions {
  readonly showTranscriptOverlay: boolean
  readonly transcriptDensityColorScale: string
  readonly transcriptDetailMode: string
  readonly transcriptExactPointLimit: number
  readonly transcriptFeatureFilterMode: string
  readonly transcriptGeneOnly: boolean
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: string
  readonly transcriptPointSize: number
}

interface ShareableMagicLensHashOptions {
  readonly magicLensActive: boolean
  readonly magicLensMinQv: number
  readonly magicLensRadiusMicrometers: number
  readonly magicLensScope: string
}

interface UseShareableUrlHashOptions {
  readonly dataset: ShareableDatasetHashOptions
  readonly view: ShareableViewHashOptions
  readonly layers: ShareableLayerHashOptions
  readonly genes: ShareableGeneHashOptions
  readonly transcripts: ShareableTranscriptHashOptions
  readonly magicLens: ShareableMagicLensHashOptions
}

export function useShareableUrlHash({
  dataset,
  genes,
  layers,
  magicLens,
  transcripts,
  view,
}: UseShareableUrlHashOptions): void {
  const { annotationUrl, customImageOpacities, customImageUrls, datasetUrl } = dataset
  const { activeControlHudTab, activeRoiSelection, shareableViewState } = view
  const {
    boundaryCellLimit,
    cellBoundaryOpacity,
    cellFillOpacity,
    coordinateUnit,
    imageOpacity,
    measurementUnit,
    morphologyEnabledChannelIds,
    observationColorMode,
    shouldLoadMorphology,
    showCellBoundaries,
    showNucleusBoundaries,
    showHoverTooltips,
  } = layers
  const {
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    selectedGenes,
  } = genes
  const {
    showTranscriptOverlay,
    transcriptDensityColorScale,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
  } = transcripts
  const { magicLensActive, magicLensMinQv, magicLensRadiusMicrometers, magicLensScope } =
    magicLens
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const timeout = window.setTimeout(() => {
      const hash = formatShareableState({
        datasetUrl,
        annotationUrl,
        customImageUrls,
        ...(customImageOpacities === undefined ? {} : { customImageOpacities }),
        selectedGenes,
        ...(shareableViewState === undefined ? {} : { viewState: shareableViewState }),
        ...(activeRoiSelection === null ? {} : { roiSelection: activeRoiSelection }),
        activeTab: activeControlHudTab,
        geneExpressionColorScale,
        geneExpressionScoreMode,
        geneExpressionDetailMode,
        observationColorMode,
        coordinateUnit,
        measurementUnit,
        shouldLoadMorphology,
        boundaryCellLimit,
        imageOpacity,
        cellFillOpacity,
        showCellBoundaries,
        showNucleusBoundaries,
        showHoverTooltips,
        cellBoundaryOpacity,
        ...(morphologyEnabledChannelIds === undefined
          ? {}
          : { morphologyEnabledChannelIds }),
        transcriptOverlay: showTranscriptOverlay,
        transcriptDetailMode,
        transcriptDensityColorScale,
        transcriptPointColorMode,
        transcriptExactPointLimit,
        transcriptMinQv,
        transcriptGeneOnly,
        transcriptFeatureFilterMode,
        transcriptOpacity,
        transcriptPointSize,
        magicLensScope,
        magicLensActive,
        magicLensRadiusMicrometers,
        magicLensMinQv,
      })

      if (window.location.hash !== hash) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${hash}`,
        )
      }
    }, 160)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeControlHudTab,
    activeRoiSelection,
    annotationUrl,
    boundaryCellLimit,
    coordinateUnit,
    customImageOpacities,
    customImageUrls,
    datasetUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    imageOpacity,
    cellFillOpacity,
    showCellBoundaries,
    showNucleusBoundaries,
    showHoverTooltips,
    cellBoundaryOpacity,
    morphologyEnabledChannelIds,
    magicLensActive,
    magicLensMinQv,
    magicLensRadiusMicrometers,
    magicLensScope,
    measurementUnit,
    observationColorMode,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    transcriptDensityColorScale,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptFeatureFilterMode,
    transcriptGeneOnly,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
  ])
}
