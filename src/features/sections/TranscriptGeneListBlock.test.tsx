import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testTranscriptsSectionModel } from '../../test/sectionModels'
import { TranscriptGeneList } from './TranscriptGeneListBlock'

function model(
  overrides: Partial<ReturnType<typeof testTranscriptsSectionModel>['geneLegend']> = {},
) {
  return { ...testTranscriptsSectionModel().geneLegend, ...overrides }
}

describe('TranscriptGeneList', () => {
  it('shows each gene with a swatch, an eye and its count', () => {
    const geneLegend = model({
      active: true,
      items: [
        { gene: 'SNAP25', color: '#4cd3c2', visible: true, count: 1_204 },
        { gene: 'GFAP', color: '#f8c550', visible: false, count: 3 },
      ],
      moreCount: 2,
      hiddenCount: 1,
    })
    render(<TranscriptGeneList geneLegend={geneLegend} />)

    expect(
      screen.getByRole('list', { name: 'Transcript gene colours' }),
    ).toHaveTextContent('SNAP251,204')
    expect(screen.getByText('+2 more genes in view')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('SNAP25 transcript color'), {
      target: { value: '#00ff00' },
    })
    fireEvent.click(screen.getByLabelText('GFAP transcripts visible'))
    fireEvent.click(screen.getByRole('button', { name: 'Show All' }))

    expect(geneLegend.onColorChange).toHaveBeenCalledWith('SNAP25', '#00ff00')
    expect(geneLegend.onVisibilityChange).toHaveBeenCalledWith('GFAP', true)
    expect(geneLegend.onShowAll).toHaveBeenCalledTimes(1)
  })

  it('shows the note when the list does not apply', () => {
    const { container, rerender } = render(
      <TranscriptGeneList geneLegend={model({ note: 'Gene colours show when …' })} />,
    )
    expect(screen.getByText('Gene colours show when …')).toBeInTheDocument()

    rerender(<TranscriptGeneList geneLegend={model()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
