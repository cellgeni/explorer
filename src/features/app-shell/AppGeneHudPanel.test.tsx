import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppGeneHudPanel } from './AppGeneHudPanel'

type Props = ComponentProps<typeof AppGeneHudPanel>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true,
    analysisHeaderCopy: '2 genes',
    appendDebugEvent: vi.fn(),
    controlIds: {
      geneExpressionDetailInputId: 'gene-detail',
      geneScaleInputId: 'gene-scale',
      geneSearchInputId: 'gene-search',
      geneSetNameInputId: 'gene-set-name',
      geneSetScoreInputId: 'gene-set-score',
      geneSetSymbolsInputId: 'gene-set-symbols',
      observationModeInputId: 'cell-color',
    },
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
    observationColorMode: 'transcript-count',
    rememberGeneExpressionScaleMax: vi.fn(),
    resetGeneExpressionSelectionState: vi.fn(),
    selectedGenes: ['Actb'],
    setGeneExpressionColorScale: vi.fn(),
    setGeneExpressionDetailMode: vi.fn(),
    setGeneExpressionScaleDomain: vi.fn(),
    setGeneExpressionScoreMode: vi.fn(),
    setManualTranscriptExactRequestKey: vi.fn(),
    setObservationColorMode: vi.fn(),
    setSelectedGenes: vi.fn(),
    toggleGene: vi.fn(),
    transcriptViewportKeyRef: { current: 'transcript-view' },
    ...overrides,
  }
}

describe('AppGeneHudPanel', () => {
  it('owns local gene form state and wires shared controls to app state', () => {
    const props = baseProps()

    render(<AppGeneHudPanel {...props} />)

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'Actb Gad1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Marker set' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    fireEvent.change(screen.getByLabelText('Signature score'), {
      target: { value: 'mean' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Marker set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Marker set' }))
    fireEvent.change(screen.getByLabelText('Gene scale'), {
      target: { value: 'viridis' },
    })
    fireEvent.change(screen.getByLabelText('Expression detail'), {
      target: { value: 'exact-region' },
    })
    fireEvent.change(screen.getByLabelText('Cell color'), {
      target: { value: 'annotations' },
    })

    expect(props.toggleGene).toHaveBeenCalledWith('Gad1')
    expect(props.setSelectedGenes).toHaveBeenCalledWith(['Actb', 'Gad1'])
    expect(props.setSelectedGenes).toHaveBeenCalledWith(['Actb'])
    expect(props.setGeneExpressionScoreMode).toHaveBeenCalledWith('sum')
    expect(props.setGeneExpressionScoreMode).toHaveBeenCalledWith('mean')
    expect(props.setGeneExpressionColorScale).toHaveBeenCalledWith('viridis')
    expect(props.setGeneExpressionDetailMode).toHaveBeenCalledWith('exact-region')
    expect(props.setObservationColorMode).toHaveBeenCalledWith('annotations')
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Saved gene set Marker set')
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Removed gene set Marker set')
  })

  it('resets local gene controls when a new gene panel load starts', () => {
    const props = baseProps()
    const { rerender } = render(<AppGeneHudPanel {...props} />)

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'Actb' },
    })
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'Marker set' },
    })

    rerender(
      <AppGeneHudPanel
        {...props}
        genePanelState={{ status: 'loading', url: 'https://example.test/next' }}
      />,
    )

    expect(screen.getByLabelText('Gene selection')).toHaveValue('')
    expect(screen.getByLabelText('Gene set symbols')).toHaveValue('')
    expect(screen.getByLabelText('Set name')).toHaveValue('')
  })
})
