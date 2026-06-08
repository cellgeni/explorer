import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { screenPixels } from '../../data/coords'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import { TranscriptStatusPanel } from './TranscriptStatusPanel'

const hoveredTranscript: ViewerTranscriptHoverDetail = {
  transcript: {
    id: 'tx-1',
    transcriptId: 'raw-1',
    position: [1, -2, 0],
    featureName: 'Actb',
    fovName: null,
    cellId: 'aaaaaaaa-1',
    qv: 40,
    fillColor: [255, 255, 255],
    zLocation: 3,
    overlapsNucleus: true,
    isGene: true,
  },
  screen: { x: screenPixels(1), y: screenPixels(2) },
}

describe('TranscriptStatusPanel', () => {
  it('shows waiting status and forwards exact-load requests', () => {
    const onLoadExactViewport = vi.fn()

    render(
      <TranscriptStatusPanel
        capabilityState={{
          status: 'ready',
          url: 'https://example.test/output',
          capabilities: { rawParquet: true, nativeZarr: true },
        }}
        layerState={{
          status: 'waiting',
          message: 'Manual load required',
          visibleTranscriptEstimate: 80,
          exactLoadRequestKey: 'request-key',
          exactLoadEstimate: 80,
        }}
        exactPointLimit={100}
        visibleTranscriptEstimate={80}
        hoveredTranscript={null}
        pinnedTranscript={null}
        onPinTranscript={vi.fn()}
        onClearPinnedTranscript={vi.fn()}
        onLoadExactViewport={onLoadExactViewport}
      />,
    )

    expect(screen.getByLabelText('Transcript overlay summary')).toHaveTextContent(
      'Native LOD + exact',
    )
    expect(screen.getByText('Manual load required')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load exact viewport' }))

    expect(onLoadExactViewport).toHaveBeenCalledWith('request-key')
  })

  it('renders transcript inspections and forwards pin/clear actions', () => {
    const onPinTranscript = vi.fn()
    const onClearPinnedTranscript = vi.fn()

    render(
      <TranscriptStatusPanel
        capabilityState={{
          status: 'ready',
          url: 'https://example.test/output',
          capabilities: { rawParquet: true, nativeZarr: false },
        }}
        layerState={{
          status: 'ready',
          url: 'https://example.test/output',
          points: [],
          groups: [{ featureName: 'Actb', fovName: null, count: 3 }],
          visibleTranscriptEstimate: 3,
          hitPointLimit: false,
          durationMs: 12,
        }}
        exactPointLimit={100}
        visibleTranscriptEstimate={3}
        hoveredTranscript={hoveredTranscript}
        pinnedTranscript={hoveredTranscript}
        onPinTranscript={onPinTranscript}
        onClearPinnedTranscript={onClearPinnedTranscript}
        onLoadExactViewport={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Top transcript groups')).toHaveTextContent('Actb')
    expect(screen.getByText('Pinned transcript')).toBeInTheDocument()
    expect(screen.getByText('Hovered transcript')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onPinTranscript).toHaveBeenCalledWith(hoveredTranscript)
    expect(onClearPinnedTranscript).toHaveBeenCalledTimes(1)
  })
})
