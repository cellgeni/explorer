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
    appendDebugEvent: vi.fn(),
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

  it('owns feature search while wiring transcript controls to shared state', () => {
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

    expect(props.setShowTranscriptOverlay).toHaveBeenCalledWith(false)
    expect(props.setTranscriptDetailMode).toHaveBeenCalledWith('density')
    expect(screen.getByLabelText('Feature search')).toHaveValue('')
    expect(props.resetGeneExpressionSelectionState).toHaveBeenCalledTimes(1)
    expect(props.setTranscriptFeatureFilterMode).toHaveBeenCalledWith('selected')
    expect(props.setSelectedGenes).toHaveBeenCalled()
    expect(props.setTranscriptOpacity).toHaveBeenCalledWith(0.55)
    expect(props.setPinnedTranscript).toHaveBeenCalledWith(null)
  })

  it('resets local feature search when a new gene panel load starts', () => {
    const props = baseProps()
    const { rerender } = render(<AppTranscriptHudPanel {...props} />)

    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })

    rerender(
      <AppTranscriptHudPanel
        {...props}
        genePanelState={{ status: 'loading', url: 'https://example.test/next' }}
      />,
    )

    expect(screen.getByLabelText('Feature search')).toHaveValue('')
  })
})
