import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  ViewerCore,
  type RoiDrawMode,
  type ViewerTranscriptHoverDetail,
} from './components/ViewerCore'
import type { LegendCategoryVisibilityChange } from './components/ViewerLegend'
import { spatialDataSelectionFor } from './datasets/datasetFactory'
import type { SpatialDataSelection } from './datasets/spatialDataDataset'
import {
  spatialDataControlLoading,
  spatialDataControlRestored,
  spatialDataSelectionToShareable,
} from './features/dataset/spatialDataModel'
import { visiumSelectionToShareable } from './features/dataset/visiumModel'
import { visiumHdActiveBinSize } from './features/dataset/visiumHdModel'
import { merscopeImageSelectionToShareable } from './features/dataset/merscopeImageModel'
import { useMerscopeImageWorkflow } from './features/app-shell/useMerscopeImageWorkflow'
import {
  isVisiumHdAnnotationDataset,
  useVisiumHdAnnotationSetsWorkflow,
} from './features/app-shell/useVisiumHdAnnotationSetsWorkflow'
import { ateraImageSelectionToShareable } from './features/dataset/ateraImageModel'
import { useAteraImageWorkflow } from './features/app-shell/useAteraImageWorkflow'
import { useTranscriptWorkflow } from './features/transcripts/useTranscriptWorkflow'
import { useGeneExpressionLayerTelemetry } from './features/genes/useGeneExpressionLayerTelemetry'
import {
  useVisiumHdExpressionProjectionWorkflow,
  type VisiumHdExpressionProjectionState,
} from './features/genes/useVisiumHdExpressionProjectionWorkflow'
import { useAnnotationsSectionModel } from './features/sections/annotationsSectionModel'
import { useCellsSectionModel } from './features/sections/cellsSectionModel'
import { useDatasetInfoModel } from './features/sections/datasetInfoModel'
import { useImageSectionModel } from './features/sections/imageSectionModel'
import { useTranscriptsSectionModel } from './features/sections/transcriptsSectionModel'
import { useViewSettingsModel } from './features/sections/viewSettingsModel'
import { useLayerPanelModel, type LayerReveal } from './features/shell/layerPanelModel'
import { useImportedSegmentation } from './features/segmentation/useImportedSegmentation'
import {
  DEFAULT_SEGMENTATION_OUTLINE_COLOR,
  useSegmentationSectionModel,
} from './features/sections/segmentationSectionModel'
import type { SegmentationPlacement } from './datasets/importedSegmentation'
import {
  segmentationLinkFor,
  segmentationSourceFromLink,
} from './datasets/segmentationSource'
import { manifestSegmentationSource } from './datasets/datasetManifest'
import { datasetManifestFor } from './data/datasetFiles'
import { ShellLayout } from './features/shell/ShellLayout'
import { useTopBarModel } from './features/shell/topBarModel'
import { useToolShortcuts } from './features/shell/useToolShortcuts'
import { useCardStackModel } from './features/cards/cardModels'
import { useEmbeddingModel } from './features/sections/embeddingModel'
import type { PlotKind } from './features/plots/plotModel'
import { parsePlotKind, plotDatasetSets } from './features/plots/plotsPanelModel'
import { usePlotsModel } from './features/plots/usePlotsModel'
import type { CellQueryCondition } from './features/query/cellQuery'
import type { CellQueryPictureImage } from './features/query/CellPicture'
import type { CellQueryImageChannel } from './features/query/cellQueryImage'
import { formatCellQueryLink, parseCellQueryLink } from './features/query/cellQueryModel'
import { useCellQueryModel } from './features/query/useCellQueryModel'
import {
  cardForLink,
  cardFromLink,
  hiddenLayersForLink,
  defaultExpandedSections,
  panelsForLink,
  panelsFromLink,
  withShellLink,
  type ShellPanelState,
} from './features/shell/shellLinkModel'
import {
  parseObservationColorMode,
  readDebugModeFromLocation,
  readShareableStateFromLocation,
} from './features/app-shell/appShellModel'
import { DatasetLoadToast } from './features/app-shell/DatasetLoadToast'
import { UndoToast } from './features/app-shell/UndoToast'
import {
  useUndoableRemovals,
  type AnnotationSnapshot,
} from './features/app-shell/useUndoableRemovals'
import { useUndoToast } from './features/app-shell/useUndoToast'
import { StartScreen } from './features/start/StartScreen'
import { StoreStructureDrawer } from './features/store-structure/StoreStructureDrawer'
import { useStoreStructure } from './features/store-structure/useStoreStructure'
import {
  CollectionBar,
  type CollectionBarAnnotations,
} from './features/collection/CollectionBar'
import {
  collectionPreviewSizeForLink,
  collectionPreviewSizeFromLink,
  collectionSwitchOpening,
  collectionViewForLink,
  collectionViewFromLink,
  type CollectionDatasetOpening,
  type CollectionView,
} from './features/collection/collectionModel'
import { useDatasetCollection } from './features/collection/useDatasetCollection'
import {
  LinkedSections,
  type LinkedSectionsColoring,
} from './features/collection/LinkedSections'
import { SectionStackViewer } from './features/collection/SectionStackViewer'
import { sectionSplitLink } from './features/collection/sectionSplitModel'
import { useSectionColumns } from './features/collection/useSectionColumns'
import { stackSections, type StackSection } from './features/collection/sectionStackModel'
import {
  compareUrlsAfterOpening,
  keepsViewOnOpening,
  linkedSectionEntries,
  toggledCompareUrls,
} from './features/collection/linkedSectionsModel'
import {
  useCollectionPreviewStore,
  useOpenDatasetPreviewStore,
} from './features/collection/useCollectionPreviews'
import { LinkedViewChannel } from './components/linkedView'
import type { InitialViewStateOverride } from './components/viewerCoreTypes'
import {
  collectionEntryFor,
  type DatasetCollectionEntry,
} from './datasets/datasetCollection'
import type { DatasetLibraryModel } from './features/start/datasetLibraryModel'
import { EXAMPLES_INDEX_URL } from './features/start/examplesIndex'
import { useRecentDatasets } from './features/start/recentDatasets'
import { useExamplesIndex } from './features/start/useExamplesIndex'
import { datasetDisplayName, documentTitle } from './features/app-shell/documentTitle'
import { isTextEntryTarget } from './features/app-shell/activeToolModel'
import {
  TRANSCRIPT_GENE_LEGEND_ID,
  viewerLegendSections,
} from './features/app-shell/viewerLegendModel'
import { viewerSelectionHighlight } from './features/app-shell/viewerSelectionHighlight'
import { colorModeAfterGeneChange } from './features/genes/geneColorModeModel'
import type { ObservationColorMode } from './rendering/cellStyling'
import {
  activeVisiumHdRoiStateForPlatform,
  appPlatformAdapterFor,
  isAnnDataPlatform,
  isVisiumHdPlatform,
  loadPlatformBoundaryElements,
  loadPlatformCellOutlines,
  loadPlatformCellTranscriptDistribution,
  loadPlatformGeneExpression,
  loadPlatformNucleusBoundaryElements,
  loadPlatformRoiTranscripts,
  loadPlatformTranscriptAggregates,
  loadPlatformTranscriptCapabilities,
  loadPlatformTranscriptViewport,
  nucleusBoundaryControlsVisibleFor,
  PLATFORM_NAMES,
  platformAnalysisEmbeddingOptions,
  platformActiveBoundaryCell,
  platformBoundarySurfaceReserved,
  platformExpressionProfileSelection,
  platformRoiElementIds,
  platformRoiSelection,
  platformSelectedEmbeddingElementId,
} from './features/app-shell/platformAdapter'
import {
  resolveAppDependencies,
  type AnalysisEmbeddingsLoader,
  type AnnotationLoader,
  type AppProps,
  type BoundaryElementsLoader,
  type CellOutlinesLoader,
  type CellTranscriptDistributionLoader,
  type GeneExpressionLoader,
  type RoiCellsLoader,
  type RoiGeneStatsLoader,
  type RoiTranscriptsLoader,
  type TranscriptAggregateLoader,
  type TranscriptCapabilitiesLoader,
  type TranscriptViewportLoader,
} from './features/app-shell/appDependencies'
import { useViewerLayerData } from './features/app-shell/useViewerLayerData'
import {
  useDatasetLifecycle,
  type DatasetOpeningState,
  type StartDatasetLoad,
} from './features/app-shell/useDatasetLifecycle'
import { useAppDomainState } from './features/app-shell/useAppDomainState'
import { useVisiumControlsWorkflow } from './features/app-shell/useVisiumControlsWorkflow'
import { useVisiumHdBinWorkflow } from './features/app-shell/useVisiumHdBinWorkflow'
import { useVisiumHdGridLodWorkflow } from './features/app-shell/useVisiumHdGridLodWorkflow'
import { useVisiumHdExpressionProfileWorkflow } from './features/app-shell/useVisiumHdExpressionProfileWorkflow'
import { useViewportDataWorkflow } from './features/app-shell/useViewportDataWorkflow'
import { useShareableUrlHash } from './features/app-shell/useShareableUrlHash'
import { formatMappingRowsScope } from './features/app-shell/visiumHdAppController'
import {
  appendFallbackNoticeEntry,
  appendDebugLogEntry,
  createLoadingTasks,
  isCancellableLoadingTaskId,
  createFallbackNoticeEntry,
  createDebugLogEntry,
  downloadTextFile,
  invalidateLatestRequest,
  type CancellableLoadingTaskId,
  type DebugLogAppendOptions,
} from './features/app-shell/appRuntimeModel'
import {
  TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
  transcriptDensityContentForRendering,
  transcriptPointsForRendering,
  transcriptStatusCopy,
} from './features/transcripts/transcriptLayerModel'
import { cellDetailStatusCopy } from './features/cells/cellDetailModel'
import {
  IDLE_CELL_EXPRESSION_PROFILE_STATE,
  cellExpressionProfileMatchesSelection,
} from './features/cells/cellExpressionProfileModel'
import type { CellGeneExpressionStatus } from './features/cells/cellGeneExpressionStatus'
import { useCellDetailWorkflow } from './features/cells/useCellDetailWorkflow'
import { useGridCellAssignmentWorkflow } from './features/cells/useGridCellAssignmentWorkflow'
import { analysisEmbeddingStatusCopy } from './features/analysis/analysisEmbeddingModel'
import { useAnalysisEmbeddingWorkflow } from './features/analysis/useAnalysisEmbeddingWorkflow'
import { useMorphologyWorkflow } from './features/morphology/useMorphologyWorkflow'
import { useMorphologyZPlaneWorkflow } from './features/morphology/useMorphologyZPlaneWorkflow'
import { MorphologyVolumeView } from './features/morphology/MorphologyVolumeView'
import { morphologyVolumeLevels } from './features/morphology/useMorphologyVolumeWorkflow'
import { customMorphologyLayerChannels } from './features/morphology/customMorphologyLayers'
import { useCustomMorphologyLayerWorkflow } from './features/morphology/useCustomMorphologyLayerWorkflow'
import { magicLensScopeLabel, magicLensStatusCopy } from './features/roi/magicLensModel'
import { useMagicLensWorkflow } from './features/roi/useMagicLensWorkflow'
import { useVisiumHdMagicLensSummary } from './features/roi/useVisiumHdMagicLensSummary'
import { useRoiWorkflow } from './features/roi/useRoiWorkflow'
import { useSelectionList } from './features/roi/useSelectionList'
import { useTranscriptGeneLegend } from './features/transcripts/useTranscriptGeneLegend'
import { selectionDatasetKey, selectionOutlines } from './features/roi/selectionListModel'
import { referenceSampleIndices } from './features/roi/roiEnrichmentModel'
import { useVisiumHdRoiWorkflow } from './features/roi/useVisiumHdRoiWorkflow'
import {
  roiGeneDatasetWarmupKey,
  roiGeneStatsStatusCopy,
  roiStatusCopy,
  defaultRoiName,
  summarizeRoiCells,
} from './features/roi/roiModel'
import { summarizeRoiGeneExpression } from './data/roiGeneStats'
import { geneExpressionZScoreCells } from './data/geneExpressionLod'
import {
  gridCellDatumDeckCenter,
  summarizeVisiumHdRoiBins,
  visiumHdRoiStatusCopy,
} from './features/roi/visiumHdRoiModel'
import { useDatasetDiagnosticsWorkflow } from './features/diagnostics/useDatasetDiagnosticsWorkflow'
import {
  annotationLabelsForCell,
  annotationStatusCopy,
  filterAnnotationsByVisibleClasses,
  filterAnnotationsByVisibleSets,
  linkAnnotationGroupId,
  placedAnnotationCellCount,
  type AnnotationState,
} from './features/annotations/annotationModel'
import {
  geometricAnnotationFromRoiSelection,
  geometricAnnotationsEmptyMessage,
  geometricAnnotationsImportFailedMessage,
  geometricAnnotationsToGeoJson,
  parseGeometricAnnotationsGeoJson,
  removeGeometricAnnotation,
  updateGeometricAnnotationColor,
  updateGeometricAnnotationVisibility,
} from './features/annotations/geometricAnnotationModel'
import { useAnnotationWorkflow } from './features/annotations/useAnnotationWorkflow'
import {
  useCellMetadataTrackValues,
  type CellMetadataTrackValuesLoader,
} from './features/annotations/useCellMetadataTrackValues'
import {
  EMPTY_GENE_EXPRESSION_SCALE_DOMAIN,
  geneExpressionBatchScaleKey,
  geneExpressionScaleDomainWith,
  IDLE_GENE_EXPRESSION_STATE,
  type GeneExpressionState,
  geneExpressionModeLabel,
  geneExpressionStatusCopy,
  genePanelStatusCopy,
  formatGeneSetsLink,
} from './features/genes/geneControlsModel'
import {
  formatGeneScaleRange,
  geneScalePercentile,
} from './features/genes/geneScaleRange'
import {
  collectStructuredLoadErrors,
  createStructuredLoadError,
  formatStructuredError,
  type StructuredLoadError,
} from './features/errors/loadErrorModel'
import {
  IDLE_BOUNDARY_LOAD_STATE,
  IDLE_DATASET_LOAD_STATE,
  morphologyLoadFailed,
  viewerBoundaryLoadState,
} from './features/dataset/datasetLoadModel'
import type { TranscriptFeatureFilterMode } from './data/transcriptOverlay'
import type { RoiSelection } from './data/roiSelection'
import { detectPerformanceBudget, type PerformanceBudget } from './data/performanceBudget'
import { placedImageExtent } from './data/imagePyramid'
import type { ShareableState } from './data/shareableState'
import {
  appendTelemetryEvent,
  telemetryEvent,
  type TelemetryEvent,
} from './data/telemetry'
import type { FallbackNotice } from './data/fallbackNotice'
import { normalizeLayerOpacity } from './rendering/layerOpacity'
import {
  createGeneExpressionElementStyleIndex,
  geometricAnnotationsToLayerData,
  geneExpressionScoreSpread,
  nonFiniteScoreCount,
  styleCellBoundariesByGeneExpression,
  styleGridCellByGeneExpression,
  unscoredGridCell,
} from './rendering/deckLayers'
import { annotationPaletteColor } from './rendering/annotationPalette'
import { useViewerStore } from './store/viewerStore'
import {
  normalizeCustomMorphologyLayerUrl,
  type MorphologyImage,
} from './data/morphologyImage'
import { micrometers, type BBox } from './data/coords'
import type { CellId } from './data/cellid'
import { slug } from './utils/slug'
import type {
  GeneExpressionBatch,
  SpatialElement,
  SpatialElementId,
  DatasetCell,
} from './datasets/spatialDataset'
import type { GexResult } from './data/gex'
import type { AnalysisEmbedding } from './data/analysisEmbeddings'
import type { ContinuousCellMetadataValue } from './data/customAnnotations'
import type {
  GeneExpressionScoreMode,
  GeometricAnnotationDatum,
} from './rendering/deckLayers'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from './rendering/deckLayers'
import {
  EMPTY_GRID_CELL_COLUMNS,
  gridCellAt,
  gridCellById,
} from './rendering/gridCellColumns'
import type {
  ViewerMagicLensDetail,
  ViewerMagicLensStatus,
  ViewerViewportDetail,
} from './components/ViewerCore'
import type { Annotation } from './data/annotation'

const EMPTY_CELL_BOUNDARY_DATA: readonly CellBoundaryDatum[] = []
const EMPTY_SPATIAL_ELEMENTS: readonly SpatialElement[] = []
const EMPTY_GENE_EXPRESSION_ELEMENTS: readonly OverviewCellDatum[] = []
const EMPTY_ANNOTATIONS: readonly Annotation[] = []
const EMPTY_GROUPS: readonly { readonly id: string; readonly label: string }[] = []

export type {
  AnalysisEmbeddingsLoader,
  AnnotationGroupLoader,
  AnnotationLoader,
  AutoChannelContrastLoader,
  AppDependencies,
  AppDependencyOverrides,
  BoundaryElementsLoader,
  CellTranscriptDistributionLoader,
  DatasetDiagnosticsRunner,
  DatasetOverviewLoader,
  DatasetWarmupLoader,
  GeneExpressionLoader,
  GenePanelLoader,
  MorphologyImageLoader,
  CustomMorphologyLayerLoader,
  RoiCellsLoader,
  RoiGeneStatsLoader,
  RoiTranscriptsLoader,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
  TranscriptAggregateLoader,
  TranscriptCapabilitiesLoader,
  TranscriptViewportLoader,
} from './features/app-shell/appDependencies'

// Shapes passed while the Annotations section hides them (15.2-C).
const NO_GEOMETRY_LAYERS: readonly GeometricAnnotationDatum[] = []
// Previews show the tissue only unless cells are coloured by genes.
const NO_PREVIEW_GENES: readonly string[] = []
// Genes for per-gene transcript reads on platforms that do not have them.
const NO_PER_GENE_TRANSCRIPT_GENES: readonly string[] = []

export function App({ dependencies }: AppProps = {}) {
  const {
    dataset: {
      detectSpatialDataset,
      getSpatialDataset,
      loadCollection,
      loadDatasetOverview,
      loadExamplesIndex,
      loadGenePanel,
      retainDataset,
      warmDatasetForRoi,
    },
    morphology: {
      computeAutoChannelContrast,
      loadCustomMorphologyLayer,
      loadMorphologyImage,
    },
    spatialElements: { loadBoundaryElements },
    annotations: { loadAnnotationGroups, loadAnnotations },
    analysis: { loadAnalysisEmbeddings },
    roi: { loadRoiCells, loadRoiGeneStats, loadRoiTranscripts },
    transcripts: {
      loadCellTranscriptDistribution,
      loadTranscriptAggregates,
      loadTranscriptCapabilities,
      loadTranscriptViewport,
    },
    genes: { loadGeneExpression },
    diagnostics: {
      readParquetRows,
      readParquetStructure,
      readStoreStructure,
      runDatasetDiagnostics,
    },
  } = resolveAppDependencies(dependencies)

  // An old link's tab opens as panels, a tool or a card (15.2-H).
  const [initialShareableState] = useState<ShareableState>(() =>
    withShellLink(readShareableStateFromLocation()),
  )
  const [performanceBudget] = useState<PerformanceBudget>(() => detectPerformanceBudget())
  const [debugMode, setDebugMode] = useState(readDebugModeFromLocation)
  const [shellPanels, setShellPanels] = useState<ShellPanelState>(() =>
    panelsFromLink(initialShareableState),
  )
  const [plotKind, setPlotKind] = useState<PlotKind>(() =>
    parsePlotKind(initialShareableState.plot),
  )
  // The Cell Query window's conditions, kept in the link (plan 23-D9).
  const [queryConditions, setQueryConditions] = useState<readonly CellQueryCondition[]>(
    () => parseCellQueryLink(initialShareableState.query),
  )
  const [collectionView, setCollectionView] = useState<CollectionView>(() =>
    collectionViewFromLink(initialShareableState),
  )
  const [collectionPreviewSize, setCollectionPreviewSize] = useState(() =>
    collectionPreviewSizeFromLink(initialShareableState),
  )
  // Registered sections of the collection shown beside the open dataset
  // (compare=), and the view they share with it.
  const [compareUrls, setCompareUrls] = useState<readonly string[]>(
    () => initialShareableState.compareUrls ?? [],
  )
  const [linkedViewChannel] = useState(() => new LinkedViewChannel())
  // The collection whose open dataset's serial sections are stacked in 3D
  // over the views (sectionView=3d), so the stack closes with it.
  const [sectionStackCollectionUrl, setSectionStackCollectionUrl] = useState(() =>
    initialShareableState.sectionView === '3d'
      ? (initialShareableState.collectionUrl ?? null)
      : null,
  )
  // The view kept when a registered section opens in place of another.
  const [carriedView, setCarriedView] = useState<{
    readonly url: string
    readonly view: InitialViewStateOverride
  } | null>(null)

  const datasetUrl = useViewerStore((state) => state.datasetUrl)
  const setDatasetUrl = useViewerStore((state) => state.setDatasetUrl)
  const appState = useAppDomainState({ initialShareableState, performanceBudget })
  const {
    annotations: {
      annotationColors,
      annotationGroupState,
      annotationImportUrl,
      annotationState,
      cellMetadataTracks,
      geometricAnnotationImportError,
      geometricAnnotations,
      hiddenAnnotationIds,
      hiddenAnnotationSetIds,
      selectedAnnotationGroupId,
      selectedCellMetadataTrackId,
      setAnnotationColors,
      setAnnotationGroupState,
      setAnnotationImportUrl,
      setAnnotationState,
      setCellMetadataTracks,
      setGeometricAnnotationImportError,
      setGeometricAnnotations,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setSelectedAnnotationGroupId,
      setSelectedCellMetadataTrackId,
    },
    analysis: {
      analysisEmbeddingState,
      selectedEmbeddingKind,
      setAnalysisEmbeddingState,
      setSelectedEmbeddingKind,
    },
    cells: {
      cellDetailState,
      cellTranscriptDistributionState,
      setCellDetailState,
      setCellTranscriptDistributionState,
    },
    dataset: {
      boundaryState,
      nucleusBoundaryState,
      cellFeatureMatrixCapabilityState,
      datasetAbout,
      datasetManifestDefaults,
      datasetPlatform,
      datasetWarmupState,
      diagnosticsState,
      loadState,
      morphologyState,
      pendingDatasetLoadState,
      setBoundaryState,
      setNucleusBoundaryState,
      setCellFeatureMatrixCapabilityState,
      setDatasetAbout,
      setDatasetManifestDefaults,
      setDatasetPlatform,
      setDatasetWarmupState,
      setDiagnosticsState,
      setLoadState,
      setMorphologyState,
      setPendingDatasetLoadState,
    },
    genes: {
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScaleDomain,
      geneExpressionScaleRange,
      geneExpressionScoreMode,
      geneExpressionState,
      genePanelState,
      savedGeneSets,
      selectedGenes,
      setGeneExpressionBatch,
      setGeneExpressionColorScale,
      setGeneExpressionDetailMode,
      setGeneExpressionScaleDomain,
      setGeneExpressionScaleRange,
      setGeneExpressionScoreMode,
      setGeneExpressionState,
      setGenePanelState,
      setSavedGeneSets,
      setSelectedGenes,
    },
    layers: {
      boundaryCellLimit,
      cellBoundaryOpacity,
      cellFillOpacity,
      cellPointScale,
      coordinateUnit,
      imageLayerOpacity,
      layerVisibility,
      measurementEnabled,
      measurementResetKey,
      measurementUnit,
      observationColorMode,
      setBoundaryCellLimit,
      setCellBoundaryOpacity,
      setCellFillOpacity,
      setCellPointScale,
      setCoordinateUnit,
      setImageLayerOpacity,
      setLayerVisibility,
      setMeasurementEnabled,
      setMeasurementResetKey,
      setMeasurementUnit,
      setObservationColorMode,
      setShowCellBoundaries,
      setShowAxes,
      setShowHoverTooltips,
      setShowLegend,
      setShowMinimap,
      setShowNavigation,
      setShowNucleusBoundaries,
      setShowScaleBar,
      showAxes,
      showCellBoundaries,
      showHoverTooltips,
      showLegend,
      showMinimap,
      showNavigation,
      showNucleusBoundaries,
      showScaleBar,
    },
    magicLens: {
      magicLensActive,
      magicLensRadiusMicrometers,
      magicLensScope,
      magicLensState,
      setMagicLensActive,
      setMagicLensRadiusMicrometers,
      setMagicLensScope,
      setMagicLensState,
    },
    morphology: {
      autoContrastChannelIds,
      boundaryElements,
      customImageLayerOpacities,
      customMorphologyLayerState,
      customMorphologyLayers,
      flatMorphologyImage,
      morphologyChannelSettings,
      morphologyImage,
      nucleusBoundaryElements,
      setAutoContrastChannelIds,
      setBoundaryElements,
      setCustomImageLayerOpacities,
      setCustomMorphologyLayerState,
      setCustomMorphologyLayers,
      setFlatMorphologyImage,
      setMorphologyChannelSettings,
      setMorphologyImage,
      setNucleusBoundaryElements,
      setShouldLoadMorphology,
      shouldLoadMorphology,
    },
    roi: {
      roiGeneStatsState,
      roiGeneViewportWarmupState,
      roiMode,
      roiName,
      roiReferenceState,
      roiState,
      roiTranscriptExportState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
      setVisiumHdRoiState,
      visiumHdRoiState,
    },
    runtime: {
      debugLog,
      fallbackNotices,
      setDebugLog,
      setFallbackNotices,
      setTelemetryEvents,
      telemetryEvents,
    },
    selection: {
      currentViewportDetail,
      selectedBoundaryCell,
      selectedCell,
      selectedGridCell,
      setCurrentViewportDetail,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
      setShareableViewState,
      setSpatialFocusRequest,
      setViewportCellCount,
      shareableViewState,
      spatialFocusRequest,
    },
    transcripts: {
      hiddenTranscriptGeneSets,
      hiddenTranscriptGenes,
      hoveredTranscript,
      manualTranscriptExactRequestKey,
      pinnedTranscript,
      setHiddenTranscriptGeneSets,
      setHiddenTranscriptGenes,
      setHoveredTranscript,
      setManualTranscriptExactRequestKey,
      setPinnedTranscript,
      setShowTranscriptOverlay,
      setTranscriptCapabilityState,
      setTranscriptDensityColorScale,
      setTranscriptDetailMode,
      setTranscriptExactPointLimit,
      setTranscriptFeatureFilterMode,
      setTranscriptGeneColors,
      setTranscriptGeneOnly,
      setTranscriptGeneSetColors,
      setTranscriptLayerState,
      setTranscriptMinQv,
      setTranscriptOpacity,
      setTranscriptPointColorMode,
      setTranscriptPointSize,
      showTranscriptOverlay,
      transcriptCapabilityState,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode,
      transcriptGeneColors,
      transcriptGeneOnly,
      transcriptGeneSetColors,
      transcriptLayerState,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    spatialData: { setSpatialDataControlState, spatialDataControlState },
    visium: { setVisiumControlState, visiumControlState },
    merscope: { merscopeImageState, setMerscopeImageState },
    atera: { ateraImageState, setAteraImageState },
    visiumHd: {
      gridCellAssignmentState,
      overviewCells,
      setGridCellAssignmentState,
      setOverviewCells,
      setSpatialGridCells,
      setVisiumHdControlState,
      setVisiumHdExpressionProfileState,
      spatialGridCells,
      visiumHdControlState,
      visiumHdExpressionProfileState,
    },
    tools: { activeTool, setActiveTool },
  } = appState
  const effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode =
    selectedGenes.length === 0 ? 'all' : transcriptFeatureFilterMode
  const loadRequestId = useRef(0)
  const visiumHdBinRequestId = useRef(0)
  const analysisEmbeddingRequestId = useRef(0)
  const boundaryRequestId = useRef(0)
  const nucleusBoundaryRequestId = useRef(0)
  const geneExpressionRequestId = useRef(0)
  const roiRequestId = useRef(0)
  const roiTranscriptExportRequestId = useRef(0)
  const transcriptCapabilityRequestId = useRef(0)
  const transcriptRequestId = useRef(0)
  const magicLensRequestId = useRef(0)
  const cellDetailRequestId = useRef(0)
  const gridCellAssignmentRequestId = useRef(0)
  const visiumHdExpressionProfileRequestId = useRef(0)
  const cellTranscriptDistributionRequestId = useRef(0)
  const magicLensDebounceRef = useRef<number | null>(null)
  const magicLensLastDetailRef = useRef<ViewerMagicLensDetail | null>(null)
  const magicLensLastQueryKeyRef = useRef<string | null>(null)
  const debugLogIdRef = useRef(0)
  const fallbackNoticeIdRef = useRef(0)
  const datasetAbortRef = useRef<AbortController | null>(null)
  const datasetWarmupAbortRef = useRef<AbortController | null>(null)
  const diagnosticsAbortRef = useRef<AbortController | null>(null)
  const analysisEmbeddingAbortRef = useRef<AbortController | null>(null)
  const boundaryAbortRef = useRef<AbortController | null>(null)
  const nucleusBoundaryAbortRef = useRef<AbortController | null>(null)
  const geneExpressionAbortRef = useRef<AbortController | null>(null)
  const roiAbortRef = useRef<AbortController | null>(null)
  const roiTranscriptExportAbortRef = useRef<AbortController | null>(null)
  const transcriptCapabilityAbortRef = useRef<AbortController | null>(null)
  const transcriptAbortRef = useRef<AbortController | null>(null)
  const roiGeneViewportWarmupAbortRef = useRef<AbortController | null>(null)
  const roiGeneViewportWarmupTimeoutRef = useRef<number | null>(null)
  const roiGeneViewportWarmupKeyRef = useRef<string | null>(null)
  const cellFeatureMatrixCapabilityKeyRef = useRef<string | null>(null)
  const spatialFocusRequestIdRef = useRef(0)
  const magicLensAbortRef = useRef<AbortController | null>(null)
  const cellDetailAbortRef = useRef<AbortController | null>(null)
  const gridCellAssignmentAbortRef = useRef<AbortController | null>(null)
  const visiumHdExpressionProfileAbortRef = useRef<AbortController | null>(null)
  const cellTranscriptDistributionAbortRef = useRef<AbortController | null>(null)
  const customMorphologyLayerAbortRef = useRef<AbortController | null>(null)
  const autoContrastChannelIdsRef = useRef<Set<string>>(new Set())
  const customMorphologyLayerIdRef = useRef(0)
  const customMorphologyLayerRequestIdRef = useRef(0)
  const roiIdRef = useRef(0)
  const geometricAnnotationIdRef = useRef(0)
  const boundaryViewportKeyRef = useRef<string | null>(null)
  const nucleusBoundaryViewportKeyRef = useRef<string | null>(null)
  const geneExpressionViewportKeyRef = useRef<string | null>(null)
  const geneExpressionLayerTimingKeyRef = useRef<string | null>(null)
  const transcriptViewportKeyRef = useRef<string | null>(null)
  const lastViewportDetailRef = useRef<ViewerViewportDetail | null>(null)
  const initialShareableStateRef = useRef<DatasetOpeningState | null>(
    initialShareableState,
  )
  const initialAnnotationImportUrlRef = useRef(
    initialShareableState.annotationUrl?.trim() || null,
  )
  // Annotation sets a link names (groups=), or the set a collection dataset
  // keeps, loaded once that dataset is ready.
  const pendingAnnotationGroupsRef = useRef<PendingAnnotationGroups | null>(
    initialShareableState.annotationGroupIds === undefined
      ? null
      : pendingAnnotationGroupsFor(initialShareableState),
  )
  // The link's set while it loads, which the link's annotationUrl= import
  // waits for.
  const linkAnnotationSetLoadRef = useRef<Promise<void> | null>(null)
  const initialSharedRoiSelectionRef = useRef<RoiSelection | null>(
    initialShareableState.roiSelection ?? null,
  )
  // The colour mode to go back to when the last gene is removed.
  const colorModeBeforeGenesRef = useRef<ObservationColorMode>(
    nonGeneColorMode(
      parseObservationColorMode(initialShareableState.observationColorMode),
    ),
  )
  const didApplyInitialDatasetUrlRef = useRef(false)
  const startDatasetLoadRef = useRef<StartDatasetLoad | null>(null)
  const initialCustomImageUrlsRef = useRef<readonly string[]>(
    initialShareableState.customImageUrls ?? [],
  )
  const initialCustomImageOpacitiesRef = useRef<readonly number[]>(
    initialShareableState.customImageOpacities ?? [],
  )
  const initialShouldLoadMorphologyRef = useRef(shouldLoadMorphology)
  const isLoading =
    loadState.status === 'loading' || pendingDatasetLoadState.status === 'loading'
  const loadedDatasetUrl = loadState.status === 'ready' ? loadState.url : null
  // The dataset shown, and one being opened in its place, stay open however
  // many others the collection previews open.
  const shownDatasetUrl = loadState.status === 'idle' ? null : loadState.url
  const openingDatasetUrl =
    pendingDatasetLoadState.status === 'loading' ? pendingDatasetLoadState.url : null
  useEffect(() => {
    if (shownDatasetUrl === null) return
    return retainDataset(shownDatasetUrl)
  }, [retainDataset, shownDatasetUrl])
  useEffect(() => {
    if (openingDatasetUrl === null) return
    return retainDataset(openingDatasetUrl)
  }, [openingDatasetUrl, retainDataset])
  const linkNamesDataset = (initialShareableState.datasetUrl?.trim() ?? '') !== ''
  // Set below, where the functions that open datasets are defined.
  const openCollectionDatasetRef = useRef<
    ((url: string, opening: CollectionDatasetOpening) => void) | null
  >(null)
  const datasetCollection = useDatasetCollection({
    initialUrl: initialShareableState.collectionUrl,
    linkOpensDataset: linkNamesDataset,
    loadCollection,
    loadedDatasetUrl,
    onOpenDataset: (url, opening) => {
      openCollectionDatasetRef.current?.(url, opening)
    },
  })
  const collectionEntry =
    datasetCollection.state.status === 'ready'
      ? collectionEntryFor(datasetCollection.state.collection, loadedDatasetUrl)
      : undefined
  const loadedDatasetName = datasetDisplayName(
    loadedDatasetUrl,
    datasetAbout?.name ?? collectionEntry?.name,
  )
  const readyCollection =
    datasetCollection.state.status === 'ready' ? datasetCollection.state.collection : null
  const linkedSections = useMemo(
    () => linkedSectionEntries(readyCollection, loadedDatasetUrl, compareUrls),
    [compareUrls, loadedDatasetUrl, readyCollection],
  )
  const stackedSections = useMemo(
    () => stackSections(readyCollection, loadedDatasetUrl),
    [loadedDatasetUrl, readyCollection],
  )
  const openCollectionUrl =
    datasetCollection.state.status === 'idle' ? null : datasetCollection.state.url
  const sectionStackOpen =
    sectionStackCollectionUrl !== null && sectionStackCollectionUrl === openCollectionUrl
  const sectionStackShown = sectionStackOpen && stackedSections.length > 0
  // Until the collection is read and its dataset open, the link's
  // sectionView= stays as it was, like compare=.
  const linkSectionView =
    sectionStackOpen &&
    (readyCollection === null || loadedDatasetUrl === null || stackedSections.length > 0)
      ? '3d'
      : undefined
  // Until the collection is read and its dataset open, the link's compare=
  // stays as it was.
  const linkCompareUrls =
    readyCollection === null || loadedDatasetUrl === null
      ? compareUrls
      : linkedSections.map((entry) => entry.url)
  // A link's view is for the dataset it names. Once another dataset loads,
  // datasets open fitted to their extent again.
  const [linkViewApplies, setLinkViewApplies] = useState(
    initialShareableState.viewState !== undefined,
  )
  if (
    linkViewApplies &&
    loadedDatasetUrl !== null &&
    loadedDatasetUrl !== initialShareableState.datasetUrl?.trim()
  ) {
    setLinkViewApplies(false)
  }
  useEffect(() => {
    document.title = documentTitle(loadedDatasetName)
  }, [loadedDatasetName])
  const platformAdapter = appPlatformAdapterFor(loadState, datasetPlatform)
  // An image's imported segmentation draws in its own colour (plan 25).
  const [segmentationOutlineColor, setSegmentationOutlineColor] = useState(
    DEFAULT_SEGMENTATION_OUTLINE_COLOR,
  )
  // Its own opacity: the outlines are all there is to see of it.
  const [segmentationOutlineOpacity, setSegmentationOutlineOpacity] = useState(1)
  const segmentationLineColor = useMemo(
    () =>
      platformAdapter.kind === 'image'
        ? hexOutlineColor(segmentationOutlineColor)
        : undefined,
    [platformAdapter.kind, segmentationOutlineColor],
  )
  // The sections open until someone opens or closes one.
  const defaultPanelIds = useMemo(
    () => defaultExpandedSections(platformAdapter.capabilities.cells),
    [platformAdapter.capabilities.cells],
  )
  const openPanelIds = useMemo(
    () => panelsForLink(shellPanels, defaultPanelIds) ?? defaultPanelIds,
    [defaultPanelIds, shellPanels],
  )
  // The start screen (plan 15.3-A) shows until a load starts,
  // unless the link names a dataset or a collection that opens one, and again
  // when a load fails with nothing else open.
  const [datasetLoadStarted, setDatasetLoadStarted] = useState(false)
  if (!datasetLoadStarted && loadState.status !== 'idle') setDatasetLoadStarted(true)
  const linkOpensDataset =
    linkNamesDataset ||
    datasetCollection.state.status === 'loading' ||
    datasetCollection.state.status === 'ready'
  const showStartScreen =
    loadState.status === 'error' ||
    (loadState.status === 'idle' && !(linkOpensDataset && !datasetLoadStarted))
  const examplesIndex = useExamplesIndex({ loadIndex: loadExamplesIndex })
  // Browse Store's drawer, opened from the dataset field (any of its forms).
  const storeStructure = useStoreStructure({
    read: readStoreStructure,
    readParquet: readParquetStructure,
    readParquetRows,
  })
  // Undo after a removal (15.3-C); another dataset ends the offer.
  const undoToast = useUndoToast()
  const { dismiss: dismissUndo, offerUndo } = undoToast
  useEffect(() => {
    dismissUndo()
  }, [dismissUndo, loadedDatasetUrl])
  const recentDatasets = useRecentDatasets()
  const { add: addRecentDataset } = recentDatasets
  useEffect(() => {
    if (loadedDatasetUrl === null || loadedDatasetName === null) return
    addRecentDataset({
      url: loadedDatasetUrl,
      name: loadedDatasetName,
      platform: platformAdapter.kind,
    })
  }, [addRecentDataset, loadedDatasetName, loadedDatasetUrl, platformAdapter.kind])
  const isVisiumHdDataset = isVisiumHdPlatform(platformAdapter)
  const platformFeatureLoadEnabled = platformAdapter.featureLoadEnabled(loadState)
  const geneExpressionScaleDatasetUrl =
    loadState.status === 'ready' ? loadState.url : datasetUrl
  const selectedCellMetadataTrack = useMemo(
    () =>
      cellMetadataTracks.find((track) => track.id === selectedCellMetadataTrackId) ??
      cellMetadataTracks[0] ??
      null,
    [cellMetadataTracks, selectedCellMetadataTrackId],
  )
  const selectedCellMetadataColorStyle = useMemo(() => {
    const values = selectedCellMetadataTrack?.values ?? null

    return selectedCellMetadataTrack === null || values === null
      ? null
      : { ...selectedCellMetadataTrack, values }
  }, [selectedCellMetadataTrack])
  const diagnosticsVisiumHdBinSize =
    visiumHdControlState.status === 'idle'
      ? undefined
      : visiumHdControlState.selectedBinSize
  const activeVisiumHdBinSize = visiumHdActiveBinSize(visiumHdControlState)
  const visiumHdBarcodeMappingRowBudget: number | undefined = undefined
  const activeVisiumHdRoiState = activeVisiumHdRoiStateForPlatform({
    activeBinSize: activeVisiumHdBinSize,
    adapter: platformAdapter,
    loadState,
    state: visiumHdRoiState,
  })
  const hiddenAnnotationSetIdSet = useMemo(
    () => new Set(hiddenAnnotationSetIds),
    [hiddenAnnotationSetIds],
  )
  const hiddenAnnotationIdSet = useMemo(
    () => new Set(hiddenAnnotationIds),
    [hiddenAnnotationIds],
  )
  // A set's eye is open. Its classes may all be unchecked.
  const annotationSetShown = useMemo(
    () =>
      annotationState.status === 'ready' &&
      filterAnnotationsByVisibleSets(
        annotationState.annotations,
        hiddenAnnotationSetIdSet,
      ).length > 0,
    [annotationState, hiddenAnnotationSetIdSet],
  )
  const visibleAnnotationState = useMemo<AnnotationState<StructuredLoadError>>(
    () =>
      annotationState.status === 'ready'
        ? {
            ...annotationState,
            annotations: filterAnnotationsByVisibleClasses(
              filterAnnotationsByVisibleSets(
                annotationState.annotations,
                hiddenAnnotationSetIdSet,
              ),
              hiddenAnnotationIdSet,
            ),
          }
        : annotationState,
    [annotationState, hiddenAnnotationIdSet, hiddenAnnotationSetIdSet],
  )
  const appendDebugEvent = useCallback(
    (message: string, options: DebugLogAppendOptions = {}) => {
      debugLogIdRef.current += 1
      const entry = createDebugLogEntry(debugLogIdRef.current, message, options)

      setDebugLog((current) => appendDebugLogEntry(current, entry))
    },
    [setDebugLog],
  )
  const morphologyChannels = useMemo(
    () => [
      ...(morphologyImage?.channelLoaders ?? []),
      ...customMorphologyLayerChannels(customMorphologyLayers),
    ],
    [customMorphologyLayers, morphologyImage],
  )
  const customImageUrls = useMemo(
    () => customMorphologyLayers.map((layer) => layer.image.url),
    [customMorphologyLayers],
  )
  const customImageOpacities = useMemo(() => {
    if (customMorphologyLayers.length === 0) {
      return undefined
    }

    const opacities = customMorphologyLayers.map((layer) =>
      normalizeLayerOpacity(customImageLayerOpacities[layer.image.url] ?? 1),
    )

    return opacities.some((opacity) => opacity !== 1) ? opacities : undefined
  }, [customImageLayerOpacities, customMorphologyLayers])
  // The Image section's checkbox hides the dataset image and custom layers.
  const renderedImageOpacity = layerVisibility.image ? imageLayerOpacity : 0
  const morphologyChannelOpacities = useMemo(() => {
    const opacities = new Map<string, number>()

    for (const channel of morphologyImage?.channelLoaders ?? []) {
      opacities.set(channel.info.id, renderedImageOpacity)
    }

    for (const layer of customMorphologyLayers) {
      const opacity = layerVisibility.image
        ? normalizeLayerOpacity(customImageLayerOpacities[layer.image.url] ?? 1)
        : 0

      for (const channel of layer.channels) {
        opacities.set(channel.info.id, opacity)
      }
    }

    return opacities
  }, [
    customImageLayerOpacities,
    customMorphologyLayers,
    layerVisibility.image,
    morphologyImage,
    renderedImageOpacity,
  ])
  const baseMorphologyChannelIds = useMemo(
    () =>
      new Set((morphologyImage?.channelLoaders ?? []).map((channel) => channel.info.id)),
    [morphologyImage],
  )
  const visibleCellBoundaryElements = showCellBoundaries
    ? boundaryElements
    : EMPTY_SPATIAL_ELEMENTS
  const visiumHdExpressionProjectionState = useVisiumHdExpressionProjectionWorkflow({
    callbacks: { appendDebugEvent },
    controls: {
      isVisiumHdDataset,
      rowBudget: visiumHdBarcodeMappingRowBudget,
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      boundaryElements: visibleCellBoundaryElements,
      geneExpressionBatch,
      loadState,
    },
    loaders: { getSpatialDataset },
  })
  // The transcript gene legend (15.4-C): each gene's colour and eye, or each
  // saved gene set's with Point color on Gene set.
  const transcriptGenes = useTranscriptGeneLegend({
    appendDebugEvent,
    colorMode: transcriptPointColorMode,
    colors: transcriptGeneColors,
    densityColorScale: transcriptDensityColorScale,
    filterMode: effectiveTranscriptFeatureFilterMode,
    geneSets: savedGeneSets,
    geneSetColors: transcriptGeneSetColors,
    hiddenGenes: hiddenTranscriptGenes,
    hiddenGeneSets: hiddenTranscriptGeneSets,
    layerState: transcriptLayerState,
    overlayShown: platformAdapter.effectiveTranscriptOverlay(showTranscriptOverlay),
    selectedGenes,
    setColors: setTranscriptGeneColors,
    setGeneSetColors: setTranscriptGeneSetColors,
    setHiddenGenes: setHiddenTranscriptGenes,
    setHiddenGeneSets: setHiddenTranscriptGeneSets,
  })
  // Hidden genes and sets belong to the dataset; colours are kept.
  useEffect(() => {
    setHiddenTranscriptGenes([])
    setHiddenTranscriptGeneSets([])
  }, [loadedDatasetUrl, setHiddenTranscriptGeneSets, setHiddenTranscriptGenes])
  const {
    activeCellMetadataTrack,
    annotationStyleColors,
    boundaryLayerData,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionAutoScaleMax,
    geneExpressionHighestScore,
    geneExpressionScaleKey,
    geneExpressionScaleMax,
    geneExpressionScaleMin,
    morphologyCanvasChannels,
    morphologyMicrometersPerPixel,
    nucleusBoundaryLayerData,
    overviewExtent,
    styledGeneExpressionElements,
    styledOverviewCells,
    transcriptDensityScaleLabels,
    transcriptDensityScaleMax,
    transcriptLayerAggregateBins,
    transcriptLayerPoints,
    viewerObservationColorMode,
    visibleTranscriptEstimate,
  } = useViewerLayerData({
    annotations: {
      annotationColors,
      annotationState: visibleAnnotationState,
      annotationSetShown,
    },
    boundaries: {
      boundaryElements,
      boundaryLineColor: segmentationLineColor,
      nucleusBoundaryElements,
    },
    cells: {
      cellMetadataTrack: selectedCellMetadataColorStyle,
      currentViewportBbox: currentViewportDetail?.bbox ?? null,
      gridCells: spatialGridCells,
      observationColorMode,
      overviewCells,
    },
    geneExpression: {
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleDatasetUrl,
      geneExpressionScaleDomain,
      geneExpressionScaleRange,
      geneExpressionScoreMode,
      selectedGenes,
    },
    morphology: {
      morphologyChannelSettings,
      morphologyChannelOpacities,
      morphologyChannels,
      morphologyImage,
    },
    transcripts: {
      hiddenTranscriptGenes: transcriptGenes.hiddenGenes,
      transcriptCapabilityState,
      transcriptDensityColorScale,
      transcriptGeneColor: transcriptGenes.featureColor,
      transcriptGeneGroup: transcriptGenes.featureGroup,
      transcriptLayerState,
      transcriptPointColorMode,
    },
  })
  // Gene expression colours cells only when it is the colour mode (D2), so
  // loading clusters with genes selected shows the clusters.
  const isGeneExpressionColorMode = observationColorMode === 'gene-expression'
  const viewerGeneExpressionElements = isGeneExpressionColorMode
    ? styledGeneExpressionElements
    : EMPTY_GENE_EXPRESSION_ELEMENTS
  const geneExpressionColorsReady =
    isGeneExpressionColorMode && geneExpressionState.status === 'ready'
  const visibleBoundaryLayerData = showCellBoundaries
    ? boundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const expressionStyledBoundaryLayerData = useMemo(
    () =>
      styleCellBoundariesByGeneExpression(
        visibleBoundaryLayerData,
        viewerGeneExpressionElements,
      ),
    [viewerGeneExpressionElements, visibleBoundaryLayerData],
  )
  const viewerBoundaryState = viewerBoundaryLoadState(boundaryState, nucleusBoundaryState)
  const visibleNucleusBoundaryLayerData = showNucleusBoundaries
    ? nucleusBoundaryLayerData
    : EMPTY_CELL_BOUNDARY_DATA
  const isVisiumHdBoundarySurfaceReserved = platformBoundarySurfaceReserved(
    platformAdapter,
    {
      boundaryState,
      expressionBoundaryCount: expressionStyledBoundaryLayerData.length,
      showCellBoundaries,
    },
  )
  // Bins are styled where they are used: the viewer the ones it draws, and the
  // Bin card and an ROI their own. Restyling every bin for each expression
  // batch copied 3.4 million objects at 2 µm and ran the tab out of memory.
  const gridCellExpressionStyleIndex = useMemo(
    () => createGeneExpressionElementStyleIndex(viewerGeneExpressionElements),
    [viewerGeneExpressionElements],
  )
  const styleGridCell = useCallback(
    (cell: GridCellDatum) =>
      styleGridCellByGeneExpression(
        cell,
        gridCellExpressionStyleIndex,
        geneExpressionColorsReady,
      ),
    [geneExpressionColorsReady, gridCellExpressionStyleIndex],
  )
  const viewerGridCells = isVisiumHdBoundarySurfaceReserved
    ? EMPTY_GRID_CELL_COLUMNS
    : spatialGridCells
  const geneExpressionOverlayEnabled = platformAdapter.geneExpressionOverlayEnabled(
    spatialGridCells.length,
  )
  const activeSelectedBoundaryCell = useMemo(() => {
    return platformActiveBoundaryCell(
      platformAdapter,
      selectedBoundaryCell,
      expressionStyledBoundaryLayerData,
    )
  }, [expressionStyledBoundaryLayerData, platformAdapter, selectedBoundaryCell])
  const viewerMicrometersPerPixel =
    morphologyMicrometersPerPixel ?? flatMorphologyImage?.micrometersPerPixel
  const geometricAnnotationLayerData = useMemo(
    () => geometricAnnotationsToLayerData(geometricAnnotations),
    [geometricAnnotations],
  )
  // An image shown before a load's cells (a SpatialData image opens
  // alongside the table) is fitted until the cells arrive and are fitted.
  const fitsLoadingImage =
    loadState.status === 'loading' &&
    overviewCells.length === 0 &&
    spatialGridCells.length === 0 &&
    morphologyImage !== null
  const imageFitExtent = useMemo(
    () =>
      platformAdapter.kind === 'image'
        ? imageFitExtentFromMorphologyImage(morphologyImage)
        : fitsLoadingImage && morphologyImage !== null
          ? placedImageExtent(morphologyImage.loader)
          : null,
    [fitsLoadingImage, morphologyImage, platformAdapter.kind],
  )
  const viewerImageStatus =
    customMorphologyLayerState.status === 'error' ||
    (customMorphologyLayerState.status === 'loading' &&
      morphologyState.status !== 'loading')
      ? customMorphologyLayerState.status
      : morphologyState.status
  const viewerImageError =
    customMorphologyLayerState.status === 'error'
      ? customMorphologyLayerState.error
      : morphologyState.status === 'error'
        ? morphologyState.error
        : null
  const viewerViewResetKey =
    loadState.status === 'idle'
      ? 'idle'
      : `${loadState.status}:${loadState.url}${fitsLoadingImage ? ':image' : ''}`
  const viewerOverviewRenderCellLimit = isAnnDataPlatform(platformAdapter)
    ? null
    : performanceBudget.overviewRenderCellLimit
  const geneOptions = useMemo(
    () => (genePanelState.status === 'ready' ? genePanelState.genes : []),
    [genePanelState],
  )
  const genePanelCopy = genePanelStatusCopy(genePanelState)
  const annotationCopy = annotationStatusCopy(annotationState)
  const annotationGroupOptions =
    annotationGroupState.status === 'ready' ? annotationGroupState.groups : []
  const overviewCellById = useMemo(() => {
    const cellById = new Map<string, OverviewCellDatum>()

    for (const cell of overviewCells) {
      cellById.set(cell.id, cell)
    }

    return cellById
  }, [overviewCells])
  // Visium spots off the tissue are not placed while hidden, so annotation
  // counts, in the panel and the legend, leave them out (15.1-I, 15.5-E).
  const annotationPlacedCellIds =
    visiumControlState.status !== 'idle' &&
    visiumControlState.summary.offTissueSpotCount > 0 &&
    !visiumControlState.summary.showOffTissue
      ? overviewCellById
      : null
  const legendAnnotations = useMemo(() => {
    if (annotationState.status !== 'ready') return null

    const annotations = filterAnnotationsByVisibleSets(
      annotationState.annotations,
      hiddenAnnotationSetIdSet,
    )
    const groupLabel =
      annotationGroupState.status === 'ready'
        ? annotationGroupState.groups.find(
            (group) => group.id === selectedAnnotationGroupId,
          )?.label
        : undefined
    const setLabel =
      groupLabel !== undefined &&
      annotations.every((annotation) => annotation.label.startsWith(`${groupLabel}: `))
        ? groupLabel
        : null

    return {
      setLabel,
      items: annotations.map((annotation, index) => ({
        id: annotation.id,
        label: annotation.label,
        color: annotationColors[annotation.id] ?? annotationPaletteColor(index),
        count: placedAnnotationCellCount(annotation, annotationPlacedCellIds),
      })),
      hiddenIds: hiddenAnnotationIdSet,
    }
  }, [
    annotationColors,
    annotationGroupState,
    annotationPlacedCellIds,
    annotationState,
    hiddenAnnotationIdSet,
    hiddenAnnotationSetIdSet,
    selectedAnnotationGroupId,
  ])
  const legendCellAreaMax = useMemo(() => {
    if (observationColorMode !== 'cell-area') return null

    let max: number | null = null
    for (const cell of overviewCells) {
      if (cell.cellArea !== undefined && Number.isFinite(cell.cellArea)) {
        max = Math.max(max ?? 0, cell.cellArea)
      }
    }
    return max
  }, [observationColorMode, overviewCells])
  const activeSelectedGridCell = useMemo(() => {
    if (selectedGridCell === null) {
      return null
    }

    // Scored by the latest batch, not the one the bin was clicked in.
    const cell = styleGridCell(unscoredGridCell(selectedGridCell))

    if (
      isVisiumHdDataset &&
      selectedGenes.length > 0 &&
      geneExpressionState.status === 'ready' &&
      cell.expressionCount === undefined
    ) {
      // Bins carry their scores only while they are coloured by gene
      // expression, so in another colour mode the card finds the bin in the
      // batch. The batch lists only bins expressing a selected gene, so a bin
      // missing from it scores 0, as the map colours it.
      const expression = styledGeneExpressionElements.find(
        (element) => element.id === cell.id,
      )

      return {
        ...cell,
        expressionCount: expression?.expressionCount ?? 0,
        expressionGenes: expression?.expressionGenes ?? selectedGenes,
      }
    }

    return cell
  }, [
    geneExpressionState.status,
    isVisiumHdDataset,
    selectedGenes,
    selectedGridCell,
    styleGridCell,
    styledGeneExpressionElements,
  ])
  const activeVisiumHdExpressionProfileSelection = useMemo(
    () =>
      platformExpressionProfileSelection(
        platformAdapter,
        activeSelectedBoundaryCell,
        activeSelectedGridCell,
      ),
    [activeSelectedBoundaryCell, activeSelectedGridCell, platformAdapter],
  )
  const activeVisiumHdExpressionProfileState = cellExpressionProfileMatchesSelection(
    visiumHdExpressionProfileState,
    activeVisiumHdExpressionProfileSelection,
  )
    ? visiumHdExpressionProfileState
    : IDLE_CELL_EXPRESSION_PROFILE_STATE
  const activeEmbedding = useMemo(
    () =>
      analysisEmbeddingState.status === 'ready'
        ? (analysisEmbeddingState.embeddings.find(
            (embedding) => embedding.kind === selectedEmbeddingKind,
          ) ??
          analysisEmbeddingState.embeddings[0] ??
          null)
        : null,
    [analysisEmbeddingState, selectedEmbeddingKind],
  )
  const roiCellIds = useMemo(
    () => platformRoiElementIds(platformAdapter, roiState, activeVisiumHdRoiState),
    [activeVisiumHdRoiState, platformAdapter, roiState],
  )
  const selectedEmbeddingElementId = platformSelectedEmbeddingElementId(
    platformAdapter,
    selectedCell,
    activeSelectedGridCell,
  )
  const embeddingElementLabel = platformAdapter.labels.embeddingElementPlural
  const embeddingCopy = analysisEmbeddingStatusCopy(
    analysisEmbeddingState,
    activeEmbedding,
    roiCellIds,
    selectedEmbeddingElementId,
    embeddingElementLabel,
  )
  const cellDetailCopy = cellDetailStatusCopy(cellDetailState, selectedCell)
  const selectedCellAnnotationLabels = useMemo(
    () =>
      selectedCell === null
        ? []
        : annotationLabelsForCell(visibleAnnotationState, selectedCell.id),
    [selectedCell, visibleAnnotationState],
  )
  const selectedGeneExpressionStatus = useMemo(
    () => selectionGeneExpressionStatus(selectedGenes, geneExpressionState),
    [geneExpressionState, selectedGenes],
  )
  const selectedGridCellExpressionStatus =
    activeSelectedGridCell !== null &&
    activeSelectedGridCell.expressionCount === undefined
      ? selectedGeneExpressionStatus
      : undefined
  const selectedBoundaryCellExpressionStatus = useMemo(
    () =>
      activeSelectedBoundaryCell === null ||
      activeSelectedBoundaryCell.expressionCount !== undefined
        ? undefined
        : boundarySelectionGeneExpressionStatus(
            selectedGeneExpressionStatus,
            geneExpressionState,
            visiumHdExpressionProjectionState,
          ),
    [
      activeSelectedBoundaryCell,
      geneExpressionState,
      selectedGeneExpressionStatus,
      visiumHdExpressionProjectionState,
    ],
  )
  const { clearVisiumHdExpressionProfileState, handleLoadVisiumHdExpressionProfile } =
    useVisiumHdExpressionProfileWorkflow({
      callbacks: { appendDebugEvent },
      controls: {
        activeBinSize: activeVisiumHdBinSize,
        isVisiumHdDataset,
        rowBudget: visiumHdBarcodeMappingRowBudget,
      },
      data: {
        activeSelection: activeVisiumHdExpressionProfileSelection,
        loadState,
        selectedGridCell: activeSelectedGridCell,
      },
      loaders: { getSpatialDataset },
      refs: {
        abortRef: visiumHdExpressionProfileAbortRef,
        requestIdRef: visiumHdExpressionProfileRequestId,
      },
      setters: { setExpressionProfileState: setVisiumHdExpressionProfileState },
    })
  const handleAnnotationSetVisibilityChange = useCallback(
    (setId: string, visible: boolean) => {
      setHiddenAnnotationSetIds((current) => {
        if (visible) {
          return current.filter((hiddenSetId) => hiddenSetId !== setId)
        }

        return current.includes(setId) ? current : [...current, setId]
      })
    },
    [setHiddenAnnotationSetIds],
  )
  // A class's eye. With `only` (an Alt-click), only that class shows, or
  // every class again when it is the only one shown.
  const handleAnnotationVisibilityChange = useCallback(
    (annotationId: string, visible: boolean, only = false) => {
      if (only) {
        if (annotationState.status !== 'ready') return

        const others = annotationState.annotations
          .map((annotation) => annotation.id)
          .filter((id) => id !== annotationId)
        setHiddenAnnotationIds((current) =>
          !current.includes(annotationId) && others.every((id) => current.includes(id))
            ? []
            : others,
        )
        return
      }

      setHiddenAnnotationIds((current) => {
        if (visible) {
          return current.filter(
            (hiddenAnnotationId) => hiddenAnnotationId !== annotationId,
          )
        }

        return current.includes(annotationId) ? current : [...current, annotationId]
      })
    },
    [annotationState, setHiddenAnnotationIds],
  )
  // A set's "all classes" checkbox: shows or hides every class at once.
  const handleAnnotationsVisibilityChange = useCallback(
    (annotationIds: readonly string[], visible: boolean) => {
      const ids = new Set(annotationIds)
      setHiddenAnnotationIds((current) => {
        const others = current.filter((id) => !ids.has(id))
        return visible ? others : [...others, ...annotationIds]
      })
    },
    [setHiddenAnnotationIds],
  )
  // The legend's eyes: transcript genes, or annotation classes.
  const { onVisibilityChange: setTranscriptGeneVisible } = transcriptGenes.model
  const handleLegendCategoryVisibilityChange =
    useCallback<LegendCategoryVisibilityChange>(
      (id, visible, sectionId, only) => {
        if (sectionId === TRANSCRIPT_GENE_LEGEND_ID) setTranscriptGeneVisible(id, visible)
        else handleAnnotationVisibilityChange(id, visible, only)
      },
      [handleAnnotationVisibilityChange, setTranscriptGeneVisible],
    )
  // The legend's "+N more in …" opens that list in the layer panel.
  const [layerReveal, setLayerReveal] = useState<LayerReveal | null>(null)
  const handleLegendShowMore = useCallback((sectionId: string) => {
    setLayerReveal((current) => ({
      ...(sectionId === TRANSCRIPT_GENE_LEGEND_ID
        ? { section: 'transcripts' as const, anchor: null }
        : { section: 'cells' as const, anchor: 'clusters' as const }),
      key: (current?.key ?? 0) + 1,
    }))
  }, [])
  const focusSpatialViewOnCell = useCallback(
    (cell: OverviewCellDatum) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({
        key: spatialFocusRequestIdRef.current,
        target: [cell.position[0] ?? 0, cell.position[1] ?? 0, cell.position[2] ?? 0],
      })
    },
    [setSpatialFocusRequest],
  )
  // The cards' Go To buttons (plan 15.2-E).
  const zoomToBbox = useCallback(
    (bbox: BBox) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({ key: spatialFocusRequestIdRef.current, bbox })
    },
    [setSpatialFocusRequest],
  )
  const focusSpatialViewOnGridCell = useCallback(
    (cell: GridCellDatum) => {
      spatialFocusRequestIdRef.current += 1
      setSpatialFocusRequest({
        key: spatialFocusRequestIdRef.current,
        target: gridCellDatumDeckCenter(cell),
      })
    },
    [setSpatialFocusRequest],
  )
  const geneExpressionCopy = geneExpressionStatusCopy(
    geneExpressionState,
    embeddingElementLabel,
  )
  const roiCopy = roiStatusCopy(roiState, roiMode)
  const visiumHdRoiCopy = visiumHdRoiStatusCopy(activeVisiumHdRoiState, roiMode)
  const roiGeneStatsCopy = roiGeneStatsStatusCopy(roiGeneStatsState)
  const analysisHeaderCopy =
    geneExpressionState.status === 'loading'
      ? geneExpressionModeLabel(geneExpressionState.mode, embeddingElementLabel)
      : genePanelCopy
  const annotationHeaderCopy =
    annotationGroupState.status === 'loading' ? 'Loading sets' : annotationCopy
  const roiGeneViewportWarmupRequiredKey =
    loadState.status === 'ready' ? roiGeneDatasetWarmupKey(loadState.url) : null
  const isRoiGeneViewportWarmupLoading =
    roiGeneViewportWarmupRequiredKey !== null &&
    !isVisiumHdDataset &&
    roiGeneViewportWarmupState.status === 'loading' &&
    roiGeneViewportWarmupState.key === roiGeneViewportWarmupRequiredKey
  const isDatasetPreparationPending =
    loadState.status === 'ready' && datasetWarmupState.status === 'loading'
  const canDrawRoi = platformAdapter.canDrawRoi({
    isDatasetPreparationPending,
    loadState,
    spatialGridCellCount: spatialGridCells.length,
    visiumHdControlState,
  })
  const roiHeaderCopy = isDatasetPreparationPending
    ? 'Preparing'
    : roiGeneStatsState.status === 'loading'
      ? 'Querying genes'
      : roiTranscriptExportState.status === 'loading'
        ? 'Exporting'
        : isRoiGeneViewportWarmupLoading
          ? 'Preparing genes'
          : roiCopy
  const isRoiTabLoading =
    roiState.status === 'loading' ||
    roiGeneStatsState.status === 'loading' ||
    roiTranscriptExportState.status === 'loading' ||
    isRoiGeneViewportWarmupLoading
  const roiSummary = useMemo(
    () => (roiState.status === 'ready' ? summarizeRoiCells(roiState.cells) : null),
    [roiState],
  )
  const visiumHdRoiSummary = useMemo(
    () =>
      activeVisiumHdRoiState.status === 'ready'
        ? summarizeVisiumHdRoiBins(activeVisiumHdRoiState.bins)
        : null,
    [activeVisiumHdRoiState],
  )
  const activeRoiSelection = platformRoiSelection(
    platformAdapter,
    roiState,
    activeVisiumHdRoiState,
  )
  const effectiveShowTranscriptOverlay =
    platformAdapter.effectiveTranscriptOverlay(showTranscriptOverlay)
  const transcriptDensityContent = useMemo(
    () => transcriptDensityContentForRendering(transcriptLayerState),
    [transcriptLayerState],
  )
  const geneExpressionZScoreCellsShown =
    geneExpressionState.status === 'ready'
      ? geneExpressionZScoreCells(geneExpressionState.mode)
      : undefined
  const geneExpressionNonFiniteCount = useMemo(
    () =>
      nonFiniteScoreCount(
        styledGeneExpressionElements.map((element) => element.expressionCount),
      ),
    [styledGeneExpressionElements],
  )
  const legendSections = useMemo(
    () =>
      viewerLegendSections({
        cellsVisible: layerVisibility.cells,
        cellNoun: {
          singular: platformAdapter.labels.embeddingElementPlural.replace(/s$/, ''),
          plural: platformAdapter.labels.embeddingElementPlural,
        },
        colorMode: observationColorMode,
        genes: {
          names: selectedGenes,
          scoreMode: geneExpressionScoreMode,
          colorScale: geneExpressionColorScale,
          scaleMin: geneExpressionScaleMin,
          scaleMax: geneExpressionScaleMax,
          status:
            geneExpressionState.status === 'ready'
              ? 'ready'
              : geneExpressionState.status === 'error' ||
                  geneExpressionState.status === 'waiting'
                ? 'unavailable'
                : 'loading',
          ...(geneExpressionZScoreCellsShown === undefined
            ? {}
            : { zScoreCells: geneExpressionZScoreCellsShown }),
          nonFiniteCount: geneExpressionNonFiniteCount,
        },
        annotations: legendAnnotations,
        metadataTrack:
          activeCellMetadataTrack === null || selectedCellMetadataTrack === null
            ? null
            : {
                label: selectedCellMetadataTrack.label,
                min: activeCellMetadataTrack.min,
                max: activeCellMetadataTrack.max,
              },
        cellAreaMax: legendCellAreaMax,
        transcripts: {
          density:
            effectiveShowTranscriptOverlay &&
            transcriptDensityContent !== null &&
            !transcriptGenes.markersShown
              ? {
                  colorScale: transcriptDensityColorScale,
                  labels: transcriptDensityScaleLabels,
                  content: transcriptDensityContent,
                }
              : null,
          // Loaded points, not drawn ones: hiding every gene in view keeps
          // the legend, so they can be shown again.
          pointColorMode:
            effectiveShowTranscriptOverlay &&
            transcriptPointsForRendering(transcriptLayerState).length > 0
              ? transcriptPointColorMode
              : null,
          genes: transcriptGenes.legend,
        },
      }),
    [
      activeCellMetadataTrack,
      effectiveShowTranscriptOverlay,
      layerVisibility.cells,
      geneExpressionColorScale,
      geneExpressionScaleMax,
      geneExpressionScaleMin,
      geneExpressionScoreMode,
      geneExpressionState.status,
      geneExpressionZScoreCellsShown,
      geneExpressionNonFiniteCount,
      legendAnnotations,
      legendCellAreaMax,
      observationColorMode,
      platformAdapter.labels.embeddingElementPlural,
      selectedCellMetadataTrack,
      selectedGenes,
      transcriptDensityColorScale,
      transcriptDensityContent,
      transcriptDensityScaleLabels,
      transcriptGenes.legend,
      transcriptGenes.markersShown,
      transcriptLayerState,
      transcriptPointColorMode,
    ],
  )
  const magicLensAvailability = platformAdapter.magicLensAvailability(
    loadState,
    spatialGridCells.length,
  )
  const magicLensLoadEnabled = magicLensAvailability.loadEnabled
  const shareableMorphologyEnabledChannelIds = useMemo(() => {
    if (baseMorphologyChannelIds.size === 0) {
      return undefined
    }

    if (morphologyChannelSettings.length > 0) {
      return morphologyChannelSettings
        .filter((setting) => setting.enabled && baseMorphologyChannelIds.has(setting.id))
        .map((setting) => setting.id)
    }

    return morphologyState.status === 'loading'
      ? initialShareableState.morphologyEnabledChannelIds
      : undefined
  }, [
    initialShareableState.morphologyEnabledChannelIds,
    baseMorphologyChannelIds,
    morphologyChannelSettings,
    morphologyState.status,
  ])
  // While the image opens, a shared plane stays in the link.
  const shareableMorphologyZPlane =
    morphologyImage?.zStack?.zPlane ??
    (morphologyImage === null && morphologyState.status === 'loading'
      ? initialShareableState.morphologyZPlane
      : undefined)
  const magicLensIsCursorActive =
    magicLensScope === 'cursor' && magicLensActive && magicLensLoadEnabled
  const magicLensCanScan =
    magicLensLoadEnabled &&
    magicLensState.status !== 'loading' &&
    (magicLensScope === 'cursor'
      ? true
      : magicLensScope === 'roi'
        ? activeRoiSelection !== null
        : currentViewportDetail !== null)
  const magicLensViewerSummary =
    magicLensState.status === 'ready' || magicLensState.status === 'loading'
      ? magicLensState.status === 'ready'
        ? magicLensState.summary
        : null
      : magicLensState.status === 'error'
        ? null
        : null
  const magicLensViewerStatus: ViewerMagicLensStatus =
    magicLensState.status === 'loading'
      ? 'loading'
      : magicLensState.status === 'ready'
        ? 'ready'
        : magicLensState.status === 'error'
          ? 'error'
          : 'idle'
  const magicLensCopy = magicLensStatusCopy(
    magicLensState,
    magicLensScope,
    loadState.status,
    magicLensCanScan,
    magicLensActive,
    magicLensAvailability.unavailableReason,
  )
  const transcriptCopy = transcriptStatusCopy(
    transcriptCapabilityState,
    transcriptLayerState,
    effectiveShowTranscriptOverlay,
  )
  const appendFallbackNotice = useCallback(
    (notice: FallbackNotice) => {
      fallbackNoticeIdRef.current += 1
      const entry = createFallbackNoticeEntry(fallbackNoticeIdRef.current, notice)

      setFallbackNotices((current) => appendFallbackNoticeEntry(current, entry))
      appendDebugEvent(`Fallback: ${notice.source}: ${notice.message}`, {
        ...(notice.coalesceKey === undefined ? {} : { coalesceKey: notice.coalesceKey }),
      })
    },
    [appendDebugEvent, setFallbackNotices],
  )
  const recordTelemetry = useCallback(
    (event: TelemetryEvent) => {
      setTelemetryEvents((current) =>
        appendTelemetryEvent(current, event, performanceBudget.telemetryEventLimit),
      )
    },
    [performanceBudget.telemetryEventLimit, setTelemetryEvents],
  )
  const handleTileCacheEviction = useCallback(
    (evictedTileCount: number) => {
      recordTelemetry(
        telemetryEvent('tile-cache.eviction', 'info', {
          detail: `${evictedTileCount.toLocaleString()} tiles`,
        }),
      )
    },
    [recordTelemetry],
  )
  useGeneExpressionLayerTelemetry({
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
    },
    data: {
      geneExpressionBatch,
      geneExpressionState,
    },
    refs: {
      timingKeyRef: geneExpressionLayerTimingKeyRef,
    },
    timings: {
      geneExpressionLayerDataDurationMs,
      geneExpressionRestyleDurationMs,
    },
  })
  const activeErrors = useMemo(
    () =>
      collectStructuredLoadErrors([
        loadState,
        pendingDatasetLoadState,
        diagnosticsState,
        morphologyState,
        customMorphologyLayerState,
        boundaryState,
        nucleusBoundaryState,
        genePanelState,
        annotationState,
        annotationGroupState,
        analysisEmbeddingState,
        roiState,
        roiGeneStatsState,
        roiTranscriptExportState,
        geneExpressionState,
        transcriptCapabilityState,
        transcriptLayerState,
        magicLensState,
        cellDetailState,
        cellTranscriptDistributionState,
        activeVisiumHdExpressionProfileState,
      ]),
    [
      annotationState,
      annotationGroupState,
      analysisEmbeddingState,
      boundaryState,
      cellDetailState,
      cellTranscriptDistributionState,
      activeVisiumHdExpressionProfileState,
      diagnosticsState,
      geneExpressionState,
      genePanelState,
      loadState,
      nucleusBoundaryState,
      magicLensState,
      morphologyState,
      customMorphologyLayerState,
      pendingDatasetLoadState,
      roiState,
      roiGeneStatsState,
      roiTranscriptExportState,
      transcriptCapabilityState,
      transcriptLayerState,
    ],
  )
  const {
    handleCancelDatasetDiagnostics,
    handleDownloadDiagnostics,
    handleRunDatasetDiagnostics,
  } = useDatasetDiagnosticsWorkflow({
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
    },
    controls: {
      ...(diagnosticsVisiumHdBinSize === undefined
        ? {}
        : { visiumHdBinSizeMicrometers: diagnosticsVisiumHdBinSize }),
    },
    dump: {
      openPanels: openPanelIds,
      activeErrors,
      boundaryCellLimit,
      coordinateUnit,
      datasetUrl,
      debugLog,
      diagnosticsState,
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScoreMode,
      geneExpressionState,
      hoveredTranscript,
      loadState,
      manualTranscriptExactRequestKey,
      measurementEnabled,
      measurementUnit,
      observationColorMode,
      performanceBudget,
      pinnedTranscript,
      selectedGenes,
      shareableViewState,
      shouldLoadMorphology,
      showTranscriptOverlay: effectiveShowTranscriptOverlay,
      telemetryEvents,
      transcriptCapabilityState,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactManualLoadRatio: TRANSCRIPT_EXACT_MANUAL_LOAD_RATIO,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode: effectiveTranscriptFeatureFilterMode,
      transcriptGeneOnly,
      transcriptLayerState,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    loaders: { runDatasetDiagnostics },
    refs: { diagnosticsAbortRef },
    setters: { setDiagnosticsState },
  })
  const handleImageTileError = useCallback(
    (error: Error) => {
      setMorphologyState((current) => {
        if (current.status !== 'ready') {
          return current
        }

        return morphologyLoadFailed(
          current.url,
          createStructuredLoadError('Image tiles', error),
        )
      })
    },
    [setMorphologyState],
  )
  // The percentile the Gene scale's top follows, read as each batch loads. A
  // ref, so a new percentile does not restart the expression loads that hold
  // rememberGeneExpressionScaleMax.
  const geneScaleTopPercentile = geneScalePercentile(geneExpressionScaleRange)
  const geneScalePercentileRef = useRef(geneScaleTopPercentile)
  useEffect(() => {
    geneScalePercentileRef.current = geneScaleTopPercentile
  }, [geneScaleTopPercentile])
  const rememberGeneExpressionScaleMax = useCallback(
    (key: string, batch: GeneExpressionBatch, scoreMode: GeneExpressionScoreMode) => {
      const percentile = geneScalePercentileRef.current
      const spread = geneExpressionScoreSpread(
        batch.elements,
        batch.genes,
        scoreMode,
        percentile,
        batch.cellCount,
      )

      if (spread.highest <= 0) {
        return
      }

      const batchKey = geneExpressionBatchScaleKey(key, batch)
      setGeneExpressionScaleDomain((current) =>
        geneExpressionScaleDomainWith(current, batchKey, percentile, spread),
      )
    },
    [setGeneExpressionScaleDomain],
  )
  const resetGeneExpressionSelectionState = useCallback(() => {
    invalidateLatestRequest({
      abortRef: geneExpressionAbortRef,
      requestIdRef: geneExpressionRequestId,
    })
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain(EMPTY_GENE_EXPRESSION_SCALE_DOMAIN)
    setGeneExpressionState(IDLE_GENE_EXPRESSION_STATE)
  }, [setGeneExpressionBatch, setGeneExpressionScaleDomain, setGeneExpressionState])
  const loadActiveAnnotations = useCallback<AnnotationLoader>(
    async (...args) => {
      const [baseUrl, options = {}] = args

      if (isAnnDataPlatform(platformAdapter)) {
        const dataset = await getSpatialDataset(baseUrl)

        if (!isH5adAnnotationDataset(dataset)) {
          throw new Error('Loaded H5AD dataset does not expose annotations.')
        }

        return dataset.annotations({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
        })
      }

      if (platformAdapter.kind === 'visium-hd') {
        const dataset = await getSpatialDataset(baseUrl)

        if (!isVisiumHdAnnotationDataset(dataset)) {
          throw new Error('Loaded Visium HD dataset does not expose annotations.')
        }

        // A set's id names its tier; "All" reads the active tier's sets.
        // Bin barcodes stand in for cell IDs.
        return (await dataset.annotations({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
          ...(activeVisiumHdBinSize === undefined
            ? {}
            : { binSizeMicrometers: activeVisiumHdBinSize }),
        })) as readonly Annotation[]
      }

      return loadAnnotations(baseUrl, options)
    },
    [activeVisiumHdBinSize, getSpatialDataset, loadAnnotations, platformAdapter],
  )
  // Only AnnData tracks arrive without values; imported CSV/JSON tracks carry them.
  const loadActiveCellMetadataTrackValues = useCallback<CellMetadataTrackValuesLoader>(
    async (baseUrl, trackId, options = {}) => {
      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adMetadataTrackDataset(dataset)) {
        throw new Error('Loaded dataset does not expose metadata track values.')
      }

      return dataset.metadataTrackValues(trackId, options)
    },
    [getSpatialDataset],
  )
  const loadActiveAnalysisEmbeddings = useCallback<AnalysisEmbeddingsLoader>(
    async (...args) => {
      const [baseUrl, options = {}] = args

      if (isAnnDataPlatform(platformAdapter)) {
        const dataset = await getSpatialDataset(baseUrl)

        if (!isH5adEmbeddingDataset(dataset)) {
          throw new Error('Loaded H5AD dataset does not expose embeddings.')
        }

        return dataset.embeddings({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
        })
      }

      return loadAnalysisEmbeddings(baseUrl, {
        ...options,
        ...platformAnalysisEmbeddingOptions(platformAdapter, activeVisiumHdBinSize),
      })
    },
    [activeVisiumHdBinSize, getSpatialDataset, loadAnalysisEmbeddings, platformAdapter],
  )
  const segmentationPlacement = useMemo<SegmentationPlacement | null>(() => {
    const loader = morphologyImage?.loader

    return platformAdapter.kind !== 'image' || loader === undefined
      ? null
      : {
          micrometersPerPixel: loader.units.micrometersPerPixel,
          imageWidth: loader.imageWidth,
          imageHeight: loader.imageHeight,
        }
  }, [morphologyImage, platformAdapter.kind])
  const handleSegmentationReady = useCallback(() => {
    setShowCellBoundaries(true)
  }, [setShowCellBoundaries])
  const importedSegmentation = useImportedSegmentation({
    datasetUrl: platformAdapter.kind === 'image' ? loadedDatasetUrl : null,
    placement: segmentationPlacement,
    appendDebugEvent,
    onReady: handleSegmentationReady,
  })
  // A new or removed segmentation reads its outlines again: the last
  // request's area no longer stands for what is drawn. Declared before the
  // viewport workflow, whose replay of the view then asks afresh.
  const boundarySegmentation = importedSegmentation.segmentation
  const boundarySegmentationRef = useRef(boundarySegmentation)

  useEffect(() => {
    if (boundarySegmentationRef.current === boundarySegmentation) {
      return
    }

    boundarySegmentationRef.current = boundarySegmentation
    invalidateLatestRequest({
      abortRef: boundaryAbortRef,
      requestIdRef: boundaryRequestId,
    })
    boundaryViewportKeyRef.current = null
    setBoundaryElements((current) => (current.length === 0 ? current : []))
    setBoundaryState(IDLE_BOUNDARY_LOAD_STATE)
  }, [boundarySegmentation, setBoundaryElements, setBoundaryState])
  const loadActiveBoundaryElements = useCallback<BoundaryElementsLoader>(
    (...args) =>
      loadPlatformBoundaryElements(
        platformAdapter,
        {
          getSpatialDataset,
          loadBoundaryElements,
          importedSegmentation: importedSegmentation.segmentation,
        },
        ...args,
      ),
    [
      getSpatialDataset,
      importedSegmentation.segmentation,
      loadBoundaryElements,
      platformAdapter,
    ],
  )
  const loadActiveCellOutlines = useCallback<CellOutlinesLoader>(
    (...args) =>
      loadPlatformCellOutlines(
        platformAdapter,
        { getSpatialDataset, loadBoundaryElements },
        ...args,
      ),
    [getSpatialDataset, loadBoundaryElements, platformAdapter],
  )
  const loadActiveNucleusBoundaryElements = useCallback<BoundaryElementsLoader>(
    (...args) =>
      loadPlatformNucleusBoundaryElements(
        platformAdapter,
        { getSpatialDataset },
        ...args,
      ),
    [getSpatialDataset, platformAdapter],
  )
  const loadActiveGeneExpression = useCallback<GeneExpressionLoader>(
    (...args) =>
      loadPlatformGeneExpression(
        platformAdapter,
        {
          activeBinSize: activeVisiumHdBinSize,
          getSpatialDataset,
          loadGeneExpression,
        },
        ...args,
      ),
    [activeVisiumHdBinSize, getSpatialDataset, loadGeneExpression, platformAdapter],
  )
  const loadActiveTranscriptCapabilities = useCallback<TranscriptCapabilitiesLoader>(
    (...args) =>
      loadPlatformTranscriptCapabilities(
        platformAdapter,
        { getSpatialDataset, loadTranscriptCapabilities },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptCapabilities, platformAdapter],
  )
  const loadActiveTranscriptAggregates = useCallback<TranscriptAggregateLoader>(
    (...args) =>
      loadPlatformTranscriptAggregates(
        platformAdapter,
        { getSpatialDataset, loadTranscriptAggregates },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptAggregates, platformAdapter],
  )
  const loadActiveTranscriptViewport = useCallback<TranscriptViewportLoader>(
    (...args) =>
      loadPlatformTranscriptViewport(
        platformAdapter,
        { getSpatialDataset, loadTranscriptViewport },
        ...args,
      ),
    [getSpatialDataset, loadTranscriptViewport, platformAdapter],
  )
  const loadActiveRoiCells = useCallback<RoiCellsLoader>(
    async (...args) => {
      const [baseUrl, selection, options = {}] = args

      if (!isAnnDataPlatform(platformAdapter)) {
        return loadRoiCells(baseUrl, selection, options)
      }

      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adRoiDataset(dataset)) {
        throw new Error('Loaded H5AD dataset does not expose ROI cell lookup.')
      }

      return dataset.cells(selection, {
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      })
    },
    [getSpatialDataset, loadRoiCells, platformAdapter],
  )
  const loadActiveRoiGeneStats = useCallback<RoiGeneStatsLoader>(
    async (...args) => {
      const [baseUrl, cells, options = {}] = args

      if (!isAnnDataPlatform(platformAdapter)) {
        return loadRoiGeneStats(baseUrl, cells, options)
      }

      const dataset = await getSpatialDataset(baseUrl)

      if (!isH5adExpressionDataset(dataset)) {
        throw new Error('Loaded H5AD dataset does not expose expression matrix reads.')
      }

      const h5adDataset: H5adExpressionDataset = dataset
      const sampledCells = h5adSampleCells(cells, options.cellLimit)
      const sampledCellIds = sampledCells.map((cell) => cell.id as SpatialElementId)
      const matrix = await h5adDataset.matrix(sampledCellIds)

      return summarizeRoiGeneExpression(matrix, {
        cellCount: cells.length,
        sampledCellIds,
        ...(options.geneLimit === undefined ? {} : { geneLimit: options.geneLimit }),
      })
    },
    [getSpatialDataset, loadRoiGeneStats, platformAdapter],
  )
  // Atera reads transcripts per gene, so its ROI export and cell histogram
  // follow the selected genes; other platforms' loaders do not change with
  // them.
  const perGeneTranscriptGenes =
    platformAdapter.kind === 'atera' ? selectedGenes : NO_PER_GENE_TRANSCRIPT_GENES
  const loadActiveRoiTranscripts = useCallback<RoiTranscriptsLoader>(
    (...args) =>
      loadPlatformRoiTranscripts(
        platformAdapter,
        {
          getSpatialDataset,
          loadRoiTranscripts,
          selectedGenes: perGeneTranscriptGenes,
        },
        ...args,
      ),
    [getSpatialDataset, loadRoiTranscripts, perGeneTranscriptGenes, platformAdapter],
  )
  const loadActiveCellTranscriptDistribution =
    useCallback<CellTranscriptDistributionLoader>(
      (...args) =>
        loadPlatformCellTranscriptDistribution(
          platformAdapter,
          {
            getSpatialDataset,
            loadCellTranscriptDistribution,
            selectedGenes: perGeneTranscriptGenes,
          },
          ...args,
        ),
      [
        getSpatialDataset,
        loadCellTranscriptDistribution,
        perGeneTranscriptGenes,
        platformAdapter,
      ],
    )
  const loadVisiumHdMagicLensSummary = useVisiumHdMagicLensSummary({
    controls: {
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      currentViewportDetail,
      geneExpressionBatch,
      gridCells: spatialGridCells,
      loadState,
      selectedGenes,
    },
    loaders: {
      getSpatialDataset,
      loadGeneExpression: loadActiveGeneExpression,
    },
  })
  useEffect(() => {
    if (observationColorMode !== 'gene-expression') {
      colorModeBeforeGenesRef.current = observationColorMode
    }
  }, [observationColorMode])
  const toggleGene = useCallback(
    (gene: string) => {
      const isSelected = selectedGenes.includes(gene)
      const nextGenes = isSelected
        ? selectedGenes.filter((selectedGene) => selectedGene !== gene)
        : [...selectedGenes, gene].sort((a, b) => a.localeCompare(b))

      appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
      resetGeneExpressionSelectionState()
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes(nextGenes)
      setObservationColorMode((mode) =>
        colorModeAfterGeneChange(mode, colorModeBeforeGenesRef.current, {
          added: !isSelected,
          geneCount: nextGenes.length,
        }),
      )
    },
    [
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      selectedGenes,
      setManualTranscriptExactRequestKey,
      setObservationColorMode,
      setSelectedGenes,
    ],
  )
  // A gene in the Selection card colours the cells by it alone (15.4-B).
  const showGene = useCallback(
    (gene: string) => {
      appendDebugEvent(`Colour by gene ${gene}`)
      if (selectedGenes.length !== 1 || selectedGenes[0] !== gene) {
        resetGeneExpressionSelectionState()
        setManualTranscriptExactRequestKey(null)
        setSelectedGenes([gene])
      }
      setObservationColorMode('gene-expression')
    },
    [
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      selectedGenes,
      setManualTranscriptExactRequestKey,
      setObservationColorMode,
      setSelectedGenes,
    ],
  )
  const handlePinTranscript = useCallback(
    (detail: ViewerTranscriptHoverDetail) => {
      setPinnedTranscript(detail)
      appendDebugEvent(
        detail.transcript === undefined
          ? 'Pinned transcript density bin'
          : `Pinned transcript ${detail.transcript.transcriptId ?? detail.transcript.id}`,
        { coalesceKey: 'transcript-pin' },
      )
    },
    [appendDebugEvent, setPinnedTranscript],
  )
  const { handleViewportChange } = useViewportDataWorkflow({
    callbacks: {
      appendDebugEvent,
      recordTelemetry,
      rememberGeneExpressionScaleMax,
    },
    controls: {
      boundaryCellLimit,
      cellBoundaryLoadingEnabled:
        platformAdapter.cellBoundaryLoadingEnabled(showCellBoundaries),
      geneExpressionDetailMode,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      ...(activeVisiumHdBinSize === undefined
        ? {}
        : { visiumHdBinSizeMicrometers: activeVisiumHdBinSize }),
      viewportCellCount:
        platformAdapter.kind === 'image'
          ? importedSegmentation.viewportCellCount
          : undefined,
    },
    data: {
      loadState,
      overviewExtent,
      selectedGenes,
    },
    loaders: {
      boundaryElements: loadActiveBoundaryElements,
      ...(platformAdapter.capabilities.nucleusBoundaries && showNucleusBoundaries
        ? { nucleusBoundaryElements: loadActiveNucleusBoundaryElements }
        : {}),
      geneExpression: loadActiveGeneExpression,
    },
    requests: {
      boundary: {
        abortRef: boundaryAbortRef,
        requestIdRef: boundaryRequestId,
        boundaryViewportKeyRef,
      },
      nucleusBoundary: {
        abortRef: nucleusBoundaryAbortRef,
        requestIdRef: nucleusBoundaryRequestId,
        boundaryViewportKeyRef: nucleusBoundaryViewportKeyRef,
      },
      geneExpression: {
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestId,
        geneExpressionViewportKeyRef,
      },
      lastViewportDetailRef,
    },
    setters: {
      setBoundaryElements,
      setNucleusBoundaryElements,
      setNucleusBoundaryState,
      setBoundaryState,
      setCurrentViewportDetail,
      setGeneExpressionBatch,
      setGeneExpressionState,
      setShareableViewState,
    },
  })

  const { cancelTranscriptLoad, transcriptLoadProgress } = useTranscriptWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      transcriptControlsOpen: openPanelIds.includes('transcripts'),
      effectiveTranscriptFeatureFilterMode,
      manualTranscriptExactRequestKey,
      showTranscriptOverlay: effectiveShowTranscriptOverlay,
      transcriptDetailMode,
      transcriptExactPointLimit,
      transcriptGeneOnly,
      transcriptMinQv,
      visibleTranscriptEstimate,
    },
    data: {
      currentViewportDetail,
      loadState,
      overviewCells,
      selectedGenes,
      transcriptCapabilityState,
    },
    loaders: {
      loadTranscriptAggregates: loadActiveTranscriptAggregates,
      loadTranscriptCapabilities: loadActiveTranscriptCapabilities,
      loadTranscriptViewport: loadActiveTranscriptViewport,
    },
    refs: {
      loadRequestIdRef: loadRequestId,
      transcriptAbortRef,
      transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
      transcriptRequestIdRef: transcriptRequestId,
      transcriptViewportKeyRef,
    },
    setters: {
      setManualTranscriptExactRequestKey,
      setTranscriptCapabilityState,
      setTranscriptLayerState,
    },
  })
  // Built after the transcript workflow, which reports exact-read progress.
  const loadingTasks = useMemo(
    () =>
      createLoadingTasks({
        analysisEmbeddingState,
        annotationGroupState,
        annotationState,
        autoContrastChannelCount: autoContrastChannelIds.length,
        boundaryState,
        nucleusBoundaryState,
        cellDetailState,
        cellTranscriptDistributionState,
        visiumHdExpressionProfileState: activeVisiumHdExpressionProfileState,
        datasetWarmupState,
        diagnosticsState,
        geneExpressionState,
        geneExpressionLoadingLabel:
          geneExpressionState.status === 'loading'
            ? geneExpressionModeLabel(geneExpressionState.mode, embeddingElementLabel)
            : undefined,
        visiumHdExpressionProjectionState,
        genePanelState,
        isRoiGeneViewportWarmupLoading,
        // The dataset load in progress, whether or not it replaces one.
        loadState:
          pendingDatasetLoadState.status === 'loading'
            ? pendingDatasetLoadState
            : loadState,
        magicLensState,
        magicLensLoadingScopeLabel:
          magicLensState.status === 'loading'
            ? magicLensScopeLabel(magicLensState.scope)
            : undefined,
        morphologyState,
        customMorphologyLayerState,
        roiGeneStatsState,
        roiState,
        roiTranscriptExportState,
        transcriptCapabilityState,
        transcriptLayerState,
        transcriptLoadProgress,
        segmentationLoading:
          importedSegmentation.state.status === 'loading'
            ? importedSegmentation.state.shapeCount === undefined
              ? {}
              : {
                  detail: `${importedSegmentation.state.shapeCount.toLocaleString()} outlines`,
                }
            : undefined,
        boundariesAreSegmentation: platformAdapter.kind === 'image',
      }),
    [
      importedSegmentation.state,
      platformAdapter.kind,
      analysisEmbeddingState,
      annotationGroupState,
      annotationState,
      autoContrastChannelIds.length,
      boundaryState,
      cellDetailState,
      cellTranscriptDistributionState,
      activeVisiumHdExpressionProfileState,
      datasetWarmupState,
      diagnosticsState,
      embeddingElementLabel,
      geneExpressionState,
      genePanelState,
      visiumHdExpressionProjectionState,
      isRoiGeneViewportWarmupLoading,
      loadState,
      magicLensState,
      morphologyState,
      customMorphologyLayerState,
      nucleusBoundaryState,
      pendingDatasetLoadState,
      roiGeneStatsState,
      roiState,
      roiTranscriptExportState,
      transcriptCapabilityState,
      transcriptLayerState,
      transcriptLoadProgress,
    ],
  )
  const loadingAreas = useMemo(
    () => new Set(loadingTasks.map((task) => task.area)),
    [loadingTasks],
  )

  const { cancelCellDetails } = useCellDetailWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    data: {
      cellDetailState,
      loadState,
      selectedCell,
      transcriptDistributionEnabled:
        platformAdapter.capabilities.cellTranscriptDistribution,
    },
    loaders: {
      loadBoundaryElements: loadActiveBoundaryElements,
      loadCellTranscriptDistribution: loadActiveCellTranscriptDistribution,
      loadRoiGeneStats: loadActiveRoiGeneStats,
    },
    refs: {
      cellDetailAbortRef,
      cellDetailRequestIdRef: cellDetailRequestId,
      cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef: cellTranscriptDistributionRequestId,
    },
    setters: {
      setCellDetailState,
      setCellTranscriptDistributionState,
    },
  })
  useGridCellAssignmentWorkflow({
    callbacks: { appendDebugEvent },
    controls: {
      isVisiumHdDataset,
      rowBudget: visiumHdBarcodeMappingRowBudget,
      selectedBinSize: activeVisiumHdBinSize,
    },
    data: {
      loadState,
      selectedGridCell,
    },
    loaders: { getSpatialDataset },
    refs: {
      gridCellAssignmentAbortRef,
      gridCellAssignmentRequestIdRef: gridCellAssignmentRequestId,
    },
    setters: { setGridCellAssignmentState },
  })

  // The reference sample for enriched genes (15.4-B): runs of consecutive
  // cells spread through the overview, which is in matrix row order. On
  // Xenium the index is the cell-feature matrix row.
  const roiReferenceCells = useMemo<readonly DatasetCell[]>(() => {
    const withRows = platformAdapter.kind === 'xenium'
    return referenceSampleIndices(overviewCells.length).flatMap((index) => {
      const cell = overviewCells[index]
      if (cell === undefined) return []
      return [
        {
          // Overview IDs are the dataset's own: Xenium cell IDs, or obs
          // names, which the AnnData readers take as they are.
          id: cell.id as CellId,
          position: {
            x: micrometers(cell.position[0] ?? 0),
            y: micrometers(-(cell.position[1] ?? 0)),
          },
          ...(withRows ? { cellFeatureMatrixRow: index } : {}),
        },
      ]
    })
  }, [overviewCells, platformAdapter.kind])
  const roiReferenceBins = useMemo(
    () =>
      referenceSampleIndices(spatialGridCells.length).map((index) =>
        gridCellAt(spatialGridCells, index),
      ),
    [spatialGridCells],
  )
  const {
    handleCancelRoiCells,
    handleCancelRoiGenes,
    handleClearRoi,
    handleExportRoiCells,
    handleExportRoiGeoJson,
    handleExportRoiTranscripts,
    handleRoiComplete,
  } = useRoiWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      currentViewportDetail,
      enabled: platformAdapter.kind !== 'visium-hd',
      magicLensScope,
      viewportGeneWarmupEnabled: !isAnnDataPlatform(platformAdapter),
      roiName,
      referenceCells: roiReferenceCells,
    },
    data: {
      loadState,
      roiState,
    },
    loaders: {
      loadRoiCells: loadActiveRoiCells,
      loadRoiGeneStats: loadActiveRoiGeneStats,
      loadRoiTranscripts: loadActiveRoiTranscripts,
    },
    refs: {
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiIdRef,
      roiRequestIdRef: roiRequestId,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
    },
    setters: {
      setMagicLensState,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setRoiState,
      setRoiTranscriptExportState,
    },
  })
  const {
    clearVisiumHdRoiState,
    handleClearActiveRoi,
    handleExportVisiumHdRoiBarcodes,
    handleExportVisiumHdRoiGeoJson,
    handleVisiumHdRoiComplete,
  } = useVisiumHdRoiWorkflow({
    callbacks: {
      appendDebugEvent,
      clearRoi: handleClearRoi,
    },
    controls: {
      activeBinSize: activeVisiumHdBinSize,
      isVisiumHdDataset,
      roiName,
    },
    data: {
      activeRoiState: activeVisiumHdRoiState,
      gridCells: spatialGridCells,
      styleGridCell,
      loadState,
      referenceBins: roiReferenceBins,
    },
    loaders: {
      getSpatialDataset,
    },
    refs: {
      roiGeneAbortRef: roiAbortRef,
      roiGeneRequestIdRef: roiRequestId,
      roiIdRef,
    },
    setters: {
      setRoiGeneStatsState,
      setRoiMode,
      setRoiName,
      setRoiReferenceState,
      setVisiumHdRoiState,
    },
  })
  const handleBeforeDatasetLoad = useCallback(() => {
    clearVisiumHdRoiState()
    clearVisiumHdExpressionProfileState()
    setGeometricAnnotations([])
    setGeometricAnnotationImportError(null)
    setFallbackNotices([])
  }, [
    clearVisiumHdExpressionProfileState,
    clearVisiumHdRoiState,
    setFallbackNotices,
    setGeometricAnnotationImportError,
    setGeometricAnnotations,
  ])
  const handleBeforeVisiumHdBinSizeChange = useCallback(() => {
    clearVisiumHdRoiState()
    clearVisiumHdExpressionProfileState()
  }, [clearVisiumHdExpressionProfileState, clearVisiumHdRoiState])

  const {
    annotationImportNotice,
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleClearAnnotations,
    handleExportAnnotations,
    handleImportAnnotationUrl,
    handleImportAnnotations,
    handleLoadAnnotations,
    handleRemoveCellMetadataTrack,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
    handleSaveQueryAnnotation,
    loadAnnotationGroup,
  } = useAnnotationWorkflow({
    callbacks: { appendDebugEvent },
    data: {
      annotationState,
      cellMetadataTracks,
      datasetCellIds: overviewCellById,
      datasetUrl,
      loadState,
      roiName,
      roiState,
      selectedAnnotationGroupId,
    },
    loaders: { loadAnnotations: loadActiveAnnotations },
    refs: {
      datasetAbortRef,
      loadRequestIdRef: loadRequestId,
      roiIdRef,
    },
    setters: {
      setAnnotationColors,
      setAnnotationState,
      setCellMetadataTracks,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setObservationColorMode,
      setSelectedAnnotationGroupId,
      setSelectedCellMetadataTrackId,
    },
  })
  useVisiumHdAnnotationSetsWorkflow({
    appendDebugEvent,
    activeBinSize: activeVisiumHdBinSize,
    annotationState,
    getSpatialDataset,
    isVisiumHdDataset,
    loadAnnotationGroup,
    loadState,
    setAnnotationGroupState,
    setAnnotationState,
    setSelectedAnnotationGroupId,
  })
  useCellMetadataTrackValues({
    callbacks: { appendDebugEvent },
    data: { loadState, observationColorMode, selectedCellMetadataTrack },
    loaders: { loadCellMetadataTrackValues: loadActiveCellMetadataTrackValues },
    refs: { datasetAbortRef, loadRequestIdRef: loadRequestId },
    setters: { setCellMetadataTracks },
  })
  const handleImportGeometricAnnotations = useCallback(
    async (file: File | null) => {
      if (file === null) {
        return
      }

      try {
        geometricAnnotationIdRef.current += 1
        const imported = parseGeometricAnnotationsGeoJson(await file.text(), {
          defaultCoordinateUnit:
            platformAdapter.kind === 'image' ? 'pixel' : 'micrometer',
          micrometersPerPixel: viewerMicrometersPerPixel ?? 1,
          idPrefix: `geojson:${geometricAnnotationIdRef.current}`,
        })

        if (imported.length === 0) {
          setGeometricAnnotationImportError(geometricAnnotationsEmptyMessage(file.name))
          appendDebugEvent('GeoJSON annotations empty')
          return
        }

        setGeometricAnnotationImportError(null)
        setGeometricAnnotations((current) => [...imported, ...current])
        appendDebugEvent(
          `GeoJSON annotations imported: ${imported.length.toLocaleString()} shapes`,
        )
      } catch (error) {
        setGeometricAnnotationImportError(
          geometricAnnotationsImportFailedMessage(file.name, error),
        )
        appendDebugEvent('GeoJSON annotation import failed')
      }
    },
    [
      appendDebugEvent,
      platformAdapter.kind,
      setGeometricAnnotationImportError,
      setGeometricAnnotations,
      viewerMicrometersPerPixel,
    ],
  )
  const handleExportGeometricAnnotations = useCallback(() => {
    if (geometricAnnotations.length === 0) {
      return
    }

    downloadTextFile(
      'geometric-annotations.geojson',
      geometricAnnotationsToGeoJson(geometricAnnotations),
    )
    appendDebugEvent(
      `GeoJSON annotations exported: ${geometricAnnotations.length.toLocaleString()} shapes`,
    )
  }, [appendDebugEvent, geometricAnnotations])
  const handleClearGeometricAnnotations = useCallback(() => {
    if (geometricAnnotations.length === 0) {
      return
    }

    setGeometricAnnotations([])
    appendDebugEvent('Cleared GeoJSON annotations')
  }, [appendDebugEvent, geometricAnnotations.length, setGeometricAnnotations])
  const handleGeometricAnnotationColorChange = useCallback(
    (annotationId: string, color: string) => {
      setGeometricAnnotations((current) =>
        updateGeometricAnnotationColor(current, annotationId, color),
      )
      appendDebugEvent(`GeoJSON annotation color ${annotationId}`, {
        coalesceKey: `geometric-annotation-color:${annotationId}`,
      })
    },
    [appendDebugEvent, setGeometricAnnotations],
  )
  const handleGeometricAnnotationVisibilityChange = useCallback(
    (annotationId: string, visible: boolean) => {
      setGeometricAnnotations((current) =>
        updateGeometricAnnotationVisibility(current, annotationId, visible),
      )
    },
    [setGeometricAnnotations],
  )
  const handleRemoveGeometricAnnotation = useCallback(
    (annotationId: string) => {
      setGeometricAnnotations((current) =>
        removeGeometricAnnotation(current, annotationId),
      )
      appendDebugEvent(`Removed GeoJSON annotation ${annotationId}`)
    },
    [appendDebugEvent, setGeometricAnnotations],
  )
  const handleImageRoiComplete = useCallback(
    (selection: RoiSelection) => {
      if (loadState.status !== 'ready') {
        return
      }

      geometricAnnotationIdRef.current += 1
      const name = roiName.trim() || defaultRoiName(geometricAnnotationIdRef.current)
      const id = `geometry:${geometricAnnotationIdRef.current}:${slug(name) || 'shape'}`
      const feature = geometricAnnotationFromRoiSelection({
        id,
        label: name,
        color: annotationPaletteColor(geometricAnnotations.length),
        selection,
      })

      setGeometricAnnotations((current) => [feature, ...current])
      setRoiMode('idle')
      setRoiName(defaultRoiName(geometricAnnotationIdRef.current + 1))
      appendDebugEvent(`Saved geometric annotation ${name}`)
    },
    [
      appendDebugEvent,
      geometricAnnotations.length,
      loadState.status,
      roiName,
      setGeometricAnnotations,
      setRoiMode,
      setRoiName,
    ],
  )
  // The link's import runs after its set loads, with the handler current then.
  const handleImportAnnotationUrlRef = useRef(handleImportAnnotationUrl)
  useEffect(() => {
    handleImportAnnotationUrlRef.current = handleImportAnnotationUrl
  })
  useEffect(() => {
    const pending = pendingAnnotationGroupsRef.current

    if (pending === null || loadedDatasetUrl === null) {
      return
    }

    // Only the dataset they were kept for takes the sets; the dataset open
    // when they were kept may still be showing until it loads.
    if (loadedDatasetUrl !== pending.datasetUrl) {
      if (loadedDatasetUrl !== pending.openUrl) {
        pendingAnnotationGroupsRef.current = null
      }
      return
    }

    if (
      annotationGroupState.status !== 'ready' ||
      annotationGroupState.url !== loadedDatasetUrl
    ) {
      return
    }

    pendingAnnotationGroupsRef.current = null
    const groupId = linkAnnotationGroupId(pending.groupIds, annotationGroupState.groups)

    if (groupId !== undefined) {
      setSelectedAnnotationGroupId(groupId)
      // The commit already applied the link's colour mode; a version 2 link
      // leaves out the default one. A hand-written link with no version and
      // no cellColor= colours cells by the set, as choosing it would.
      // The classes the link hides stay hidden once the set loads.
      const load = loadAnnotationGroup(groupId, {
        switchColorMode: pending.switchColorMode,
        hiddenAnnotationIds: pending.hiddenAnnotationIds,
        hiddenAnnotationSetIds: pending.hiddenAnnotationSetIds,
      })
      linkAnnotationSetLoadRef.current = load
      void load.then(() => {
        if (linkAnnotationSetLoadRef.current === load) {
          linkAnnotationSetLoadRef.current = null
        }
      })
    }
  }, [
    annotationGroupState,
    loadAnnotationGroup,
    loadedDatasetUrl,
    setSelectedAnnotationGroupId,
  ])
  // Declared after the effect above, which starts the link's set first.
  useEffect(() => {
    if (loadedDatasetUrl === null) {
      return
    }

    const initialAnnotationUrl = initialAnnotationImportUrlRef.current

    if (initialAnnotationUrl === null) {
      return
    }

    // Loading a set replaces the labels shown, so an import that finished
    // first was lost. The link's labels were made with the set loaded
    // first, so its import waits for the set: while the dataset lists its
    // sets, and then while the set loads.
    if (
      pendingAnnotationGroupsRef.current?.datasetUrl === loadedDatasetUrl &&
      annotationGroupState.status === 'loading'
    ) {
      return
    }

    initialAnnotationImportUrlRef.current = null
    const requestId = loadRequestId.current
    const importLinkAnnotations = () => {
      // Another dataset was opened while the set loaded.
      if (loadRequestId.current !== requestId) {
        return
      }

      void handleImportAnnotationUrlRef
        .current(initialAnnotationUrl, {
          hiddenAnnotationIds: initialShareableState.hiddenAnnotationIds,
          hiddenAnnotationSetIds: initialShareableState.hiddenAnnotationSetIds,
        })
        .then((imported) => {
          if (imported) {
            setAnnotationImportUrl(initialAnnotationUrl)
          }
        })
    }
    const setLoad = linkAnnotationSetLoadRef.current

    if (setLoad === null) {
      importLinkAnnotations()
    } else {
      void setLoad.then(importLinkAnnotations)
    }
  }, [
    annotationGroupState.status,
    initialShareableState.hiddenAnnotationIds,
    initialShareableState.hiddenAnnotationSetIds,
    loadRequestId,
    loadedDatasetUrl,
    setAnnotationImportUrl,
  ])

  const {
    handleCancelAnalysisEmbeddings,
    handleEmbeddingCellSelect,
    handleLoadAnalysisEmbeddings,
  } = useAnalysisEmbeddingWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
      onSelectedCellFocus: focusSpatialViewOnCell,
    },
    data: {
      analysisEmbeddingState,
      loadState,
      overviewCellById,
      selectedEmbeddingKind,
    },
    loaders: {
      loadAnalysisEmbeddings: loadActiveAnalysisEmbeddings,
    },
    refs: {
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
    },
    setters: {
      setAnalysisEmbeddingState,
      setSelectedCell,
      setSelectedEmbeddingKind,
    },
  })
  const handleEmbeddingElementSelect = useCallback(
    (elementId: string) => {
      if (!isVisiumHdDataset) {
        setSelectedGridCell(null)
        setSelectedBoundaryCell(null)
        handleEmbeddingCellSelect(elementId)
        return
      }

      const gridCell = gridCellById(spatialGridCells, elementId)

      if (gridCell === undefined) {
        return
      }

      setSelectedCell(null)
      setSelectedBoundaryCell(null)
      clearVisiumHdExpressionProfileState()
      setSelectedGridCell(gridCell)
      focusSpatialViewOnGridCell(gridCell)
    },
    [
      clearVisiumHdExpressionProfileState,
      focusSpatialViewOnGridCell,
      handleEmbeddingCellSelect,
      isVisiumHdDataset,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
      spatialGridCells,
    ],
  )
  // Stable viewer click handlers keep the deck props unchanged across App
  // renders, so unrelated state changes do not redraw every cell.
  const handleViewerCellClick = useCallback(
    (cell: OverviewCellDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedGridCell(null)
      setSelectedBoundaryCell(null)
      setSelectedCell(cell)
    },
    [
      clearVisiumHdExpressionProfileState,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )
  const handleViewerCellBoundaryClick = useCallback(
    (cell: CellBoundaryDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedCell(null)
      setSelectedGridCell(null)
      setSelectedBoundaryCell(cell)
    },
    [
      clearVisiumHdExpressionProfileState,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )
  const handleViewerGridCellClick = useCallback(
    (cell: GridCellDatum) => {
      clearVisiumHdExpressionProfileState()
      setSelectedCell(null)
      setSelectedBoundaryCell(null)
      setSelectedGridCell(cell)
    },
    [
      clearVisiumHdExpressionProfileState,
      setSelectedBoundaryCell,
      setSelectedCell,
      setSelectedGridCell,
    ],
  )

  const handleClearSelection = useCallback(() => {
    clearVisiumHdExpressionProfileState()
    setSelectedCell(null)
    setSelectedBoundaryCell(null)
    setSelectedGridCell(null)
  }, [
    clearVisiumHdExpressionProfileState,
    setSelectedBoundaryCell,
    setSelectedCell,
    setSelectedGridCell,
  ])
  // The selected cell's nuclei drawn in the view, for the Cell card.
  const selectedCellNuclei = useMemo(() => {
    const cellId = activeSelectedBoundaryCell?.id ?? selectedCell?.id

    return cellId === undefined || visibleNucleusBoundaryLayerData.length === 0
      ? EMPTY_CELL_BOUNDARY_DATA
      : visibleNucleusBoundaryLayerData.filter((nucleus) => nucleus.cellId === cellId)
  }, [activeSelectedBoundaryCell, selectedCell, visibleNucleusBoundaryLayerData])
  const drawnBoundaryById = useMemo(
    () =>
      new Map(
        expressionStyledBoundaryLayerData.map((boundary) => [boundary.id, boundary]),
      ),
    [expressionStyledBoundaryLayerData],
  )
  const selectionHighlight = useMemo(
    () =>
      viewerSelectionHighlight({
        selectedCell,
        selectedBoundaryCell,
        selectedGridCell,
        drawnBoundaries: drawnBoundaryById,
      }),
    [drawnBoundaryById, selectedBoundaryCell, selectedCell, selectedGridCell],
  )

  const {
    handleCancelMagicLens,
    handleMagicLensClear,
    handleMagicLensCursorActiveChange,
    handleMagicLensLeave,
    handleMagicLensMove,
    handleMagicLensRadiusChange,
    handleMagicLensScopeChange,
    handleMagicLensSummarise,
  } = useMagicLensWorkflow({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
    },
    controls: {
      magicLensActive,
      magicLensScope,
    },
    data: {
      activeRoiSelection,
      currentViewportDetail,
      loadState,
      selectedGenes,
    },
    loaders: {
      loadRoiCells: loadActiveRoiCells,
      loadRoiGeneStats: loadActiveRoiGeneStats,
      ...(platformAdapter.kind === 'visium-hd'
        ? { loadMagicLensSummary: loadVisiumHdMagicLensSummary }
        : {}),
    },
    refs: {
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
    },
    setters: {
      setMagicLensActive,
      setMagicLensRadiusMicrometers,
      setMagicLensScope,
      setMagicLensState,
      setMeasurementResetKey,
    },
  })
  const returnToPan = useCallback(() => {
    if (activeTool === 'magic-lens') handleMagicLensLeave()
    setActiveTool('pan')
    appendDebugEvent('Tool: Pan')
  }, [activeTool, appendDebugEvent, handleMagicLensLeave, setActiveTool])
  // Esc anywhere but a text field leaves the active tool for Pan (D8),
  // unless it closed a popover, the drawer or a tooltip.
  useEffect(() => {
    if (activeTool === 'pan') return

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        isTextEntryTarget(event.target)
      ) {
        return
      }
      returnToPan()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTool, returnToPan])
  const handleRoiModeChange = useCallback(
    (nextMode: RoiDrawMode) => {
      // Starting a shape clears the measurement line.
      if (nextMode !== 'idle') {
        setMeasurementResetKey((current) => current + 1)
      }

      setRoiMode(nextMode)
      appendDebugEvent(
        platformAdapter.kind === 'image'
          ? nextMode === 'idle'
            ? 'Geometry draw cancelled'
            : nextMode === 'box'
              ? 'Geometry box mode enabled'
              : 'Geometry lasso mode enabled'
          : nextMode === 'idle'
            ? 'ROI draw cancelled'
            : nextMode === 'box'
              ? 'ROI draw mode enabled'
              : 'ROI lasso mode enabled',
      )
    },
    [appendDebugEvent, platformAdapter.kind, setMeasurementResetKey, setRoiMode],
  )

  const { handleAutoContrast, queueAutoContrast, updateMorphologyChannel } =
    useMorphologyWorkflow({
      callbacks: { appendDebugEvent },
      loaders: { computeAutoChannelContrast },
      refs: {
        autoContrastChannelIdsRef,
        datasetAbortRef,
        loadRequestIdRef: loadRequestId,
      },
      setters: {
        setAutoContrastChannelIds,
        setMorphologyChannelSettings,
        setMorphologyState,
      },
    })
  const { requestedZPlane: requestedMorphologyZPlane, selectMorphologyZPlane } =
    useMorphologyZPlaneWorkflow({
      callbacks: { appendDebugEvent },
      data: { morphologyImage },
      refs: { loadRequestIdRef: loadRequestId },
      setters: { setMorphologyImage, setMorphologyState },
    })
  // The 3D view of an OME-Zarr z-stack, over the 2D view, kept open for the
  // dataset it was opened on: another dataset opens in 2D.
  const [volumeViewDatasetUrl, setVolumeViewDatasetUrl] = useState<string | null>(null)
  const volumeViewAvailable = useMemo(
    () => morphologyVolumeLevels(morphologyImage).length > 0,
    [morphologyImage],
  )
  const volumeViewShown =
    volumeViewAvailable &&
    volumeViewDatasetUrl !== null &&
    volumeViewDatasetUrl === loadedDatasetUrl
  // The 3D view of cells placed in 3D (a third spatial coordinate), over the
  // 2D view like the image's, and kept open the same way. One 3D view shows
  // at a time.
  const [cellViewDatasetUrl, setCellViewDatasetUrl] = useState<string | null>(null)
  const cellViewAvailable = useMemo(
    () => overviewCells.some((cell) => cell.z !== undefined),
    [overviewCells],
  )
  const cellViewShown =
    cellViewAvailable &&
    cellViewDatasetUrl !== null &&
    cellViewDatasetUrl === loadedDatasetUrl &&
    !volumeViewShown &&
    !sectionStackShown
  const setVolumeViewOpen = useCallback(
    (open: boolean) => {
      setVolumeViewDatasetUrl(open ? loadedDatasetUrl : null)
      if (open) setCellViewDatasetUrl(null)
    },
    [loadedDatasetUrl, setCellViewDatasetUrl],
  )
  const setCellViewOpen = useCallback(
    (open: boolean) => {
      setCellViewDatasetUrl(open ? loadedDatasetUrl : null)

      if (open) {
        setVolumeViewDatasetUrl(null)
        setSectionStackCollectionUrl(null)
      }
    },
    [loadedDatasetUrl, setCellViewDatasetUrl],
  )
  const shareableCellView = cellViewAvailable ? (cellViewShown ? '3d' : '2d') : undefined
  // In the link while the image can be shown in 3D; while the image opens, a
  // 3D view the link or manifest asked for stays in it.
  const shareableImageView = volumeViewAvailable
    ? volumeViewShown
      ? '3d'
      : '2d'
    : morphologyImage === null &&
        morphologyState.status === 'loading' &&
        volumeViewDatasetUrl !== null &&
        volumeViewDatasetUrl === datasetUrl
      ? '3d'
      : undefined
  const { handleLoadCustomLayer, handleRemoveCustomLayer } =
    useCustomMorphologyLayerWorkflow({
      callbacks: {
        appendDebugEvent,
        appendFallbackNotice,
      },
      data: {
        customLayers: customMorphologyLayers,
      },
      loaders: { loadCustomMorphologyLayer },
      refs: {
        customLayerAbortRef: customMorphologyLayerAbortRef,
        customLayerIdRef: customMorphologyLayerIdRef,
        customLayerRequestIdRef: customMorphologyLayerRequestIdRef,
        loadRequestIdRef: loadRequestId,
      },
      setters: {
        setCustomLayerLoadState: setCustomMorphologyLayerState,
        setCustomLayers: setCustomMorphologyLayers,
        setMorphologyChannelSettings,
      },
    })
  const handleCustomImageLayerOpacityChange = useCallback(
    (imageUrl: string, opacity: number) => {
      setCustomImageLayerOpacities((current) => ({
        ...current,
        [imageUrl]: normalizeLayerOpacity(opacity),
      }))
    },
    [setCustomImageLayerOpacities],
  )
  const handleRemoveCustomImageLayer = useCallback(
    (layerId: string) => {
      const layer = customMorphologyLayers.find((candidate) => candidate.id === layerId)
      handleRemoveCustomLayer(layerId)

      if (layer === undefined) {
        return
      }

      setCustomImageLayerOpacities((current) => {
        const remaining = { ...current }
        delete remaining[layer.image.url]
        return remaining
      })
    },
    [customMorphologyLayers, handleRemoveCustomLayer, setCustomImageLayerOpacities],
  )

  useEffect(() => {
    if (loadedDatasetUrl === null || initialCustomImageUrlsRef.current.length === 0) {
      return
    }

    const initialDatasetUrl = initialShareableState.datasetUrl?.trim()

    if (
      initialDatasetUrl !== undefined &&
      initialDatasetUrl !== '' &&
      initialDatasetUrl !== loadedDatasetUrl
    ) {
      return
    }

    const customImageUrls = initialCustomImageUrlsRef.current
    const customImageOpacities = initialCustomImageOpacitiesRef.current
    initialCustomImageUrlsRef.current = []
    initialCustomImageOpacitiesRef.current = []

    void (async () => {
      for (const [index, customImageUrl] of customImageUrls.entries()) {
        const loaded = await handleLoadCustomLayer(customImageUrl)
        const opacity = customImageOpacities[index]

        if (!loaded || opacity === undefined) {
          continue
        }

        try {
          const normalizedUrl = normalizeCustomMorphologyLayerUrl(customImageUrl)
          handleCustomImageLayerOpacityChange(normalizedUrl, opacity)
        } catch {
          // The load workflow already surfaced invalid URLs.
        }
      }
    })()
  }, [
    handleCustomImageLayerOpacityChange,
    handleLoadCustomLayer,
    initialShareableState.datasetUrl,
    loadedDatasetUrl,
  ])

  // A segmentation the link names opens over the link's image; otherwise one
  // the image's manifest names (plan 25). Each image is offered one once.
  const initialSegmentationLinkRef = useRef(
    initialShareableState.segmentationUrl === undefined
      ? null
      : {
          url: initialShareableState.segmentationUrl,
          format: initialShareableState.segmentationFormat,
          units: initialShareableState.segmentationUnits,
        },
  )
  const segmentationOfferedForRef = useRef<string | null>(null)
  const loadImportedSegmentation = importedSegmentation.load

  useEffect(() => {
    if (
      platformAdapter.kind !== 'image' ||
      loadedDatasetUrl === null ||
      segmentationOfferedForRef.current === loadedDatasetUrl
    ) {
      return
    }

    segmentationOfferedForRef.current = loadedDatasetUrl
    const link = initialSegmentationLinkRef.current
    initialSegmentationLinkRef.current = null
    const initialDatasetUrl = initialShareableState.datasetUrl?.trim()
    const linkApplies =
      link !== null &&
      (initialDatasetUrl === undefined ||
        initialDatasetUrl === '' ||
        initialDatasetUrl === loadedDatasetUrl)
    const source = linkApplies
      ? segmentationSourceFromLink(link)
      : (manifestSegmentationSource(datasetManifestFor(loadedDatasetUrl)) ?? null)

    if (source !== null) {
      loadImportedSegmentation(source)
    } else if (linkApplies) {
      appendDebugEvent(
        `Segmentation skipped: the format of ${link.url} cannot be told from its name.`,
        { coalesceKey: 'segmentation' },
      )
    }
  }, [
    appendDebugEvent,
    initialShareableState.datasetUrl,
    loadImportedSegmentation,
    loadedDatasetUrl,
    platformAdapter.kind,
  ])

  const { cancelDatasetLoad, handleDatasetSubmit } = useDatasetLifecycle({
    callbacks: {
      appendDebugEvent,
      appendFallbackNotice,
      onBeforeDatasetLoad: handleBeforeDatasetLoad,
      queueAutoContrast,
      recordTelemetry,
    },
    controls: {
      isDatasetLoaded: loadState.status === 'ready',
      isDatasetLoading: loadState.status === 'loading',
      // A link naming a dataset and its collection loads the dataset once the
      // collection is read, so the image the collection pairs with it shows.
      initialDatasetLoadHeld: datasetCollection.state.status === 'loading',
    },
    initialState: {
      initialShareableState,
    },
    loaders: {
      detectSpatialDataset,
      getSpatialDataset,
      loadAnnotationGroups,
      loadDatasetOverview,
      loadGenePanel,
      loadMorphologyImage,
      warmDatasetForRoi,
    },
    refs: {
      analysisEmbeddingAbortRef,
      analysisEmbeddingRequestIdRef: analysisEmbeddingRequestId,
      autoContrastChannelIdsRef,
      boundaryAbortRef,
      boundaryRequestIdRef: boundaryRequestId,
      boundaryViewportKeyRef,
      nucleusBoundaryAbortRef,
      nucleusBoundaryRequestIdRef: nucleusBoundaryRequestId,
      nucleusBoundaryViewportKeyRef,
      cellDetailAbortRef,
      cellDetailRequestIdRef: cellDetailRequestId,
      cellFeatureMatrixCapabilityKeyRef,
      cellTranscriptDistributionAbortRef,
      cellTranscriptDistributionRequestIdRef: cellTranscriptDistributionRequestId,
      customMorphologyLayerAbortRef,
      customMorphologyLayerRequestIdRef,
      datasetAbortRef,
      datasetWarmupAbortRef,
      diagnosticsAbortRef,
      didApplyInitialDatasetUrlRef,
      geneExpressionAbortRef,
      geneExpressionRequestIdRef: geneExpressionRequestId,
      geneExpressionViewportKeyRef,
      initialShareableStateRef,
      initialSharedRoiSelectionRef,
      initialShouldLoadMorphologyRef,
      lastViewportDetailRef,
      loadRequestIdRef: loadRequestId,
      magicLensAbortRef,
      magicLensDebounceRef,
      magicLensLastDetailRef,
      magicLensLastQueryKeyRef,
      magicLensRequestIdRef: magicLensRequestId,
      roiAbortRef,
      roiGeneViewportWarmupAbortRef,
      roiGeneViewportWarmupKeyRef,
      roiGeneViewportWarmupTimeoutRef,
      roiRequestIdRef: roiRequestId,
      roiTranscriptExportAbortRef,
      roiTranscriptExportRequestIdRef: roiTranscriptExportRequestId,
      startDatasetLoadRef,
      transcriptAbortRef,
      transcriptCapabilityAbortRef,
      transcriptCapabilityRequestIdRef: transcriptCapabilityRequestId,
      transcriptRequestIdRef: transcriptRequestId,
      transcriptViewportKeyRef,
      visiumHdBinRequestIdRef: visiumHdBinRequestId,
    },
    setters: {
      setAnalysisEmbeddingState,
      setAnnotationColors,
      setAnnotationGroupState,
      setAnnotationState,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setCellMetadataTracks,
      setSelectedCellMetadataTrackId,
      setCellBoundaryOpacity,
      setCellFillOpacity,
      setCellPointScale,
      setVolumeViewDatasetUrl,
      setCellViewDatasetUrl,
      setImageLayerOpacity,
      setShowTranscriptOverlay,
      setDatasetAbout,
      setDatasetManifestDefaults,
      setAutoContrastChannelIds,
      setBoundaryElements,
      setBoundaryState,
      setCellDetailState,
      setCellFeatureMatrixCapabilityState,
      setCellTranscriptDistributionState,
      setCurrentViewportDetail,
      setCustomMorphologyLayerState,
      setCustomMorphologyLayers,
      setCustomImageLayerOpacities,
      setDatasetUrl,
      setDatasetPlatform,
      setDatasetWarmupState,
      setDiagnosticsState,
      setGeneExpressionBatch,
      setGeneExpressionColorScale,
      setGeneExpressionDetailMode,
      setGeneExpressionScaleDomain,
      setGeneExpressionScaleRange,
      setGeneExpressionScoreMode,
      setGeneExpressionState,
      setGenePanelState,
      setHoveredTranscript,
      setLoadState,
      setPendingDatasetLoadState,
      setMagicLensActive,
      setMagicLensState,
      setManualTranscriptExactRequestKey,
      setMeasurementEnabled,
      setMeasurementResetKey,
      setFlatMorphologyImage,
      setMorphologyChannelSettings,
      setMorphologyImage,
      setMorphologyState,
      setObservationColorMode,
      setOverviewCells,
      setPinnedTranscript,
      setRoiGeneStatsState,
      setRoiGeneViewportWarmupState,
      setRoiMode,
      setRoiName,
      setRoiState,
      setRoiTranscriptExportState,
      setSelectedAnnotationGroupId,
      setSelectedCell,
      setSelectedGridCell,
      setSelectedEmbeddingKind,
      setSavedGeneSets,
      setSelectedGenes,
      setShowCellBoundaries,
      setShowNucleusBoundaries,
      setSpatialGridCells,
      setNucleusBoundaryElements,
      setNucleusBoundaryState,
      setTranscriptCapabilityState,
      setTranscriptDensityColorScale,
      setTranscriptExactPointLimit,
      setTranscriptLayerState,
      setTranscriptPointColorMode,
      setVisiumHdControlState,
      setSpatialDataControlState,
      setVisiumControlState,
      setMerscopeImageState,
      setAteraImageState,
      setViewportCellCount,
    },
  })
  // Cancel in the loading list (15.3-D). ViewerCore gets one stable
  // callback, so deck.gl never sees a new prop; it calls the latest
  // handlers, and only for a task still in the list.
  const cancelLoadingTaskRef = useRef<(id: string) => void>(() => undefined)
  useEffect(() => {
    const cancelTask: Record<CancellableLoadingTaskId, () => void> = {
      dataset: cancelDatasetLoad,
      'dataset-diagnostics': handleCancelDatasetDiagnostics,
      'transcript-overlay': cancelTranscriptLoad,
      'magic-lens': handleCancelMagicLens,
      embeddings: handleCancelAnalysisEmbeddings,
      'cell-details': cancelCellDetails,
      'cell-transcripts': cancelCellDetails,
      'roi-cells': handleCancelRoiCells,
      'roi-genes': handleCancelRoiGenes,
    }

    cancelLoadingTaskRef.current = (id) => {
      if (
        isCancellableLoadingTaskId(id) &&
        loadingTasks.some((task) => task.id === id && task.cancellable === true)
      ) {
        cancelTask[id]()
      }
    }
  })
  const handleCancelLoadingTask = useCallback((id: string) => {
    cancelLoadingTaskRef.current(id)
  }, [])

  const handleSpatialDataSelectionChange = useCallback(
    (selection: SpatialDataSelection) => {
      // The open dataset, not the address box, which may hold a failed one.
      const viewUrl = loadedDatasetUrl ?? datasetUrl
      const shownSelection = spatialDataSelectionFor(viewUrl)
      setSpatialDataControlState((state) => spatialDataControlLoading(state, selection))
      appendDebugEvent(
        `SpatialData view change: ${[
          selection.table === undefined ? null : `table ${selection.table}`,
          selection.coordinateSystem === undefined
            ? null
            : `coordinate system ${selection.coordinateSystem}`,
          selection.image === undefined ? null : `image ${selection.image}`,
          selection.micrometersPerUnit === undefined
            ? 'estimated units'
            : `${selection.micrometersPerUnit.toString()} µm per unit`,
        ]
          .filter((part) => part !== null)
          .join(', ')}`,
      )
      void startDatasetLoadRef.current?.(viewUrl, shouldLoadMorphology, {
        spatialDataSelection: selection,
        restoreControl: () => {
          setSpatialDataControlState((state) =>
            spatialDataControlRestored(state, shownSelection),
          )
        },
      })
    },
    [
      appendDebugEvent,
      datasetUrl,
      loadedDatasetUrl,
      setSpatialDataControlState,
      shouldLoadMorphology,
    ],
  )
  const { handleVisiumImageChange, handleVisiumViewChange } = useVisiumControlsWorkflow({
    appendDebugEvent,
    datasetUrl: loadState.status === 'idle' ? null : loadState.url,
    getSpatialDataset,
    setFlatMorphologyImage,
    setMorphologyState,
    setVisiumControlState,
    shouldLoadMorphology,
    startDatasetLoadRef,
    visiumControlState,
  })
  const { handleMerscopeImageChange } = useMerscopeImageWorkflow({
    appendDebugEvent,
    datasetUrl: loadState.status === 'idle' ? null : loadState.url,
    merscopeImageState,
    setMerscopeImageState,
    shouldLoadMorphology,
    startDatasetLoadRef,
  })
  const { handleAteraImageChange } = useAteraImageWorkflow({
    appendDebugEvent,
    ateraImageState,
    datasetUrl: loadState.status === 'idle' ? null : loadState.url,
    setAteraImageState,
    startDatasetLoadRef,
  })
  const { handleVisiumHdBinSizeChange } = useVisiumHdBinWorkflow({
    callbacks: {
      appendDebugEvent,
      onBeforeBinSizeChange: handleBeforeVisiumHdBinSizeChange,
      onFallback: appendFallbackNotice,
    },
    controls: {
      currentViewportDetail,
      shouldLoadMorphology,
      visiumHdControlState,
    },
    data: {
      flatMorphologyImage,
      loadedDatasetUrl,
    },
    loaders: {
      getSpatialDataset,
    },
    refs: {
      geneExpressionAbortRef,
      geneExpressionRequestIdRef: geneExpressionRequestId,
      geneExpressionViewportKeyRef,
      visiumHdBinRequestIdRef: visiumHdBinRequestId,
    },
    setters: {
      setFlatMorphologyImage,
      setGeneExpressionBatch,
      setGeneExpressionScaleDomain,
      setGeneExpressionState,
      setGenePanelState,
      setLoadState,
      setMorphologyState,
      setSelectedGridCell,
      setSpatialGridCells,
      setVisiumHdControlState,
    },
  })

  useVisiumHdGridLodWorkflow({
    callbacks: { appendDebugEvent },
    controls: { visiumHdControlState },
    data: {
      currentViewportDetail,
      loadedDatasetUrl,
      spatialGridCells,
    },
    loaders: { getSpatialDataset },
    refs: { visiumHdBinRequestIdRef: visiumHdBinRequestId },
    setters: {
      setLoadState,
      setSpatialGridCells,
      setVisiumHdControlState,
    },
  })

  // The loaded annotation set for the link. Until one loads, a link for its
  // own dataset keeps the sets it was opened with; once the dataset's sets
  // are listed and none of them matches, or another dataset loads, it drops
  // them. Memoised so the link is not rescheduled on every render.
  const loadedAnnotationGroupId =
    annotationState.status === 'ready' ? annotationState.groupId : undefined
  const [linkAnnotationGroupIds, setLinkAnnotationGroupIds] = useState(
    initialShareableState.annotationGroupIds ?? null,
  )
  if (
    linkAnnotationGroupIds !== null &&
    loadedDatasetUrl !== null &&
    (loadedDatasetUrl !== initialShareableState.datasetUrl?.trim() ||
      (annotationState.status === 'ready' && annotationState.url === loadedDatasetUrl) ||
      (annotationGroupState.status === 'ready' &&
        annotationGroupState.url === loadedDatasetUrl &&
        linkAnnotationGroupId(linkAnnotationGroupIds, annotationGroupState.groups) ===
          undefined))
  ) {
    setLinkAnnotationGroupIds(null)
  }
  const sharedAnnotationGroupIds = useMemo(
    () =>
      loadedAnnotationGroupId === undefined
        ? (linkAnnotationGroupIds ?? undefined)
        : [loadedAnnotationGroupId],
    [linkAnnotationGroupIds, loadedAnnotationGroupId],
  )
  // Hidden classes and sets: until the link's set loads, the link keeps the
  // ones it was opened with, as it keeps its sets.
  const sharedHiddenAnnotationIds =
    linkAnnotationGroupIds === null
      ? hiddenAnnotationIds
      : (initialShareableState.hiddenAnnotationIds ?? hiddenAnnotationIds)
  const sharedHiddenAnnotationSetIds =
    linkAnnotationGroupIds === null
      ? hiddenAnnotationSetIds
      : (initialShareableState.hiddenAnnotationSetIds ?? hiddenAnnotationSetIds)
  const sharedPanels = useMemo(
    () => panelsForLink(shellPanels, defaultPanelIds),
    [defaultPanelIds, shellPanels],
  )
  const sharedHiddenLayers = useMemo(
    () => hiddenLayersForLink(layerVisibility),
    [layerVisibility],
  )
  // A link's `card=` selects that cell, bin or boundary once it is loaded
  // for the link's dataset. Another selection, or another dataset, drops it.
  const linkedCardRef = useRef(cardFromLink(initialShareableState))
  useEffect(() => {
    const card = linkedCardRef.current
    if (card === null || loadedDatasetUrl === null) return

    if (
      loadedDatasetUrl !== initialShareableState.datasetUrl?.trim() ||
      selectedCell !== null ||
      selectedGridCell !== null ||
      selectedBoundaryCell !== null
    ) {
      linkedCardRef.current = null
      return
    }

    if (card.kind === 'cell') {
      if (overviewCells.length === 0) return
      linkedCardRef.current = null
      const cell = overviewCells.find((candidate) => candidate.id === card.id)
      if (cell !== undefined) handleViewerCellClick(cell)
      return
    }

    // Bins and boundaries load with the view, which the link also restores.
    if (card.kind === 'bin') {
      const bin = gridCellById(spatialGridCells, card.id)
      if (bin === undefined) return
      linkedCardRef.current = null
      handleViewerGridCellClick(bin)
      return
    }

    const boundary = drawnBoundaryById.get(card.id)
    if (boundary === undefined) return
    linkedCardRef.current = null
    handleViewerCellBoundaryClick(boundary)
  }, [
    drawnBoundaryById,
    handleViewerCellBoundaryClick,
    handleViewerCellClick,
    handleViewerGridCellClick,
    initialShareableState.datasetUrl,
    loadedDatasetUrl,
    overviewCells,
    selectedBoundaryCell,
    selectedCell,
    selectedGridCell,
    spatialGridCells,
  ])
  const currentShareUrl = useShareableUrlHash({
    dataset: {
      annotationUrl: annotationImportUrl,
      customImageOpacities,
      customImageUrls,
      segmentation: segmentationLinkFor(
        importedSegmentation.state.status === 'idle'
          ? null
          : importedSegmentation.state.source,
      ),
      ...(datasetCollection.state.status === 'idle'
        ? {}
        : {
            collectionUrl: datasetCollection.state.url,
            collectionView: collectionViewForLink(collectionView),
            collectionPreviewSize: collectionPreviewSizeForLink(collectionPreviewSize),
            compareUrls: linkCompareUrls,
            sectionView: linkSectionView,
          }),
      // The loaded dataset, not the address box: until a load finishes the
      // link keeps the dataset it was opened with (15.1-L).
      datasetUrl: loadedDatasetUrl ?? initialShareableState.datasetUrl ?? '',
      // A value equal to the manifest's default is left out; one the user set
      // back to the app default is kept, so the manifest does not replace it.
      datasetDefaults: datasetManifestDefaults,
      annotationGroupIds: sharedAnnotationGroupIds,
      hiddenAnnotationIds: sharedHiddenAnnotationIds,
      hiddenAnnotationSetIds: sharedHiddenAnnotationSetIds,
      spatialDataSelection: spatialDataSelectionToShareable(spatialDataControlState),
      visiumSelection: visiumSelectionToShareable(visiumControlState),
      merscopeSelection: merscopeImageSelectionToShareable(merscopeImageState),
      ateraSelection: ateraImageSelectionToShareable(ateraImageState),
    },
    genes: {
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScaleRange: formatGeneScaleRange(geneExpressionScaleRange),
      geneExpressionScoreMode,
      geneSets: formatGeneSetsLink(savedGeneSets),
      selectedGenes,
    },
    layers: {
      boundaryCellLimit,
      cellBoundaryOpacity,
      cellFillOpacity,
      cellPointScale,
      cellMetadataTrackId:
        observationColorMode === 'metadata'
          ? (selectedCellMetadataTrack?.id ?? null)
          : null,
      coordinateUnit,
      imageOpacity: imageLayerOpacity,
      measurementUnit,
      morphologyEnabledChannelIds: shareableMorphologyEnabledChannelIds,
      morphologyZPlane: shareableMorphologyZPlane,
      imageView: shareableImageView,
      cellView: shareableCellView,
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
    },
    magicLens: {
      magicLensRadiusMicrometers,
      magicLensScope,
    },
    transcripts: {
      showTranscriptOverlay,
      transcriptDensityColorScale,
      transcriptDetailMode,
      transcriptExactPointLimit,
      // The chosen filter, not the one in effect: with no genes selected the
      // filter shows All features, but the link should still say Selected
      // genes (the default, so left out) and apply it once genes are chosen.
      transcriptFeatureFilterMode,
      transcriptGeneOnly,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointColorMode,
      transcriptPointSize,
    },
    view: {
      activeRoiSelection,
      shareableViewState,
      panels: sharedPanels,
      card: cardForLink({
        cellId: selectedCell?.id,
        binId: selectedGridCell?.id,
        boundaryId: selectedBoundaryCell?.id,
      }),
      tool: activeTool,
      plot: plotKind,
      query: formatCellQueryLink(queryConditions),
      hiddenLayers: sharedHiddenLayers,
    },
  })

  const restoreAnnotationSnapshot = useCallback(
    (snapshot: AnnotationSnapshot) => {
      setAnnotationState(snapshot.annotationState)
      setAnnotationColors(snapshot.annotationColors)
      setHiddenAnnotationIds(snapshot.hiddenAnnotationIds)
      setHiddenAnnotationSetIds(snapshot.hiddenAnnotationSetIds)
      setCellMetadataTracks(snapshot.cellMetadataTracks)
      setSelectedCellMetadataTrackId(snapshot.selectedCellMetadataTrackId)
      setObservationColorMode(snapshot.observationColorMode)
    },
    [
      setAnnotationColors,
      setAnnotationState,
      setCellMetadataTracks,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setObservationColorMode,
      setSelectedCellMetadataTrackId,
    ],
  )
  // Saved selections (15.4-A): drawing adds one, and the Selection card
  // shows the active one. They belong to the dataset and its frame: the
  // Visium library, or the SpatialData coordinate system and scale.
  const selectionList = useSelectionList({
    datasetKey: selectionDatasetKey(loadedDatasetUrl, {
      ...(visiumControlState.status === 'idle'
        ? {}
        : { visiumLibrary: visiumControlState.summary.libraryId }),
      ...(spatialDataControlState.status === 'idle'
        ? {}
        : {
            spatialDataFrame: `${spatialDataControlState.coordinateSystem}@${spatialDataControlState.units.micrometersPerUnit}`,
          }),
    }),
    enabled: platformAdapter.kind !== 'image',
    canRun: canDrawRoi,
    activeSelection: activeRoiSelection,
    initialSharedSelectionRef: initialSharedRoiSelectionRef,
    runSelection: isVisiumHdDataset ? handleVisiumHdRoiComplete : handleRoiComplete,
    clearActiveSelection: handleClearActiveRoi,
    setRoiName,
    offerUndo,
    appendDebugEvent,
    zoomToBbox,
  })
  const viewerSelectionOutlines = useMemo(
    () =>
      selectionOutlines(
        selectionList.selections,
        selectionList.activeId,
        layerVisibility.annotations,
      ),
    [layerVisibility.annotations, selectionList.activeId, selectionList.selections],
  )
  const {
    activeId: activeSelectionId,
    onDelete: deleteSelection,
    onRename: renameSelection,
  } = selectionList
  const handleSelectionNameChange = useCallback(
    (name: string) => {
      if (activeSelectionId === null) setRoiName(name)
      else renameSelection(activeSelectionId, name)
    },
    [activeSelectionId, renameSelection, setRoiName],
  )
  const deleteActiveSelection = useCallback(() => {
    if (activeSelectionId !== null) deleteSelection(activeSelectionId)
  }, [activeSelectionId, deleteSelection])
  // Removals that offer Undo (15.3-C).
  const undoable = useUndoableRemovals({
    offerUndo,
    appendDebugEvent,
    annotations: {
      annotationState,
      annotationColors,
      hiddenAnnotationIds,
      hiddenAnnotationSetIds,
      cellMetadataTracks,
      selectedCellMetadataTrackId,
      observationColorMode,
      restore: restoreAnnotationSnapshot,
      onRemove: handleRemoveAnnotation,
      onRemoveTrack: handleRemoveCellMetadataTrack,
      onClear: handleClearAnnotations,
    },
    shapes: {
      shapes: geometricAnnotations,
      restore: setGeometricAnnotations,
      onRemove: handleRemoveGeometricAnnotation,
      onClear: handleClearGeometricAnnotations,
    },
  })

  // The section models (plan 15.2-A): the layer panel, info
  // drawer and top bar take these instead of separate props.
  const datasetInfo = useDatasetInfoModel({
    activeErrors,
    appendDebugEvent,
    boundaryCellLimit,
    cellFeatureMatrixCapabilityState,
    datasetAbout,
    datasetImageLoader: morphologyImage?.loader ?? null,
    datasetFactsInput:
      loadState.status === 'ready'
        ? {
            platform: platformAdapter.kind,
            url: loadState.url,
            elementNoun: platformAdapter.labels.embeddingElementPlural,
            elementCount: loadState.cellCount,
            geneCount:
              genePanelState.status === 'ready' ? genePanelState.genes.length : null,
            channelCount: morphologyChannels.length,
            zPlaneCount: morphologyImage?.zStack?.sizeZ ?? 1,
            hasFlatImage: flatMorphologyImage !== null,
            micrometersPerPixel: viewerMicrometersPerPixel,
          }
        : null,
    datasetUrl,
    debugLog,
    debugMode,
    diagnosticsState,
    fallbackNotices,
    handleBrowseStructure: storeStructure.browse,
    handleDatasetSubmit,
    handleDownloadDiagnostics,
    handleRunDatasetDiagnostics,
    handleSpatialDataSelectionChange,
    handleVisiumHdBinSizeChange,
    handleVisiumImageChange,
    handleVisiumViewChange,
    isDatasetLoaded: loadState.status === 'ready',
    isLoading,
    isVisiumHdDataset,
    performanceBudget,
    setBoundaryCellLimit,
    setDatasetUrl,
    setDebugLog,
    setShouldLoadMorphology,
    shareUrl: currentShareUrl,
    shouldLoadMorphology,
    spatialDataControlState,
    visiumControlState,
    visiumHdControlState,
    merscopeImageState,
    handleMerscopeImageChange,
    ateraImageState,
    handleAteraImageChange,
  })
  // An example or recent dataset opens in place, like Load Dataset.
  const handleOpenDataset = useCallback(
    (url: string) => {
      setDatasetUrl(url)
      void startDatasetLoadRef.current?.(url, shouldLoadMorphology)
    },
    [setDatasetUrl, shouldLoadMorphology],
  )
  // A dataset of the open collection, restoring what its opening carries the
  // way a shared link's state is restored.
  const handleOpenCollectionDataset = useCallback(
    (url: string, opening: CollectionDatasetOpening) => {
      for (const ignored of opening.ignored) {
        appendDebugEvent(`The collection's ${ignored}, so the viewer default is used.`)
      }

      const linkState = { ...opening.linkState, datasetUrl: url }
      initialShareableStateRef.current = {
        ...linkState,
        ...(opening.annotationColors === undefined
          ? {}
          : { annotationColors: opening.annotationColors }),
      }
      pendingAnnotationGroupsRef.current =
        linkState.annotationGroupIds === undefined
          ? null
          : pendingAnnotationGroupsFor(linkState, loadedDatasetUrl)
      handleOpenDataset(url)
    },
    [appendDebugEvent, handleOpenDataset, loadedDatasetUrl],
  )
  useEffect(() => {
    openCollectionDatasetRef.current = handleOpenCollectionDataset
  })
  const collectionPreviewLoaders = useMemo(
    () => ({
      detectSpatialDataset,
      getSpatialDataset,
      loadDatasetOverview,
      loadGeneExpression,
      loadAnnotations,
      retainDataset,
    }),
    [
      detectSpatialDataset,
      getSpatialDataset,
      loadAnnotations,
      loadDatasetOverview,
      loadGeneExpression,
      retainDataset,
    ],
  )
  // Previews take the loaded annotation set while cells are coloured by it.
  const collectionPreviewAnnotations = useMemo((): CollectionBarAnnotations | null => {
    if (
      observationColorMode !== 'annotations' ||
      loadedAnnotationGroupId === undefined ||
      !annotationSetShown
    ) {
      return null
    }

    return {
      groupId: loadedAnnotationGroupId,
      label:
        (annotationGroupState.status === 'ready'
          ? annotationGroupState.groups.find(
              (group) => group.id === loadedAnnotationGroupId,
            )?.label
          : undefined) ?? 'Annotations',
      colors: annotationColors,
      hiddenIds: hiddenAnnotationIdSet,
    }
  }, [
    annotationColors,
    annotationGroupState,
    annotationSetShown,
    hiddenAnnotationIdSet,
    loadedAnnotationGroupId,
    observationColorMode,
  ])
  const collectionPreviewGenes =
    observationColorMode === 'gene-expression' ? selectedGenes : NO_PREVIEW_GENES
  // Read by the bar's previews and by the sections shown side by side.
  const collectionPreviewStore = useCollectionPreviewStore({
    collection: readyCollection,
    loaders: collectionPreviewLoaders,
    genes: collectionPreviewGenes,
    scoreMode: geneExpressionScoreMode,
    annotationGroupId: collectionPreviewAnnotations?.groupId ?? null,
    paused: isLoading,
  })
  // How the sections beside the open dataset, and those stacked in 3D, colour
  // their cells: as the main view does.
  const sectionColoring = useMemo(
    (): LinkedSectionsColoring => ({
      genes: collectionPreviewGenes,
      colorScale: geneExpressionColorScale,
      scaleRange: geneExpressionScaleRange,
      annotations: collectionPreviewAnnotations,
    }),
    [
      collectionPreviewAnnotations,
      collectionPreviewGenes,
      geneExpressionColorScale,
      geneExpressionScaleRange,
    ],
  )
  // The stacked sections are read whether in the bar or not, like those
  // shown beside the open dataset.
  const linkedSectionsKey = [
    ...new Set([
      ...linkedSections.map((entry) => entry.url),
      ...(sectionStackShown ? stackedSections.map(({ entry }) => entry.url) : []),
    ]),
  ].join('\n')
  useEffect(() => {
    collectionPreviewStore?.setLinked(
      linkedSectionsKey === '' ? [] : linkedSectionsKey.split('\n'),
    )
  }, [collectionPreviewStore, linkedSectionsKey])
  // The open dataset's cells in the 3D view, read as a section's are, from
  // the dataset the main view has open.
  const cellViewStore = useOpenDatasetPreviewStore({
    url: cellViewShown ? loadedDatasetUrl : null,
    loaders: collectionPreviewLoaders,
    genes: collectionPreviewGenes,
    scoreMode: geneExpressionScoreMode,
    annotationGroupId: collectionPreviewAnnotations?.groupId ?? null,
    paused: isLoading,
  })
  const cellViewSections = useMemo(
    (): readonly StackSection[] =>
      cellViewDatasetUrl === null
        ? []
        : [
            {
              entry: {
                path: cellViewDatasetUrl,
                url: cellViewDatasetUrl,
                ...(loadedDatasetName === null ? {} : { name: loadedDatasetName }),
              },
              z: 0,
            },
          ],
    [cellViewDatasetUrl, loadedDatasetName],
  )
  // Opens a dataset of the collection, keeping the genes and colouring. A
  // section registered to the open one keeps the view and the sections shown
  // beside it; opening one of those swaps it with the open dataset.
  const handleSelectCollectionEntry = (entry: DatasetCollectionEntry) => {
    const view = linkedViewChannel.getView()

    setCarriedView(
      view !== null && keepsViewOnOpening(readyCollection, loadedDatasetUrl, entry.url)
        ? {
            url: entry.url,
            view: { target: [view.target[0], view.target[1], 0], zoom: view.zoom },
          }
        : null,
    )
    setCompareUrls(
      compareUrlsAfterOpening(
        readyCollection,
        loadedDatasetUrl,
        linkedSections,
        entry.url,
      ),
    )
    // A section of another stack keeps the 3D view; any other dataset opens
    // in 2D.
    if (stackSections(readyCollection, entry.url).length === 0) {
      setSectionStackCollectionUrl(null)
    }
    handleOpenCollectionDataset(
      entry.url,
      collectionSwitchOpening({
        selectedGenes,
        observationColorMode,
        geneExpressionScoreMode,
        annotationGroupId: loadedAnnotationGroupId ?? null,
        hiddenAnnotationIds,
        hiddenAnnotationSetIds,
        annotationColors,
        cellMetadataTrackId: selectedCellMetadataTrack?.id ?? null,
      }),
    )
  }
  const datasetLibrary = useMemo(
    (): DatasetLibraryModel => ({
      examples: examplesIndex.state,
      examplesIndexUrl: EXAMPLES_INDEX_URL,
      onLoadExamples: examplesIndex.load,
      onRetryExamples: examplesIndex.retry,
      recent: recentDatasets.recent,
      onRemoveRecent: recentDatasets.remove,
      onOpen: handleOpenDataset,
    }),
    [
      examplesIndex.load,
      examplesIndex.retry,
      examplesIndex.state,
      handleOpenDataset,
      recentDatasets.recent,
      recentDatasets.remove,
    ],
  )
  const imageSection = useImageSectionModel({
    appendDebugEvent,
    autoContrastChannelIds,
    customLayerLoadState: customMorphologyLayerState,
    customLayerOpacities: customImageLayerOpacities,
    customLayers: customMorphologyLayers,
    handleAutoContrast,
    handleLoadCustomLayer,
    handleRemoveCustomLayer: handleRemoveCustomImageLayer,
    imageLayerOpacity,
    loadEnabled: loadState.status === 'ready',
    morphologyChannelSettings,
    morphologyChannels,
    morphologyZStack: morphologyImage?.zStack,
    requestedMorphologyZPlane,
    selectMorphologyZPlane,
    setCustomLayerOpacity: handleCustomImageLayerOpacityChange,
    setImageLayerOpacity,
    updateMorphologyChannel,
    volumeViewAvailable,
    volumeViewOpen: volumeViewShown,
    setVolumeViewOpen,
  })
  const cellsSection = useCellsSectionModel({
    analysisHeaderCopy,
    appendDebugEvent,
    offerUndo,
    cellBoundaryOpacity,
    cellFillOpacity,
    cellPointScale,
    cellLayerControlsVisible: platformAdapter.capabilities.cells,
    cellViewAvailable,
    cellViewOpen: cellViewShown,
    setCellViewOpen,
    cellMetadataTracks,
    geneExpressionBatch,
    geneExpressionColorScale,
    geneExpressionCopy,
    geneExpressionDetailMode,
    geneExpressionScaleDatasetUrl,
    geneExpressionScaleMin,
    geneExpressionScaleMax,
    geneExpressionAutoScaleMax,
    geneExpressionHighestScore,
    geneExpressionScaleRange,
    geneExpressionScoreMode,
    geneExpressionState,
    geneOptions,
    genePanelState,
    hasAnnotationColors:
      annotationState.status === 'ready' && annotationState.annotations.length > 0,
    nucleusBoundaryControlsVisible: nucleusBoundaryControlsVisibleFor(
      platformAdapter,
      spatialDataControlState.status === 'idle'
        ? undefined
        : spatialDataControlState.nuclei,
    ),
    observationColorMode,
    rememberGeneExpressionScaleMax,
    resetGeneExpressionSelectionState,
    savedGeneSets,
    selectedCellMetadataTrackId: selectedCellMetadataTrack?.id ?? null,
    selectedGenes,
    setCellBoundaryOpacity,
    setCellFillOpacity,
    setCellPointScale,
    setGeneExpressionColorScale,
    setGeneExpressionDetailMode,
    setGeneExpressionScaleDomain,
    setGeneExpressionScaleRange,
    setGeneExpressionScoreMode,
    setManualTranscriptExactRequestKey,
    setObservationColorMode,
    setSavedGeneSets,
    setSelectedCellMetadataTrackId,
    setSelectedGenes,
    setShowCellBoundaries,
    setShowNucleusBoundaries,
    showCellBoundaries,
    showNucleusBoundaries,
    toggleGene,
    transcriptViewportKeyRef,
  })
  const segmentationSection = useSegmentationSectionModel({
    appendDebugEvent,
    boundaryCellLimit,
    boundaryState,
    controller: importedSegmentation,
    currentViewport: currentViewportDetail,
    outlineColor: segmentationOutlineColor,
    outlineOpacity: segmentationOutlineOpacity,
    setOutlineColor: setSegmentationOutlineColor,
    setOutlineOpacity: setSegmentationOutlineOpacity,
    setShowOutlines: setShowCellBoundaries,
    showOutlines: showCellBoundaries,
  })
  const transcriptsSection = useTranscriptsSectionModel({
    appendDebugEvent,
    effectiveTranscriptFeatureFilterMode,
    geneLegend: transcriptGenes.model,
    geneOnlyFilterEnabled: platformAdapter.capabilities.transcriptGeneOnlyFilter,
    geneOptions,
    genePanelState,
    handlePinTranscript,
    hoveredTranscript,
    loadEnabled: platformFeatureLoadEnabled,
    pinnedTranscript,
    resetGeneExpressionSelectionState,
    selectedGenes,
    setManualTranscriptExactRequestKey,
    setPinnedTranscript,
    setSelectedGenes,
    setShowTranscriptOverlay,
    setTranscriptDensityColorScale,
    setTranscriptDetailMode,
    setTranscriptExactPointLimit,
    setTranscriptFeatureFilterMode,
    setTranscriptGeneOnly,
    setTranscriptMinQv,
    setTranscriptOpacity,
    setTranscriptPointColorMode,
    setTranscriptPointSize,
    showTranscriptOverlay: effectiveShowTranscriptOverlay,
    toggleGene,
    transcriptCapabilityState,
    transcriptCopy,
    transcriptDensityColorScale,
    transcriptDensityScaleLabels,
    transcriptDensityScaleMax,
    transcriptDetailMode,
    transcriptExactPointLimit,
    transcriptGeneOnly,
    transcriptLayerState,
    transcriptMinQv,
    transcriptOpacity,
    transcriptPointColorMode,
    transcriptPointSize,
    transcriptViewportKeyRef,
    visibleTranscriptEstimate,
  })
  // The `Open N Sections` link: an AnnData table's section columns.
  const sectionColumns = useSectionColumns({
    datasetUrl: loadState.status === 'ready' ? loadedDatasetUrl : null,
    enabled: datasetPlatform === 'h5ad' && readyCollection === null,
    getSpatialDataset,
  })
  const annotationsSection = useAnnotationsSectionModel({
    annotationColors,
    annotationGroupOptions,
    annotationGroupState,
    annotationHeaderCopy,
    annotationImportNotice,
    annotationImportUrl,
    annotationPlacedCellIds,
    annotationState,
    cellMetadataTracks,
    elementNoun: embeddingElementLabel,
    geometricAnnotationImportError,
    geometricAnnotations,
    geometricAnnotationsEnabled:
      platformAdapter.capabilities.geometricAnnotations && loadState.status === 'ready',
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleAnnotationSetVisibilityChange,
    handleAnnotationVisibilityChange,
    handleAnnotationsVisibilityChange,
    handleClearAnnotations: undoable.handleClearAnnotations,
    handleClearGeometricAnnotations: undoable.handleClearShapes,
    handleExportAnnotations,
    handleExportGeometricAnnotations,
    handleGeometricAnnotationColorChange,
    handleGeometricAnnotationVisibilityChange,
    handleImportAnnotationUrl,
    handleImportAnnotations,
    handleImportGeometricAnnotations,
    handleLoadAnnotations,
    handleRemoveAnnotation: undoable.handleRemoveAnnotation,
    handleRemoveCellMetadataTrack: undoable.handleRemoveCellMetadataTrack,
    handleRemoveGeometricAnnotation: undoable.handleRemoveShape,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    loadEnabled: platformAdapter.capabilities.annotations && loadState.status === 'ready',
    sectionSplit: sectionSplitLink({
      datasetUrl: loadState.status === 'ready' ? loadedDatasetUrl : null,
      platform: datasetPlatform,
      sectionColumns,
      inCollection: readyCollection !== null,
      pathname: window.location.pathname,
    }),
    selectedAnnotationGroupId,
    selectionList,
    selectionsAvailable: platformAdapter.kind !== 'image',
    setAnnotationImportUrl,
  })
  const viewSettings = useViewSettingsModel({
    appendDebugEvent,
    coordinateUnit,
    handleMagicLensLeave,
    measurementEnabled,
    measurementUnit,
    setCoordinateUnit,
    setMeasurementEnabled,
    setMeasurementResetKey,
    setMeasurementUnit,
    setShowAxes,
    setShowHoverTooltips,
    setShowLegend,
    setShowMinimap,
    setShowNavigation,
    setShowScaleBar,
    showAxes,
    showHoverTooltips,
    showLegend,
    showMinimap,
    showNavigation,
    showScaleBar,
  })
  const loadingDatasetUrl =
    pendingDatasetLoadState.status === 'loading'
      ? pendingDatasetLoadState.url
      : loadState.status === 'loading'
        ? loadState.url
        : null
  const topBar = useTopBarModel({
    activeTool,
    appendDebugEvent,
    canDrawRoi,
    channelCount: morphologyChannels.length,
    datasetName: loadedDatasetName,
    debugMode,
    elementCount: loadState.status === 'ready' ? loadState.cellCount : 0,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    geneCount: genePanelState.status === 'ready' ? genePanelState.genes.length : null,
    loadingDatasetName:
      loadingDatasetUrl === null
        ? null
        : (datasetDisplayName(loadingDatasetUrl, undefined) ?? loadingDatasetUrl),
    magicLensAvailable: platformAdapter.capabilities.magicLens,
    magicLensCanSummariseView:
      currentViewportDetail !== null && magicLensState.status !== 'loading',
    magicLensEnabled: magicLensLoadEnabled,
    magicLensRadiusMicrometers,
    magicLensReason: magicLensAvailability.unavailableReason,
    magicLensScope,
    onMagicLensCursorActiveChange: handleMagicLensCursorActiveChange,
    onMagicLensRadiusChange: handleMagicLensRadiusChange,
    onMagicLensScopeChange: handleMagicLensScopeChange,
    onMagicLensSummariseView: () => {
      handleMagicLensSummarise('viewport')
    },
    onMeasureEnabledChange: viewSettings.measure.onEnabledChange,
    onReturnToPan: returnToPan,
    onRoiModeChange: handleRoiModeChange,
    platform: platformAdapter.kind,
    setDebugMode,
  })
  const [fitRequestKey, setFitRequestKey] = useState(0)
  useToolShortcuts(true, topBar.tools.onSelect, () => {
    setFitRequestKey((current) => current + 1)
  })
  const layerPanel = useLayerPanelModel({
    annotations: annotationsSection,
    appendDebugEvent,
    capabilities: platformAdapter.capabilities,
    cells: cellsSection,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    image: imageSection,
    imageAvailable: morphologyImage !== null || flatMorphologyImage !== null,
    layerVisibility,
    loadingAreas,
    segmentation: platformAdapter.capabilities.segmentationImport
      ? segmentationSection
      : null,
    setLayerVisibility,
    transcripts: transcriptsSection,
  })

  const embedding = useEmbeddingModel({
    activeEmbedding,
    analysisEmbeddingState,
    annotationStyles: annotationStyleColors,
    appendDebugEvent,
    copy: embeddingCopy,
    datasetReady: loadState.status === 'ready',
    elementLabel: isVisiumHdDataset ? 'bins' : 'cells',
    onLoad: handleLoadAnalysisEmbeddings,
    onSelectElement: handleEmbeddingElementSelect,
    roiElementIds: roiCellIds,
    selectedElementId: isVisiumHdDataset
      ? (activeSelectedGridCell?.id ?? null)
      : (selectedCell?.id ?? null),
    selectedKind: selectedEmbeddingKind,
    setSelectedKind: setSelectedEmbeddingKind,
  })

  // The Plots panel (plan 22): the selected genes by the classes of a set,
  // with the active selection as an extra group.
  const activeSavedSelection = selectionList.active
  const plotsSelection = useMemo(
    () =>
      activeSavedSelection === null || roiCellIds.length === 0
        ? null
        : {
            name: activeSavedSelection.name,
            color: activeSavedSelection.color,
            cellIds: roiCellIds,
            hitCellLimit: roiState.status === 'ready' && roiState.hitCellLimit,
          },
    [activeSavedSelection, roiCellIds, roiState],
  )
  // The Plots window (plan 22) reads each gene across every cell. Visium HD
  // has no matrix it reads by gene across every bin, so the window is hidden
  // there, as Cell Query is.
  const plotsAvailable =
    platformAdapter.capabilities.cells &&
    platformAdapter.capabilities.annotations &&
    platformAdapter.kind !== 'visium-hd'
  const plotsDatasetSets = useMemo(
    () =>
      plotDatasetSets(
        annotationGroupState.status === 'ready' ? annotationGroupState.groups : [],
        loadedAnnotationGroupId,
      ),
    [annotationGroupState, loadedAnnotationGroupId],
  )
  const plots = usePlotsModel({
    open: shellPanels.plotsOpen,
    plotKind,
    onPlotKindChange: setPlotKind,
    available: plotsAvailable,
    datasetUrl: loadedDatasetUrl,
    datasetReady: loadState.status === 'ready',
    platformLabel: PLATFORM_NAMES[platformAdapter.kind],
    getSpatialDataset,
    annotations:
      annotationState.status === 'ready'
        ? annotationState.annotations
        : EMPTY_ANNOTATIONS,
    visibleClasses: annotationStyleColors,
    selection: plotsSelection,
    savedSelections: selectionList.selections,
    loadSelectionCells: loadActiveRoiCells,
    datasetSets: plotsDatasetSets,
    loadSetAnnotations: loadActiveAnnotations,
    selectedGenes,
    colorScale: geneExpressionColorScale,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    appendDebugEvent,
  })

  // The Cell Query window (plan 23): the cells matching conditions on their
  // columns, in a table. Visium HD bins are not overview cells.
  const queryAvailable =
    platformAdapter.capabilities.cells && platformAdapter.kind !== 'visium-hd'
  // Pictures take the canvas's channels, colours and contrast (plan
  // 23-D10), whether or not the canvas shows the image now.
  const cellQueryPictureImage = useMemo<CellQueryPictureImage | null>(() => {
    const loader = morphologyImage?.loader ?? null
    if (
      loader === null &&
      morphologyCanvasChannels.length === 0 &&
      flatMorphologyImage === null
    ) {
      return null
    }
    return {
      loader,
      channels: morphologyCanvasChannels.map((channel) => ({ ...channel, opacity: 1 })),
      flatImage: flatMorphologyImage,
    }
  }, [flatMorphologyImage, morphologyCanvasChannels, morphologyImage])
  // The image's channels for its columns (plan 26), named, with
  // auto-contrast's threshold.
  const cellQueryImageChannels = useMemo<readonly CellQueryImageChannel[]>(
    () =>
      morphologyChannels.map((channel) => {
        const histogram = morphologyChannelSettings.find(
          (setting) => setting.id === channel.info.id,
        )?.histogram
        return {
          id: channel.info.id,
          name: channel.info.name,
          loader: channel.loader,
          rgb:
            (channel.info.samplesPerPixel ?? 1) > 1 ||
            channel.info.alphaFromIntensity === false,
          ...(histogram === undefined ? {} : { histogram }),
        }
      }),
    [morphologyChannelSettings, morphologyChannels],
  )
  const cellQuery = useCellQueryModel({
    open: shellPanels.queryOpen,
    available: queryAvailable,
    datasetUrl: loadedDatasetUrl,
    datasetReady: loadState.status === 'ready',
    cells: overviewCells,
    elementNoun: platformAdapter.labels.embeddingElementPlural,
    annotations:
      annotationState.status === 'ready'
        ? annotationState.annotations
        : EMPTY_ANNOTATIONS,
    datasetSets: plotsDatasetSets,
    annotationGroups:
      annotationGroupState.status === 'ready'
        ? annotationGroupState.groups
        : EMPTY_GROUPS,
    loadSetAnnotations: loadActiveAnnotations,
    savedSelections: selectionList.selections,
    loadSelectionCells: loadActiveRoiCells,
    metadataTracks: cellMetadataTracks,
    loadMetadataTrackValues: loadActiveCellMetadataTrackValues,
    conditions: queryConditions,
    onConditionsChange: setQueryConditions,
    selectedCellId: selectedCell?.id ?? null,
    onSelectCell: handleEmbeddingCellSelect,
    onSaveClass: handleSaveQueryAnnotation,
    pictureImage: cellQueryPictureImage,
    loadCellOutlines: loadActiveCellOutlines,
    imageChannels: cellQueryImageChannels,
    imageZPlane: morphologyImage?.zStack?.zPlane ?? null,
    appendDebugEvent,
  })

  // The cards (plan 15.2-D): Selection, Cell, Transcript and
  // Magic Lens.
  const elementPlural = platformAdapter.labels.embeddingElementPlural
  const selectionLensInput = {
    available: platformAdapter.capabilities.magicLens,
    enabled: magicLensLoadEnabled && activeRoiSelection !== null,
    label: platformAdapter.capabilities.transcripts ? 'Transcripts' : 'Expression',
    state: magicLensState,
    onRun: () => {
      handleMagicLensSummarise('roi')
    },
  }
  const selectionGenesInput = {
    copy: roiGeneStatsCopy,
    state: roiGeneStatsState,
    reference: roiReferenceState,
    selectedGenes,
    onShowGene: showGene,
  }
  const cards = useCardStackModel({
    selection:
      platformAdapter.kind === 'image'
        ? {
            variant: 'geometry',
            drawing: roiMode === 'idle' ? null : roiMode,
            name: roiName,
            nameDisabled: loadState.status !== 'ready',
            onClose: returnToPan,
            onNameChange: setRoiName,
            shapeCount: geometricAnnotations.length,
          }
        : isVisiumHdDataset
          ? {
              variant: 'bins',
              genes: selectionGenesInput,
              lens: selectionLensInput,
              name: roiName,
              nameDisabled: loadState.status !== 'ready',
              onClose: selectionList.onCloseActive,
              onDelete: deleteActiveSelection,
              onExportBarcodes: handleExportVisiumHdRoiBarcodes,
              onExportGeoJson: handleExportVisiumHdRoiGeoJson,
              onNameChange: handleSelectionNameChange,
              roiState: activeVisiumHdRoiState,
              status: visiumHdRoiCopy,
              summary: visiumHdRoiSummary,
            }
          : {
              variant: 'cells',
              elementNoun: {
                singular: elementPlural.replace(/s$/, ''),
                plural: elementPlural,
              },
              genes: selectionGenesInput,
              lens: selectionLensInput,
              loading: isRoiTabLoading,
              name: roiName,
              nameDisabled: !platformFeatureLoadEnabled,
              onClose: selectionList.onCloseActive,
              onDelete: deleteActiveSelection,
              onExportCells: handleExportRoiCells,
              onExportGeoJson: handleExportRoiGeoJson,
              onExportTranscripts: handleExportRoiTranscripts,
              onNameChange: handleSelectionNameChange,
              onSave: handleSaveRoiAnnotation,
              roiState,
              status: roiHeaderCopy,
              summary: roiSummary,
              transcriptExportState: roiTranscriptExportState,
            },
    cell: {
      cell: {
        selected: selectedCell,
        title: platformAdapter.kind === 'visium' ? 'Spot' : 'Cell',
        status: cellDetailCopy,
        annotationLabels: selectedCellAnnotationLabels,
        state: cellDetailState,
        distributionState: cellTranscriptDistributionState,
        distributionVisible: platformAdapter.capabilities.cellTranscriptDistribution,
        variant: isAnnDataPlatform(platformAdapter) ? 'observations' : 'default',
      },
      boundary: {
        selected: activeSelectedBoundaryCell,
        expressionStatus: selectedBoundaryCellExpressionStatus,
      },
      gridCell: {
        selected: activeSelectedGridCell,
        assignmentState: gridCellAssignmentState,
        expressionStatus: selectedGridCellExpressionStatus,
      },
      profile: {
        state: activeVisiumHdExpressionProfileState,
        onLoad: handleLoadVisiumHdExpressionProfile,
      },
      nuclei: selectedCellNuclei,
      onClose: handleClearSelection,
    },
    transcript: platformAdapter.capabilities.transcripts
      ? {
          capabilityState: transcriptCapabilityState,
          onClose: transcriptsSection.onClearPinnedTranscript,
          pinned: pinnedTranscript,
        }
      : null,
    magicLens: platformAdapter.capabilities.magicLens
      ? {
          cursorActive: magicLensIsCursorActive,
          onClose: handleMagicLensClear,
          state: magicLensState,
          status: magicLensCopy,
        }
      : null,
    zoomToBbox,
  })

  // The view to open the loaded dataset with: one carried from the registered
  // section it replaced, else the link's.
  const viewerInitialView =
    carriedView !== null &&
    loadState.status !== 'idle' &&
    loadState.url === carriedView.url
      ? carriedView.view
      : linkViewApplies
        ? initialShareableState.viewState
        : undefined
  const viewerTileCount = 1 + linkedSections.length
  const viewerRegion = (
    <section className="viewer-region" aria-labelledby="viewer-heading">
      <h2 id="viewer-heading" className="visually-hidden">
        Spatial View
      </h2>

      <div
        className="viewer-tiles"
        style={
          {
            '--viewer-tile-columns': viewerTileCount === 4 ? 2 : viewerTileCount,
          } as CSSProperties
        }
      >
        <div className="viewer-tile viewer-main-tile">
          <ViewerCore
            cells={styledOverviewCells}
            expressionElements={viewerGeneExpressionElements}
            geneExpressionActive={geneExpressionColorsReady}
            geneExpressionOverlayEnabled={geneExpressionOverlayEnabled}
            boundaries={expressionStyledBoundaryLayerData}
            nucleusBoundaries={visibleNucleusBoundaryLayerData}
            cellBoundaryHoverEnabled={platformAdapter.cellBoundaryHoverEnabled(
              showCellBoundaries,
            )}
            hoverTooltipsEnabled={showHoverTooltips}
            overviewCellSourceLabel={
              platformAdapter.kind === 'h5ad'
                ? 'H5AD'
                : platformAdapter.kind === 'visium'
                  ? 'Visium'
                  : platformAdapter.kind === 'spatialdata'
                    ? 'SpatialData'
                    : platformAdapter.kind === 'atera' ||
                        platformAdapter.kind === 'merscope'
                      ? PLATFORM_NAMES[platformAdapter.kind]
                      : 'Xenium'
            }
            gridCells={viewerGridCells}
            fitGridCells={spatialGridCells}
            fitImageExtent={imageFitExtent}
            transcriptAggregateBins={transcriptLayerAggregateBins}
            transcriptPoints={transcriptLayerPoints}
            geometricAnnotations={
              layerVisibility.annotations
                ? geometricAnnotationLayerData
                : NO_GEOMETRY_LAYERS
            }
            imageLoader={morphologyImage?.loader ?? null}
            imageChannels={morphologyCanvasChannels}
            flatImage={flatMorphologyImage}
            imageOpacity={
              morphologyCanvasChannels.length === 0 ? renderedImageOpacity : 1
            }
            cellLayersVisible={layerVisibility.cells}
            cellFillOpacity={cellFillOpacity}
            cellPointScale={cellPointScale}
            cellBoundaryOpacity={
              // H5AD points have no outline unless the table has label boundaries.
              platformAdapter.kind === 'h5ad' && !showCellBoundaries
                ? 0
                : platformAdapter.kind === 'image'
                  ? segmentationOutlineOpacity
                  : cellBoundaryOpacity
            }
            pointSizeFullViewScale={platformAdapter.pointSizeFullViewScale}
            trueSizePoints={platformAdapter.trueSizePoints}
            transcriptOpacity={transcriptOpacity}
            transcriptPointSize={transcriptPointSize}
            observationColorMode={viewerObservationColorMode}
            annotationStyleColors={annotationStyleColors}
            cellMetadataTrack={activeCellMetadataTrack}
            loadingTasks={loadingTasks}
            onCancelLoadingTask={handleCancelLoadingTask}
            legendSections={legendSections}
            legend={showLegend}
            showZoomLevel={debugMode}
            selectionHighlight={selectionHighlight}
            onClearSelection={handleClearSelection}
            onLegendCategoryVisibilityChange={handleLegendCategoryVisibilityChange}
            onLegendShowMore={handleLegendShowMore}
            coordinateUnit={coordinateUnit}
            measurementEnabled={measurementEnabled}
            measurementUnit={measurementUnit}
            measurementResetKey={measurementResetKey}
            status={loadState.status}
            imageStatus={viewerImageStatus}
            boundaryStatus={viewerBoundaryState.status}
            overviewRenderCellLimit={viewerOverviewRenderCellLimit}
            clipOverviewCellsToViewport={!isAnnDataPlatform(platformAdapter)}
            maxConcurrentTileRequests={performanceBudget.maxConcurrentTileRequests}
            tileCacheMaxTiles={performanceBudget.tileCacheMaxTiles}
            roiMode={roiMode}
            roiSelection={activeRoiSelection}
            selectionOutlines={viewerSelectionOutlines}
            magicLensActive={magicLensIsCursorActive}
            magicLensRadiusMicrometers={magicLensRadiusMicrometers}
            magicLensStatus={magicLensViewerStatus}
            magicLensSummary={magicLensViewerSummary}
            viewResetKey={viewerViewResetKey}
            focusRequest={spatialFocusRequest}
            navigationControls={showNavigation}
            minimap={showMinimap}
            axes={showAxes}
            scaleBar={showScaleBar}
            fitRequestKey={fitRequestKey}
            onImageTileError={handleImageTileError}
            onTileCacheEviction={handleTileCacheEviction}
            onViewportCellCountChange={setViewportCellCount}
            onViewportChange={handleViewportChange}
            onTranscriptHover={setHoveredTranscript}
            onTranscriptClick={handlePinTranscript}
            onCellClick={handleViewerCellClick}
            onCellBoundaryClick={handleViewerCellBoundaryClick}
            onGridCellClick={handleViewerGridCellClick}
            onRoiComplete={
              platformAdapter.kind === 'image'
                ? handleImageRoiComplete
                : selectionList.onDrawn
            }
            onMagicLensMove={handleMagicLensMove}
            onMagicLensLeave={handleMagicLensLeave}
            linkedView={linkedViewChannel}
            {...(viewerInitialView === undefined
              ? {}
              : { initialViewStateOverride: viewerInitialView })}
            {...(loadState.status === 'error'
              ? { errorMessage: formatStructuredError(loadState.error) }
              : {})}
            {...(viewerImageError === null
              ? {}
              : { imageErrorMessage: formatStructuredError(viewerImageError) })}
            {...(viewerMicrometersPerPixel === undefined
              ? {}
              : {
                  micrometersPerPixel: viewerMicrometersPerPixel,
                })}
            {...(spatialDataControlState.status !== 'idle' &&
            spatialDataControlState.units.source === 'unknown'
              ? { physicalUnitLabel: 'units' }
              : {})}
            {...(viewerBoundaryState.status === 'error'
              ? { boundaryErrorMessage: formatStructuredError(viewerBoundaryState.error) }
              : {})}
          />
          {volumeViewShown ? (
            <MorphologyVolumeView
              image={morphologyImage}
              settings={morphologyChannelSettings}
              onClose={() => {
                setVolumeViewOpen(false)
              }}
            />
          ) : null}
          {cellViewShown ? (
            <SectionStackViewer
              key={cellViewDatasetUrl}
              mode="cells"
              sections={cellViewSections}
              store={cellViewStore}
              coloring={sectionColoring}
              cellPointScale={cellPointScale}
              hoverTooltips={showHoverTooltips}
              onClose={() => {
                setCellViewOpen(false)
              }}
            />
          ) : null}
          {linkedSections.length === 0 ? null : (
            <div className="viewer-tile-header">
              <span className="viewer-tile-name" title={loadedDatasetName ?? undefined}>
                {loadedDatasetName}
              </span>
            </div>
          )}
        </div>
        {linkedSections.length === 0 ? null : (
          <LinkedSections
            entries={linkedSections}
            store={collectionPreviewStore}
            channel={linkedViewChannel}
            coloring={sectionColoring}
            cellPointScale={cellPointScale}
            pointSizeFullViewScale={platformAdapter.pointSizeFullViewScale}
            hoverTooltips={showHoverTooltips}
            onOpen={handleSelectCollectionEntry}
            onClose={(entry) => {
              setCompareUrls(toggledCompareUrls(linkedSections, entry))
            }}
          />
        )}
      </div>
      {sectionStackShown ? (
        <SectionStackViewer
          key={stackedSections[0]?.entry.coordinateSystem}
          sections={stackedSections}
          store={collectionPreviewStore}
          coloring={sectionColoring}
          cellPointScale={cellPointScale}
          hoverTooltips={showHoverTooltips}
          onClose={() => {
            setSectionStackCollectionUrl(null)
          }}
        />
      ) : null}
      {showStartScreen ? (
        <StartScreen
          open={datasetInfo.open}
          library={datasetLibrary}
          error={loadState.status === 'error' ? loadState.error : null}
        />
      ) : null}
      <div className="viewer-toasts">
        {pendingDatasetLoadState.status === 'error' ? (
          <DatasetLoadToast
            failedUrl={pendingDatasetLoadState.url}
            error={pendingDatasetLoadState.error}
            openDatasetName={loadedDatasetName}
            onDismiss={() => {
              setPendingDatasetLoadState(IDLE_DATASET_LOAD_STATE)
            }}
          />
        ) : null}
        <UndoToast store={undoToast} />
      </div>
    </section>
  )
  const skipLink = (
    <a className="skip-link" href="#viewer-heading">
      Skip To Spatial View
    </a>
  )

  return (
    <main className="app-shell">
      {skipLink}
      <ShellLayout
        topBar={topBar}
        info={datasetInfo}
        library={datasetLibrary}
        settings={viewSettings}
        layerPanel={layerPanel}
        image={imageSection}
        cells={cellsSection}
        transcripts={transcriptsSection}
        annotations={annotationsSection}
        segmentation={
          platformAdapter.capabilities.segmentationImport ? segmentationSection : null
        }
        cards={cards}
        embedding={platformAdapter.capabilities.cells ? embedding : null}
        plots={plotsAvailable ? plots : null}
        query={queryAvailable ? cellQuery : null}
        panels={shellPanels}
        onPanelsChange={setShellPanels}
        layerReveal={layerReveal}
        storeStructure={<StoreStructureDrawer store={storeStructure} />}
        collection={
          datasetCollection.state.status === 'idle' ? null : (
            <CollectionBar
              state={datasetCollection.state}
              loadedUrl={loadedDatasetUrl}
              pendingUrl={isLoading ? datasetUrl : null}
              onSelect={handleSelectCollectionEntry}
              onClose={datasetCollection.close}
              view={collectionView}
              onViewChange={setCollectionView}
              previewSize={{
                value: collectionPreviewSize,
                onChange: setCollectionPreviewSize,
              }}
              previews={{
                store: collectionPreviewStore,
                genes: collectionPreviewGenes,
                colorScale: geneExpressionColorScale,
                scaleRange: geneExpressionScaleRange,
                annotations: collectionPreviewAnnotations,
              }}
              beside={{
                shown: linkedSections,
                onToggle: (entry) => {
                  setCompareUrls(toggledCompareUrls(linkedSections, entry))
                },
              }}
              {...(stackedSections.length === 0
                ? {}
                : {
                    stack: {
                      sectionCount: stackedSections.length,
                      shown: sectionStackShown,
                      onToggle: () => {
                        setSectionStackCollectionUrl(
                          sectionStackShown ? null : openCollectionUrl,
                        )
                        if (!sectionStackShown) setCellViewDatasetUrl(null)
                      },
                    },
                  })}
            />
          )
        }
      >
        {viewerRegion}
      </ShellLayout>
    </main>
  )
}

function selectionGeneExpressionStatus(
  selectedGenes: readonly string[],
  state: GeneExpressionState<StructuredLoadError>,
): CellGeneExpressionStatus {
  if (selectedGenes.length === 0) {
    return {
      status: 'idle',
      message: 'Select a gene or gene set to load expression.',
    }
  }

  if (state.status === 'loading') {
    return {
      status: 'loading',
      message: 'Loading selected-gene expression.',
    }
  }

  if (state.status === 'waiting') {
    return {
      status: 'unavailable',
      message: state.message,
    }
  }

  if (state.status === 'error') {
    return {
      status: 'error',
      message: formatStructuredError(state.error),
    }
  }

  if (state.status === 'ready') {
    return {
      status: 'unavailable',
      message:
        'Selected-gene expression is loaded, but no expression value matched this selection.',
    }
  }

  return {
    status: 'idle',
    message: 'Expression will load after the spatial view is ready.',
  }
}

function boundarySelectionGeneExpressionStatus(
  baseStatus: CellGeneExpressionStatus,
  geneExpressionState: GeneExpressionState<StructuredLoadError>,
  projectionState: VisiumHdExpressionProjectionState,
): CellGeneExpressionStatus {
  if (geneExpressionState.status !== 'ready') {
    return baseStatus
  }

  if (projectionState.status === 'loading') {
    return {
      status: 'loading',
      message: `Projecting selected-gene expression onto ${projectionState.boundaryCellCount.toLocaleString()} cells using ${formatMappingRowsScope(
        projectionState.rowBudget,
      )}.`,
    }
  }

  if (projectionState.status === 'unavailable') {
    return {
      status: 'unavailable',
      message: projectionState.reason,
    }
  }

  if (projectionState.status === 'error') {
    return {
      status: 'error',
      message: formatStructuredError(projectionState.error),
    }
  }

  if (projectionState.status === 'ready') {
    return {
      status: 'unavailable',
      message:
        'Selected-gene expression was projected, but no expression value matched this cell.',
    }
  }

  return {
    status: 'unavailable',
    message: 'Selected-gene bin expression is loaded. Cell projection is pending.',
  }
}

interface H5adRoiDataset {
  cells(
    selection: Parameters<RoiCellsLoader>[1],
    options?: { readonly limit?: number },
  ): Promise<readonly DatasetCell[]>
}

interface H5adExpressionDataset {
  matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>>
}

interface H5adAnnotationDataset {
  annotations(options?: {
    readonly groupId?: string
    readonly signal?: AbortSignal
  }): Promise<readonly Annotation[]>
}

interface H5adEmbeddingDataset {
  embeddings(options?: {
    readonly kind?: string
    readonly signal?: AbortSignal
  }): Promise<readonly AnalysisEmbedding[]>
}

interface H5adMetadataTrackDataset {
  metadataTrackValues(
    trackId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly ContinuousCellMetadataValue[]>
}

function isH5adRoiDataset(dataset: unknown): dataset is H5adRoiDataset {
  return hasFunction(dataset, 'cells')
}

function isH5adExpressionDataset(dataset: unknown): dataset is H5adExpressionDataset {
  return hasFunction(dataset, 'matrix')
}

function isH5adAnnotationDataset(dataset: unknown): dataset is H5adAnnotationDataset {
  return hasFunction(dataset, 'annotations')
}

function isH5adEmbeddingDataset(dataset: unknown): dataset is H5adEmbeddingDataset {
  return hasFunction(dataset, 'embeddings')
}

function isH5adMetadataTrackDataset(
  dataset: unknown,
): dataset is H5adMetadataTrackDataset {
  return hasFunction(dataset, 'metadataTrackValues')
}

function hasFunction<T extends string>(
  value: unknown,
  key: T,
): value is Record<T, (...args: never[]) => unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    key in value &&
    typeof (value as Record<T, unknown>)[key] === 'function'
  )
}

function h5adSampleCells(
  cells: readonly DatasetCell[],
  limit: number | undefined,
): readonly DatasetCell[] {
  const normalizedLimit =
    limit === undefined || !Number.isFinite(limit)
      ? cells.length
      : Math.max(1, Math.floor(limit))

  return cells.length <= normalizedLimit ? cells : cells.slice(0, normalizedLimit)
}

function imageFitExtentFromMorphologyImage(image: MorphologyImage | null): BBox | null {
  if (image === null) {
    return null
  }

  const loader = image.loader
  const micrometersPerPixel = loader.units.micrometersPerPixel

  return {
    minX: micrometers(0),
    maxX: micrometers(loader.imageWidth * micrometersPerPixel),
    minY: micrometers(0),
    maxY: micrometers(loader.imageHeight * micrometersPerPixel),
  }
}

function nonGeneColorMode(mode: ObservationColorMode | undefined): ObservationColorMode {
  return mode === undefined || mode === 'gene-expression' ? 'transcript-count' : mode
}

interface PendingAnnotationGroups {
  readonly datasetUrl: string
  // The dataset open when the sets were kept, shown until the next one loads.
  readonly openUrl: string | null
  readonly groupIds: readonly string[]
  readonly hiddenAnnotationIds: readonly string[] | undefined
  readonly hiddenAnnotationSetIds: readonly string[] | undefined
  readonly switchColorMode: boolean
}

function pendingAnnotationGroupsFor(
  state: ShareableState,
  openUrl: string | null = null,
): PendingAnnotationGroups {
  return {
    datasetUrl: state.datasetUrl?.trim() ?? '',
    openUrl,
    groupIds: state.annotationGroupIds ?? [],
    hiddenAnnotationIds: state.hiddenAnnotationIds,
    hiddenAnnotationSetIds: state.hiddenAnnotationSetIds,
    switchColorMode:
      state.linkVersion === undefined && state.observationColorMode === undefined,
  }
}

// `#rrggbb` as an outline colour, a little translucent like the default
// outline.
function hexOutlineColor(hex: string): [number, number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_SEGMENTATION_OUTLINE_COLOR

  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    230,
  ]
}
