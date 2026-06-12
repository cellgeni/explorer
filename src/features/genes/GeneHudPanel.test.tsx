import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeneHudPanel } from './GeneHudPanel'

describe('GeneHudPanel', () => {
  it('renders gene controls and forwards search, set, scale, and mode updates', () => {
    const handlers = {
      onGeneSearchChange: vi.fn(),
      onToggleGene: vi.fn(),
      onGeneSetSymbolsChange: vi.fn(),
      onApplyGeneSetSymbols: vi.fn(),
      onSaveSelectedGeneSet: vi.fn(),
      onGeneSetNameChange: vi.fn(),
      onGeneExpressionScoreModeChange: vi.fn(),
      onApplySavedGeneSet: vi.fn(),
      onRemoveSavedGeneSet: vi.fn(),
      onGeneExpressionColorScaleChange: vi.fn(),
      onGeneExpressionDetailModeChange: vi.fn(),
      onObservationColorModeChange: vi.fn(),
      onCellMetadataTrackChange: vi.fn(),
    }
    const savedGeneSet = {
      id: 'set-1',
      name: 'Marker set',
      genes: ['Actb'],
      scoreMode: 'sum' as const,
    }

    render(
      <GeneHudPanel
        active
        geneSearchInputId="gene-search"
        geneSetSymbolsInputId="gene-set-symbols"
        geneSetNameInputId="gene-set-name"
        geneSetScoreInputId="gene-set-score"
        geneScaleInputId="gene-scale"
        geneExpressionDetailInputId="gene-detail"
        observationModeInputId="cell-color"
        cellMetadataTrackInputId="metadata-track"
        analysisHeaderCopy="2 genes"
        geneExpressionCopy="Expression ready"
        genePanelState={{
          status: 'ready',
          url: 'https://example.test/output',
          genes: ['Actb', 'Gad1'],
        }}
        geneExpressionState={{ status: 'idle' }}
        geneSearch=""
        geneSetSymbols="Actb"
        geneSetName=""
        geneExpressionScoreMode="sum"
        savedGeneSets={[savedGeneSet]}
        selectedGenes={['Actb']}
        filteredGenes={['Gad1']}
        geneExpressionColorScale="plasma"
        geneExpressionScaleMax={12}
        geneExpressionDetailMode="auto"
        observationColorMode="metadata"
        hasAnnotationColors
        cellMetadataTracks={[
          {
            id: 'metadata:confidence',
            label: 'confidence',
            values: [],
            min: 0,
            max: 1,
          },
          {
            id: 'metadata:pseudotime',
            label: 'pseudotime',
            values: [],
            min: 0.1,
            max: 0.9,
          },
        ]}
        selectedCellMetadataTrackId="metadata:confidence"
        {...handlers}
      />,
    )

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Actb' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gad1' }))
    fireEvent.change(screen.getByLabelText('Gene set symbols'), {
      target: { value: 'Actb Gad1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Symbols' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Set' }))
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'New set' } })
    fireEvent.change(screen.getByLabelText('Signature score'), {
      target: { value: 'mean' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Marker set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Marker set' }))
    fireEvent.change(screen.getByLabelText('Gene scale'), {
      target: { value: 'viridis' },
    })
    fireEvent.change(screen.getByLabelText('Expression detail'), {
      target: { value: 'all-cells' },
    })
    fireEvent.change(screen.getByLabelText('Cell color'), {
      target: { value: 'annotations' },
    })
    fireEvent.change(screen.getByLabelText('Metadata track'), {
      target: { value: 'metadata:pseudotime' },
    })

    expect(handlers.onGeneSearchChange).toHaveBeenCalledWith('gad')
    expect(handlers.onToggleGene).toHaveBeenCalledWith('Actb')
    expect(handlers.onToggleGene).toHaveBeenCalledWith('Gad1')
    expect(handlers.onGeneSetSymbolsChange).toHaveBeenCalledWith('Actb Gad1')
    expect(handlers.onApplyGeneSetSymbols).toHaveBeenCalledTimes(1)
    expect(handlers.onSaveSelectedGeneSet).toHaveBeenCalledTimes(1)
    expect(handlers.onGeneSetNameChange).toHaveBeenCalledWith('New set')
    expect(handlers.onGeneExpressionScoreModeChange).toHaveBeenCalledWith('mean')
    expect(handlers.onApplySavedGeneSet).toHaveBeenCalledWith(savedGeneSet)
    expect(handlers.onRemoveSavedGeneSet).toHaveBeenCalledWith('set-1')
    expect(handlers.onGeneExpressionColorScaleChange).toHaveBeenCalledWith('viridis')
    expect(handlers.onGeneExpressionDetailModeChange).toHaveBeenCalledWith('all-cells')
    expect(handlers.onObservationColorModeChange).toHaveBeenCalledWith('annotations')
    expect(handlers.onCellMetadataTrackChange).toHaveBeenCalledWith('metadata:pseudotime')
  })
})
