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

  it('lists the first 12 categories with visibility toggles', () => {
    const onChange = vi.fn()
    render(<ViewerLegend sections={[categories]} onCategoryVisibilityChange={onChange} />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(12)
    expect(screen.getByText('+2 more in the Annotations tab')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Cluster 2, 2,000 cells' }),
    ).not.toBeChecked()
    expect(screen.getByText('1,000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 2, 2,000 cells' }))
    expect(onChange).toHaveBeenCalledWith('cluster-2', true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 1, 1,000 cells' }))
    expect(onChange).toHaveBeenCalledWith('cluster-1', false)
  })

  it('collapses to its header', () => {
    render(<ViewerLegend sections={[categories]} />)

    const toggle = screen.getByRole('button', { name: 'Legend' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
