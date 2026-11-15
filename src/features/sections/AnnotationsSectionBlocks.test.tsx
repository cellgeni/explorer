import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { Annotation } from '../../datasets/spatialDataset'
import { testAnnotationsSectionModel } from '../../test/sectionModels'
import type { AnnotationSetsModel } from './annotationsSectionModel'
import { AnnotationLabelLists } from './AnnotationsSectionBlocks'

// 30 classes of one set, the largest first.
const ANNOTATIONS: readonly Annotation[] = Array.from({ length: 30 }, (_, index) => ({
  id: `analysis:class-${index}`,
  label: `fine_celltype: Class ${index}`,
  cellIds: Array.from({ length: 30 - index }, (_, cell) =>
    asCellId(`aaaaaaaa-${index * 100 + cell}`),
  ),
}))
const IDS = ANNOTATIONS.map((annotation) => annotation.id)

function renderLists(overrides: Partial<AnnotationSetsModel> = {}) {
  const { sets } = testAnnotationsSectionModel({
    sets: {
      state: { status: 'ready', url: 'https://example.test', annotations: ANNOTATIONS },
      ...overrides,
    },
  })
  render(<AnnotationLabelLists sets={sets} />)
  return sets
}

describe('AnnotationLabelLists', () => {
  it('lists every class of a set', () => {
    renderLists()
    const set = screen.getByRole('region', { name: 'fine_celltype labels' })

    expect(within(set).getAllByRole('listitem')).toHaveLength(30)
    expect(within(set).getByLabelText('fine_celltype: Class 29 visible')).toBeChecked()
  })

  it('checks and unchecks all classes from the heading', () => {
    const sets = renderLists({ hiddenIds: [IDS[3] ?? ''] })
    const all = screen.getByLabelText<HTMLInputElement>('All fine_celltype classes')

    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(true)
    fireEvent.click(all)
    expect(sets.onManyVisibilityChange).toHaveBeenCalledWith(IDS, true)
  })

  it('unchecks every class when all are shown', () => {
    const sets = renderLists()
    const all = screen.getByLabelText<HTMLInputElement>('All fine_celltype classes')

    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)
    fireEvent.click(all)
    expect(sets.onManyVisibilityChange).toHaveBeenCalledWith(IDS, false)
  })

  it('shows none checked when every class is hidden', () => {
    renderLists({ hiddenIds: IDS })
    const all = screen.getByLabelText<HTMLInputElement>('All fine_celltype classes')

    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(false)
  })

  it('hides and shows the whole set with its eye, keeping the classes', () => {
    const sets = renderLists()
    const eye = screen.getByRole('button', { name: 'fine_celltype visible' })

    expect(eye).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(eye)
    expect(sets.onSetVisibilityChange).toHaveBeenCalledWith(
      'analysis:fine-celltype',
      false,
    )
    expect(sets.onManyVisibilityChange).not.toHaveBeenCalled()
  })
})
