import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDatasetLifecycle } from './useDatasetLifecycle'

function abortRef() {
  return { current: new AbortController() }
}

function numberRef(value = 0) {
  return { current: value }
}

function stringRef(value: string | null = null) {
  return { current: value }
}

function timeoutRef() {
  return { current: null as number | null }
}

function Probe({ refs }: { readonly refs: ReturnType<typeof createLifecycleRefs> }) {
  const noopSetter = vi.fn()

  useDatasetLifecycle({
    analysisEmbeddingAbortRef: refs.analysisEmbeddingAbortRef,
    analysisEmbeddingRequestIdRef: numberRef(),
    appendDebugEvent: vi.fn(),
    autoContrastChannelIdsRef: { current: new Set<string>() },
    boundaryAbortRef: refs.boundaryAbortRef,
    boundaryRequestIdRef: numberRef(),
    boundaryViewportKeyRef: stringRef(),
    cellDetailAbortRef: refs.cellDetailAbortRef,
    cellDetailRequestIdRef: numberRef(),
    cellFeatureMatrixCapabilityKeyRef: stringRef(),
    cellTranscriptDistributionAbortRef: refs.cellTranscriptDistributionAbortRef,
    cellTranscriptDistributionRequestIdRef: numberRef(),
    datasetAbortRef: refs.datasetAbortRef,
    datasetWarmupAbortRef: refs.datasetWarmupAbortRef,
    diagnosticsAbortRef: refs.diagnosticsAbortRef,
    didApplyInitialDatasetUrlRef: { current: false },
    geneExpressionAbortRef: refs.geneExpressionAbortRef,
    geneExpressionColorScale: 'plasma',
    geneExpressionRequestIdRef: numberRef(),
    geneExpressionViewportKeyRef: stringRef(),
    initialShareableState: {},
    initialShareableStateRef: { current: null },
    initialSharedRoiSelectionRef: { current: null },
    initialShouldLoadMorphologyRef: { current: false },
    lastViewportDetailRef: { current: null },
    loadAnnotationGroups: vi.fn(async () => []),
    loadDatasetOverview: vi.fn(async () => []),
    loadGenePanel: vi.fn(async () => []),
    loadMorphologyImage: vi.fn(async () => {
      throw new Error('unused')
    }),
    loadRequestIdRef: numberRef(),
    magicLensAbortRef: refs.magicLensAbortRef,
    magicLensDebounceRef: refs.magicLensDebounceRef,
    magicLensLastDetailRef: { current: null },
    magicLensLastQueryKeyRef: stringRef(),
    magicLensRequestIdRef: numberRef(),
    queueAutoContrast: vi.fn(),
    recordTelemetry: vi.fn(),
    roiAbortRef: refs.roiAbortRef,
    roiGeneViewportWarmupAbortRef: refs.roiGeneViewportWarmupAbortRef,
    roiGeneViewportWarmupKeyRef: stringRef(),
    roiGeneViewportWarmupTimeoutRef: refs.roiGeneViewportWarmupTimeoutRef,
    roiRequestIdRef: numberRef(),
    roiTranscriptExportAbortRef: refs.roiTranscriptExportAbortRef,
    roiTranscriptExportRequestIdRef: numberRef(),
    setAnalysisEmbeddingState: noopSetter,
    setAnnotationColors: noopSetter,
    setAnnotationGroupState: noopSetter,
    setAnnotationState: noopSetter,
    setCellMetadataTracks: noopSetter,
    setSelectedCellMetadataTrackId: noopSetter,
    setAutoContrastChannelIds: noopSetter,
    setBoundaryElements: noopSetter,
    setBoundaryState: noopSetter,
    setCellDetailState: noopSetter,
    setCellFeatureMatrixCapabilityState: noopSetter,
    setCellTranscriptDistributionState: noopSetter,
    setCurrentViewportDetail: noopSetter,
    setDatasetUrl: vi.fn(),
    setDatasetWarmupState: noopSetter,
    setDiagnosticsState: noopSetter,
    setGeneExpressionBatch: noopSetter,
    setGeneExpressionColorScale: noopSetter,
    setGeneExpressionDetailMode: noopSetter,
    setGeneExpressionScaleDomain: noopSetter,
    setGeneExpressionScoreMode: noopSetter,
    setGeneExpressionState: noopSetter,
    setGenePanelState: noopSetter,
    setHoveredTranscript: noopSetter,
    setLoadState: noopSetter,
    setMagicLensActive: noopSetter,
    setMagicLensState: noopSetter,
    setManualTranscriptExactRequestKey: noopSetter,
    setMeasurementEnabled: noopSetter,
    setMeasurementResetKey: noopSetter,
    setMorphologyChannelSettings: noopSetter,
    setMorphologyImage: noopSetter,
    setMorphologyState: noopSetter,
    setObservationColorMode: noopSetter,
    setOverviewCells: noopSetter,
    setPinnedTranscript: noopSetter,
    setRoiGeneStatsState: noopSetter,
    setRoiGeneViewportWarmupState: noopSetter,
    setRoiMode: noopSetter,
    setRoiName: noopSetter,
    setRoiState: noopSetter,
    setRoiTranscriptExportState: noopSetter,
    setSelectedAnnotationGroupId: noopSetter,
    setSelectedCell: noopSetter,
    setSelectedEmbeddingKind: noopSetter,
    setSelectedGenes: noopSetter,
    setTranscriptCapabilityState: noopSetter,
    setTranscriptDensityColorScale: noopSetter,
    setTranscriptExactPointLimit: noopSetter,
    setTranscriptLayerState: noopSetter,
    setTranscriptPointColorMode: noopSetter,
    setViewportCellCount: noopSetter,
    startDatasetLoadRef: { current: null },
    transcriptAbortRef: refs.transcriptAbortRef,
    transcriptCapabilityAbortRef: refs.transcriptCapabilityAbortRef,
    transcriptCapabilityRequestIdRef: numberRef(),
    transcriptDensityColorScale: 'thermal',
    transcriptExactPointLimit: 100_000,
    transcriptPointColorMode: 'feature',
    transcriptRequestIdRef: numberRef(),
    transcriptViewportKeyRef: stringRef(),
    warmDatasetForRoi: vi.fn(async () => undefined),
  })

  return null
}

function createLifecycleRefs() {
  return {
    analysisEmbeddingAbortRef: abortRef(),
    boundaryAbortRef: abortRef(),
    cellDetailAbortRef: abortRef(),
    cellTranscriptDistributionAbortRef: abortRef(),
    datasetAbortRef: abortRef(),
    datasetWarmupAbortRef: abortRef(),
    diagnosticsAbortRef: abortRef(),
    geneExpressionAbortRef: abortRef(),
    magicLensAbortRef: abortRef(),
    magicLensDebounceRef: timeoutRef(),
    roiAbortRef: abortRef(),
    roiGeneViewportWarmupAbortRef: abortRef(),
    roiGeneViewportWarmupTimeoutRef: timeoutRef(),
    roiTranscriptExportAbortRef: abortRef(),
    transcriptAbortRef: abortRef(),
    transcriptCapabilityAbortRef: abortRef(),
  }
}

describe('useDatasetLifecycle', () => {
  it('aborts active feature requests on unmount', () => {
    const refs = createLifecycleRefs()
    const { unmount } = render(<Probe refs={refs} />)

    unmount()

    expect(refs.datasetAbortRef.current).toBeNull()
    expect(refs.datasetWarmupAbortRef.current).toBeNull()
    expect(refs.diagnosticsAbortRef.current).toBeNull()
    expect(refs.analysisEmbeddingAbortRef.current).toBeNull()
    expect(refs.boundaryAbortRef.current).toBeNull()
    expect(refs.geneExpressionAbortRef.current).toBeNull()
    expect(refs.roiAbortRef.current).toBeNull()
    expect(refs.roiTranscriptExportAbortRef.current).toBeNull()
    expect(refs.transcriptCapabilityAbortRef.current).toBeNull()
    expect(refs.transcriptAbortRef.current).toBeNull()
    expect(refs.roiGeneViewportWarmupAbortRef.current).toBeNull()
    expect(refs.magicLensAbortRef.current).toBeNull()
    expect(refs.cellDetailAbortRef.current).toBeNull()
    expect(refs.cellTranscriptDistributionAbortRef.current).toBeNull()
  })
})
