import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import {
  EMPTY_SELECTION_LIST,
  SELECTION_PALETTE,
  activateSelection,
  addSelection,
  findSelectionByGeometry,
  recolorSelection,
  removeSelection,
  renameSelection,
  restoreSelection,
  selectionDatasetKey,
  selectionDisplayName,
  selectionListFor,
  selectionOutlines,
  setSelectionVisible,
  type SelectionListState,
} from './selectionListModel'

function box(minX: number, minY: number, maxX: number, maxY: number): RoiSelection {
  return {
    kind: 'box',
    bbox: {
      minX: micrometers(minX),
      minY: micrometers(minY),
      maxX: micrometers(maxX),
      maxY: micrometers(maxY),
    },
  }
}

const LASSO: RoiSelection = {
  kind: 'lasso',
  bbox: box(0, 0, 10, 10).bbox,
  points: [
    { x: micrometers(0), y: micrometers(0) },
    { x: micrometers(10), y: micrometers(0) },
    { x: micrometers(10), y: micrometers(10) },
  ],
}

function listWith(...selections: RoiSelection[]): SelectionListState {
  return selections.reduce(
    (state, selection) => addSelection(state, selection).state,
    selectionListFor(EMPTY_SELECTION_LIST, 'https://example.test/a'),
  )
}

describe('selectionListModel', () => {
  it('adds numbered selections in palette order and makes the new one active', () => {
    const state = listWith(box(0, 0, 1, 1), box(2, 2, 3, 3))

    expect(state.selections.map((selection) => selection.name)).toEqual([
      'ROI 1',
      'ROI 2',
    ])
    expect(state.selections.map((selection) => selection.id)).toEqual([
      'selection-1',
      'selection-2',
    ])
    expect(state.selections.map((selection) => selection.color)).toEqual([
      SELECTION_PALETTE[0],
      SELECTION_PALETTE[1],
    ])
    expect(state.selections.every((selection) => selection.visible)).toBe(true)
    expect(state.activeId).toBe('selection-2')
    expect(state.nextNumber).toBe(3)
  })

  it('takes a given name, such as a link’s Shared ROI', () => {
    const { added } = addSelection(listWith(), box(0, 0, 1, 1), 'Shared ROI')

    expect(added.name).toBe('Shared ROI')
    expect(added.id).toBe('selection-1')
  })

  it('starts empty for another dataset and keeps the list for its own', () => {
    const state = listWith(box(0, 0, 1, 1))

    expect(selectionListFor(state, 'https://example.test/a')).toBe(state)
    expect(selectionListFor(state, 'https://example.test/b')).toEqual({
      ...EMPTY_SELECTION_LIST,
      datasetKey: 'https://example.test/b',
    })
  })

  it('renames, recolours and hides one selection, and keeps unchanged states', () => {
    const state = listWith(box(0, 0, 1, 1), box(2, 2, 3, 3))
    const renamed = renameSelection(state, 'selection-1', 'Cortex')
    const recolored = recolorSelection(renamed, 'selection-2', '#123456')
    const hidden = setSelectionVisible(recolored, 'selection-1', false)

    expect(hidden.selections).toMatchObject([
      { name: 'Cortex', visible: false },
      { name: 'ROI 2', color: '#123456', visible: true },
    ])
    expect(renameSelection(hidden, 'selection-1', 'Cortex')).toBe(hidden)
    expect(setSelectionVisible(hidden, 'missing', true)).toBe(hidden)
  })

  it('shows a blank name as Selection', () => {
    expect(selectionDisplayName({ name: '  ' })).toBe('Selection')
    expect(selectionDisplayName({ name: ' Cortex ' })).toBe('Cortex')
  })

  it('activates only listed selections, or none', () => {
    const state = listWith(box(0, 0, 1, 1), box(2, 2, 3, 3))

    expect(activateSelection(state, 'selection-1').activeId).toBe('selection-1')
    expect(activateSelection(state, null).activeId).toBeNull()
    expect(activateSelection(state, 'missing')).toBe(state)
  })

  it('removes a selection and puts it back at its index', () => {
    const state = listWith(box(0, 0, 1, 1), box(2, 2, 3, 3), box(4, 4, 5, 5))
    const { state: removedState, removed } = removeSelection(state, 'selection-2')

    expect(removed).toMatchObject({ index: 1, wasActive: false })
    expect(removedState.selections.map((selection) => selection.id)).toEqual([
      'selection-1',
      'selection-3',
    ])
    expect(removedState.activeId).toBe('selection-3')

    if (removed === null) throw new Error('Expected a removed selection.')
    const restored = restoreSelection(removedState, removed)
    expect(restored.selections.map((selection) => selection.id)).toEqual([
      'selection-1',
      'selection-2',
      'selection-3',
    ])
    expect(restoreSelection(restored, removed)).toBe(restored)
  })

  it('clears the active id when the active selection is removed', () => {
    const state = listWith(box(0, 0, 1, 1))
    const { state: next, removed } = removeSelection(state, 'selection-1')

    expect(removed?.wasActive).toBe(true)
    expect(next.activeId).toBeNull()
    expect(removeSelection(next, 'selection-1').removed).toBeNull()
  })

  it('keeps selections drawn after a removal when it is undone', () => {
    const state = listWith(box(0, 0, 1, 1), box(2, 2, 3, 3))
    const { state: removedState, removed } = removeSelection(state, 'selection-2')
    if (removed === null) throw new Error('Expected a removed selection.')
    const drawn = addSelection(
      removeSelection(removedState, 'selection-1').state,
      box(6, 6, 7, 7),
    ).state

    expect(
      restoreSelection(drawn, removed).selections.map((selection) => selection.id),
    ).toEqual(['selection-3', 'selection-2'])
  })

  it('outlines visible selections and the active one even when hidden', () => {
    const state = setSelectionVisible(
      setSelectionVisible(
        listWith(box(0, 0, 1, 1), box(2, 2, 3, 3), box(4, 4, 5, 5)),
        'selection-1',
        false,
      ),
      'selection-3',
      false,
    )

    expect(
      selectionOutlines(state.selections, 'selection-3', true).map((outline) => [
        outline.id,
        outline.active,
      ]),
    ).toEqual([
      ['selection-2', false],
      ['selection-3', true],
    ])
    expect(
      selectionOutlines(state.selections, 'selection-3', false).map(
        (outline) => outline.id,
      ),
    ).toEqual(['selection-3'])
  })

  it('finds a saved selection by its outline', () => {
    const state = listWith(box(0, 0, 1, 1), LASSO)

    expect(findSelectionByGeometry(state.selections, box(0, 0, 1, 1))?.id).toBe(
      'selection-1',
    )
    expect(
      findSelectionByGeometry(state.selections, { ...LASSO, points: [...LASSO.points] })
        ?.id,
    ).toBe('selection-2')
    expect(findSelectionByGeometry(state.selections, box(0, 0, 1, 2))).toBeUndefined()
    expect(
      findSelectionByGeometry(state.selections, {
        ...LASSO,
        points: LASSO.points.slice(0, 2),
      }),
    ).toBeUndefined()
  })

  it('matches outlines within the link’s rounding', () => {
    const state = listWith(box(0.0004, 0, 1, 1))

    expect(findSelectionByGeometry(state.selections, box(0, 0, 1, 1))?.id).toBe(
      'selection-1',
    )
    expect(findSelectionByGeometry(state.selections, box(0.01, 0, 1, 1))).toBeUndefined()
  })

  it('keys selections by dataset and frame', () => {
    expect(selectionDatasetKey(null)).toBeNull()
    expect(selectionDatasetKey('https://example.test/a')).toBe('https://example.test/a')
    expect(
      selectionDatasetKey('https://example.test/a', {
        visiumLibrary: 'lib1',
        spatialDataFrame: 'global@1',
      }),
    ).toBe('https://example.test/a#library=lib1&frame=global@1')
  })
})
