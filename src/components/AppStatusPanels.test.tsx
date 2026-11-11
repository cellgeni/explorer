import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadingIndicator, type LoadingTaskSummary } from './AppStatusPanels'

const TASKS: readonly LoadingTaskSummary[] = [
  { id: 'dataset', label: 'Loading dataset', detail: 'output', cancellable: true },
  { id: 'gene-panel', label: 'Loading gene panel' },
  { id: 'boundaries', label: 'Loading boundaries' },
  { id: 'annotation-sets', label: 'Loading annotation sets' },
  { id: 'morphology', label: 'Loading image' },
  {
    id: 'transcript-overlay',
    label: 'Loading transcripts',
    cancellable: true,
    progress: 0.999,
  },
  { id: 'roi-genes', label: 'Querying ROI genes', cancellable: true },
]

describe('LoadingIndicator', () => {
  it('offers Cancel for cancellable tasks, named after the task (15.3-D)', () => {
    const onCancel = vi.fn()
    render(<LoadingIndicator tasks={TASKS} onCancel={onCancel} />)

    const list = screen.getByRole('status', { name: 'Active loading tasks' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Cancel loading dataset',
      'Cancel loading transcripts',
      'Cancel querying ROI genes',
    ])
    expect(
      screen.getByRole('button', { name: 'Cancel loading dataset' }),
    ).toHaveAttribute('title', 'Cancel loading dataset')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel querying ROI genes' }))
    expect(onCancel).toHaveBeenCalledWith('roi-genes')
  })

  it('keeps cancellable tasks out of "+n more"', () => {
    render(<LoadingIndicator tasks={TASKS} onCancel={vi.fn()} />)

    const more = screen.getByRole('list', { name: 'Additional loading tasks' })
    expect(within(more).getByText('Loading transcripts')).toBeInTheDocument()
    expect(within(more).getByText('Querying ROI genes')).toBeInTheDocument()
    expect(within(more).queryByText('Loading image')).not.toBeInTheDocument()
    expect(within(more).getByText('+1 more')).toBeInTheDocument()
  })

  it('shows a whole percentage where the task knows its progress', () => {
    render(<LoadingIndicator tasks={TASKS} onCancel={vi.fn()} />)

    expect(screen.getByText('99%')).toBeInTheDocument()
    expect(screen.queryAllByText(/%$/)).toHaveLength(1)
  })

  it('has no Cancel buttons without a handler, and hides tasks as before', () => {
    render(<LoadingIndicator tasks={TASKS} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('+3 more')).toBeInTheDocument()
  })
})
