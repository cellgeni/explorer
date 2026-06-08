import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppControlHud } from './AppControlHud'

type Props = ComponentProps<typeof AppControlHud>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    activeControlHudTab: 'dataset',
    activeErrors: [],
    activeEmbedding: null,
    analysisEmbeddingState: { status: 'idle' },
    analysisHeaderCopy: 'Idle',
    annotationColors: {},
    annotationGroupOptions: [],
    annotationGroupState: { status: 'idle' },
    annotationHeaderCopy: 'Idle',
    annotationState: { status: 'idle' },
    appendDebugEvent: vi.fn(),
    applyGeneSetSymbols: vi.fn(),
    applySavedGeneSet: vi.fn(),
    autoContrastChannelIds: [],
    boundaryCellLimit: 50_000,
    canDrawRoi: false,
    cellBoundaryOpacity: 1,
    cellDetailCopy: 'No selection',
    cellDetailState: { status: 'idle' },
    cellFeatureMatrixCapabilityState: { status: 'idle' },
    cellFillOpacity: 1,
    cellTranscriptDistributionState: { status: 'idle' },
    controlIds: {
      annotationGroupInputId: 'annotation-group',
      annotationImportInputId: 'annotation-import',
      boundaryLimitInputId: 'boundary-limit',
      cellBoundaryOpacityInputId: 'cell-boundary-opacity',
      cellFillOpacityInputId: 'cell-fill-opacity',
      coordinateUnitInputId: 'coordinate-unit',
      datasetInputId: 'dataset-url',
      embeddingViewInputId: 'embedding-view',
      geneExpressionDetailInputId: 'gene-expression-detail',
      geneScaleInputId: 'gene-scale',
      geneSearchInputId: 'gene-search',
      geneSetNameInputId: 'gene-set-name',
      geneSetScoreInputId: 'gene-set-score',
      geneSetSymbolsInputId: 'gene-set-symbols',
      imageOpacityInputId: 'image-opacity',
      magicLensMinQvInputId: 'magic-lens-qv',
      magicLensRadiusInputId: 'magic-lens-radius',
      magicLensScopeInputId: 'magic-lens-scope',
      measurementModeInputId: 'measurement-mode',
      measurementUnitInputId: 'measurement-unit',
      morphologyInputId: 'morphology',
      observationModeInputId: 'observation-mode',
      roiNameInputId: 'roi-name',
      transcriptDensityScaleInputId: 'transcript-density-scale',
      transcriptDetailInputId: 'transcript-detail',
      transcriptFeatureFilterInputId: 'transcript-feature-filter',
      transcriptFeatureSearchInputId: 'transcript-feature-search',
      transcriptMinQvInputId: 'transcript-min-qv',
      transcriptOpacityInputId: 'transcript-opacity',
      transcriptPointBudgetInputId: 'transcript-point-budget',
      transcriptPointColorInputId: 'transcript-point-color',
      transcriptPointSizeInputId: 'transcript-point-size',
    },
    coordinateUnit: 'um',
    datasetUrl: 'https://example.test/output',
    debugLog: [],
    diagnosticsState: { status: 'idle' },
    effectiveTranscriptFeatureFilterMode: 'all',
    embeddingCopy: 'Idle',
    filteredGenes: [],
    filteredTranscriptFeatures: [],
    geneExpressionColorScale: 'plasma',
    geneExpressionCopy: 'Expression: none',
    geneExpressionDetailMode: 'auto',
    geneExpressionScaleMax: 0,
    geneExpressionScoreMode: 'sum',
    geneExpressionState: { status: 'idle' },
    genePanelState: { status: 'idle' },
    geneSearch: '',
    geneSetName: '',
    geneSetSymbols: '',
    handleAnnotationColorChange: vi.fn(),
    handleAnnotationGroupChange: vi.fn(),
    handleAutoContrast: vi.fn(),
    handleClearAnnotations: vi.fn(),
    handleClearRoi: vi.fn(),
    handleDatasetSubmit: vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    }),
    handleDownloadDiagnostics: vi.fn(),
    handleEmbeddingCellSelect: vi.fn(),
    handleExportRoiCells: vi.fn(),
    handleExportRoiTranscripts: vi.fn(),
    handleGeneExpressionColorScaleChange: vi.fn(),
    handleGeneExpressionDetailModeChange: vi.fn(),
    handleGeneExpressionScoreModeChange: vi.fn(),
    handleImportAnnotations: vi.fn(async () => undefined),
    handleLoadAnalysisEmbeddings: vi.fn(),
    handleLoadAnnotations: vi.fn(),
    handleLoadExactViewport: vi.fn(),
    handleMagicLensCursorActiveChange: vi.fn(),
    handleMagicLensLeave: vi.fn(),
    handleMagicLensMinQvChange: vi.fn(),
    handleMagicLensRadiusChange: vi.fn(),
    handleMagicLensScopeChange: vi.fn(),
    handleObservationColorModeChange: vi.fn(),
    handlePinTranscript: vi.fn(),
    handleRemoveAnnotation: vi.fn(),
    handleRunDatasetDiagnostics: vi.fn(async () => undefined),
    handleRunMagicLens: vi.fn(),
    handleSaveRoiAnnotation: vi.fn(),
    handleToggleTranscriptSelectedFeature: vi.fn(),
    handleTranscriptDensityColorScaleChange: vi.fn(),
    handleTranscriptDetailModeChange: vi.fn(),
    handleTranscriptExactPointLimitChange: vi.fn(),
    handleTranscriptFeatureFilterModeChange: vi.fn(),
    handleTranscriptGeneOnlyChange: vi.fn(),
    handleTranscriptMinQvChange: vi.fn(),
    handleTranscriptOpacityPercentChange: vi.fn(),
    handleTranscriptOverlayChange: vi.fn(),
    handleTranscriptPointColorModeChange: vi.fn(),
    handleTranscriptPointSizeChange: vi.fn(),
    hasAnnotationColors: false,
    hoveredTranscript: null,
    imageLayerOpacity: 1,
    isControlHudCollapsed: false,
    isLoading: false,
    isRoiTabLoading: false,
    loadEnabled: false,
    loadingTabIds: new Set(),
    loadingTasks: [],
    magicLensCanScan: false,
    magicLensCopy: 'Load dataset',
    magicLensIsCursorActive: false,
    magicLensMinQv: 20,
    magicLensRadiusMicrometers: 80,
    magicLensScope: 'cursor',
    magicLensState: { status: 'idle' },
    measurementEnabled: false,
    measurementUnit: 'um',
    morphologyChannelSettings: [],
    morphologyChannels: [],
    observationColorMode: 'transcript-count',
    performanceBudget: {
      boundaryCellLimit: 50_000,
      maxConcurrentTileRequests: 4,
      overviewRenderCellLimit: 150_000,
      profile: 'balanced',
      telemetryEventLimit: 120,
      tileCacheMaxTiles: 120,
    },
    pickTranscriptFeature: vi.fn(),
    pinnedTranscript: null,
    removeSavedGeneSet: vi.fn(),
    roiAvailable: false,
    roiCellIds: [],
    roiGeneStatsCopy: 'Genes idle',
    roiGeneStatsState: { status: 'idle' },
    roiHeaderCopy: 'Idle',
    roiMode: 'idle',
    roiName: 'ROI 1',
    roiState: { status: 'idle' },
    roiSummary: null,
    roiTranscriptExportState: { status: 'idle' },
    saveSelectedGeneSet: vi.fn(),
    savedGeneSets: [],
    selectedAnnotationGroupId: 'all',
    selectedCell: null,
    selectedEmbeddingKind: 'umap',
    selectedGenes: [],
    setActiveControlHudTab: vi.fn(),
    setBoundaryCellLimit: vi.fn(),
    setCellBoundaryOpacity: vi.fn(),
    setCellFillOpacity: vi.fn(),
    setCoordinateUnit: vi.fn(),
    setDatasetUrl: vi.fn(),
    setDebugLog: vi.fn(),
    setGeneSearch: vi.fn(),
    setGeneSetName: vi.fn(),
    setGeneSetSymbols: vi.fn(),
    setImageLayerOpacity: vi.fn(),
    setIsControlHudCollapsed: vi.fn(),
    setMagicLensActive: vi.fn(),
    setMeasurementEnabled: vi.fn(),
    setMeasurementResetKey: vi.fn(),
    setMeasurementUnit: vi.fn(),
    setPinnedTranscript: vi.fn(),
    setRoiMode: vi.fn(),
    setRoiName: vi.fn(),
    setSelectedEmbeddingKind: vi.fn(),
    setShouldLoadMorphology: vi.fn(),
    setTranscriptFeatureSearch: vi.fn(),
    shouldLoadMorphology: true,
    showTranscriptOverlay: false,
    toggleGene: vi.fn(),
    transcriptCapabilityState: { status: 'idle' },
    transcriptCopy: 'Off',
    transcriptDensityColorScale: 'thermal',
    transcriptDensityScaleLabels: ['0', '-', '-'],
    transcriptDensityScaleMax: undefined,
    transcriptDetailMode: 'auto',
    transcriptExactPointLimit: 100_000,
    transcriptFeatureSearch: '',
    transcriptGeneOnly: true,
    transcriptLayerState: { status: 'idle' },
    transcriptMinQv: 20,
    transcriptOpacity: 0.85,
    transcriptPointColorMode: 'feature',
    transcriptPointSize: 2,
    updateMorphologyChannel: vi.fn(),
    visibleTranscriptEstimate: 0,
    ...overrides,
  }
}

describe('AppControlHud', () => {
  it('routes shell tab and collapse actions through debug logging', () => {
    const props = baseProps()

    render(<AppControlHud {...props} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Layers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Controls' }))

    expect(props.setActiveControlHudTab).toHaveBeenCalledWith('layers')
    expect(props.appendDebugEvent).toHaveBeenCalledWith('HUD tab: Layers', {
      coalesceKey: 'hud-tab',
    })
    expect(props.setIsControlHudCollapsed).toHaveBeenCalledWith(true)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('HUD collapsed')
  })

  it('normalizes layer control updates before forwarding them to app state', () => {
    const props = baseProps({ activeControlHudTab: 'layers' })

    render(<AppControlHud {...props} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Image opacity' }), {
      target: { value: '45' },
    })
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Mouse coordinates' })).getByRole(
        'button',
        { name: 'px' },
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Distance measure' }))

    expect(props.setImageLayerOpacity).toHaveBeenCalledWith(0.45)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Image opacity: 45%', {
      coalesceKey: 'image-opacity',
    })
    expect(props.setCoordinateUnit).toHaveBeenCalledWith('px')
    expect(props.setMeasurementEnabled).toHaveBeenCalledWith(true)
    expect(props.setRoiMode).toHaveBeenCalledWith('idle')
    expect(props.setMagicLensActive).toHaveBeenCalledWith(false)
    expect(props.handleMagicLensLeave).toHaveBeenCalledTimes(1)
  })
})
