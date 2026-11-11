import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCellsSectionModel, type CellsSectionModelInput } from './cellsSectionModel'

function input(overrides: Partial<CellsSectionModelInput> = {}): CellsSectionModelInput {
  return {
    analysisHeaderCopy: '2 genes',
    appendDebugEvent: vi.fn(),
    offerUndo: vi.fn(),
    cellBoundaryOpacity: 1,
    cellFillOpacity: 1,
    cellLayerControlsVisible: true,
    cellMetadataTracks: [],
    geneExpressionBatch: null,
    geneExpressionColorScale: 'plasma',
    geneExpressionCopy: 'Expression ready',
    geneExpressionDetailMode: 'auto',
    geneExpressionScaleDatasetUrl: 'https://example.test/output',
    geneExpressionScaleMax: 12,
    geneExpressionScoreMode: 'sum',
    geneExpressionState: { status: 'idle' },
    geneOptions: ['Actb', 'Gad1'],
    genePanelState: {
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb', 'Gad1'],
    },
    hasAnnotationColors: true,
    nucleusBoundaryControlsVisible: true,
    observationColorMode: 'transcript-count',
    rememberGeneExpressionScaleMax: vi.fn(),
    resetGeneExpressionSelectionState: vi.fn(),
    selectedCellMetadataTrackId: null,
    selectedGenes: ['Actb', 'Slc17a7'],
    setCellBoundaryOpacity: vi.fn(),
    setCellFillOpacity: vi.fn(),
    setGeneExpressionColorScale: vi.fn(),
    setGeneExpressionDetailMode: vi.fn(),
    setGeneExpressionScaleDomain: vi.fn(),
    setGeneExpressionScoreMode: vi.fn(),
    setManualTranscriptExactRequestKey: vi.fn(),
    setObservationColorMode: vi.fn(),
    setSelectedCellMetadataTrackId: vi.fn(),
    setSelectedGenes: vi.fn(),
    setShowCellBoundaries: vi.fn(),
    setShowNucleusBoundaries: vi.fn(),
    showCellBoundaries: true,
    showNucleusBoundaries: true,
    toggleGene: vi.fn(),
    transcriptViewportKeyRef: { current: 'transcript-view' },
    ...overrides,
  }
}

describe('useCellsSectionModel', () => {
  it('turns opacity percents into opacities and logs them', () => {
    const options = input()
    const { result } = renderHook(() => useCellsSectionModel(options))

    result.current.appearance.onFillOpacityPercentChange(35)
    result.current.appearance.onBoundaryOpacityPercentChange(25)

    expect(options.setCellFillOpacity).toHaveBeenCalledWith(0.35)
    expect(options.setCellBoundaryOpacity).toHaveBeenCalledWith(0.25)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Cell fill opacity: 35%', {
      coalesceKey: 'cell-fill-opacity',
    })
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Cell boundary opacity: 25%', {
      coalesceKey: 'cell-boundary-opacity',
    })
  })

  it('logs boundary visibility changes and ignores unchanged ones', () => {
    const options = input()
    const { result } = renderHook(() => useCellsSectionModel(options))

    result.current.appearance.onShowCellBoundariesChange(true)
    result.current.appearance.onShowCellBoundariesChange(false)
    result.current.appearance.onShowNucleusBoundariesChange(false)

    expect(options.setShowCellBoundaries).toHaveBeenCalledTimes(1)
    expect(options.setShowCellBoundaries).toHaveBeenCalledWith(false)
    expect(options.setShowNucleusBoundaries).toHaveBeenCalledWith(false)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Cell boundaries hidden', {
      coalesceKey: 'cell-boundaries-visible',
    })
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Nucleus boundaries hidden', {
      coalesceKey: 'nucleus-boundaries-visible',
    })
  })

  it('applies genes, colours cells by them and drops pending requests', () => {
    const options = input()
    const { result } = renderHook(() => useCellsSectionModel(options))

    result.current.genes.onApply(['Actb', 'Gad1'])

    expect(options.resetGeneExpressionSelectionState).toHaveBeenCalledTimes(1)
    expect(options.transcriptViewportKeyRef.current).toBeNull()
    expect(options.setManualTranscriptExactRequestKey).toHaveBeenCalledWith(null)
    expect(options.setSelectedGenes).toHaveBeenCalledWith(['Actb', 'Gad1'])
    expect(options.setObservationColorMode).toHaveBeenCalledWith('gene-expression')
    expect(options.setGeneExpressionScoreMode).not.toHaveBeenCalled()

    result.current.genes.onApply(['Gad1'], 'mean')

    expect(options.setGeneExpressionScoreMode).toHaveBeenCalledWith('mean')
  })

  it('wires the colour controls to app state', () => {
    const options = input()
    const { result } = renderHook(() => useCellsSectionModel(options))

    result.current.colour.onScoreModeChange('mean')
    result.current.colour.onColorScaleChange('viridis')
    result.current.colour.onDetailModeChange('all-cells')
    result.current.colour.onModeChange('annotations')
    result.current.colour.onMetadataTrackChange('metadata:pseudotime')
    result.current.genes.onToggle('Gad1')

    expect(options.setGeneExpressionScoreMode).toHaveBeenCalledWith('mean')
    // Without a batch the remembered scale resets.
    expect(options.setGeneExpressionScaleDomain).toHaveBeenCalledWith({ key: '', max: 0 })
    expect(options.setGeneExpressionColorScale).toHaveBeenCalledWith('viridis')
    expect(options.setGeneExpressionDetailMode).toHaveBeenCalledWith('all-cells')
    expect(options.setObservationColorMode).toHaveBeenCalledWith('annotations')
    expect(options.setSelectedCellMetadataTrackId).toHaveBeenCalledWith(
      'metadata:pseudotime',
    )
    expect(options.toggleGene).toHaveBeenCalledWith('Gad1')
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Cell color: annotations')
    expect(result.current.colour.selectedGeneCount).toBe(2)
    expect(result.current.colour.isLoading).toBe(false)
  })

  it('reports loading while the gene panel or expression loads', () => {
    const { result } = renderHook(() =>
      useCellsSectionModel(
        input({
          geneExpressionState: {
            status: 'loading',
            url: 'https://example.test/output',
            genes: ['Actb'],
            mode: 'exact-region',
            visibleCellCount: 1,
          },
        }),
      ),
    )

    expect(result.current.colour.isLoading).toBe(true)
  })
})
