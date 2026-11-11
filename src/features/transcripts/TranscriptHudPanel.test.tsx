import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import { screenPixels } from '../../data/coords'
import { testTranscriptsSectionModel } from '../../test/sectionModels'
import { TranscriptHudPanel } from './TranscriptHudPanel'

const READY_PANEL = {
  status: 'ready',
  url: 'https://example.test/output',
  genes: ['Actb', 'Gad1'],
} as const

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

describe('TranscriptHudPanel', () => {
  it('renders transcript controls and forwards control changes', () => {
    const transcripts = testTranscriptsSectionModel({
      headerCopy: 'Ready',
      show: true,
      exactPointLimit: 100_000,
      densityColorScale: 'thermal',
      densityScaleMax: 50,
      densityScaleLabels: ['0', '25', '50'],
      opacity: 0.7,
      capabilityState: {
        status: 'ready',
        url: 'https://example.test/output',
        capabilities: { rawParquet: true, nativeZarr: true },
      },
      visibleEstimate: 50,
      pinnedTranscript,
      features: {
        filterMode: 'selected',
        panelState: READY_PANEL,
        options: ['Actb', 'Gad1'],
        selected: ['Actb'],
      },
    })

    render(<TranscriptHudPanel active transcripts={transcripts} />)

    expect(screen.getByText('Ready')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Show transcripts'))
    fireEvent.change(screen.getByLabelText('Detail'), { target: { value: 'density' } })
    expect(screen.getByText('50 of 100,000 points')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Max' }))
    fireEvent.change(screen.getByLabelText('Exact budget'), {
      target: { value: '50000' },
    })
    fireEvent.keyDown(screen.getByLabelText('Exact budget'), { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Feature filter'), {
      target: { value: 'all' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Actb from transcript features' }),
    )
    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    expect(screen.getByLabelText('Feature search')).toHaveValue('')
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
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(transcripts.onShowChange).toHaveBeenCalledWith(false)
    expect(transcripts.onDetailModeChange).toHaveBeenCalledWith('density')
    expect(transcripts.onExactPointLimitChange).toHaveBeenCalledWith(50000)
    expect(transcripts.features.onFilterModeChange).toHaveBeenCalledWith('all')
    expect(transcripts.features.onToggle).toHaveBeenCalledWith('Actb')
    expect(transcripts.features.onPick).toHaveBeenCalledWith('Gad1')
    expect(transcripts.onDensityColorScaleChange).toHaveBeenCalledWith('viridis')
    expect(transcripts.onPointColorModeChange).toHaveBeenCalledWith('quality')
    expect(transcripts.onMinQvChange).toHaveBeenCalledWith(30)
    expect(transcripts.onGeneOnlyChange).toHaveBeenCalledWith(false)
    expect(transcripts.onOpacityPercentChange).toHaveBeenCalledWith(55)
    expect(transcripts.onPointSizeChange).toHaveBeenCalledWith(4)
    expect(transcripts.onClearPinnedTranscript).toHaveBeenCalledTimes(1)
  })

  it('keeps the search when a gene is not picked', () => {
    const transcripts = testTranscriptsSectionModel({
      features: {
        panelState: READY_PANEL,
        options: ['Actb', 'Gad1'],
        onPick: vi.fn(() => false),
      },
    })

    render(<TranscriptHudPanel active transcripts={transcripts} />)

    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))

    expect(screen.getByLabelText('Feature search')).toHaveValue('gad')
  })

  it('enables the feature search once the gene panel is ready', () => {
    const transcripts = testTranscriptsSectionModel()
    const { rerender } = render(<TranscriptHudPanel active transcripts={transcripts} />)

    expect(screen.getByLabelText('Feature search')).toBeDisabled()

    rerender(
      <TranscriptHudPanel
        active
        transcripts={{
          ...transcripts,
          features: { ...transcripts.features, panelState: READY_PANEL },
        }}
      />,
    )

    expect(screen.getByLabelText('Feature search')).toBeEnabled()
  })

  it('resets the feature search when a new gene panel load starts', () => {
    const transcripts = testTranscriptsSectionModel({
      features: { panelState: READY_PANEL, options: ['Actb', 'Gad1'] },
    })
    const { rerender } = render(<TranscriptHudPanel active transcripts={transcripts} />)

    fireEvent.change(screen.getByLabelText('Feature search'), {
      target: { value: 'gad' },
    })

    rerender(
      <TranscriptHudPanel
        active
        transcripts={{
          ...transcripts,
          features: {
            ...transcripts.features,
            panelState: { status: 'loading', url: 'https://example.test/next' },
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Feature search')).toHaveValue('')
  })
})
