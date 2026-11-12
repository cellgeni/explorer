import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeneOptionList } from './GeneOptionList'

describe('GeneOptionList', () => {
  it('virtualizes all gene options while allowing scroll-through selection', () => {
    const genes = Array.from(
      { length: 200 },
      (_value, index) => `Gene${String(index).padStart(3, '0')}`,
    )
    const onToggleGene = vi.fn()

    render(
      <GeneOptionList genes={genes} selectedGenes={[]} onToggleGene={onToggleGene} />,
    )

    const list = screen.getByRole('list', { name: 'Gene options' })

    expect(within(list).getByRole('button', { name: 'Gene000' })).toBeInTheDocument()
    // Each rendered row says where it is among all 200.
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute(
      'aria-setsize',
      '200',
    )
    expect(within(list).queryByRole('button', { name: 'Gene199' })).toBeNull()

    fireEvent.scroll(list, { target: { scrollTop: 200 * 28 } })

    const lastGene = within(list).getByRole('button', { name: 'Gene199' })
    fireEvent.click(lastGene)

    expect(onToggleGene).toHaveBeenCalledWith('Gene199')
  })

  it('names a gene alias in the option tooltip', () => {
    render(
      <GeneOptionList
        genes={['ACTB', 'MYH7']}
        selectedGenes={[]}
        aliases={new Map([['MYH7', 'ENSG00000092054']])}
        onToggleGene={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'MYH7' })).toHaveAttribute(
      'title',
      'MYH7 (ENSG00000092054)',
    )
    expect(screen.getByRole('button', { name: 'ACTB' })).toHaveAttribute('title', 'ACTB')
  })

  it('shows an empty state when no genes match', () => {
    render(<GeneOptionList genes={[]} selectedGenes={[]} onToggleGene={vi.fn()} />)

    expect(screen.getByText('No matching genes')).toBeInTheDocument()
  })
})
