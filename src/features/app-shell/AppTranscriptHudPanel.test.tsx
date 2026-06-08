import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import { screenPixels } from '../../data/coords'
import { AppTranscriptHudPanel } from './AppTranscriptHudPanel'

type Props = ComponentProps<typeof AppTranscriptHudPanel>

const pinnedTranscript: ViewerTranscriptHoverDetail = {
  transcript: {
    id: 'tx-1',
    transcriptId: 'raw-1',
    position: [1, -2, 0],
    featureName: 'Actb',
    fovName: null,
    cellId: 'cell-1',
    qv: 40,
    fillColor: [255, 255, 255],
    isGene: true,
  },
  screen: { x: screenPixels(1), y: screenPixels(2) },
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true,
    controlIds: {
      transcriptDensityScaleInputId: 'tx-density',
      transcriptDetailInputId: 'tx-detail',
      transcriptFeatureFilterInputId: 'tx-filter',
      transcriptFeatureSearchInputId: 'tx-search',
      transcriptMinQvInputId: 'tx-qv',
      transcriptOpacityInputId: 'tx-opacity',
      transcriptPointBudgetInputId: 'tx-budget',
      transcriptPointColorInputId: 'tx-point-color',
      transcriptPointSizeInputId: 'tx-size',
    },
    effectiveTranscriptFeatureFilterMode: 'selected',
    filteredTranscriptFeatures: ['Gad1'],
    genePanelState: {
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb', 'Gad1'],
    },
    handleLoadExactViewport: vi.fn(),
    handlePinTranscript: vi.fn(),
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
    hoveredTranscript: null,
    loadEnabled: true,
    pickTranscriptFeature: vi.fn(),
    pinnedTranscript: null,
    selectedGenes: ['Actb'],
    setPinnedTranscript: vi.fn(),
    setTranscriptFeatureSearch: vi.fn(),
    showTranscriptOverlay: true,
    transcriptCapabilityState: {
      status: 'ready',
      url: 'https://example.test/output',
      capabilities: { rawParquet: true, nativeZarr: true },
    },
    transcriptCopy: 'Ready',
    transcriptDensityColorScale: 'thermal',
    transcriptDensityScaleLabels: ['0', '25', '50'],
    transcriptDensityScaleMax: 50,
    transcriptDetailMode: 'auto',
    transcriptExactPointLimit: 100_000,
    transcriptFeatureSearch: 'ga',
    transcriptGeneOnly: true,
    transcriptLayerState: { status: 'idle' },
    transcriptMinQv: 20,
    transcriptOpacity: 0.7,
    transcriptPointColorMode: 'feature',
    transcriptPointSize: 2,
    visibleTranscriptEstimate: 50,
    ...overrides,
  }
}

describe('AppTranscriptHudPanel', () => {
  it('derives transcript feature search availability from gene panel readiness', () => {
    const props = baseProps({ genePanelState: { status: 'idle' } })
    const { rerender } = render(<AppTranscriptHudPanel {...props} />)

    expect(screen.getByLabelText('Feature search')).toBeDisabled()

    rerender(
      <AppTranscriptHudPanel
        {...props}
        genePanelState={{
          status: 'ready',
          url: 'https://example.test/output',
          genes: ['Actb', 'Gad1'],
        }}
      />,
    )

    expect(screen.getByLabelText('Feature search')).toBeEnabled()
  })

  it('wires transcript controls and clears pinned transcript state', () => {
    const props = baseProps({ pinnedTranscript })

    render(<AppTranscriptHudPanel {...props} />)

    fireEvent.click(screen.getByLabelText('Show transcripts'))
    fireEvent.change(screen.getByLabelText('Detail'), {
      target: { value: 'density' },
    })
    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    fireEvent.change(screen.getByLabelText('Transcript opacity'), {
      target: { value: '55' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(props.handleTranscriptOverlayChange).toHaveBeenCalledWith(false)
    expect(props.handleTranscriptDetailModeChange).toHaveBeenCalledWith('density')
    expect(props.setTranscriptFeatureSearch).toHaveBeenCalledWith('gad')
    expect(props.pickTranscriptFeature).toHaveBeenCalledWith('Gad1')
    expect(props.handleTranscriptOpacityPercentChange).toHaveBeenCalledWith(55)
    expect(props.setPinnedTranscript).toHaveBeenCalledWith(null)
  })
})
