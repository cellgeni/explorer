import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { SavedSelection } from '../roi/selectionListModel'
import { testAnnotationsSectionModel } from '../../test/sectionModels'
import type { SelectionListModel } from './annotationsSectionModel'
import { SelectionListPanel } from './SelectionListBlock'

const SELECTIONS: readonly SavedSelection[] = [
  {
    id: 'selection-1',
    name: 'Cortex',
    color: '#f0c84b',
    visible: true,
    selection: {
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(100),
        maxY: micrometers(50),
      },
    },
  },
  {
    id: 'selection-2',
    name: 'ROI 2',
    color: '#4bd6f0',
    visible: false,
    selection: {
      kind: 'lasso',
      bbox: {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(10),
        maxY: micrometers(10),
      },
      points: [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(10) },
      ],
    },
  },
]

function renderPanel(overrides: Partial<SelectionListModel> = {}) {
  const { selections } = testAnnotationsSectionModel({
    selections: { selections: SELECTIONS, activeId: 'selection-1', ...overrides },
  })
  render(<SelectionListPanel selections={selections} />)
  return selections
}

describe('SelectionListPanel', () => {
  it('lists each selection with its area, and marks the one in the card', () => {
    renderPanel()

    const list = screen.getByRole('list', { name: 'Selections' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveClass('is-active')
    expect(rows[0]).toHaveTextContent('5,000 µm²')
    expect(rows[1]).toHaveClass('is-hidden')
    expect(rows[1]).toHaveTextContent('50 µm²')
    expect(within(list).getByRole('button', { name: 'Cortex' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('2 saved')).toBeInTheDocument()
  })

  it('shows, recolours, hides, goes to and deletes a selection', () => {
    const model = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'ROI 2' }))
    fireEvent.change(screen.getByLabelText('ROI 2 color'), {
      target: { value: '#00ff00' },
    })
    fireEvent.click(screen.getByLabelText('Cortex visible'))
    fireEvent.click(screen.getByRole('button', { name: 'Go to ROI 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cortex' }))

    expect(model.onActivate).toHaveBeenCalledWith('selection-2')
    expect(model.onColorChange).toHaveBeenCalledWith('selection-2', '#00ff00')
    expect(model.onVisibilityChange).toHaveBeenCalledWith('selection-1', false)
    expect(model.onGoTo).toHaveBeenCalledWith('selection-2')
    expect(model.onDelete).toHaveBeenCalledWith('selection-1')
  })

  it('renames with Enter, and Esc keeps the old name', () => {
    const model = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Cortex' }))
    const field = screen.getByRole('textbox', { name: 'Rename Cortex' })
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: ' Medulla ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(model.onRename).toHaveBeenCalledWith('selection-1', 'Medulla')
    expect(screen.queryByRole('textbox', { name: 'Rename Cortex' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rename ROI 2' }))
    const second = screen.getByRole('textbox', { name: 'Rename ROI 2' })
    fireEvent.change(second, { target: { value: 'Lost' } })
    fireEvent.keyDown(second, { key: 'Escape' })
    fireEvent.blur(second)
    expect(model.onRename).toHaveBeenCalledTimes(1)
  })

  it('cannot show a selection while the queries cannot run', () => {
    renderPanel({ canActivate: false })

    expect(screen.getByRole('button', { name: 'ROI 2' })).toBeDisabled()
  })

  it('says how to add one, and is absent on an image', () => {
    const { rerender } = render(
      <SelectionListPanel
        selections={
          testAnnotationsSectionModel({ selections: { selections: [] } }).selections
        }
      />,
    )
    expect(
      screen.getByText(/Draw with Box selection or Lasso selection/),
    ).toBeInTheDocument()

    rerender(
      <SelectionListPanel
        selections={
          testAnnotationsSectionModel({ selections: { available: false } }).selections
        }
      />,
    )
    expect(screen.queryByRole('heading', { name: 'Selections' })).toBeNull()
  })
})
