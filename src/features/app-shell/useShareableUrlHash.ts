import { useEffect } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import { formatShareableState, type ShareableViewState } from '../../data/shareableState'

interface UseShareableUrlHashOptions {
  readonly activeControlHudTab: string
  readonly activeRoiSelection: RoiSelection | null
  readonly annotationUrl: string
  readonly boundaryCellLimit: number
  readonly coordinateUnit: string
  readonly customImageUrls: readonly string[]
  readonly datasetUrl: string
  readonly geneExpressionColorScale: string
  readonly geneExpressionDetailMode: string
  readonly geneExpressionScoreMode: string
  readonly imageOpacity: number
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly morphologyEnabledChannelIds: readonly string[] | undefined
  readonly magicLensActive: boolean
  readonly magicLensMinQv: number
  readonly magicLensRadiusMicrometers: number
  readonly magicLensScope: string
  readonly measurementUnit: string
  readonly observationColorMode: string
  readonly selectedGenes: readonly string[]
  readonly shareableViewState: ShareableViewState | undefined
  readonly shouldLoadMorphology: boolean
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

export function useShareableUrlHash({
  activeControlHudTab,
  activeRoiSelection,
  annotationUrl,
  boundaryCellLimit,
  coordinateUnit,
  customImageUrls,
  datasetUrl,
  geneExpressionColorScale,
  geneExpressionDetailMode,
  geneExpressionScoreMode,
  imageOpacity,
  cellFillOpacity,
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
}: UseShareableUrlHashOptions): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const timeout = window.setTimeout(() => {
      const hash = formatShareableState({
        datasetUrl,
        annotationUrl,
        customImageUrls,
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
    customImageUrls,
    datasetUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    imageOpacity,
    cellFillOpacity,
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
