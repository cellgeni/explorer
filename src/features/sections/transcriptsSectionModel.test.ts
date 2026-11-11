import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useTranscriptsSectionModel,
  type TranscriptsSectionModelInput,
} from './transcriptsSectionModel'

function input(
  overrides: Partial<TranscriptsSectionModelInput> = {},
): TranscriptsSectionModelInput {
  return {
    appendDebugEvent: vi.fn(),
    effectiveTranscriptFeatureFilterMode: 'selected',
    geneOnlyFilterEnabled: true,
    geneOptions: ['Actb', 'Gad1'],
    genePanelState: {
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb', 'Gad1'],
    },
    handlePinTranscript: vi.fn(),
    hoveredTranscript: null,
    loadEnabled: true,
    pinnedTranscript: null,
    resetGeneExpressionSelectionState: vi.fn(),
    selectedGenes: ['Actb'],
    setManualTranscriptExactRequestKey: vi.fn(),
    setPinnedTranscript: vi.fn(),
    setSelectedGenes: vi.fn(),
    setShowTranscriptOverlay: vi.fn(),
    setTranscriptDensityColorScale: vi.fn(),
    setTranscriptDetailMode: vi.fn(),
    setTranscriptExactPointLimit: vi.fn(),
    setTranscriptFeatureFilterMode: vi.fn(),
    setTranscriptGeneOnly: vi.fn(),
    setTranscriptMinQv: vi.fn(),
    setTranscriptOpacity: vi.fn(),
    setTranscriptPointColorMode: vi.fn(),
    setTranscriptPointSize: vi.fn(),
    showTranscriptOverlay: true,
    toggleGene: vi.fn(),
    transcriptCapabilityState: { status: 'idle' },
    transcriptCopy: 'Ready',
    transcriptDensityColorScale: 'thermal',
    transcriptDensityScaleLabels: ['0', '25', '50'],
    transcriptDensityScaleMax: 50,
    transcriptDetailMode: 'auto',
    transcriptExactPointLimit: 100_000,
    transcriptGeneOnly: true,
    transcriptLayerState: { status: 'idle' },
    transcriptMinQv: 20,
    transcriptOpacity: 0.7,
    transcriptPointColorMode: 'feature',
    transcriptPointSize: 2,
    transcriptViewportKeyRef: { current: 'transcript-view' },
    visibleTranscriptEstimate: 50,
    ...overrides,
  }
}

describe('useTranscriptsSectionModel', () => {
  it('wires transcript controls to shared state', () => {
    const options = input()
    const { result } = renderHook(() => useTranscriptsSectionModel(options))

    result.current.onShowChange(false)
    result.current.onDetailModeChange('density')
    result.current.onOpacityPercentChange(55)
    result.current.onClearPinnedTranscript()

    expect(options.setShowTranscriptOverlay).toHaveBeenCalledWith(false)
    expect(options.setTranscriptDetailMode).toHaveBeenCalledWith('density')
    expect(options.setTranscriptOpacity).toHaveBeenCalledWith(0.55)
    expect(options.setPinnedTranscript).toHaveBeenCalledWith(null)
  })

  it('picks a feature into the selection and filters to it', () => {
    const options = input()
    const { result } = renderHook(() => useTranscriptsSectionModel(options))

    expect(result.current.features.onPick('Gad1')).toBe(true)
    expect(result.current.features.onPick('Missing')).toBe(false)

    expect(options.resetGeneExpressionSelectionState).toHaveBeenCalledTimes(1)
    expect(options.setTranscriptFeatureFilterMode).toHaveBeenCalledWith('selected')
    expect(options.setSelectedGenes).toHaveBeenCalledTimes(1)
  })

  it('reports loading while capabilities or the layer load', () => {
    const { result } = renderHook(() =>
      useTranscriptsSectionModel(
        input({
          transcriptCapabilityState: {
            status: 'loading',
            url: 'https://example.test/output',
          },
        }),
      ),
    )

    expect(result.current.isLoading).toBe(true)
    expect(result.current.headerCopy).toBe('Ready')
    expect(result.current.features.filterMode).toBe('selected')
  })
})
