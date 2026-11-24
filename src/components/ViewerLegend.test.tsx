import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewerLegend } from './ViewerLegend'
import type { ViewerLegendSection } from './viewerLegendTypes'

const categories: ViewerLegendSection = {
  kind: 'categories',
  id: 'cells',
  title: 'graphclust',
  items: Array.from({ length: 14 }, (_value, index) => ({
    id: `cluster-${index + 1}`,
    label: `Cluster ${index + 1}`,
    color: '#4cc39a',
    count: 1000 * (index + 1),
    visible: index !== 1,
  })),
}

describe('ViewerLegend', () => {
  it('draws nothing without sections', () => {
    const { container } = render(<ViewerLegend sections={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a continuous scale with its range', () => {
    render(
      <ViewerLegend
        sections={[
          {
            kind: 'continuous',
            id: 'cells',
            title: 'SNAP25',
            detail: 'Expression per cell',
            gradient: 'linear-gradient(90deg, red, blue)',
            min: '0',
            max: '11',
          },
        ]}
      />,
    )

    expect(screen.getByRole('img', { name: 'SNAP25: from 0 to 11' })).toBeInTheDocument()
    expect(screen.getByText('Expression per cell')).toBeInTheDocument()
  })

  it('links "+N more" to the full list when it can be opened', () => {
    const onShowMore = vi.fn()
    render(<ViewerLegend sections={[categories]} onShowMore={onShowMore} />)

    const more = screen.getByRole('button', { name: '+2 more in Cells › Clusters' })
    expect(more).toHaveAttribute('title', 'Show the other 2 in Cells › Clusters')
    fireEvent.click(more)
    expect(onShowMore).toHaveBeenCalledWith('cells')
  })

  it('lists the first 12 categories with visibility toggles', () => {
    const onChange = vi.fn()
    render(<ViewerLegend sections={[categories]} onCategoryVisibilityChange={onChange} />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(12)
    expect(screen.getByText('+2 more in Cells › Clusters')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Cluster 2, 2,000 cells' }),
    ).not.toBeChecked()
    expect(screen.getByText('1,000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 2, 2,000 cells' }))
    expect(onChange).toHaveBeenCalledWith('cluster-2', true, categories.id)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 1, 1,000 cells' }))
    expect(onChange).toHaveBeenCalledWith('cluster-1', false, categories.id)
  })

  // The label is cut at 260 px; its row carries the full name (EXP-307).
  it('names each class in full on its row', () => {
    const long = 'Intratelencephalic-projecting excitatory neuron of cortical layer 2/3'
    render(
      <ViewerLegend
        sections={[
          {
            ...categories,
            items: [{ id: 'a', label: long, color: '#1f77b4', count: 10, visible: true }],
          },
        ]}
        onCategoryVisibilityChange={vi.fn()}
      />,
    )

    expect(screen.getByText(long).closest('label')).toHaveAttribute('title', long)
  })

  it('shows only one class on an Alt-click, where the section allows it', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ViewerLegend
        sections={[{ ...categories, showOnly: true }]}
        onCategoryVisibilityChange={onChange}
      />,
    )
    const cluster1 = screen.getByRole('checkbox', { name: 'Cluster 1, 1,000 cells' })

    expect(cluster1).toHaveAttribute(
      'title',
      'Hide Cluster 1 (Alt- or Shift-click, or Enter: show only this)',
    )
    fireEvent.click(cluster1, { altKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cluster-1', true, 'cells', true)
    // The eye waits for the new state rather than toggling itself.
    expect(cluster1).toBeChecked()

    // Shift-click, where the desktop takes Alt-click, and Enter.
    onChange.mockClear()
    fireEvent.click(cluster1, { shiftKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cluster-1', true, 'cells', true)
    onChange.mockClear()
    expect(fireEvent.keyDown(cluster1, { key: 'Enter' })).toBe(false)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cluster-1', true, 'cells', true)

    onChange.mockClear()
    rerender(
      <ViewerLegend sections={[categories]} onCategoryVisibilityChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 1, 1,000 cells' }), {
      altKey: true,
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cluster-1', false, 'cells')
    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Cluster 1, 1,000 cells' }), {
      key: 'Enter',
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('counts transcripts and points to the Transcripts section for the rest', () => {
    render(
      <ViewerLegend
        sections={[
          {
            kind: 'categories',
            id: 'transcript-genes',
            title: 'Transcripts',
            items: [
              { id: 'GFAP', label: 'GFAP', color: '#f8c550', count: 1, visible: true },
            ],
            noun: { singular: 'transcript', plural: 'transcripts' },
            moreCount: 3,
            moreWhere: 'Transcripts',
          },
        ]}
      />,
    )

    expect(
      screen.getByRole('checkbox', { name: 'GFAP, 1 transcript' }),
    ).toBeInTheDocument()
    expect(screen.getByText('+3 more in Transcripts')).toBeInTheDocument()
  })

  it('collapses to its header', () => {
    render(<ViewerLegend sections={[categories]} />)

    const toggle = screen.getByRole('button', { name: 'Legend' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
