import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { testAnnotationsSectionModel } from '../../test/sectionModels'
import type { AnnotationSetsModel } from './annotationsSectionModel'
import {
  AnnotationLabelLists,
  AnnotationSetControls,
  MetadataTracksPanel,
} from './AnnotationsSectionBlocks'
import type { Annotation } from '../../data/annotation'

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

describe('AnnotationSetControls', () => {
  it('shows a failed import as an alert beside the controls, keeping the labels', () => {
    const { sets } = testAnnotationsSectionModel({
      sets: {
        state: { status: 'ready', url: 'https://example.test', annotations: ANNOTATIONS },
        importError: 'Unexpected load error: Annotation URL returned HTTP 404.',
      },
    })
    render(<AnnotationSetControls sets={sets} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Annotation URL returned HTTP 404.',
    )
    expect(screen.getByRole('button', { name: 'Export Annotations' })).toBeEnabled()
  })
})

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

  it('searches the classes, and checks or unchecks only the matches', () => {
    const sets = renderLists({ hiddenIds: [IDS[2] ?? ''] })
    const set = screen.getByRole('region', { name: 'fine_celltype labels' })

    fireEvent.change(screen.getByLabelText('Search fine_celltype classes'), {
      target: { value: 'class 2' },
    })
    // Class 2 and Class 20 to 29.
    expect(within(set).getAllByRole('listitem')).toHaveLength(11)
    expect(screen.getByRole('status')).toHaveTextContent('11 of 30')

    const all = screen.getByLabelText<HTMLInputElement>('All fine_celltype classes')
    expect(all.indeterminate).toBe(true)
    fireEvent.click(all)
    expect(sets.onManyVisibilityChange).toHaveBeenCalledWith(
      [2, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29].map((index) => IDS[index]),
      true,
    )
  })

  it('says when no class matches, and clears the search with Escape', () => {
    renderLists()
    const search = screen.getByLabelText('Search fine_celltype classes')
    const set = screen.getByRole('region', { name: 'fine_celltype labels' })

    fireEvent.change(search, { target: { value: 'microglia' } })
    expect(screen.getByRole('status')).toHaveTextContent('No classes match')
    expect(within(set).queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByLabelText('All fine_celltype classes')).toBeDisabled()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(within(set).getAllByRole('listitem')).toHaveLength(30)
  })

  it('leaves the search out of short sets', () => {
    const { sets } = testAnnotationsSectionModel({
      sets: {
        state: {
          status: 'ready',
          url: 'https://example.test',
          annotations: ANNOTATIONS.slice(0, 8),
        },
      },
    })
    render(<AnnotationLabelLists sets={sets} />)

    expect(screen.queryByLabelText('Search fine_celltype classes')).toBeNull()
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

  it('counts in the dataset’s own noun', () => {
    renderLists({ elementNoun: 'spots' })
    const set = screen.getByRole('region', { name: 'fine_celltype labels' })

    // 30 + 29 + ... + 1 assignments.
    expect(within(set).getByText('465 spots')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fine_celltype visible' })).toHaveAttribute(
      'title',
      'Hide fine_celltype: draw the spots without its colours, keeping the classes checked below',
    )
  })
})

describe('MetadataTracksPanel', () => {
  it('lists every track, past the old 9-row window', () => {
    const tracks = Array.from({ length: 40 }, (_, index) => ({
      id: `h5ad:track-${index}`,
      label: `Track ${index}`,
      values: null,
      cellCount: 100,
      min: 0,
      max: index,
    }))
    const { metadataTracks } = testAnnotationsSectionModel({ metadataTracks: { tracks } })
    render(<MetadataTracksPanel metadataTracks={metadataTracks} />)
    const list = screen.getByRole('list', { name: 'Loaded metadata tracks' })

    expect(within(list).getAllByRole('listitem')).toHaveLength(40)
    expect(within(list).getByText('Track 39')).toBeInTheDocument()
    // No inline sizing: the list is as tall as its rows.
    expect(list).not.toHaveAttribute('style')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Track 39' }))
    expect(metadataTracks.onRemove).toHaveBeenCalledWith('h5ad:track-39')
  })
  it('counts in the dataset’s own noun', () => {
    const { metadataTracks } = testAnnotationsSectionModel({
      metadataTracks: {
        elementNoun: 'spots',
        tracks: [
          { id: 'h5ad:a', label: 'A', values: null, cellCount: 370, min: 0, max: 2 },
          { id: 'h5ad:b', label: 'B', values: null, cellCount: 1, min: 1, max: 1 },
        ],
      },
    })
    render(<MetadataTracksPanel metadataTracks={metadataTracks} />)

    expect(screen.getByText('370 spots | 0-2')).toBeInTheDocument()
    expect(screen.getByText('1 spot | 1-1')).toBeInTheDocument()
  })
})
