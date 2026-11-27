import { micrometers, type BBox, type DataPoint } from './coords'
import type { RoiSelection } from './roiSelection'

// Version 2 (15.1-L) leaves default values out, so a missing field means its
// default; version 1 wrote every field. The parser reads both.
const HASH_VERSION = '2'

// A panel beside the main view (`compareLink=`): `1` linked to it, `0` with
// a view of its own, each followed by x, y and zoom when set: a linked
// panel's offset from the main view, an unlinked one's view (else fitted).
export interface ShareablePanelLink {
  readonly linked: boolean
  readonly values?: readonly [number, number, number]
}

export type ShareablePanelImage = 'cells' | 'only' | null

export interface ShareableViewState {
  readonly target: readonly [number, number, number]
  readonly zoom: number
}

export interface ShareableState {
  // The link's xv; links without one are version 1.
  readonly linkVersion?: number
  // The dataset collection the dataset was opened from: `collection=`.
  readonly collectionUrl?: string
  // How the collection bar shows its datasets when not in a row:
  // `collectionView=grid` (expanded) or `names` (previews off).
  readonly collectionView?: string
  // The width of each preview in its grid, in CSS px:
  // `collectionPreviewSize=`.
  readonly collectionPreviewSize?: number
  // Sections of the collection shown beside the dataset, one `compare=`
  // each.
  readonly compareUrls?: readonly string[]
  // How each of them follows the main view, in their order: one
  // `compareLink=` each, null where it is not understood. Absent, each opens
  // as it does by default.
  readonly compareLinks?: readonly (ShareablePanelLink | null)[]
  // What each of them shows of its image, in their order (`compareImage=`):
  // `1` the image under its cells, `only` the image alone, empty neither.
  readonly compareImages?: readonly ShareablePanelImage[]
  // Each one's shown channels (`compareChannels=`), as `channels=` gives the
  // main view's: `-` for none, empty (null) for the image's defaults.
  readonly compareChannels?: readonly (readonly string[] | null)[]
  // Whether each draws its cell boundaries (`compareBoundaries=`): `1` for
  // yes, empty for no.
  readonly compareBoundaries?: readonly boolean[]
  // `3d` when the collection's serial sections are stacked in 3D:
  // `sectionView=`.
  readonly sectionView?: string
  readonly datasetUrl?: string
  // The reader chosen for the dataset in place of detection, such as `h5ad`:
  // `reader=`, written only with `dataset=`.
  readonly datasetReader?: string
  readonly annotationUrl?: string
  // Annotation sets loaded from the dataset itself, such as graphclust.
  readonly annotationGroupIds?: readonly string[]
  // Empty (`customImageUrl=` alone) when the user removed the custom image
  // layers the dataset's manifest opens.
  readonly customImageUrls?: readonly string[]
  readonly customImageOpacities?: readonly number[]
  // A segmentation imported onto an image (plan 25): `segmentation=` its URL,
  // `segmentationFormat=` when the name does not tell it, and
  // `segmentationUnits=micrometers` for polygons in micrometres.
  readonly segmentationUrl?: string
  readonly segmentationFormat?: string
  readonly segmentationUnits?: string
  readonly selectedGenes?: readonly string[]
  // The gene picker's saved gene sets: `geneSets=`, in the form
  // `formatGeneSetsLink` writes.
  readonly geneSets?: string
  readonly viewState?: ShareableViewState
  readonly roiSelection?: RoiSelection
  // An old link's control tab, which the shell maps onto panels, card and
  // tool (plan 15.2-H).
  readonly activeTab?: string
  // Open layer sections, the info drawer and the Embedding panel: `panel=`.
  readonly panels?: readonly string[]
  // A card to restore, such as `cell:<id>`: `card=`.
  readonly card?: string
  // The active tool when it is not Pan: `tool=`.
  readonly tool?: string
  // The Plots panel's plot when it is not the dot plot: `plot=` (plan
  // 22-D8).
  readonly plot?: string
  // The Cell Query window's conditions: `query=` (plan 23-D9), in the form
  // `formatCellQueryLink` writes.
  readonly query?: string
  // Hidden layers (image, cells, annotations): `hidden=`.
  readonly hiddenLayers?: readonly string[]
  // Hidden annotation classes, such as `analysis:leiden:3`: `hiddenClasses=`,
  // comma-separated, with `%` and `,` in an ID written as `%25` and `%2C`.
  readonly hiddenAnnotationIds?: readonly string[]
  // For a set with more classes hidden than shown, the shown ones instead:
  // `shownClasses=`, written as `hiddenClasses=` is. The set's other classes
  // are hidden.
  readonly shownAnnotationIds?: readonly string[]
  // Hidden annotation sets, such as `analysis:leiden` (the set's eye):
  // `hiddenSets=`, written as `hiddenClasses=` is.
  readonly hiddenAnnotationSetIds?: readonly string[]
  readonly geneExpressionColorScale?: string
  // The Gene scale's range when set: `geneRange=min,max`, an end empty for
  // Auto.
  readonly geneExpressionScaleRange?: string
  readonly geneExpressionScoreMode?: string
  readonly geneExpressionDetailMode?: string
  readonly observationColorMode?: string
  readonly cellMetadataTrackId?: string
  readonly coordinateUnit?: string
  readonly measurementUnit?: string
  readonly shouldLoadMorphology?: boolean
  readonly boundaryCellLimit?: number
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  // Multiplier on the size cells are drawn at when shown as points.
  readonly cellPointScale?: number
  readonly showCellBoundaries?: boolean
  readonly showNucleusBoundaries?: boolean
  readonly showHoverTooltips?: boolean
  // Settings › Show minimap, Show axes, Show legend, Show navigation buttons
  // and Show scale bar.
  readonly showMinimap?: boolean
  readonly showAxes?: boolean
  readonly showLegend?: boolean
  readonly showNavigation?: boolean
  readonly showScaleBar?: boolean
  readonly cellBoundaryOpacity?: number
  readonly morphologyEnabledChannelIds?: readonly string[]
  // Image channel colours changed from those the channels open with, by
  // channel ID: `channelColors=` as `id:rrggbb` entries.
  readonly morphologyChannelColors?: Readonly<
    Record<string, readonly [number, number, number]>
  >
  // Zero-based z plane of a z-stack dataset image.
  readonly morphologyZPlane?: number
  // Zero-based time point of a time series dataset image (plan 28): `t=`.
  readonly morphologyTimePoint?: number
  // `3d` when an OME-Zarr z-stack is shown in the 3D view: `imageView=`.
  readonly imageView?: string
  // `3d` when cells placed in 3D (a third spatial coordinate) are shown in
  // the 3D view: `cellView=`.
  readonly cellView?: string
  readonly transcriptOverlay?: boolean
  readonly transcriptDetailMode?: string
  readonly transcriptMinQv?: number
  readonly transcriptGeneOnly?: boolean
  readonly transcriptFeatureFilterMode?: string
  readonly transcriptDensityColorScale?: string
  readonly transcriptPointColorMode?: string
  readonly transcriptExactPointLimit?: number
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
  readonly magicLensScope?: string
  readonly magicLensActive?: boolean
  readonly magicLensRadiusMicrometers?: number
  readonly spatialDataTable?: string
  readonly spatialDataCoordinateSystem?: string
  readonly spatialDataImage?: string
  readonly spatialDataMicrometersPerUnit?: number
  // Standard Visium: tissue image (`hires`, `lowres`, or `none`), library,
  // and whether spots off the tissue are shown.
  readonly visiumImage?: string
  readonly visiumLibrary?: string
  readonly visiumOffTissue?: boolean
  // MERSCOPE: the .vzg stain and z plane shown, as `<stain>_z<plane>`, or
  // `none`.
  readonly merscopeImage?: string
  // Atera: `3d` when the 3D DAPI stack is shown instead of the 2D image.
  readonly ateraImage?: string
}

type MutableShareableState = {
  -readonly [Key in keyof ShareableState]?: ShareableState[Key]
}

export function parseShareableState(hash: string): ShareableState {
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash

  if (rawHash.trim() === '') {
    return {}
  }

  const params = new URLSearchParams(rawHash)
  const state: MutableShareableState = {}
  const linkVersion = parsePositiveInteger(params.get('xv'))
  const collectionUrl = readString(params, 'collection')
  const collectionView = readString(params, 'collectionView')
  const collectionPreviewSize = parsePositiveInteger(params.get('collectionPreviewSize'))
  const compareUrls = readStrings(params, 'compare')
  const compareLinks = params.getAll('compareLink').map(parsePanelLink)
  const compareImages = params.getAll('compareImage').map(parsePanelImage)
  const compareChannels = params.getAll('compareChannels').map(parsePanelChannels)
  const compareBoundaries = params
    .getAll('compareBoundaries')
    .map((value) => value.trim() === '1')
  const sectionView = readString(params, 'sectionView')
  const datasetUrl = readString(params, 'dataset')
  const datasetReader = readString(params, 'reader')
  const annotationUrl = readString(params, 'annotationUrl')
  const annotationGroupIds = readEscapedCsv(params, 'groups')
  const customImageUrls = params.has('customImageUrl')
    ? (readStrings(params, 'customImageUrl') ?? [])
    : undefined
  const customImageOpacities = readUnitNumbers(params, 'customImageOpacity')
  const segmentationUrl = readString(params, 'segmentation')
  const segmentationFormat = readString(params, 'segmentationFormat')
  const segmentationUnits = readString(params, 'segmentationUnits')
  // An empty genes= clears a dataset manifest's genes.
  const selectedGenes = readCsvAllowEmpty(params, 'genes')?.map(unescapeCsvEntry)
  const geneSets = readString(params, 'geneSets')
  const viewState = parseViewState(params.get('view'))
  const roiSelection = parseRoiSelection(params.get('roi'))
  const activeTab = readString(params, 'tab')
  const panels = readCsvAllowEmpty(params, 'panel')?.map(unescapeCsvEntry)
  const card = readString(params, 'card')
  const tool = readString(params, 'tool')
  const plot = readString(params, 'plot')
  const query = readString(params, 'query')
  const hiddenLayers = readEscapedCsv(params, 'hidden')
  const hiddenAnnotationIds = readEscapedCsv(params, 'hiddenClasses')
  const shownAnnotationIds = readEscapedCsv(params, 'shownClasses')
  const hiddenAnnotationSetIds = readEscapedCsv(params, 'hiddenSets')
  const geneExpressionColorScale = readString(params, 'scale')
  const geneExpressionScaleRange = readString(params, 'geneRange')
  const geneExpressionScoreMode = readString(params, 'score')
  const geneExpressionDetailMode = readString(params, 'detail')
  const observationColorMode = readString(params, 'cellColor')
  const cellMetadataTrackId = readString(params, 'cellTrack')
  const coordinateUnit = readString(params, 'coord')
  const measurementUnit = readString(params, 'measureUnit')
  const shouldLoadMorphology = parseBoolean(params.get('morphology'))
  const boundaryCellLimit = parsePositiveInteger(params.get('boundaryLimit'))
  const imageOpacity = parseUnitNumber(params.get('imgOpacity'))
  const cellFillOpacity = parseUnitNumber(params.get('cellFill'))
  const cellPointScale = parsePositiveNumber(params.get('cellSize'))
  const showCellBoundaries = parseBoolean(params.get('cellBounds'))
  const showNucleusBoundaries = parseBoolean(params.get('nucleusBounds'))
  const showHoverTooltips = parseBoolean(params.get('hoverTips'))
  const showMinimap = parseBoolean(params.get('minimap'))
  const showAxes = parseBoolean(params.get('axes'))
  const showLegend = parseBoolean(params.get('legend'))
  const showNavigation = parseBoolean(params.get('navButtons'))
  const showScaleBar = parseBoolean(params.get('scaleBar'))
  const cellBoundaryOpacity = parseUnitNumber(params.get('cellBoundary'))
  const morphologyEnabledChannelIds = readCsvAllowEmpty(params, 'channels')?.map(
    unescapeCsvEntry,
  )
  const morphologyChannelColors = parseChannelColors(params.get('channelColors'))
  const morphologyZPlane = parseNonNegativeInteger(params.get('z'))
  const morphologyTimePoint = parseNonNegativeInteger(params.get('t'))
  const imageView = readString(params, 'imageView')
  const cellView = readString(params, 'cellView')
  const transcriptOverlay = parseBoolean(params.get('tx'))
  const transcriptDetailMode = readString(params, 'txDetail')
  const transcriptMinQv = parseNonNegativeInteger(params.get('txQv'))
  const transcriptGeneOnly = parseBoolean(params.get('txGene'))
  const transcriptFeatureFilterMode = readString(params, 'txFilter')
  const transcriptDensityColorScale = readString(params, 'txDensity')
  const transcriptPointColorMode = readString(params, 'txColor')
  const transcriptExactPointLimit = parsePositiveInteger(params.get('txBudget'))
  const transcriptOpacity = parseUnitNumber(params.get('txOpacity'))
  const transcriptPointSize = parsePositiveInteger(params.get('txSize'))
  const magicLensScope = readString(params, 'lensScope')
  const magicLensActive = parseBoolean(params.get('lens'))
  const magicLensRadiusMicrometers = parsePositiveInteger(params.get('lensRadius'))
  const spatialDataTable = readString(params, 'sdTable')
  const spatialDataCoordinateSystem = readString(params, 'sdCs')
  const spatialDataImage = readString(params, 'sdImage')
  const spatialDataMicrometersPerUnit = parsePositiveNumber(params.get('sdUm'))
  const visiumImage = readString(params, 'vimg')
  const merscopeImage = readString(params, 'mimg')
  const ateraImage = readString(params, 'aimg')
  const visiumLibrary = readString(params, 'vlib')
  const visiumOffTissue = parseBoolean(params.get('voff'))

  if (linkVersion !== undefined) {
    state.linkVersion = linkVersion
  }

  if (collectionUrl !== undefined) {
    state.collectionUrl = collectionUrl
  }

  if (collectionView !== undefined) {
    state.collectionView = collectionView
  }

  if (collectionPreviewSize !== undefined) {
    state.collectionPreviewSize = collectionPreviewSize
  }

  if (compareUrls !== undefined) {
    state.compareUrls = compareUrls
  }

  if (compareLinks.length > 0) {
    state.compareLinks = compareLinks
  }

  if (compareImages.length > 0) {
    state.compareImages = compareImages
  }

  if (compareChannels.length > 0) {
    state.compareChannels = compareChannels
  }

  if (compareBoundaries.some(Boolean)) {
    state.compareBoundaries = compareBoundaries
  }

  if (sectionView !== undefined) {
    state.sectionView = sectionView
  }

  if (datasetUrl !== undefined) {
    state.datasetUrl = datasetUrl
  }

  if (datasetReader !== undefined) {
    state.datasetReader = datasetReader
  }

  if (annotationGroupIds !== undefined) {
    state.annotationGroupIds = annotationGroupIds
  }

  if (annotationUrl !== undefined) {
    state.annotationUrl = annotationUrl
  }

  if (customImageUrls !== undefined) {
    state.customImageUrls = customImageUrls
  }

  if (customImageOpacities !== undefined) {
    state.customImageOpacities = customImageOpacities
  }

  if (segmentationUrl !== undefined) {
    state.segmentationUrl = segmentationUrl

    if (segmentationFormat !== undefined) {
      state.segmentationFormat = segmentationFormat
    }

    if (segmentationUnits !== undefined) {
      state.segmentationUnits = segmentationUnits
    }
  }

  if (selectedGenes !== undefined) {
    state.selectedGenes = selectedGenes
  }
  if (geneSets !== undefined) {
    state.geneSets = geneSets
  }

  if (viewState !== undefined) {
    state.viewState = viewState
  }

  if (roiSelection !== undefined) {
    state.roiSelection = roiSelection
  }

  if (activeTab !== undefined) {
    state.activeTab = activeTab
  }

  if (panels !== undefined) {
    state.panels = panels
  }

  if (card !== undefined) {
    state.card = card
  }

  if (tool !== undefined) {
    state.tool = tool
  }

  if (plot !== undefined) {
    state.plot = plot
  }

  if (query !== undefined) {
    state.query = query
  }

  if (hiddenLayers !== undefined) {
    state.hiddenLayers = hiddenLayers
  }

  if (hiddenAnnotationIds !== undefined) {
    state.hiddenAnnotationIds = hiddenAnnotationIds
  }

  if (shownAnnotationIds !== undefined) {
    state.shownAnnotationIds = shownAnnotationIds
  }

  if (hiddenAnnotationSetIds !== undefined) {
    state.hiddenAnnotationSetIds = hiddenAnnotationSetIds
  }

  if (geneExpressionColorScale !== undefined) {
    state.geneExpressionColorScale = geneExpressionColorScale
  }

  if (geneExpressionScaleRange !== undefined) {
    state.geneExpressionScaleRange = geneExpressionScaleRange
  }

  if (geneExpressionScoreMode !== undefined) {
    state.geneExpressionScoreMode = geneExpressionScoreMode
  }

  if (geneExpressionDetailMode !== undefined) {
    state.geneExpressionDetailMode = geneExpressionDetailMode
  }

  if (observationColorMode !== undefined) {
    state.observationColorMode = observationColorMode
  }

  if (cellMetadataTrackId !== undefined) {
    state.cellMetadataTrackId = cellMetadataTrackId
  }

  if (coordinateUnit !== undefined) {
    state.coordinateUnit = coordinateUnit
  }

  if (measurementUnit !== undefined) {
    state.measurementUnit = measurementUnit
  }

  if (shouldLoadMorphology !== undefined) {
    state.shouldLoadMorphology = shouldLoadMorphology
  }

  if (boundaryCellLimit !== undefined) {
    state.boundaryCellLimit = boundaryCellLimit
  }

  if (imageOpacity !== undefined) {
    state.imageOpacity = imageOpacity
  }

  if (cellFillOpacity !== undefined) {
    state.cellFillOpacity = cellFillOpacity
  }

  if (cellPointScale !== undefined) {
    state.cellPointScale = cellPointScale
  }

  if (showCellBoundaries !== undefined) {
    state.showCellBoundaries = showCellBoundaries
  }

  if (showNucleusBoundaries !== undefined) {
    state.showNucleusBoundaries = showNucleusBoundaries
  }

  if (showHoverTooltips !== undefined) {
    state.showHoverTooltips = showHoverTooltips
  }

  if (showMinimap !== undefined) {
    state.showMinimap = showMinimap
  }

  if (showAxes !== undefined) {
    state.showAxes = showAxes
  }

  if (showLegend !== undefined) {
    state.showLegend = showLegend
  }

  if (showNavigation !== undefined) {
    state.showNavigation = showNavigation
  }

  if (showScaleBar !== undefined) {
    state.showScaleBar = showScaleBar
  }

  if (cellBoundaryOpacity !== undefined) {
    state.cellBoundaryOpacity = cellBoundaryOpacity
  }

  if (morphologyEnabledChannelIds !== undefined) {
    state.morphologyEnabledChannelIds = morphologyEnabledChannelIds
  }

  if (morphologyChannelColors !== undefined) {
    state.morphologyChannelColors = morphologyChannelColors
  }

  if (morphologyZPlane !== undefined) {
    state.morphologyZPlane = morphologyZPlane
  }

  if (morphologyTimePoint !== undefined) {
    state.morphologyTimePoint = morphologyTimePoint
  }

  if (imageView !== undefined) {
    state.imageView = imageView
  }

  if (cellView !== undefined) {
    state.cellView = cellView
  }

  if (transcriptOverlay !== undefined) {
    state.transcriptOverlay = transcriptOverlay
  }

  if (transcriptDetailMode !== undefined) {
    state.transcriptDetailMode = transcriptDetailMode
  }

  if (transcriptMinQv !== undefined) {
    state.transcriptMinQv = transcriptMinQv
  }

  if (transcriptGeneOnly !== undefined) {
    state.transcriptGeneOnly = transcriptGeneOnly
  }

  if (transcriptFeatureFilterMode !== undefined) {
    state.transcriptFeatureFilterMode = transcriptFeatureFilterMode
  }

  if (transcriptDensityColorScale !== undefined) {
    state.transcriptDensityColorScale = transcriptDensityColorScale
  }

  if (transcriptPointColorMode !== undefined) {
    state.transcriptPointColorMode = transcriptPointColorMode
  }

  if (transcriptExactPointLimit !== undefined) {
    state.transcriptExactPointLimit = transcriptExactPointLimit
  }

  if (transcriptOpacity !== undefined) {
    state.transcriptOpacity = transcriptOpacity
  }

  if (transcriptPointSize !== undefined) {
    state.transcriptPointSize = transcriptPointSize
  }

  if (magicLensScope !== undefined) {
    state.magicLensScope = magicLensScope
  }

  if (magicLensActive !== undefined) {
    state.magicLensActive = magicLensActive
  }

  if (magicLensRadiusMicrometers !== undefined) {
    state.magicLensRadiusMicrometers = magicLensRadiusMicrometers
  }

  if (spatialDataTable !== undefined) {
    state.spatialDataTable = spatialDataTable
  }

  if (spatialDataCoordinateSystem !== undefined) {
    state.spatialDataCoordinateSystem = spatialDataCoordinateSystem
  }

  if (spatialDataImage !== undefined) {
    state.spatialDataImage = spatialDataImage
  }

  if (spatialDataMicrometersPerUnit !== undefined) {
    state.spatialDataMicrometersPerUnit = spatialDataMicrometersPerUnit
  }

  if (visiumImage !== undefined) {
    state.visiumImage = visiumImage
  }

  if (merscopeImage !== undefined) {
    state.merscopeImage = merscopeImage
  }

  if (ateraImage !== undefined) {
    state.ateraImage = ateraImage
  }

  if (visiumLibrary !== undefined) {
    state.visiumLibrary = visiumLibrary
  }

  if (visiumOffTissue !== undefined) {
    state.visiumOffTissue = visiumOffTissue
  }

  return state
}

export function formatShareableState(state: ShareableState): string {
  const params = new URLSearchParams()

  params.set('xv', HASH_VERSION)

  if (state.collectionUrl !== undefined && state.collectionUrl.trim() !== '') {
    params.set('collection', state.collectionUrl.trim())
  }

  setOptionalString(params, 'collectionView', state.collectionView)

  if (
    state.collectionPreviewSize !== undefined &&
    Number.isFinite(state.collectionPreviewSize)
  ) {
    params.set(
      'collectionPreviewSize',
      Math.max(1, Math.floor(state.collectionPreviewSize)).toString(),
    )
  }

  if (state.compareUrls !== undefined) {
    for (const compareUrl of state.compareUrls) {
      setOptionalString(params, 'compare', compareUrl, 'append')
    }
  }

  if (state.compareLinks !== undefined) {
    for (const compareLink of state.compareLinks) {
      params.append(
        'compareLink',
        compareLink === null ? '' : formatPanelLink(compareLink),
      )
    }
  }

  if (state.compareImages !== undefined) {
    for (const compareImage of state.compareImages) {
      params.append(
        'compareImage',
        compareImage === 'cells' ? '1' : compareImage === 'only' ? 'only' : '',
      )
    }
  }

  if (state.compareChannels !== undefined) {
    for (const channels of state.compareChannels) {
      params.append(
        'compareChannels',
        channels === null
          ? ''
          : channels.length === 0
            ? '-'
            : channels.map(escapeCsvEntry).join(','),
      )
    }
  }

  if (state.compareBoundaries?.some(Boolean) === true) {
    for (const boundaries of state.compareBoundaries) {
      params.append('compareBoundaries', boundaries ? '1' : '')
    }
  }

  setOptionalString(params, 'sectionView', state.sectionView)

  if (state.datasetUrl !== undefined && state.datasetUrl.trim() !== '') {
    params.set('dataset', state.datasetUrl.trim())
    setOptionalString(params, 'reader', state.datasetReader)
  }

  setOptionalString(params, 'annotationUrl', state.annotationUrl)

  if (state.annotationGroupIds !== undefined && state.annotationGroupIds.length > 0) {
    params.set('groups', state.annotationGroupIds.map(escapeCsvEntry).join(','))
  }

  if (state.customImageUrls !== undefined) {
    for (const customImageUrl of state.customImageUrls) {
      setOptionalString(params, 'customImageUrl', customImageUrl, 'append')
    }

    if (state.customImageUrls.length === 0) {
      params.append('customImageUrl', '')
    }
  }

  if (state.customImageOpacities !== undefined) {
    for (const customImageOpacity of state.customImageOpacities) {
      if (Number.isFinite(customImageOpacity)) {
        params.append('customImageOpacity', roundForHash(customImageOpacity).toString())
      }
    }
  }

  if (state.segmentationUrl !== undefined && state.segmentationUrl.trim() !== '') {
    params.set('segmentation', state.segmentationUrl.trim())
    setOptionalString(params, 'segmentationFormat', state.segmentationFormat)
    setOptionalString(params, 'segmentationUnits', state.segmentationUnits)
  }

  // Written even when empty, which a link does only to clear a manifest's
  // genes (withoutShareableDefaults leaves out the usual empty list).
  if (state.selectedGenes !== undefined) {
    params.set('genes', state.selectedGenes.map(escapeCsvEntry).join(','))
  }

  setOptionalString(params, 'geneSets', state.geneSets)

  if (state.viewState !== undefined) {
    params.set('view', formatViewState(state.viewState))
  }

  if (state.roiSelection !== undefined) {
    params.set('roi', formatRoiSelection(state.roiSelection))
  }

  setOptionalString(params, 'tab', state.activeTab)

  if (state.panels !== undefined) {
    params.set('panel', state.panels.map(escapeCsvEntry).join(','))
  }

  setOptionalString(params, 'card', state.card)
  setOptionalString(params, 'tool', state.tool)
  setOptionalString(params, 'plot', state.plot)
  setOptionalString(params, 'query', state.query)

  if (state.hiddenLayers !== undefined && state.hiddenLayers.length > 0) {
    params.set('hidden', state.hiddenLayers.map(escapeCsvEntry).join(','))
  }

  setEscapedCsv(params, 'hiddenClasses', state.hiddenAnnotationIds)
  setEscapedCsv(params, 'shownClasses', state.shownAnnotationIds)
  setEscapedCsv(params, 'hiddenSets', state.hiddenAnnotationSetIds)
  setOptionalString(params, 'scale', state.geneExpressionColorScale)
  setOptionalString(params, 'geneRange', state.geneExpressionScaleRange)
  setOptionalString(params, 'score', state.geneExpressionScoreMode)
  setOptionalString(params, 'detail', state.geneExpressionDetailMode)
  setOptionalString(params, 'cellColor', state.observationColorMode)
  setOptionalString(params, 'cellTrack', state.cellMetadataTrackId)
  setOptionalString(params, 'coord', state.coordinateUnit)
  setOptionalString(params, 'measureUnit', state.measurementUnit)

  if (state.shouldLoadMorphology !== undefined) {
    params.set('morphology', state.shouldLoadMorphology ? '1' : '0')
  }

  if (state.boundaryCellLimit !== undefined && Number.isFinite(state.boundaryCellLimit)) {
    params.set(
      'boundaryLimit',
      Math.max(1, Math.floor(state.boundaryCellLimit)).toString(),
    )
  }

  if (state.imageOpacity !== undefined && Number.isFinite(state.imageOpacity)) {
    params.set('imgOpacity', roundForHash(state.imageOpacity).toString())
  }

  if (state.cellFillOpacity !== undefined && Number.isFinite(state.cellFillOpacity)) {
    params.set('cellFill', roundForHash(state.cellFillOpacity).toString())
  }

  if (state.cellPointScale !== undefined && Number.isFinite(state.cellPointScale)) {
    params.set('cellSize', roundForHash(state.cellPointScale).toString())
  }

  if (state.showCellBoundaries !== undefined) {
    params.set('cellBounds', state.showCellBoundaries ? '1' : '0')
  }

  if (state.showNucleusBoundaries !== undefined) {
    params.set('nucleusBounds', state.showNucleusBoundaries ? '1' : '0')
  }

  if (state.showHoverTooltips !== undefined) {
    params.set('hoverTips', state.showHoverTooltips ? '1' : '0')
  }

  if (state.showMinimap !== undefined) {
    params.set('minimap', state.showMinimap ? '1' : '0')
  }

  if (state.showAxes !== undefined) {
    params.set('axes', state.showAxes ? '1' : '0')
  }

  if (state.showLegend !== undefined) {
    params.set('legend', state.showLegend ? '1' : '0')
  }

  if (state.showNavigation !== undefined) {
    params.set('navButtons', state.showNavigation ? '1' : '0')
  }

  if (state.showScaleBar !== undefined) {
    params.set('scaleBar', state.showScaleBar ? '1' : '0')
  }

  if (
    state.cellBoundaryOpacity !== undefined &&
    Number.isFinite(state.cellBoundaryOpacity)
  ) {
    params.set('cellBoundary', roundForHash(state.cellBoundaryOpacity).toString())
  }

  if (state.morphologyEnabledChannelIds !== undefined) {
    params.set(
      'channels',
      state.morphologyEnabledChannelIds.map(escapeCsvEntry).join(','),
    )
  }

  const channelColors = Object.entries(state.morphologyChannelColors ?? {})

  if (channelColors.length > 0) {
    params.set(
      'channelColors',
      channelColors
        .map(([id, color]) => escapeCsvEntry(`${id}:${formatHexColor(color)}`))
        .join(','),
    )
  }

  if (state.morphologyZPlane !== undefined && Number.isFinite(state.morphologyZPlane)) {
    params.set('z', Math.max(0, Math.floor(state.morphologyZPlane)).toString())
  }

  if (
    state.morphologyTimePoint !== undefined &&
    Number.isFinite(state.morphologyTimePoint)
  ) {
    params.set('t', Math.max(0, Math.floor(state.morphologyTimePoint)).toString())
  }

  setOptionalString(params, 'imageView', state.imageView)
  setOptionalString(params, 'cellView', state.cellView)

  if (state.transcriptOverlay !== undefined) {
    params.set('tx', state.transcriptOverlay ? '1' : '0')
  }

  setOptionalString(params, 'txDetail', state.transcriptDetailMode)

  if (state.transcriptMinQv !== undefined && Number.isFinite(state.transcriptMinQv)) {
    params.set('txQv', Math.max(0, Math.floor(state.transcriptMinQv)).toString())
  }

  if (state.transcriptGeneOnly !== undefined) {
    params.set('txGene', state.transcriptGeneOnly ? '1' : '0')
  }

  setOptionalString(params, 'txFilter', state.transcriptFeatureFilterMode)
  setOptionalString(params, 'txDensity', state.transcriptDensityColorScale)
  setOptionalString(params, 'txColor', state.transcriptPointColorMode)

  if (
    state.transcriptExactPointLimit !== undefined &&
    Number.isFinite(state.transcriptExactPointLimit)
  ) {
    params.set(
      'txBudget',
      Math.max(1, Math.floor(state.transcriptExactPointLimit)).toString(),
    )
  }

  if (state.transcriptOpacity !== undefined && Number.isFinite(state.transcriptOpacity)) {
    params.set('txOpacity', roundForHash(state.transcriptOpacity).toString())
  }

  if (
    state.transcriptPointSize !== undefined &&
    Number.isFinite(state.transcriptPointSize)
  ) {
    params.set('txSize', Math.max(1, Math.floor(state.transcriptPointSize)).toString())
  }

  setOptionalString(params, 'lensScope', state.magicLensScope)

  if (state.magicLensActive !== undefined) {
    params.set('lens', state.magicLensActive ? '1' : '0')
  }

  if (
    state.magicLensRadiusMicrometers !== undefined &&
    Number.isFinite(state.magicLensRadiusMicrometers)
  ) {
    params.set(
      'lensRadius',
      Math.max(1, Math.floor(state.magicLensRadiusMicrometers)).toString(),
    )
  }

  setOptionalString(params, 'sdTable', state.spatialDataTable)
  setOptionalString(params, 'sdCs', state.spatialDataCoordinateSystem)
  setOptionalString(params, 'sdImage', state.spatialDataImage)

  if (
    state.spatialDataMicrometersPerUnit !== undefined &&
    Number.isFinite(state.spatialDataMicrometersPerUnit) &&
    state.spatialDataMicrometersPerUnit > 0
  ) {
    params.set(
      'sdUm',
      Number(state.spatialDataMicrometersPerUnit.toPrecision(6)).toString(),
    )
  }

  setOptionalString(params, 'vimg', state.visiumImage)
  setOptionalString(params, 'mimg', state.merscopeImage)
  setOptionalString(params, 'aimg', state.ateraImage)
  setOptionalString(params, 'vlib', state.visiumLibrary)

  if (state.visiumOffTissue !== undefined) {
    params.set('voff', state.visiumOffTissue ? '1' : '0')
  }

  const text = params.toString()
  return text === '' ? '' : `#${text}`
}

export function viewStateToShareable(viewState: {
  readonly target: readonly [number, number, number]
  readonly zoom: number
}): ShareableViewState {
  return {
    target: [
      roundForHash(viewState.target[0] ?? 0),
      roundForHash(viewState.target[1] ?? 0),
      roundForHash(viewState.target[2] ?? 0),
    ],
    zoom: roundForHash(viewState.zoom),
  }
}

export function shareableViewStateKey(viewState: ShareableViewState | undefined): string {
  if (viewState === undefined) {
    return ''
  }

  return `${viewState.target.join(':')}:${viewState.zoom}`
}

function readString(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)
  return value === null || value.trim() === '' ? undefined : value
}

function readStrings(
  params: URLSearchParams,
  name: string,
): readonly string[] | undefined {
  const values = params
    .getAll(name)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return values.length === 0 ? undefined : values
}

function readUnitNumbers(
  params: URLSearchParams,
  name: string,
): readonly number[] | undefined {
  const values = params
    .getAll(name)
    .map((value) => parseUnitNumber(value))
    .filter((value): value is number => value !== undefined)

  return values.length === 0 ? undefined : values
}

function readCsv(params: URLSearchParams, name: string): readonly string[] | undefined {
  const value = params.get(name)

  if (value === null || value.trim() === '') {
    return undefined
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return entries.length === 0 ? undefined : entries
}

// A comma-separated list whose entries may hold commas, written as `%2C`
// (and `%` as `%25`).
function readEscapedCsv(
  params: URLSearchParams,
  name: string,
): readonly string[] | undefined {
  return readCsv(params, name)?.map(unescapeCsvEntry)
}

function setEscapedCsv(
  params: URLSearchParams,
  name: string,
  entries: readonly string[] | undefined,
): void {
  const kept = (entries ?? []).filter((entry) => entry.trim() !== '')

  if (kept.length > 0) {
    params.set(name, kept.map(escapeCsvEntry).join(','))
  }
}

// A part of a structured value such as `query=` or `geneSets=`: `%`, `;`,
// `|` and `,` inside it are written as `%25`, `%3B`, `%7C` and `%2C`.
export function escapeLinkPart(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll(';', '%3B')
    .replaceAll('|', '%7C')
    .replaceAll(',', '%2C')
}

export function unescapeLinkPart(value: string): string {
  return value.replace(/%(25|3B|7C|2C)/gi, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  )
}

function escapeCsvEntry(entry: string): string {
  return entry.replaceAll('%', '%25').replaceAll(',', '%2C')
}

// Any other `%` is kept as written, so a hand-written link cannot fail here.
function unescapeCsvEntry(entry: string): string {
  return entry.replace(/%(25|2C)/gi, (_match, code: string) =>
    code === '25' ? '%' : ',',
  )
}

function readCsvAllowEmpty(
  params: URLSearchParams,
  name: string,
): readonly string[] | undefined {
  const value = params.get(name)

  if (value === null) {
    return undefined
  }

  if (value.trim() === '') {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function setOptionalString(
  params: URLSearchParams,
  name: string,
  value: string | undefined,
  mode: 'set' | 'append' = 'set',
): void {
  if (value !== undefined && value.trim() !== '') {
    if (mode === 'append') {
      params.append(name, value.trim())
      return
    }

    params.set(name, value.trim())
  }
}

function parsePanelLink(value: string): ShareablePanelLink | null {
  const [flag, ...rest] = value.split(',')

  if (flag !== '0' && flag !== '1') return null

  const linked = flag === '1'
  if (rest.length === 0) return { linked }

  const numbers = parseNumberList(rest.join(','), 3)

  return numbers === null
    ? null
    : { linked, values: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0] }
}

function parsePanelImage(value: string): ShareablePanelImage {
  const trimmed = value.trim()

  return trimmed === '1' ? 'cells' : trimmed === 'only' ? 'only' : null
}

// `Channel:0:ff00ff,Channel:3:d73f7c`: each entry's colour follows its last
// `:`, so the channel ID may hold colons. Malformed entries are skipped.
function parseChannelColors(
  value: string | null,
): Readonly<Record<string, readonly [number, number, number]>> | undefined {
  if (value === null) return undefined

  const colors: Record<string, readonly [number, number, number]> = {}

  for (const entry of value.split(',')) {
    const unescaped = unescapeCsvEntry(entry.trim())
    const separator = unescaped.lastIndexOf(':')
    const id = unescaped.slice(0, separator)
    const hex = /^[\da-f]{6}$/i.exec(unescaped.slice(separator + 1))?.[0]

    if (separator > 0 && hex !== undefined) {
      colors[id] = [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    }
  }

  return Object.keys(colors).length === 0 ? undefined : colors
}

function formatHexColor(color: readonly [number, number, number]): string {
  return color
    .map((component) =>
      Math.max(0, Math.min(255, Math.round(component)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
}

function parsePanelChannels(value: string): readonly string[] | null {
  const trimmed = value.trim()

  if (trimmed === '') return null
  if (trimmed === '-') return []

  return trimmed
    .split(',')
    .map((entry) => unescapeCsvEntry(entry.trim()))
    .filter((entry) => entry.length > 0)
}

function formatPanelLink(link: ShareablePanelLink): string {
  return [link.linked ? '1' : '0', ...(link.values ?? []).map(formatHashNumber)].join(',')
}

function parseViewState(value: string | null): ShareableViewState | undefined {
  const numbers = parseNumberList(value, 4)

  if (numbers === null) {
    return undefined
  }

  return {
    target: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    zoom: numbers[3] ?? 0,
  }
}

function formatViewState(viewState: ShareableViewState): string {
  return [viewState.target[0], viewState.target[1], viewState.target[2], viewState.zoom]
    .map(formatHashNumber)
    .join(',')
}

function parseRoiSelection(value: string | null): RoiSelection | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const [kind, encoded] = value.split(':', 2)

  if (kind === 'box') {
    const numbers = parseNumberList(encoded ?? '', 4)

    if (numbers === null) {
      return undefined
    }

    return { kind: 'box', bbox: bboxFromNumbers(numbers) }
  }

  if (kind === 'lasso') {
    const points = (encoded ?? '')
      .split(';')
      .map((point) => parseNumberList(point, 2))
      .filter((point): point is readonly [number, number] => point !== null)
      .map((point) => dataPoint(point[0], point[1]))

    if (points.length < 3) {
      return undefined
    }

    return { kind: 'lasso', bbox: bboxFromPoints(points), points }
  }

  return undefined
}

function formatRoiSelection(selection: RoiSelection): string {
  if (selection.kind === 'box') {
    return `box:${[
      selection.bbox.minX,
      selection.bbox.minY,
      selection.bbox.maxX,
      selection.bbox.maxY,
    ]
      .map(formatHashNumber)
      .join(',')}`
  }

  return `lasso:${selection.points
    .map((point) => [point.x, point.y].map(formatHashNumber).join(','))
    .join(';')}`
}

function parseNumberList(
  value: string | null,
  expectedLength: number,
): readonly number[] | null {
  if (value === null) {
    return null
  }

  const numbers = value.split(',').map((part) => Number(part))

  if (
    numbers.length !== expectedLength ||
    numbers.some((number) => !Number.isFinite(number))
  ) {
    return null
  }

  return numbers
}

function bboxFromNumbers(numbers: readonly number[]): BBox {
  return {
    minX: micrometers(Math.min(numbers[0] ?? 0, numbers[2] ?? 0)),
    minY: micrometers(Math.min(numbers[1] ?? 0, numbers[3] ?? 0)),
    maxX: micrometers(Math.max(numbers[0] ?? 0, numbers[2] ?? 0)),
    maxY: micrometers(Math.max(numbers[1] ?? 0, numbers[3] ?? 0)),
  }
}

function bboxFromPoints(points: readonly DataPoint[]): BBox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

function dataPoint(x: number, y: number): DataPoint {
  return {
    x: micrometers(x),
    y: micrometers(y),
  }
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === '1' || value === 'true') {
    return true
  }

  if (value === '0' || value === 'false') {
    return false
  }

  return undefined
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function parsePositiveNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseUnitNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined
}

function roundForHash(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}

function formatHashNumber(value: number): string {
  return roundForHash(value).toString()
}
