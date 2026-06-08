import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptHudPanel } from './TranscriptHudPanel'

describe('TranscriptHudPanel', () => {
  it('renders transcript controls and forwards control changes', () => {
    const handlers = {
      onShowTranscriptOverlayChange: vi.fn(),
      onTranscriptDetailModeChange: vi.fn(),
      onTranscriptExactPointLimitChange: vi.fn(),
      onTranscriptFeatureFilterModeChange: vi.fn(),
      onToggleSelectedFeature: vi.fn(),
      onTranscriptFeatureSearchChange: vi.fn(),
      onPickTranscriptFeature: vi.fn(),
      onTranscriptDensityColorScaleChange: vi.fn(),
      onTranscriptPointColorModeChange: vi.fn(),
      onTranscriptMinQvChange: vi.fn(),
      onTranscriptGeneOnlyChange: vi.fn(),
      onTranscriptOpacityPercentChange: vi.fn(),
      onTranscriptPointSizeChange: vi.fn(),
      onPinTranscript: vi.fn(),
      onClearPinnedTranscript: vi.fn(),
      onLoadExactViewport: vi.fn(),
    }

    render(
      <TranscriptHudPanel
        active
        transcriptDetailInputId="tx-detail"
        transcriptDensityScaleInputId="tx-density"
        transcriptPointColorInputId="tx-point-color"
        transcriptPointBudgetInputId="tx-budget"
        transcriptMinQvInputId="tx-qv"
        transcriptFeatureFilterInputId="tx-filter"
        transcriptFeatureSearchInputId="tx-search"
        transcriptOpacityInputId="tx-opacity"
        transcriptPointSizeInputId="tx-size"
        transcriptCopy="Ready"
        loadEnabled
        featureSearchEnabled
        showTranscriptOverlay
        transcriptDetailMode="auto"
        transcriptExactPointLimit={100000}
        effectiveTranscriptFeatureFilterMode="selected"
        selectedGenes={['Actb']}
        transcriptFeatureSearch="ga"
        filteredTranscriptFeatures={['Gad1']}
        transcriptDensityColorScale="thermal"
        transcriptDensityScaleMax={50}
        transcriptDensityScaleLabels={['0', '25', '50']}
        transcriptPointColorMode="feature"
        transcriptMinQv={20}
        transcriptGeneOnly
        transcriptOpacity={0.7}
        transcriptPointSize={2}
        transcriptCapabilityState={{
          status: 'ready',
          url: 'https://example.test/output',
          capabilities: { rawParquet: true, nativeZarr: true },
        }}
        transcriptLayerState={{ status: 'idle' }}
        visibleTranscriptEstimate={50}
        hoveredTranscript={null}
        pinnedTranscript={null}
        {...handlers}
      />,
    )

    fireEvent.click(screen.getByLabelText('Show transcripts'))
    fireEvent.change(screen.getByLabelText('Detail'), { target: { value: 'density' } })
    fireEvent.change(screen.getByLabelText('Exact budget'), {
      target: { value: '50000' },
    })
    fireEvent.change(screen.getByLabelText('Feature filter'), {
      target: { value: 'all' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Actb' }))
    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    fireEvent.change(screen.getByLabelText('Density color'), {
      target: { value: 'viridis' },
    })
    fireEvent.change(screen.getByLabelText('Point color'), {
      target: { value: 'quality' },
    })
    fireEvent.change(screen.getByLabelText('Min QV'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('Gene-only calls'))
    fireEvent.change(screen.getByLabelText('Transcript opacity'), {
      target: { value: '55' },
    })
    fireEvent.change(screen.getByLabelText('Point size'), { target: { value: '4' } })

    expect(handlers.onShowTranscriptOverlayChange).toHaveBeenCalledWith(false)
    expect(handlers.onTranscriptDetailModeChange).toHaveBeenCalledWith('density')
    expect(handlers.onTranscriptExactPointLimitChange).toHaveBeenCalledWith(50000)
    expect(handlers.onTranscriptFeatureFilterModeChange).toHaveBeenCalledWith('all')
    expect(handlers.onToggleSelectedFeature).toHaveBeenCalledWith('Actb')
    expect(handlers.onTranscriptFeatureSearchChange).toHaveBeenCalledWith('gad')
    expect(handlers.onPickTranscriptFeature).toHaveBeenCalledWith('Gad1')
    expect(handlers.onTranscriptDensityColorScaleChange).toHaveBeenCalledWith('viridis')
    expect(handlers.onTranscriptPointColorModeChange).toHaveBeenCalledWith('quality')
    expect(handlers.onTranscriptMinQvChange).toHaveBeenCalledWith(30)
    expect(handlers.onTranscriptGeneOnlyChange).toHaveBeenCalledWith(false)
    expect(handlers.onTranscriptOpacityPercentChange).toHaveBeenCalledWith(55)
    expect(handlers.onTranscriptPointSizeChange).toHaveBeenCalledWith(4)
  })
})
