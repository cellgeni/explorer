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

    const list = screen.getByLabelText('Gene options')

    expect(within(list).getByRole('button', { name: 'Gene000' })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Gene199' })).toBeNull()

    fireEvent.scroll(list, { target: { scrollTop: 200 * 28 } })

    const lastGene = within(list).getByRole('button', { name: 'Gene199' })
    fireEvent.click(lastGene)

    expect(onToggleGene).toHaveBeenCalledWith('Gene199')
  })

  it('shows an empty state when no genes match', () => {
    render(<GeneOptionList genes={[]} selectedGenes={[]} onToggleGene={vi.fn()} />)

    expect(screen.getByText('No matching genes')).toBeInTheDocument()
  })
})
