import { useCallback, useEffect, useRef } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import {
  formatShareableState,
  parseShareableState,
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
  // An image's imported segmentation, when it was opened from a URL.
  readonly segmentation?:
    | {
        readonly url: string
        readonly format?: string | undefined
        readonly units?: string | undefined
      }
    | undefined
  // The open dataset collection (collection=), if any.
  readonly collectionUrl?: string | undefined
  // How its bar shows the datasets, when not in a row (collectionView=).
  readonly collectionView?: string | undefined
  // The width of each preview in its grid, when not the default
  // (collectionPreviewSize=).
  readonly collectionPreviewSize?: number | undefined
  // Its registered sections shown beside the dataset (compare=).
  readonly compareUrls?: readonly string[] | undefined
  // `3d` while its serial sections are stacked in 3D (sectionView=).
  readonly sectionView?: string | undefined
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
  readonly ateraSelection?: {
    readonly ateraImage?: string
  }
}

interface ShareableViewHashOptions {
  readonly activeRoiSelection: RoiSelection | null
  readonly shareableViewState: ShareableViewState | undefined
  readonly panels: readonly string[] | undefined
  readonly card: string | undefined
  readonly tool: string
  readonly hiddenLayers: readonly string[]
  // The Plots panel's plot (plot=).
  readonly plot: string
  // The Cell Query window's conditions (query=), if any.
  readonly query?: string | undefined
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
  readonly showMinimap: boolean
  readonly showAxes: boolean
  readonly showLegend: boolean
  readonly showNavigation: boolean
  readonly showScaleBar: boolean
  readonly cellBoundaryOpacity: number
  readonly morphologyEnabledChannelIds: readonly string[] | undefined
  readonly morphologyZPlane: number | undefined
  readonly imageView: string | undefined
  readonly cellView: string | undefined
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
  // The saved gene sets (geneSets=), if any.
  readonly geneSets?: string | undefined
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

// The query string without the link's values: once the hash is written it is
// the whole link (readShareableStateFromLocation), so a copy in the query
// string could only show values the view no longer has, such as a closed
// collection or compare panel. A key is the link's when it alone parses to
// some state; others, such as debug=, stay.
function searchWithoutLinkState(search: string): string {
  const kept = new URLSearchParams()
  let dropped = false

  for (const [key, value] of new URLSearchParams(search)) {
    const entry = new URLSearchParams([[key, value]]).toString()

    if (Object.keys(parseShareableState(entry)).length === 0) {
      kept.append(key, value)
    } else {
      dropped = true
    }
  }

  if (!dropped) return search

  const rest = kept.toString()
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
    collectionPreviewSize,
    collectionUrl,
    collectionView,
    customImageOpacities,
    customImageUrls,
    datasetDefaults,
    datasetUrl,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    sectionView,
  } = dataset
  const segmentationUrl = dataset.segmentation?.url
  const segmentationFormat = dataset.segmentation?.format
  const segmentationUnits = dataset.segmentation?.units
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
  const ateraImage = dataset.ateraSelection?.ateraImage
  const {
    activeRoiSelection,
    card,
    hiddenLayers,
    panels,
    plot,
    query,
    shareableViewState,
    tool,
  } = view
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
    imageView,
    cellView,
    observationColorMode,
    shouldLoadMorphology,
    showCellBoundaries,
    showNucleusBoundaries,
    showHoverTooltips,
    showMinimap,
    showAxes,
    showLegend,
    showNavigation,
    showScaleBar,
  } = layers
  const {
    geneExpressionColorScale,
    geneExpressionScaleRange,
    geneExpressionDetailMode,
    geneExpressionScoreMode,
    geneSets,
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
          ...(collectionPreviewSize === undefined ? {} : { collectionPreviewSize }),
          ...(compareKey === '' ? {} : { compareUrls: compareKey.split('\n') }),
          ...(sectionView === undefined ? {} : { sectionView }),
          datasetUrl,
          annotationUrl,
          ...(annotationGroupIds === undefined ? {} : { annotationGroupIds }),
          customImageUrls,
          ...(customImageOpacities === undefined ? {} : { customImageOpacities }),
          ...(segmentationUrl === undefined
            ? {}
            : {
                segmentationUrl,
                ...(segmentationFormat === undefined ? {} : { segmentationFormat }),
                ...(segmentationUnits === undefined ? {} : { segmentationUnits }),
              }),
          selectedGenes,
          ...(geneSets === undefined ? {} : { geneSets }),
          ...(shareableViewState === undefined ? {} : { viewState: shareableViewState }),
          ...(activeRoiSelection === null ? {} : { roiSelection: activeRoiSelection }),
          ...(panels === undefined ? {} : { panels }),
          ...(card === undefined ? {} : { card }),
          tool,
          plot,
          ...(query === undefined ? {} : { query }),
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
          showMinimap,
          showAxes,
          showLegend,
          showNavigation,
          showScaleBar,
          cellBoundaryOpacity,
          ...(morphologyEnabledChannelIds === undefined
            ? {}
            : { morphologyEnabledChannelIds }),
          ...(morphologyZPlane === undefined ? {} : { morphologyZPlane }),
          ...(imageView === undefined ? {} : { imageView }),
          ...(cellView === undefined ? {} : { cellView }),
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
          ...(ateraImage === undefined ? {} : { ateraImage }),
        },
        datasetDefaults,
      ),
    )
    hashRef.current = hash

    const timeout = window.setTimeout(() => {
      if (leavingRef.current) return

      if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${searchWithoutLinkState(window.location.search)}${hash}`
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
    plot,
    query,
    tool,
    annotationUrl,
    collectionUrl,
    collectionView,
    collectionPreviewSize,
    compareKey,
    sectionView,
    boundaryCellLimit,
    cellMetadataTrackId,
    coordinateUnit,
    customImageOpacities,
    customImageUrls,
    datasetDefaults,
    datasetUrl,
    segmentationFormat,
    segmentationUnits,
    segmentationUrl,
    geneExpressionColorScale,
    geneExpressionDetailMode,
    geneExpressionScaleRange,
    geneExpressionScoreMode,
    geneSets,
    imageOpacity,
    cellFillOpacity,
    cellPointScale,
    showCellBoundaries,
    showNucleusBoundaries,
    showHoverTooltips,
    showMinimap,
    showAxes,
    showLegend,
    showNavigation,
    showScaleBar,
    cellBoundaryOpacity,
    morphologyEnabledChannelIds,
    morphologyZPlane,
    imageView,
    cellView,
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
    ateraImage,
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
      : `${origin}${pathname}${searchWithoutLinkState(search)}${hashRef.current}`
  }, [])
}
