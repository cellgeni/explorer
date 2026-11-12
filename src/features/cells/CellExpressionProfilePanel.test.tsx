import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CellGeneExpressionSummary } from './cellDetailModel'
import { CellExpressionProfilePanel } from './CellExpressionProfilePanel'
import type { CellExpressionProfileState } from './cellExpressionProfileModel'

const EXPRESSION: CellGeneExpressionSummary = {
  genes: [
    { gene: 'Gad1', count: 900, percentTotal: 75 },
    { gene: 'Actb', count: 300, percentTotal: 25 },
  ],
  totalCount: 1200,
  hitGeneLimit: false,
}

const SELECTION = { selectionId: 'aaaaaaab-1', selectionKind: 'cell' } as const

function readyState(
  values: Partial<{ expression: CellGeneExpressionSummary; sourceLabel: string }> = {},
): CellExpressionProfileState {
  return { status: 'ready', ...SELECTION, expression: EXPRESSION, ...values }
}

function loadButton(): HTMLElement {
  return screen.getByRole('button')
}

describe('CellExpressionProfilePanel', () => {
  it('offers to load the profile on demand and calls onLoad', () => {
    const onLoad = vi.fn()
    render(<CellExpressionProfilePanel state={{ status: 'idle' }} onLoad={onLoad} />)

    expect(screen.getByText('Cell GEX profile')).toBeInTheDocument()
    expect(screen.getByText('On demand')).toBeInTheDocument()
    expect(screen.getByText('No cell GEX loaded')).toBeInTheDocument()
    expect(loadButton()).toHaveTextContent('Load Cell GEX')
    expect(loadButton()).toHaveAttribute(
      'title',
      'Load selected cell gene expression profile',
    )

    fireEvent.click(loadButton())
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('disables the button while loading and announces progress', () => {
    const onLoad = vi.fn()
    render(
      <CellExpressionProfilePanel
        state={{ status: 'loading', ...SELECTION }}
        onLoad={onLoad}
      />,
    )

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(loadButton()).toHaveTextContent('Loading...')
    expect(loadButton()).toBeDisabled()
    expect(screen.getByText('Loading cell GEX profile')).toHaveAttribute(
      'aria-live',
      'polite',
    )

    fireEvent.click(loadButton())
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('shows why a profile is unavailable', () => {
    render(
      <CellExpressionProfilePanel
        state={{
          status: 'unavailable',
          ...SELECTION,
          reason: 'This dataset has no cell-feature matrix.',
        }}
        onLoad={vi.fn()}
      />,
    )

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('This dataset has no cell-feature matrix.'),
    ).toBeInTheDocument()
  })

  it('shows a load error and lets the user try again', () => {
    const onLoad = vi.fn()
    render(
      <CellExpressionProfilePanel
        state={{
          status: 'error',
          ...SELECTION,
          error: { title: 'Matrix read failed', message: 'HTTP 403 from the host.' },
        }}
        onLoad={onLoad}
      />,
    )

    const error = screen.getByText('Matrix read failed: HTTP 403 from the host.')
    expect(error).toHaveClass('is-error')
    expect(error).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Error')).toBeInTheDocument()

    fireEvent.click(loadButton())
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('lists the loaded genes with the total count and a refresh button', () => {
    render(
      <CellExpressionProfilePanel
        state={readyState({ sourceLabel: 'cell_feature_matrix.h5' })}
        onLoad={vi.fn()}
      />,
    )

    expect(screen.getByText('1,200 counts')).toBeInTheDocument()
    expect(loadButton()).toHaveTextContent('Refresh Cell GEX')
    expect(screen.getByText('cell_feature_matrix.h5')).toBeInTheDocument()
    expect(screen.getByText('Top genes in selected cell')).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Top selected cell genes' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Cell gene filter')).toHaveAttribute(
      'placeholder',
      'Search cell genes',
    )
    expect(screen.getByText('Gad1')).toBeInTheDocument()
    expect(screen.getByText('Actb')).toBeInTheDocument()
  })

  it('leaves out the source caption when there is none', () => {
    const { container } = render(
      <CellExpressionProfilePanel state={readyState()} onLoad={vi.fn()} />,
    )

    const captions = [...container.querySelectorAll('.cell-z-caption')]
    expect(captions.map((caption) => caption.textContent)).toEqual([
      'Top genes in selected cell',
    ])
  })

  it('notes the gene limit with cell wording', () => {
    render(
      <CellExpressionProfilePanel
        state={readyState({ expression: { ...EXPRESSION, hitGeneLimit: true } })}
        onLoad={vi.fn()}
      />,
    )

    expect(screen.getByText('Showing first 100,000 cell genes')).toBeInTheDocument()
  })

  it('uses bin wording for a Visium HD bin', () => {
    const { rerender } = render(
      <CellExpressionProfilePanel
        state={{ status: 'idle' }}
        onLoad={vi.fn()}
        selectionKind="bin"
      />,
    )

    expect(screen.getByText('Bin GEX profile')).toBeInTheDocument()
    expect(screen.getByText('No bin GEX loaded')).toBeInTheDocument()
    expect(loadButton()).toHaveTextContent('Load Bin GEX')

    rerender(
      <CellExpressionProfilePanel
        state={readyState({ expression: { ...EXPRESSION, hitGeneLimit: true } })}
        onLoad={vi.fn()}
        selectionKind="bin"
      />,
    )
    expect(loadButton()).toHaveTextContent('Refresh Bin GEX')
    expect(
      screen.getByRole('list', { name: 'Top selected bin genes' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Bin gene filter')).toBeInTheDocument()
    expect(screen.getByText('Showing first 100,000 bin genes')).toBeInTheDocument()
  })

  it('keeps the button disabled when loading is not possible', () => {
    const onLoad = vi.fn()
    render(
      <CellExpressionProfilePanel state={{ status: 'idle' }} onLoad={onLoad} disabled />,
    )

    expect(loadButton()).toBeDisabled()
    fireEvent.click(loadButton())
    expect(onLoad).not.toHaveBeenCalled()
  })
})
