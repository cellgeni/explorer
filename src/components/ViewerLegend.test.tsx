import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerLegend } from './ViewerLegend'
import type { LegendPlacement } from './viewerLegendPlacement'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// The legend, 260 × 300 px, in a 1000 × 800 px view at (100, 50) on the
// page; at first in the stack, 12 px in from the view's bottom left.
function stubLegendLayout() {
  const view = document.createElement('div')
  const box = { left: 12, top: 488, width: 260, height: 300 }
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('viewer-legend') ? view : null
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === view) {
      return { left: 100, top: 50, width: 1000, height: 800 } as DOMRect
    }
    if (this.classList.contains('viewer-legend')) {
      return { ...box, left: 100 + box.left, top: 50 + box.top } as DOMRect
    }
    return { left: 0, top: 0, width: 0, height: 0 } as DOMRect
  })
  // Calls back as it starts to observe, as a ResizeObserver does.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback()
      }
      unobserve() {}
      disconnect() {}
    },
  )
  // Where the legend is drawn, in the view.
  return box
}

function MovableLegend({
  initial = null,
  onPlacementChange,
}: {
  readonly initial?: LegendPlacement | null
  readonly onPlacementChange?: (placement: LegendPlacement | null) => void
}) {
  const [placement, setPlacement] = useState(initial)
  return (
    <ViewerLegend
      sections={[categories]}
      placement={placement}
      onPlacementChange={(next) => {
        onPlacementChange?.(next)
        setPlacement(next)
      }}
    />
  )
}

describe('ViewerLegend moved', () => {
  it('follows its header and stays by the corner it is dropped nearer', () => {
    stubLegendLayout()
    const onPlacementChange = vi.fn()
    render(<MovableLegend onPlacementChange={onPlacementChange} />)
    const legend = screen.getByRole('region', { name: 'Legend' })
    const toggle = screen.getByRole('button', { name: 'Legend' })
    const grip = screen.getByRole('button', { name: 'Move the legend' })
    expect(grip).toHaveAccessibleDescription('At the bottom left')

    fireEvent.pointerDown(toggle, { clientX: 150, clientY: 550, pointerId: 1 })
    // A quick drag's first move can be off the header already.
    fireEvent.pointerMove(document.body, { clientX: 750, clientY: 150, pointerId: 1 })
    expect(legend).toHaveClass('is-moved', 'is-dragging')
    expect(legend.style.left).toBe('612px')
    expect(legend.style.top).toBe('88px')

    fireEvent.pointerUp(toggle, { clientX: 750, clientY: 150, pointerId: 1 })
    // The click that ends the drag leaves the legend open.
    fireEvent.click(toggle, { detail: 1 })
    expect(onPlacementChange).toHaveBeenCalledExactlyOnceWith({
      fromRight: true,
      fromBottom: false,
      x: 128,
      y: 88,
    })
    expect(legend).toHaveClass('is-moved')
    expect(legend).not.toHaveClass('is-dragging')
    expect(legend.style.right).toBe('128px')
    expect(legend.style.top).toBe('88px')
    expect(grip).toHaveAccessibleDescription('88 px from the top, 128 px from the right')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // A click without a drag still closes it.
    fireEvent.pointerDown(toggle, { clientX: 150, clientY: 550, pointerId: 2 })
    fireEvent.pointerMove(toggle, { clientX: 151, clientY: 551, pointerId: 2 })
    fireEvent.pointerUp(toggle, { clientX: 151, clientY: 551, pointerId: 2 })
    fireEvent.click(toggle, { detail: 1 })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(onPlacementChange).toHaveBeenCalledTimes(1)
  })

  it('goes back in the stack when dropped in the bottom-left corner', () => {
    const box = stubLegendLayout()
    const onPlacementChange = vi.fn()
    box.left = 300
    box.top = 200
    render(
      <MovableLegend
        initial={{ fromRight: false, fromBottom: false, x: 300, y: 200 }}
        onPlacementChange={onPlacementChange}
      />,
    )
    const legend = screen.getByRole('region', { name: 'Legend' })
    const toggle = screen.getByRole('button', { name: 'Legend' })

    fireEvent.pointerDown(toggle, { clientX: 450, clientY: 260, pointerId: 1 })
    fireEvent.pointerMove(toggle, { clientX: 170, clientY: 560, pointerId: 1 })
    fireEvent.pointerUp(toggle, { clientX: 170, clientY: 560, pointerId: 1 })

    expect(onPlacementChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(legend).not.toHaveClass('is-moved')
    expect(legend.style.cssText).toBe('')
  })

  it('moves by arrow keys on its grip, and back on Home or a double-click', () => {
    stubLegendLayout()
    render(<MovableLegend />)
    const legend = screen.getByRole('region', { name: 'Legend' })
    const grip = screen.getByRole('button', { name: 'Move the legend' })

    expect(fireEvent.keyDown(grip, { key: 'ArrowUp' })).toBe(false)
    expect(legend.style.left).toBe('12px')
    expect(legend.style.bottom).toBe('32px')
    expect(grip).toHaveAccessibleDescription('32 px from the bottom, 12 px from the left')

    fireEvent.keyDown(grip, { key: 'Home' })
    expect(legend).not.toHaveClass('is-moved')
    expect(grip).toHaveAccessibleDescription('At the bottom left')

    fireEvent.keyDown(grip, { key: 'ArrowRight' })
    expect(legend.style.left).toBe('32px')
    fireEvent.doubleClick(grip)
    expect(legend).not.toHaveClass('is-moved')
  })

  it('stays inside a view too short for where it was left', () => {
    stubLegendLayout()
    render(
      <MovableLegend initial={{ fromRight: false, fromBottom: false, x: 40, y: 700 }} />,
    )
    const legend = screen.getByRole('region', { name: 'Legend' })

    // 800 px less its 300 px and the 12 px inset.
    expect(legend.style.top).toBe('488px')
    expect(
      screen.getByRole('button', { name: 'Move the legend' }),
    ).toHaveAccessibleDescription('488 px from the top, 40 px from the left')
  })

  it('stays put without a place to keep, as on narrow screens', () => {
    stubLegendLayout()
    render(<ViewerLegend sections={[categories]} />)
    const legend = screen.getByRole('region', { name: 'Legend' })
    const toggle = screen.getByRole('button', { name: 'Legend' })

    expect(screen.queryByRole('button', { name: 'Move the legend' })).toBeNull()
    fireEvent.pointerDown(toggle, { clientX: 150, clientY: 550, pointerId: 1 })
    fireEvent.pointerMove(toggle, { clientX: 750, clientY: 150, pointerId: 1 })
    expect(legend).not.toHaveClass('is-moved')
  })
})
