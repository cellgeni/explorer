import { useCallback, useEffect, useRef } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import {
  formatShareableState,
  type ShareableState,
  type ShareableViewState,
} from '../../data/shareableState'
import { readShareableStateFromLocation } from './appShellModel'
import { withoutShareableDefaults } from './shareableDefaults'

interface ShareableDatasetHashOptions {
  readonly annotationUrl: string
  readonly annotationGroupIds?: readonly string[] | undefined
  // Hidden annotation classes (hiddenClasses=).
  readonly hiddenAnnotationIds?: readonly string[] | undefined
  // Hidden annotation sets (hiddenSets=).
  readonly hiddenAnnotationSetIds?: readonly string[] | undefined
  readonly customImageOpacities: readonly number[] | undefined
  readonly customImageUrls: readonly string[]
  // The open dataset collection (collection=), if any.
  readonly collectionUrl?: string | undefined
  // How its bar shows the datasets, when not in a row (collectionView=).
  readonly collectionView?: string | undefined
  // Its registered sections shown beside the dataset (compare=).
  readonly compareUrls?: readonly string[] | undefined
  readonly datasetUrl: string
  // The loaded dataset's manifest defaults (15.1-L).
  readonly datasetDefaults?: ShareableState | undefined
  readonly spatialDataSelection?: {
    readonly spatialDataTable?: string
    readonly spatialDataCoordinateSystem?: string
    readonly spatialDataImage?: string
    readonly spatialDataMicrometersPerUnit?: number
  }
  readonly visiumSelection?: {
    readonly visiumImage?: string
    readonly visiumLibrary?: string
    readonly visiumOffTissue?: boolean
  }
  readonly merscopeSelection?: {
    readonly merscopeImage?: string
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
  readonly cellPointScale: number
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
  readonly geneExpressionScaleRange: string | undefined
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

// The query string without collection=: once the hash is written it names the
// collection, or leaves it out after the collection is closed, and a query
// string copy would bring a closed collection back on reload.
function searchWithoutCollection(search: string): string {
  const params = new URLSearchParams(search)

  if (!params.has('collection')) return search

  params.delete('collection')
  const rest = params.toString()
  return rest === '' ? '' : `?${rest}`
}

// Writes the view to the address (15.1-L). Opening another dataset adds a
// history entry, so Back returns to the previous dataset or to the start
// screen (15.3-C); every other change replaces the current entry. The write
// waits 160 ms for changes to settle; the returned function gives the link
// for the current state at once, for Copy Link.
export function useShareableUrlHash({
  dataset,
  genes,
  layers,
  magicLens,
  transcripts,
  view,
  onHistoryDatasetChange = reloadPage,
}: UseShareableUrlHashOptions): () => string {
  const {
    annotationGroupIds,
    annotationUrl,
    collectionUrl,
    collectionView,
    customImageOpacities,
    customImageUrls,
    datasetDefaults,
    datasetUrl,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
  } = dataset
  // As a string, so a new array with the same URLs writes nothing.
  const compareKey = dataset.compareUrls?.join('\n') ?? ''
  const spatialDataTable = dataset.spatialDataSelection?.spatialDataTable
  const spatialDataCoordinateSystem =
    dataset.spatialDataSelection?.spatialDataCoordinateSystem
  const spatialDataImage = dataset.spatialDataSelection?.spatialDataImage
  const spatialDataMicrometersPerUnit =
    dataset.spatialDataSelection?.spatialDataMicrometersPerUnit
  const visiumImage = dataset.visiumSelection?.visiumImage
  const visiumLibrary = dataset.visiumSelection?.visiumLibrary
  const visiumOffTissue = dataset.visiumSelection?.visiumOffTissue
  const merscopeImage = dataset.merscopeSelection?.merscopeImage
  const { activeRoiSelection, card, hiddenLayers, panels, shareableViewState, tool } =
    view
  const {
    boundaryCellLimit,
    cellMetadataTrackId,
    cellBoundaryOpacity,
    cellFillOpacity,
    cellPointScale,
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
    geneExpressionScaleRange,
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
  const { magicLensRadiusMicrometers, magicLensScope } = magicLens
  const datasetUrlRef = useRef(datasetUrl)
  // Set once Back or Forward is reloading the page, so no write lands on the
  // entry it moved to.
  const leavingRef = useRef(false)
  // The hash for the current state, ahead of the address.
  const hashRef = useRef<string | null>(null)

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

    const hash = formatShareableState(
      withoutShareableDefaults(
        {
          ...(collectionUrl === undefined ? {} : { collectionUrl }),
          ...(collectionView === undefined ? {} : { collectionView }),
          ...(compareKey === '' ? {} : { compareUrls: compareKey.split('\n') }),
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
          ...(hiddenAnnotationIds === undefined ? {} : { hiddenAnnotationIds }),
          ...(hiddenAnnotationSetIds === undefined ? {} : { hiddenAnnotationSetIds }),
          geneExpressionColorScale,
          ...(geneExpressionScaleRange === undefined ? {} : { geneExpressionScaleRange }),
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
          cellPointScale,
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
          ...(spatialDataTable === undefined ? {} : { spatialDataTable }),
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
          ...(merscopeImage === undefined ? {} : { merscopeImage }),
        },
        datasetDefaults,
      ),
    )
    hashRef.current = hash

    const timeout = window.setTimeout(() => {
      if (leavingRef.current) return

      if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${searchWithoutCollection(window.location.search)}${hash}`
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
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    hiddenLayers,
    panels,
    tool,
    annotationUrl,
    collectionUrl,
    collectionView,
    compareKey,
    boundaryCellLimit,
    cellMetadataTrackId,
    coordinateUnit,
    customImageOpacities,
    customImageUrls,
    datasetDefaults,
    datasetUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScaleRange,
    geneExpressionScoreMode,
    imageOpacity,
    cellFillOpacity,
    cellPointScale,
    showCellBoundaries,
    showNucleusBoundaries,
    showHoverTooltips,
    cellBoundaryOpacity,
    morphologyEnabledChannelIds,
    morphologyZPlane,
    magicLensRadiusMicrometers,
    magicLensScope,
    measurementUnit,
    observationColorMode,
    selectedGenes,
    shareableViewState,
    shouldLoadMorphology,
    showTranscriptOverlay,
    spatialDataTable,
    spatialDataCoordinateSystem,
    spatialDataImage,
    spatialDataMicrometersPerUnit,
    visiumImage,
    visiumLibrary,
    visiumOffTissue,
    merscopeImage,
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

  return useCallback(() => {
    const { origin, pathname, search, href } = window.location
    return hashRef.current === null
      ? href
      : `${origin}${pathname}${searchWithoutCollection(search)}${hashRef.current}`
  }, [])
}
