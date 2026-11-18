import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CellId } from '../../data/cellid'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import type { CellQueryCondition } from './cellQuery'
import { createCellQuerySession } from './cellQuerySession'
import { CellQueryPanel } from './CellQueryPanel'
import { useCellQueryModel, type CellQueryModelInput } from './useCellQueryModel'

const DATASET = 'https://example.test/sample.h5ad'

function cell(id: string, transcriptCount: number, cellArea: number): OverviewCellDatum {
  return {
    id,
    position: [0, 0, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
    transcriptCount,
    cellArea,
  }
}

const CELLS = [
  cell('c1', 10, 30),
  cell('c2', 25, 12),
  cell('c3', 40, 50),
  cell('c4', 5, 8),
]

function ids(...values: string[]): readonly CellId[] {
  return values as unknown as readonly CellId[]
}

const LEIDEN: readonly Annotation<string>[] = [
  { id: 'analysis:leiden:0', label: 'leiden: T cells', cellIds: ids('c1', 'c2') },
  { id: 'analysis:leiden:1', label: 'leiden: B cells', cellIds: ids('c3', 'c4', 'gone') },
]

const TRACK: ContinuousCellMetadataTrack = {
  id: 'h5ad:score',
  label: 'score',
  values: null,
  cellCount: 4,
  min: 0,
  max: 1,
}

function Harness({
  initial = [],
  overrides = {},
}: {
  readonly initial?: readonly CellQueryCondition[]
  readonly overrides?: Partial<CellQueryModelInput>
}) {
  const [conditions, setConditions] = useState(initial)
  const query = useCellQueryModel({
    open: true,
    available: true,
    datasetUrl: DATASET,
    datasetReady: true,
    cells: CELLS,
    elementNoun: 'cells',
    annotations: LEIDEN,
    datasetSets: [{ groupId: 'kmeans', label: 'kmeans', classCount: 2 }],
    annotationGroups: [{ id: 'kmeans', label: 'kmeans' }],
    loadSetAnnotations: async () => [
      { id: 'analysis:kmeans:a', label: 'kmeans: A', cellIds: ids('c4') },
      { id: 'analysis:kmeans:b', label: 'kmeans: B', cellIds: ids('c1', 'c2', 'c3') },
    ],
    savedSelections: [],
    loadSelectionCells: async () => [],
    metadataTracks: [TRACK],
    loadMetadataTrackValues: async () => [
      { cellId: 'c1' as CellId, value: 0.9 },
      { cellId: 'c3' as CellId, value: 0.2 },
    ],
    conditions,
    onConditionsChange: setConditions,
    selectedCellId: null,
    onSelectCell: () => undefined,
    onSaveClass: () => undefined,
    appendDebugEvent: () => undefined,
    createSession: () => createCellQuerySession(null),
    ...overrides,
  })

  return (
    <div>
      <p data-testid="status">{query.status}</p>
      <CellQueryPanel query={query} />
    </div>
  )
}

function rowTexts(): readonly string[] {
  return within(screen.getByRole('table', { name: 'Matching cells' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? '')
        .join(' | '),
    )
}

function addCondition(columnId: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Add condition' }), {
    target: { value: columnId },
  })
}

describe('Cell Query panel (plan 23-B to 23-E)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists every cell until a condition is added, then the cells in the chosen classes', async () => {
    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('4 cells, no conditions')
    })
    expect(rowTexts()).toEqual(['c1', 'c2', 'c3', 'c4'])

    addCondition('set:analysis:leiden')
    expect(
      screen.getByText('Conditions with no class chosen are left out until one is.'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: /B cells/ }))

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
    })
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c3 | B cells', 'c4 | B cells'])
    })
  })

  it('reads a dataset set and a metadata track the first time a condition uses them', async () => {
    const loadSetAnnotations = vi.fn(async () => [
      { id: 'analysis:kmeans:a', label: 'kmeans: A', cellIds: ids('c4') },
      { id: 'analysis:kmeans:b', label: 'kmeans: B', cellIds: ids('c1', 'c2', 'c3') },
    ])
    render(<Harness overrides={{ loadSetAnnotations }} />)

    addCondition('set:dataset-set:kmeans')
    fireEvent.click(await screen.findByRole('checkbox', { name: /^B/ }))
    addCondition('track:h5ad:score')

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
    })
    expect(loadSetAnnotations).toHaveBeenCalledWith(
      DATASET,
      expect.objectContaining({ groupId: 'kmeans' }),
    )
    // c2 has no score, so the whole range leaves it out.
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c1 | B | 0.9', 'c3 | B | 0.2'])
    })
  })

  it('narrows numbers by the bounds the operator uses', async () => {
    render(
      <Harness
        initial={[
          {
            kind: 'number',
            columnId: 'cell:transcripts',
            operator: 'at-least',
            min: 20,
            max: Infinity,
          },
        ]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
    })
    expect(screen.queryByRole('spinbutton', { name: 'To' })).toBeNull()

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Transcript count: comparison' }),
      {
        target: { value: 'between' },
      },
    )
    const to = screen.getByRole('spinbutton', { name: 'To' })
    fireEvent.change(to, { target: { value: '30' } })
    fireEvent.blur(to)

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('1 of 4 cells match')
    })
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c2 | 25'])
    })
  })

  it('sorts by a column, adds and removes columns, and selects a row', async () => {
    const onSelectCell = vi.fn()
    render(<Harness overrides={{ onSelectCell }} />)
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(4)
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Add column' }), {
      target: { value: 'cell:area' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Cell area/ }))
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c4 | 8', 'c2 | 12', 'c1 | 30', 'c3 | 50'])
    })
    expect(screen.getByRole('columnheader', { name: /Cell area/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )

    fireEvent.click(screen.getByRole('button', { name: 'c1' }))
    expect(onSelectCell).toHaveBeenCalledWith('c1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove the Cell area column' }))
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c1', 'c2', 'c3', 'c4'])
    })
  })

  it('moves between rows with the arrow keys', async () => {
    render(<Harness />)
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(4)
    })

    const first = screen.getByRole('button', { name: 'c1' })
    expect(first).toHaveAttribute('tabindex', '0')
    act(() => {
      first.focus()
    })
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'c2' })).toHaveFocus()
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'c2' }), { key: 'End' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'c4' })).toHaveFocus()
    })
  })

  it('saves the matches as a class and exports the table as CSV', async () => {
    const onSaveClass = vi.fn()
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:cell-query'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(
      <Harness
        overrides={{ onSaveClass }}
        initial={[
          {
            kind: 'category',
            columnId: 'set:analysis:leiden',
            operator: 'not-in',
            classIds: ['analysis:leiden:0'],
          },
        ]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
    })
    const save = screen.getByRole('button', { name: 'Save As Class' })
    await waitFor(() => {
      expect(save).toBeEnabled()
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Class name' }), {
      target: { value: 'Not T cells' },
    })
    fireEvent.click(save)
    expect(onSaveClass).toHaveBeenCalledWith('Not T cells', ['c3', 'c4'])

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => {
      expect(blobs).toHaveLength(1)
    })
    expect(await blobs[0]?.text()).toBe('cell_id,leiden\nc3,B cells\nc4,B cells')
  })

  it('says when a condition names a column the dataset does not list', async () => {
    render(
      <Harness
        initial={[
          {
            kind: 'number',
            columnId: 'track:gone',
            operator: 'at-least',
            min: 1,
            max: Infinity,
          },
        ]}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The dataset no longer lists this column.',
    )
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('4 cells, no conditions')
    })
  })
})
