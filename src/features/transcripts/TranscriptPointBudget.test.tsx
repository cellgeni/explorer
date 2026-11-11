import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TranscriptPointBudget } from './TranscriptPointBudget'

describe('TranscriptPointBudget', () => {
  it('shows this view against the budget', () => {
    render(
      <TranscriptPointBudget estimate={28_724} limit={100_000} onLimitChange={vi.fn()} />,
    )

    const meter = screen.getByRole('meter', { name: 'Exact points' })
    expect(meter).toHaveAttribute('aria-valuenow', '28724')
    expect(meter).toHaveAttribute('aria-valuemax', '100000')
    expect(meter).toHaveAttribute('aria-valuetext', '28,724 of 100,000 points')
    expect(meter).not.toHaveClass('is-over')
    expect(screen.getByText('28,724 of 100,000 points')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('fills and marks the meter when the view has more than the budget', () => {
    render(
      <TranscriptPointBudget
        estimate={5_000_000}
        limit={100_000}
        onLimitChange={vi.fn()}
      />,
    )

    const meter = screen.getByRole('meter', { name: 'Exact points' })
    expect(meter).toHaveAttribute('aria-valuenow', '100000')
    expect(meter).toHaveClass('is-over')
    expect(meter.querySelector('span')).toHaveStyle({ width: '100.0%' })
  })

  it('edits the budget from Edit Max', () => {
    const onLimitChange = vi.fn()
    render(
      <TranscriptPointBudget
        estimate={10}
        limit={100_000}
        onLimitChange={onLimitChange}
      />,
    )

    const edit = screen.getByRole('button', { name: 'Edit Max' })
    fireEvent.click(edit)
    expect(edit).toHaveAttribute('aria-expanded', 'true')

    const field = screen.getByRole('spinbutton', { name: 'Exact budget' })
    expect(field).toHaveValue(100_000)
    fireEvent.change(field, { target: { value: '50000' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onLimitChange).toHaveBeenCalledWith(50_000)
  })
})
