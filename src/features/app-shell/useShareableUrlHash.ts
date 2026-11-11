import { useEffect, useRef } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import { formatShareableState, type ShareableViewState } from '../../data/shareableState'
import { readShareableStateFromLocation } from './appShellModel'
import { withoutShareableDefaults } from './shareableDefaults'

interface ShareableDatasetHashOptions {
  readonly annotationUrl: string
  readonly annotationGroupIds?: readonly string[] | undefined
  readonly customImageOpacities: readonly number[] | undefined
  readonly customImageUrls: readonly string[]
  readonly datasetUrl: string
  readonly spatialDataSelection?: {
    readonly spatialDataCoordinateSystem?: string
    readonly spatialDataImage?: string
    readonly spatialDataMicrometersPerUnit?: number
  }
  readonly visiumSelection?: {
    readonly visiumImage?: string
    readonly visiumLibrary?: string
    readonly visiumOffTissue?: boolean
  }
}

interface ShareableViewHashOptions {
  readonly activeRoiSelection: RoiSelection | null
  readonly shareableViewState: ShareableViewState | undefined
  readonly panels: readonly string[] | undefined
  readonly card: string | undefined
  readonly tool: string
  readonly hiddenLayers: readonly string[]
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
  readonly morphologyZPlane: number | undefined
  readonly measurementUnit: string
  readonly observationColorMode: string
  readonly cellMetadataTrackId: string | null
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
  // Back or Forward reached an entry for another dataset. Reloading opens
  // that entry's link, with its view and settings.
  readonly onHistoryDatasetChange?: () => void
}

function reloadPage(): void {
  window.location.reload()
}

// The dataset the address names: the hash's, or else the query string's.
function linkedDatasetUrl(): string {
  return readShareableStateFromLocation().datasetUrl?.trim() ?? ''
}

// Writes the view to the address (15.1-L). Opening another dataset adds a
// history entry, so Back returns to the previous dataset or to the start
// screen (15.3-C); every other change replaces the current entry.
export function useShareableUrlHash({
  dataset,
  genes,
  layers,
  magicLens,
  transcripts,
  view,
  onHistoryDatasetChange = reloadPage,
}: UseShareableUrlHashOptions): void {
  const {
    annotationGroupIds,
    annotationUrl,
    customImageOpacities,
    customImageUrls,
    datasetUrl,
  } = dataset
  const spatialDataCoordinateSystem =
    dataset.spatialDataSelection?.spatialDataCoordinateSystem
  const spatialDataImage = dataset.spatialDataSelection?.spatialDataImage
  const spatialDataMicrometersPerUnit =
    dataset.spatialDataSelection?.spatialDataMicrometersPerUnit
  const visiumImage = dataset.visiumSelection?.visiumImage
  const visiumLibrary = dataset.visiumSelection?.visiumLibrary
  const visiumOffTissue = dataset.visiumSelection?.visiumOffTissue
  const { activeRoiSelection, card, hiddenLayers, panels, shareableViewState, tool } =
    view
  const {
    boundaryCellLimit,
    cellMetadataTrackId,
    cellBoundaryOpacity,
    cellFillOpacity,
    coordinateUnit,
    imageOpacity,
    measurementUnit,
    morphologyEnabledChannelIds,
    morphologyZPlane,
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
  const { magicLensMinQv, magicLensRadiusMicrometers, magicLensScope } = magicLens
  const datasetUrlRef = useRef(datasetUrl)
  // Set once Back or Forward is reloading the page, so no write lands on the
  // entry it moved to.
  const leavingRef = useRef(false)

  useEffect(() => {
    datasetUrlRef.current = datasetUrl
  }, [datasetUrl])

  useEffect(() => {
    function handlePopState() {
      if (linkedDatasetUrl() === datasetUrlRef.current.trim()) return
      leavingRef.current = true
      onHistoryDatasetChange()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [onHistoryDatasetChange])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const timeout = window.setTimeout(() => {
      if (leavingRef.current) return

      const hash = formatShareableState(
        withoutShareableDefaults({
          datasetUrl,
          annotationUrl,
          ...(annotationGroupIds === undefined ? {} : { annotationGroupIds }),
          customImageUrls,
          ...(customImageOpacities === undefined ? {} : { customImageOpacities }),
          selectedGenes,
          ...(shareableViewState === undefined ? {} : { viewState: shareableViewState }),
          ...(activeRoiSelection === null ? {} : { roiSelection: activeRoiSelection }),
          ...(panels === undefined ? {} : { panels }),
          ...(card === undefined ? {} : { card }),
          tool,
          hiddenLayers,
          geneExpressionColorScale,
          geneExpressionScoreMode,
          geneExpressionDetailMode,
          observationColorMode,
          ...(cellMetadataTrackId === null ? {} : { cellMetadataTrackId }),
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
          ...(morphologyZPlane === undefined ? {} : { morphologyZPlane }),
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
          magicLensRadiusMicrometers,
          magicLensMinQv,
          ...(spatialDataCoordinateSystem === undefined
            ? {}
            : { spatialDataCoordinateSystem }),
          ...(spatialDataImage === undefined ? {} : { spatialDataImage }),
          ...(spatialDataMicrometersPerUnit === undefined
            ? {}
            : { spatialDataMicrometersPerUnit }),
          ...(visiumImage === undefined ? {} : { visiumImage }),
          ...(visiumLibrary === undefined ? {} : { visiumLibrary }),
          ...(visiumOffTissue === undefined ? {} : { visiumOffTissue }),
        }),
      )

      if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${window.location.search}${hash}`
        const nextDatasetUrl = datasetUrl.trim()

        if (nextDatasetUrl !== '' && nextDatasetUrl !== linkedDatasetUrl()) {
          window.history.pushState(null, '', url)
        } else {
          window.history.replaceState(null, '', url)
        }
      }
    }, 160)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeRoiSelection,
    annotationGroupIds,
    card,
    hiddenLayers,
    panels,
    tool,
    annotationUrl,
    boundaryCellLimit,
    cellMetadataTrackId,
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
    morphologyZPlane,
    magicLensMinQv,
    magicLensRadiusMicrometers,
    magicLensScope,
    measurementUnit,
    observationColorMode,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    spatialDataCoordinateSystem,
    spatialDataImage,
    spatialDataMicrometersPerUnit,
    visiumImage,
    visiumLibrary,
    visiumOffTissue,
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
