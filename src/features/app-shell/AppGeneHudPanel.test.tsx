import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppGeneHudPanel } from './AppGeneHudPanel'

type Props = ComponentProps<typeof AppGeneHudPanel>

const savedGeneSet = {
  id: 'set-1',
  name: 'Marker set',
  genes: ['Actb'],
  scoreMode: 'sum' as const,
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true,
    analysisHeaderCopy: '2 genes',
    applyGeneSetSymbols: vi.fn(),
    applySavedGeneSet: vi.fn(),
    controlIds: {
      geneExpressionDetailInputId: 'gene-detail',
      geneScaleInputId: 'gene-scale',
      geneSearchInputId: 'gene-search',
      geneSetNameInputId: 'gene-set-name',
      geneSetScoreInputId: 'gene-set-score',
      geneSetSymbolsInputId: 'gene-set-symbols',
      observationModeInputId: 'cell-color',
    },
    filteredGenes: ['Gad1'],
    geneExpressionColorScale: 'plasma',
    geneExpressionCopy: 'Expression ready',
    geneExpressionDetailMode: 'auto',
    geneExpressionScaleMax: 12,
    geneExpressionScoreMode: 'sum',
    geneExpressionState: { status: 'idle' },
    genePanelState: {
      status: 'ready',
      url: 'https://example.test/output',
      genes: ['Actb', 'Gad1'],
    },
    geneSearch: '',
    geneSetName: '',
    geneSetSymbols: 'Actb',
    handleGeneExpressionColorScaleChange: vi.fn(),
    handleGeneExpressionDetailModeChange: vi.fn(),
    handleGeneExpressionScoreModeChange: vi.fn(),
    handleObservationColorModeChange: vi.fn(),
    hasAnnotationColors: true,
    observationColorMode: 'transcript-count',
    removeSavedGeneSet: vi.fn(),
    savedGeneSets: [savedGeneSet],
    saveSelectedGeneSet: vi.fn(),
    selectedGenes: ['Actb'],
    setGeneSearch: vi.fn(),
    setGeneSetName: vi.fn(),
    setGeneSetSymbols: vi.fn(),
    toggleGene: vi.fn(),
    ...overrides,
  }
}

describe('AppGeneHudPanel', () => {
  it('wires gene controls to app state and workflow handlers', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    fireEvent.change(screen.getByLabelText('Set name'), {
      target: { value: 'New set' },
    })
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

    expect(props.setGeneSearch).toHaveBeenCalledWith('gad')
    expect(props.toggleGene).toHaveBeenCalledWith('Gad1')
    expect(props.setGeneSetSymbols).toHaveBeenCalledWith('Actb Gad1')
    expect(props.applyGeneSetSymbols).toHaveBeenCalledTimes(1)
    expect(props.saveSelectedGeneSet).toHaveBeenCalledTimes(1)
    expect(props.setGeneSetName).toHaveBeenCalledWith('New set')
    expect(props.handleGeneExpressionScoreModeChange).toHaveBeenCalledWith('mean')
    expect(props.applySavedGeneSet).toHaveBeenCalledWith(savedGeneSet)
    expect(props.removeSavedGeneSet).toHaveBeenCalledWith('set-1')
    expect(props.handleGeneExpressionColorScaleChange).toHaveBeenCalledWith('viridis')
    expect(props.handleGeneExpressionDetailModeChange).toHaveBeenCalledWith(
      'exact-region',
    )
    expect(props.handleObservationColorModeChange).toHaveBeenCalledWith('annotations')
  })
})
