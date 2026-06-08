import type { Dispatch, FormEventHandler, SetStateAction } from 'react'
import type {
  RoiDrawMode,
  ViewerCoordinateUnit,
  ViewerTranscriptHoverDetail,
} from '../../components/ViewerCore'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
} from '../../data/analysisEmbeddings'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { PerformanceBudget } from '../../data/performanceBudget'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
  OverviewCellDatum,
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import type { AnnotationGroupOption } from '../../data/datasetAnnotations'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type {
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type { DebugLogAppendOptions, DebugLogEntry, LoadingTask } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'
import type { ControlHudTab } from './appShellModel'
import { AnnotationHudPanel } from '../annotations/AnnotationHudPanel'
import type {
  AnnotationGroupState,
  AnnotationState,
} from '../annotations/annotationModel'
import type { AnalysisEmbeddingState } from '../analysis/analysisEmbeddingModel'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import { CellHudPanel } from '../control-hud/CellHudPanel'
import { ControlHudShell } from '../control-hud/ControlHudShell'
import { RoiHudPanel } from '../control-hud/RoiHudPanel'
import type {
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
} from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { GeneHudPanel } from '../genes/GeneHudPanel'
import type {
  GeneExpressionState,
  GenePanelState,
  SavedGeneSet,
} from '../genes/geneControlsModel'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import { MagicLensHudPanel } from '../roi/MagicLensHudPanel'
import type { MagicLensScope, MagicLensState } from '../roi/magicLensModel'
import type {
  RoiGeneStatsState,
  RoiState,
  RoiSummary,
  RoiTranscriptExportState,
} from '../roi/roiModel'
import { TranscriptHudPanel } from '../transcripts/TranscriptHudPanel'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import { AppDatasetHudPanel } from './AppDatasetHudPanel'
import { AppLayerHudPanel } from './AppLayerHudPanel'

interface AppControlHudProps {
  readonly activeControlHudTab: ControlHudTab
  readonly activeErrors: readonly StructuredLoadError[]
  readonly activeEmbedding: AnalysisEmbedding | null
  readonly analysisEmbeddingState: AnalysisEmbeddingState<StructuredLoadError>
  readonly analysisHeaderCopy: string
  readonly annotationColors: Readonly<Record<string, string>>
  readonly annotationGroupOptions: readonly AnnotationGroupOption[]
  readonly annotationGroupState: AnnotationGroupState<StructuredLoadError>
  readonly annotationHeaderCopy: string
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly autoContrastChannelIds: readonly string[]
  readonly boundaryCellLimit: number
  readonly canDrawRoi: boolean
  readonly cellDetailCopy: string
  readonly cellDetailState: CellDetailState<StructuredLoadError>
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCapabilityState
  readonly cellTranscriptDistributionState: CellTranscriptDistributionState<StructuredLoadError>
  readonly controlIds: AppControlIds
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly embeddingCopy: string
  readonly filteredGenes: readonly string[]
  readonly filteredTranscriptFeatures: readonly string[]
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionCopy: string
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleMax: number
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly geneSearch: string
  readonly geneSetName: string
  readonly geneSetSymbols: string
  readonly handleAnnotationColorChange: (annotationId: string, color: string) => void
  readonly handleAnnotationGroupChange: (groupId: string) => void
  readonly handleAutoContrast: (channel: MorphologyImageChannel) => void
  readonly handleClearAnnotations: () => void
  readonly handleClearRoi: () => void
  readonly handleDatasetSubmit: FormEventHandler<HTMLFormElement>
  readonly handleDownloadDiagnostics: () => void
  readonly handleEmbeddingCellSelect: (cellId: string) => void
  readonly handleExportRoiCells: () => void
  readonly handleExportRoiTranscripts: () => void
  readonly handleGeneExpressionColorScaleChange: (scale: GeneExpressionColorScale) => void
  readonly handleGeneExpressionDetailModeChange: (mode: GeneExpressionDetailMode) => void
  readonly handleGeneExpressionScoreModeChange: (mode: GeneExpressionScoreMode) => void
  readonly handleImportAnnotations: (file: File | null) => Promise<void>
  readonly handleLoadAnalysisEmbeddings: () => void
  readonly handleLoadAnnotations: () => void
  readonly handleLoadExactViewport: (requestKey: string) => void
  readonly handleMagicLensCursorActiveChange: (active: boolean) => void
  readonly handleMagicLensLeave: () => void
  readonly handleMagicLensMinQvChange: (minQv: number) => void
  readonly handleMagicLensRadiusChange: (radiusMicrometers: number) => void
  readonly handleMagicLensScopeChange: (scope: MagicLensScope) => void
  readonly handleObservationColorModeChange: (mode: ObservationColorMode) => void
  readonly handlePinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
  readonly handleRunMagicLens: () => void
  readonly handleSaveRoiAnnotation: () => void
  readonly handleToggleTranscriptSelectedFeature: (feature: string) => void
  readonly handleTranscriptDensityColorScaleChange: (
    scale: TranscriptDensityColorScale,
  ) => void
  readonly handleTranscriptDetailModeChange: (mode: TranscriptDetailMode) => void
  readonly handleTranscriptExactPointLimitChange: (limit: number) => void
  readonly handleTranscriptFeatureFilterModeChange: (
    mode: TranscriptFeatureFilterMode,
  ) => void
  readonly handleTranscriptGeneOnlyChange: (enabled: boolean) => void
  readonly handleTranscriptMinQvChange: (minQv: number) => void
  readonly handleTranscriptOpacityPercentChange: (percent: number) => void
  readonly handleTranscriptOverlayChange: (enabled: boolean) => void
  readonly handleTranscriptPointColorModeChange: (mode: TranscriptPointColorMode) => void
  readonly handleTranscriptPointSizeChange: (pointSize: number) => void
  readonly hasAnnotationColors: boolean
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly imageLayerOpacity: number
  readonly isControlHudCollapsed: boolean
  readonly isLoading: boolean
  readonly isRoiTabLoading: boolean
  readonly loadEnabled: boolean
  readonly loadingTabIds: ReadonlySet<ControlHudTab>
  readonly loadingTasks: readonly LoadingTask[]
  readonly magicLensCanScan: boolean
  readonly magicLensCopy: string
  readonly magicLensIsCursorActive: boolean
  readonly magicLensMinQv: number
  readonly magicLensRadiusMicrometers: number
  readonly magicLensScope: MagicLensScope
  readonly magicLensState: MagicLensState<StructuredLoadError>
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly observationColorMode: ObservationColorMode
  readonly performanceBudget: PerformanceBudget
  readonly pickTranscriptFeature: (feature: string) => void
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly removeSavedGeneSet: (id: string) => void
  readonly roiAvailable: boolean
  readonly roiCellIds: readonly string[]
  readonly roiGeneStatsCopy: string
  readonly roiGeneStatsState: RoiGeneStatsState<StructuredLoadError>
  readonly roiHeaderCopy: string
  readonly roiMode: RoiDrawMode
  readonly roiName: string
  readonly roiState: RoiState<StructuredLoadError>
  readonly roiSummary: RoiSummary | null
  readonly roiTranscriptExportState: RoiTranscriptExportState<StructuredLoadError>
  readonly savedGeneSets: readonly SavedGeneSet[]
  readonly selectedAnnotationGroupId: string
  readonly selectedCell: OverviewCellDatum | null
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
  readonly selectedGenes: readonly string[]
  readonly setActiveControlHudTab: Dispatch<SetStateAction<ControlHudTab>>
  readonly setBoundaryCellLimit: Dispatch<SetStateAction<number>>
  readonly setCellBoundaryOpacity: Dispatch<SetStateAction<number>>
  readonly setCellFillOpacity: Dispatch<SetStateAction<number>>
  readonly setCoordinateUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setDatasetUrl: (url: string) => void
  readonly setDebugLog: Dispatch<SetStateAction<readonly DebugLogEntry[]>>
  readonly setGeneSearch: Dispatch<SetStateAction<string>>
  readonly setGeneSetName: Dispatch<SetStateAction<string>>
  readonly setGeneSetSymbols: Dispatch<SetStateAction<string>>
  readonly setImageLayerOpacity: Dispatch<SetStateAction<number>>
  readonly setIsControlHudCollapsed: Dispatch<SetStateAction<boolean>>
  readonly setMagicLensActive: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementEnabled: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementResetKey: Dispatch<SetStateAction<number>>
  readonly setMeasurementUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setPinnedTranscript: Dispatch<
    SetStateAction<ViewerTranscriptHoverDetail | null>
  >
  readonly setRoiMode: Dispatch<SetStateAction<RoiDrawMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setSelectedEmbeddingKind: Dispatch<SetStateAction<AnalysisEmbeddingKind>>
  readonly setShouldLoadMorphology: Dispatch<SetStateAction<boolean>>
  readonly setTranscriptFeatureSearch: Dispatch<SetStateAction<string>>
  readonly shouldLoadMorphology: boolean
  readonly showTranscriptOverlay: boolean
  readonly cellBoundaryOpacity: number
  readonly cellFillOpacity: number
  readonly applyGeneSetSymbols: () => void
  readonly applySavedGeneSet: (geneSet: SavedGeneSet) => void
  readonly saveSelectedGeneSet: () => void
  readonly toggleGene: (gene: string) => void
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly transcriptCopy: string
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptDensityScaleLabels: readonly [string, string, string]
  readonly transcriptDensityScaleMax: number | undefined
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptFeatureSearch: string
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptLayerState<StructuredLoadError>
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptPointSize: number
  readonly updateMorphologyChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
  readonly visibleTranscriptEstimate: number
}

export function AppControlHud({
  activeControlHudTab,
  activeErrors,
  activeEmbedding,
  analysisEmbeddingState,
  analysisHeaderCopy,
  annotationColors,
  annotationGroupOptions,
  annotationGroupState,
  annotationHeaderCopy,
  annotationState,
  appendDebugEvent,
  autoContrastChannelIds,
  boundaryCellLimit,
  canDrawRoi,
  cellBoundaryOpacity,
  cellDetailCopy,
  cellDetailState,
  cellFeatureMatrixCapabilityState,
  cellFillOpacity,
  cellTranscriptDistributionState,
  controlIds,
  coordinateUnit,
  datasetUrl,
  debugLog,
  diagnosticsState,
  effectiveTranscriptFeatureFilterMode,
  embeddingCopy,
  filteredGenes,
  filteredTranscriptFeatures,
  geneExpressionColorScale,
  geneExpressionCopy,
  geneExpressionDetailMode,
  geneExpressionScaleMax,
  geneExpressionScoreMode,
  geneExpressionState,
  genePanelState,
  geneSearch,
  geneSetName,
  geneSetSymbols,
  handleAnnotationColorChange,
  handleAnnotationGroupChange,
  handleAutoContrast,
  handleClearAnnotations,
  handleClearRoi,
  handleDatasetSubmit,
  handleDownloadDiagnostics,
  handleEmbeddingCellSelect,
  handleExportRoiCells,
  handleExportRoiTranscripts,
  handleGeneExpressionColorScaleChange,
  handleGeneExpressionDetailModeChange,
  handleGeneExpressionScoreModeChange,
  handleImportAnnotations,
  handleLoadAnalysisEmbeddings,
  handleLoadAnnotations,
  handleLoadExactViewport,
  handleMagicLensCursorActiveChange,
  handleMagicLensLeave,
  handleMagicLensMinQvChange,
  handleMagicLensRadiusChange,
  handleMagicLensScopeChange,
  handleObservationColorModeChange,
  handlePinTranscript,
  handleRemoveAnnotation,
  handleRunDatasetDiagnostics,
  handleRunMagicLens,
  handleSaveRoiAnnotation,
  handleToggleTranscriptSelectedFeature,
  handleTranscriptDensityColorScaleChange,
  handleTranscriptDetailModeChange,
  handleTranscriptExactPointLimitChange,
  handleTranscriptFeatureFilterModeChange,
  handleTranscriptGeneOnlyChange,
  handleTranscriptMinQvChange,
  handleTranscriptOpacityPercentChange,
  handleTranscriptOverlayChange,
  handleTranscriptPointColorModeChange,
  handleTranscriptPointSizeChange,
  hasAnnotationColors,
  hoveredTranscript,
  imageLayerOpacity,
  isControlHudCollapsed,
  isLoading,
  isRoiTabLoading,
  loadEnabled,
  loadingTabIds,
  loadingTasks,
  magicLensCanScan,
  magicLensCopy,
  magicLensIsCursorActive,
  magicLensMinQv,
  magicLensRadiusMicrometers,
  magicLensScope,
  magicLensState,
  measurementEnabled,
  measurementUnit,
  morphologyChannelSettings,
  morphologyChannels,
  observationColorMode,
  performanceBudget,
  pickTranscriptFeature,
  pinnedTranscript,
  removeSavedGeneSet,
  roiAvailable,
  roiCellIds,
  roiGeneStatsCopy,
  roiGeneStatsState,
  roiHeaderCopy,
  roiMode,
  roiName,
  roiState,
  roiSummary,
  roiTranscriptExportState,
  savedGeneSets,
  selectedAnnotationGroupId,
  selectedCell,
  selectedEmbeddingKind,
  selectedGenes,
  setActiveControlHudTab,
  setBoundaryCellLimit,
  setCellBoundaryOpacity,
  setCellFillOpacity,
  setCoordinateUnit,
  setDatasetUrl,
  setDebugLog,
  setGeneSearch,
  setGeneSetName,
  setGeneSetSymbols,
  setImageLayerOpacity,
  setIsControlHudCollapsed,
  setMagicLensActive,
  setMeasurementEnabled,
  setMeasurementResetKey,
  setMeasurementUnit,
  setPinnedTranscript,
  setRoiMode,
  setRoiName,
  setSelectedEmbeddingKind,
  setShouldLoadMorphology,
  setTranscriptFeatureSearch,
  shouldLoadMorphology,
  showTranscriptOverlay,
  applyGeneSetSymbols,
  applySavedGeneSet,
  saveSelectedGeneSet,
  toggleGene,
  transcriptCapabilityState,
  transcriptCopy,
  transcriptDensityColorScale,
  transcriptDensityScaleLabels,
  transcriptDensityScaleMax,
  transcriptDetailMode,
  transcriptExactPointLimit,
  transcriptFeatureSearch,
  transcriptGeneOnly,
  transcriptLayerState,
  transcriptMinQv,
  transcriptOpacity,
  transcriptPointColorMode,
  transcriptPointSize,
  updateMorphologyChannel,
  visibleTranscriptEstimate,
}: AppControlHudProps) {
  return (
    <ControlHudShell
      collapsed={isControlHudCollapsed}
      activeTab={activeControlHudTab}
      loadingTabIds={loadingTabIds}
      loadingTasks={loadingTasks}
      onCollapsedChange={(nextCollapsed) => {
        setIsControlHudCollapsed(nextCollapsed)
        appendDebugEvent(nextCollapsed ? 'HUD collapsed' : 'HUD expanded')
      }}
      onActiveTabChange={(tabId, tabLabel) => {
        setActiveControlHudTab(tabId)
        appendDebugEvent(`HUD tab: ${tabLabel}`, {
          coalesceKey: 'hud-tab',
        })
      }}
    >
      <AppDatasetHudPanel
        active={activeControlHudTab === 'dataset'}
        activeErrors={activeErrors}
        appendDebugEvent={appendDebugEvent}
        boundaryCellLimit={boundaryCellLimit}
        cellFeatureMatrixCapabilityState={cellFeatureMatrixCapabilityState}
        controlIds={controlIds}
        datasetUrl={datasetUrl}
        debugLog={debugLog}
        diagnosticsState={diagnosticsState}
        handleDatasetSubmit={handleDatasetSubmit}
        handleDownloadDiagnostics={handleDownloadDiagnostics}
        handleRunDatasetDiagnostics={handleRunDatasetDiagnostics}
        isLoading={isLoading}
        setBoundaryCellLimit={setBoundaryCellLimit}
        setDatasetUrl={setDatasetUrl}
        setDebugLog={setDebugLog}
        setShouldLoadMorphology={setShouldLoadMorphology}
        shouldLoadMorphology={shouldLoadMorphology}
      />

      <AppLayerHudPanel
        active={activeControlHudTab === 'layers'}
        appendDebugEvent={appendDebugEvent}
        autoContrastChannelIds={autoContrastChannelIds}
        cellBoundaryOpacity={cellBoundaryOpacity}
        cellFillOpacity={cellFillOpacity}
        controlIds={controlIds}
        coordinateUnit={coordinateUnit}
        handleAutoContrast={handleAutoContrast}
        handleMagicLensLeave={handleMagicLensLeave}
        imageLayerOpacity={imageLayerOpacity}
        measurementEnabled={measurementEnabled}
        measurementUnit={measurementUnit}
        morphologyChannelSettings={morphologyChannelSettings}
        morphologyChannels={morphologyChannels}
        performanceBudget={performanceBudget}
        setCellBoundaryOpacity={setCellBoundaryOpacity}
        setCellFillOpacity={setCellFillOpacity}
        setCoordinateUnit={setCoordinateUnit}
        setImageLayerOpacity={setImageLayerOpacity}
        setMagicLensActive={setMagicLensActive}
        setMeasurementEnabled={setMeasurementEnabled}
        setMeasurementResetKey={setMeasurementResetKey}
        setMeasurementUnit={setMeasurementUnit}
        setRoiMode={setRoiMode}
        updateMorphologyChannel={updateMorphologyChannel}
      />

      <GeneHudPanel
        active={activeControlHudTab === 'genes'}
        geneSearchInputId={controlIds.geneSearchInputId}
        geneSetSymbolsInputId={controlIds.geneSetSymbolsInputId}
        geneSetNameInputId={controlIds.geneSetNameInputId}
        geneSetScoreInputId={controlIds.geneSetScoreInputId}
        geneScaleInputId={controlIds.geneScaleInputId}
        geneExpressionDetailInputId={controlIds.geneExpressionDetailInputId}
        observationModeInputId={controlIds.observationModeInputId}
        analysisHeaderCopy={analysisHeaderCopy}
        geneExpressionCopy={geneExpressionCopy}
        genePanelState={genePanelState}
        geneExpressionState={geneExpressionState}
        geneSearch={geneSearch}
        geneSetSymbols={geneSetSymbols}
        geneSetName={geneSetName}
        geneExpressionScoreMode={geneExpressionScoreMode}
        savedGeneSets={savedGeneSets}
        selectedGenes={selectedGenes}
        filteredGenes={filteredGenes}
        geneExpressionColorScale={geneExpressionColorScale}
        geneExpressionScaleMax={geneExpressionScaleMax}
        geneExpressionDetailMode={geneExpressionDetailMode}
        observationColorMode={observationColorMode}
        hasAnnotationColors={hasAnnotationColors}
        onGeneSearchChange={setGeneSearch}
        onToggleGene={toggleGene}
        onGeneSetSymbolsChange={setGeneSetSymbols}
        onApplyGeneSetSymbols={applyGeneSetSymbols}
        onSaveSelectedGeneSet={saveSelectedGeneSet}
        onGeneSetNameChange={setGeneSetName}
        onGeneExpressionScoreModeChange={handleGeneExpressionScoreModeChange}
        onApplySavedGeneSet={applySavedGeneSet}
        onRemoveSavedGeneSet={removeSavedGeneSet}
        onGeneExpressionColorScaleChange={handleGeneExpressionColorScaleChange}
        onGeneExpressionDetailModeChange={handleGeneExpressionDetailModeChange}
        onObservationColorModeChange={handleObservationColorModeChange}
      />

      <TranscriptHudPanel
        active={activeControlHudTab === 'transcripts'}
        transcriptDetailInputId={controlIds.transcriptDetailInputId}
        transcriptDensityScaleInputId={controlIds.transcriptDensityScaleInputId}
        transcriptPointColorInputId={controlIds.transcriptPointColorInputId}
        transcriptPointBudgetInputId={controlIds.transcriptPointBudgetInputId}
        transcriptMinQvInputId={controlIds.transcriptMinQvInputId}
        transcriptFeatureFilterInputId={controlIds.transcriptFeatureFilterInputId}
        transcriptFeatureSearchInputId={controlIds.transcriptFeatureSearchInputId}
        transcriptOpacityInputId={controlIds.transcriptOpacityInputId}
        transcriptPointSizeInputId={controlIds.transcriptPointSizeInputId}
        transcriptCopy={transcriptCopy}
        loadEnabled={loadEnabled}
        featureSearchEnabled={genePanelState.status === 'ready'}
        showTranscriptOverlay={showTranscriptOverlay}
        transcriptDetailMode={transcriptDetailMode}
        transcriptExactPointLimit={transcriptExactPointLimit}
        effectiveTranscriptFeatureFilterMode={effectiveTranscriptFeatureFilterMode}
        selectedGenes={selectedGenes}
        transcriptFeatureSearch={transcriptFeatureSearch}
        filteredTranscriptFeatures={filteredTranscriptFeatures}
        transcriptDensityColorScale={transcriptDensityColorScale}
        transcriptDensityScaleMax={transcriptDensityScaleMax}
        transcriptDensityScaleLabels={transcriptDensityScaleLabels}
        transcriptPointColorMode={transcriptPointColorMode}
        transcriptMinQv={transcriptMinQv}
        transcriptGeneOnly={transcriptGeneOnly}
        transcriptOpacity={transcriptOpacity}
        transcriptPointSize={transcriptPointSize}
        transcriptCapabilityState={transcriptCapabilityState}
        transcriptLayerState={transcriptLayerState}
        visibleTranscriptEstimate={visibleTranscriptEstimate}
        hoveredTranscript={hoveredTranscript}
        pinnedTranscript={pinnedTranscript}
        onShowTranscriptOverlayChange={handleTranscriptOverlayChange}
        onTranscriptDetailModeChange={handleTranscriptDetailModeChange}
        onTranscriptExactPointLimitChange={handleTranscriptExactPointLimitChange}
        onTranscriptFeatureFilterModeChange={handleTranscriptFeatureFilterModeChange}
        onToggleSelectedFeature={handleToggleTranscriptSelectedFeature}
        onTranscriptFeatureSearchChange={setTranscriptFeatureSearch}
        onPickTranscriptFeature={pickTranscriptFeature}
        onTranscriptDensityColorScaleChange={handleTranscriptDensityColorScaleChange}
        onTranscriptPointColorModeChange={handleTranscriptPointColorModeChange}
        onTranscriptMinQvChange={handleTranscriptMinQvChange}
        onTranscriptGeneOnlyChange={handleTranscriptGeneOnlyChange}
        onTranscriptOpacityPercentChange={handleTranscriptOpacityPercentChange}
        onTranscriptPointSizeChange={handleTranscriptPointSizeChange}
        onPinTranscript={handlePinTranscript}
        onClearPinnedTranscript={() => {
          setPinnedTranscript(null)
        }}
        onLoadExactViewport={handleLoadExactViewport}
      />

      <MagicLensHudPanel
        active={activeControlHudTab === 'magic-lens'}
        magicLensScopeInputId={controlIds.magicLensScopeInputId}
        magicLensRadiusInputId={controlIds.magicLensRadiusInputId}
        magicLensMinQvInputId={controlIds.magicLensMinQvInputId}
        magicLensCopy={magicLensCopy}
        loadEnabled={loadEnabled}
        roiAvailable={roiAvailable}
        magicLensScope={magicLensScope}
        magicLensState={magicLensState}
        magicLensRadiusMicrometers={magicLensRadiusMicrometers}
        magicLensMinQv={magicLensMinQv}
        magicLensIsCursorActive={magicLensIsCursorActive}
        magicLensCanScan={magicLensCanScan}
        onScopeChange={handleMagicLensScopeChange}
        onRadiusChange={handleMagicLensRadiusChange}
        onMinQvChange={handleMagicLensMinQvChange}
        onCursorActiveChange={handleMagicLensCursorActiveChange}
        onRunMagicLens={handleRunMagicLens}
      />

      <AnnotationHudPanel
        active={activeControlHudTab === 'annotations'}
        annotationGroupInputId={controlIds.annotationGroupInputId}
        annotationImportInputId={controlIds.annotationImportInputId}
        annotationHeaderCopy={annotationHeaderCopy}
        loadEnabled={loadEnabled}
        selectedAnnotationGroupId={selectedAnnotationGroupId}
        annotationGroupOptions={annotationGroupOptions}
        annotationState={annotationState}
        annotationGroupState={annotationGroupState}
        annotationColors={annotationColors}
        onAnnotationGroupChange={handleAnnotationGroupChange}
        onLoadAnnotations={handleLoadAnnotations}
        onClearAnnotations={handleClearAnnotations}
        onImportAnnotations={(file) => {
          void handleImportAnnotations(file)
        }}
        onAnnotationColorChange={handleAnnotationColorChange}
        onRemoveAnnotation={handleRemoveAnnotation}
      />

      <CellHudPanel
        active={activeControlHudTab === 'cell'}
        embeddingViewInputId={controlIds.embeddingViewInputId}
        embeddingCopy={embeddingCopy}
        analysisEmbeddingState={analysisEmbeddingState}
        activeEmbedding={activeEmbedding}
        selectedEmbeddingKind={selectedEmbeddingKind}
        roiCellIds={roiCellIds}
        selectedCell={selectedCell}
        cellDetailCopy={cellDetailCopy}
        cellDetailState={cellDetailState}
        cellTranscriptDistributionState={cellTranscriptDistributionState}
        loadEnabled={loadEnabled}
        onEmbeddingKindChange={(nextEmbeddingKind) => {
          setSelectedEmbeddingKind(nextEmbeddingKind)
          appendDebugEvent(`Embedding view: ${nextEmbeddingKind}`)
        }}
        onLoadAnalysisEmbeddings={handleLoadAnalysisEmbeddings}
        onSelectEmbeddingCell={handleEmbeddingCellSelect}
      />

      <RoiHudPanel
        active={activeControlHudTab === 'roi'}
        roiNameInputId={controlIds.roiNameInputId}
        roiHeaderCopy={roiHeaderCopy}
        isLoading={isRoiTabLoading}
        canDrawRoi={canDrawRoi}
        roiMode={roiMode}
        roiName={roiName}
        loadEnabled={loadEnabled}
        roiState={roiState}
        roiSummary={roiSummary}
        roiGeneStatsCopy={roiGeneStatsCopy}
        roiGeneStatsState={roiGeneStatsState}
        roiTranscriptExportState={roiTranscriptExportState}
        onRoiModeChange={(nextMode) => {
          if (nextMode !== 'idle') {
            setMeasurementEnabled(false)
            setMeasurementResetKey((current) => current + 1)
          }

          setRoiMode(nextMode)
          appendDebugEvent(
            nextMode === 'idle'
              ? 'ROI draw cancelled'
              : nextMode === 'box'
                ? 'ROI draw mode enabled'
                : 'ROI lasso mode enabled',
          )
        }}
        onClearRoi={handleClearRoi}
        onRoiNameChange={setRoiName}
        onSaveRoiAnnotation={handleSaveRoiAnnotation}
        onExportRoiCells={handleExportRoiCells}
        onExportRoiTranscripts={handleExportRoiTranscripts}
      />
    </ControlHudShell>
  )
}
