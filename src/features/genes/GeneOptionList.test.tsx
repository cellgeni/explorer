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
    fireEvent.click(lastGene, { detail: 1 })

    // A mouse click, not Enter or Space.
    expect(onToggleGene).toHaveBeenCalledWith('Gene199', false)
  })

  it('keeps the rows under the scroll position when a picked gene leaves the list', () => {
    const genes = Array.from(
      { length: 200 },
      (_value, index) => `Gene${String(index).padStart(3, '0')}`,
    )
    const { rerender } = render(
      <GeneOptionList genes={genes} selectedGenes={[]} onToggleGene={vi.fn()} />,
    )
    const list = screen.getByRole('list', { name: 'Gene options' })

    fireEvent.scroll(list, { target: { scrollTop: 150 * 28 } })
    expect(within(list).getByRole('button', { name: 'Gene150' })).toBeInTheDocument()

    // Picking Gene150 takes it out of the list; the list stays scrolled.
    rerender(
      <GeneOptionList
        genes={genes.filter((gene) => gene !== 'Gene150')}
        selectedGenes={['Gene150']}
        onToggleGene={vi.fn()}
      />,
    )

    expect(within(list).getByRole('button', { name: 'Gene151' })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Gene000' })).toBeNull()
  })

  it('starts a new search at the top', () => {
    const genes = Array.from(
      { length: 200 },
      (_value, index) => `Gene${String(index).padStart(3, '0')}`,
    )
    const { rerender } = render(
      <GeneOptionList
        genes={genes}
        selectedGenes={[]}
        scrollResetKey=""
        onToggleGene={vi.fn()}
      />,
    )
    const list = screen.getByRole('list', { name: 'Gene options' })

    fireEvent.scroll(list, { target: { scrollTop: 150 * 28 } })
    rerender(
      <GeneOptionList
        genes={genes.slice(100)}
        selectedGenes={[]}
        scrollResetKey="gene1"
        onToggleGene={vi.fn()}
      />,
    )

    expect(list.scrollTop).toBe(0)
    expect(within(list).getByRole('button', { name: 'Gene100' })).toBeInTheDocument()
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
