import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CellId } from '../../data/cellid'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import { micrometers } from '../../data/coords'
import type { CellOutlineRequest, SpatialElement } from '../../datasets/spatialDataset'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { fakeCellImage, fakeOmeZarrCellImage } from '../../test/cellImageFixtures'
import type { CellImageLoader } from './cellImageMeasurer'
import type { CellQueryCondition } from './cellQuery'
import type { CellQueryImageChannel } from './cellQueryImage'
import { createCellQuerySession, type CellQuerySession } from './cellQuerySession'
import { CellQueryPanel } from './CellQueryPanel'
import {
  useCellQueryModel,
  type CellQueryModel,
  type CellQueryModelInput,
} from './useCellQueryModel'
import type { Annotation } from '../../data/annotation'

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

// Sessions whose runs wait while `held`, so a test can act before a result
// arrives.
function heldSessions() {
  const waiting: (() => void)[] = []
  const sessions = {
    held: false,
    waiting,
    release() {
      sessions.held = false
      for (const resume of waiting.splice(0)) resume()
    },
    create(): CellQuerySession {
      const session = createCellQuerySession(null)
      return {
        ...session,
        run: async (conditions, sort) => {
          if (sessions.held) {
            await new Promise<void>((resolve) => {
              waiting.push(resolve)
            })
          }
          return session.run(conditions, sort)
        },
      }
    },
  }
  return sessions
}

function Harness({
  initial = [],
  overrides = {},
  onQuery,
}: {
  readonly initial?: readonly CellQueryCondition[]
  readonly overrides?: Partial<CellQueryModelInput>
  // Sees each render's model, so a test can call its handlers directly.
  readonly onQuery?: (query: CellQueryModel) => void
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
    pictureImage: null,
    loadCellOutlines: async () => new Map(),
    imageChannels: [],
    imageZPlane: null,
    appendDebugEvent: () => undefined,
    createSession: () => createCellQuerySession(null),
    ...overrides,
  })
  onQuery?.(query)

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

  it('still matches when the sort column is not in the next dataset, and sorts again on return', async () => {
    const { rerender } = render(<Harness />)
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(4)
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Add column' }), {
      target: { value: 'cell:transcripts' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Transcript count/ }))
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c4 | 5', 'c1 | 10', 'c2 | 25', 'c3 | 40'])
    })

    // H5AD cells, whose transcript counts of 0 list no Transcript count column.
    const otherCells = [cell('d1', 0, 20), cell('d2', 0, 10), cell('d3', 0, 30)]
    rerender(
      <Harness
        overrides={{ datasetUrl: 'https://example.test/other.h5ad', cells: otherCells }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('3 cells, no conditions')
    })
    await waitFor(() => {
      expect(rowTexts()).toEqual(['d1 | ', 'd2 | ', 'd3 | '])
    })
    expect(
      screen.getByRole('columnheader', { name: /cell:transcripts/ }),
    ).toHaveAttribute('aria-sort', 'none')

    rerender(<Harness />)
    await waitFor(() => {
      expect(rowTexts()).toEqual(['c4 | 5', 'c1 | 10', 'c2 | 25', 'c3 | 40'])
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

  it('exports the matches of the query as it stands, not those of the edit before', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:cell-query'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const sessions = heldSessions()
    let latest: CellQueryModel | null = null
    render(
      <Harness
        overrides={{ createSession: sessions.create }}
        onQuery={(query) => {
          latest = query
        }}
        initial={[
          {
            kind: 'number',
            columnId: 'cell:transcripts',
            operator: 'at-least',
            min: 0,
            max: Infinity,
          },
        ]}
      />,
    )
    const exportCsv = screen.getByRole('button', { name: 'Export CSV' })
    await waitFor(() => {
      expect(exportCsv).toBeEnabled()
    })
    expect(rowTexts()).toHaveLength(4)

    // The edit's run waits, with the four rows before it still listed.
    sessions.held = true
    const from = screen.getByRole('spinbutton', { name: 'From' })
    fireEvent.change(from, { target: { value: '20' } })
    fireEvent.blur(from)
    await waitFor(() => {
      expect(sessions.waiting).not.toHaveLength(0)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('Matching')
    expect(rowTexts()).toHaveLength(4)
    expect(exportCsv).toBeDisabled()
    fireEvent.click(exportCsv)
    act(() => {
      latest?.onExportCsv()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(blobs).toHaveLength(0)

    sessions.release()
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
    })
    await waitFor(() => {
      expect(exportCsv).toBeEnabled()
    })
    fireEvent.click(exportCsv)
    await waitFor(() => {
      expect(blobs).toHaveLength(1)
    })
    expect(await blobs[0]?.text()).toBe('cell_id,Transcript count\nc2,25\nc3,40')
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

  describe('pictures (plan 23-G, 23-H)', () => {
    const IMAGE = { loader: null, channels: [], flatImage: null }
    const square = (id: string): SpatialElement => ({
      id,
      geometry: {
        kind: 'polygon',
        rings: [
          [
            { x: micrometers(-5), y: micrometers(-5) },
            { x: micrometers(5), y: micrometers(-5) },
            { x: micrometers(5), y: micrometers(5) },
          ],
        ],
      },
    })

    it('starts each row in view with a picture and the outlines read for those rows', async () => {
      const loadCellOutlines = vi.fn(
        async (_url: string, cells: readonly CellOutlineRequest[]) =>
          new Map(
            cells
              .filter((cell) => cell.id === 'c1')
              .map((cell) => [cell.id, square(cell.id)]),
          ),
      )
      render(<Harness overrides={{ pictureImage: IMAGE, loadCellOutlines }} />)

      // With an image, 40 µm is the default.
      const picture = await screen.findByRole('img', { name: 'c1, 40 µm across' })
      expect(screen.getByRole('combobox', { name: 'Picture' })).toHaveValue('40')
      expect(screen.getByRole('columnheader', { name: 'Picture' })).toBeVisible()
      await waitFor(() => {
        expect(picture.querySelector('.cell-query-outline path')).not.toBeNull()
      })
      // c2 has no outline: a dashed ring at its position.
      expect(
        screen
          .getByRole('img', { name: 'c2, 40 µm across' })
          .querySelector('.cell-query-outline.is-fallback'),
      ).not.toBeNull()
      // One read for the rows in view, each by its overview row.
      expect(loadCellOutlines).toHaveBeenCalledOnce()
      expect(loadCellOutlines.mock.calls[0]?.[0]).toBe(DATASET)
      expect(
        loadCellOutlines.mock.calls[0]?.[1].map((cell) => [cell.id, cell.overviewRow]),
      ).toEqual([
        ['c1', 0],
        ['c2', 1],
        ['c3', 2],
        ['c4', 3],
      ])

      fireEvent.change(screen.getByRole('combobox', { name: 'Picture' }), {
        target: { value: 'off' },
      })
      expect(screen.queryByRole('img', { name: /across/ })).toBeNull()
      expect(screen.queryByRole('columnheader', { name: 'Picture' })).toBeNull()
    })

    it('leaves pictures off without an image, and draws outlines alone when chosen', async () => {
      const loadCellOutlines = vi.fn(async () => new Map<string, SpatialElement>())
      render(<Harness overrides={{ loadCellOutlines }} />)

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('4 cells, no conditions')
      })
      expect(screen.getByRole('combobox', { name: 'Picture' })).toHaveValue('off')
      expect(loadCellOutlines).not.toHaveBeenCalled()

      fireEvent.change(screen.getByRole('combobox', { name: 'Picture' }), {
        target: { value: '20' },
      })
      const picture = await screen.findByRole('img', { name: 'c1, 20 µm across' })
      await waitFor(() => {
        expect(picture.querySelector('.cell-query-outline')).not.toBeNull()
      })
      expect(picture.querySelector('canvas')).toBeNull()
    })
  })

  describe('image channels (plan 26)', () => {
    // 8 x 8 µm, 1 µm per pixel: the left half 10, the right half 100.
    function imageChannel(
      overrides: Partial<CellQueryImageChannel> = {},
      loader: CellImageLoader = fakeCellImage({
        width: 8,
        height: 8,
        pixel: (x) => (x >= 4 ? 100 : 10),
      }).loader,
    ): CellQueryImageChannel {
      return {
        id: 'Channel:0',
        name: 'DAPI',
        loader: loader as unknown as ImagePyramidLoader,
        rgb: false,
        histogram: {
          bins: [4, 0, 0, 4],
          maxCount: 4,
          min: 0,
          max: 100,
          sampleCount: 8,
          threshold: 50,
        },
        ...overrides,
      }
    }

    // Two cells on each half, of area π (radius 1 µm), or without an area
    // as discs of the Radius field's.
    function imageCell(id: string, x: number, y: number, cellArea?: number) {
      return {
        id,
        position: [x, -y, 0],
        radiusPixels: 2,
        fillColor: [0, 0, 0, 255],
        ...(cellArea === undefined ? {} : { cellArea }),
      } satisfies OverviewCellDatum
    }
    const PLACES = [
      ['c1', 1, 1],
      ['c2', 6, 1],
      ['c3', 6, 6],
      ['c4', 1, 6],
    ] as const
    const IMAGE_CELLS = PLACES.map(([id, x, y]) => imageCell(id, x, y, Math.PI))

    function imageOptions() {
      return within(screen.getByRole('combobox', { name: 'Add condition' }))
        .getAllByRole('option')
        .filter((option) => option.closest('optgroup')?.getAttribute('label') === 'Image')
    }

    it('lists each channel, and measures it under every cell for a condition', async () => {
      const appendDebugEvent = vi.fn()
      render(
        <Harness
          overrides={{
            cells: IMAGE_CELLS,
            imageChannels: [imageChannel()],
            appendDebugEvent,
          }}
        />,
      )

      expect(imageOptions().map((option) => option.textContent)).toEqual([
        'DAPI mean (1 µm/px)',
        'DAPI % above 50 (1 µm/px)',
      ])
      addCondition('image:mean:0:Channel:0')

      // The mean starts at Otsu's threshold.
      expect(screen.getByRole('spinbutton', { name: 'From' })).toHaveValue(50)
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
      await waitFor(() => {
        expect(rowTexts()).toEqual(['c2 | 100', 'c3 | 100'])
      })
      expect(screen.getByText('Range 10 to 100')).toBeVisible()
      expect(appendDebugEvent).toHaveBeenCalledWith(
        expect.stringMatching(/^Cell query: measured DAPI at level 0 in /),
      )
    })

    it('measures again with another threshold, shown on the histogram', async () => {
      render(
        <Harness overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel()] }} />,
      )

      addCondition('image:above:0:t50:Channel:0')
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
      expect(
        screen.getByRole('img', { name: 'DAPI histogram, threshold 50' }),
      ).toBeVisible()

      const threshold = screen.getByRole('spinbutton', { name: 'Threshold' })
      fireEvent.change(threshold, { target: { value: '5' } })
      fireEvent.blur(threshold)

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('4 of 4 cells match')
      })
      expect(
        within(screen.getByRole('group', { name: 'Conditions' })).getByText(
          'DAPI % above 5 (1 µm/px)',
        ),
      ).toBeVisible()
    })

    it('measures discs of the radius set for cells without an area', async () => {
      const cells = PLACES.map(([id, x, y]) => imageCell(id, x, y))
      render(<Harness overrides={{ cells, imageChannels: [imageChannel()] }} />)

      addCondition('image:mean:0:r5:Channel:0')
      expect(screen.getByRole('spinbutton', { name: 'Radius' })).toHaveValue(5)
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent(/of 4 cells match/)
      })

      const radius = screen.getByRole('spinbutton', { name: 'Radius' })
      fireEvent.change(radius, { target: { value: '1' } })
      fireEvent.blur(radius)

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
    })

    it('asks before a large read, and measures once told to', async () => {
      const loader = {
        ...fakeCellImage({ width: 8, height: 8, pixel: (x) => (x >= 4 ? 100 : 10) })
          .loader,
        tileReadBytes: async () => 2 * 1024 ** 3,
      }
      render(
        <Harness
          overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel({}, loader)] }}
        />,
      )

      addCondition('image:mean:0:Channel:0')
      expect(await screen.findByText('Measuring DAPI reads 2.0 GiB.')).toBeVisible()
      // Each level with its size, from the tile index.
      expect(
        await screen.findByRole('option', { name: '1 µm/px, 2.0 GiB (default)' }),
      ).toBeInTheDocument()
      expect(screen.getByTestId('status')).toHaveTextContent('Waiting to measure')

      fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
    })

    // Plan 26, M2: read chunk by chunk, each level sized as its chunks
    // decoded at most.
    it('measures an OME-Zarr image', async () => {
      const { loader } = await fakeOmeZarrCellImage({
        width: 8,
        height: 8,
        pixel: (x) => (x >= 4 ? 100 : 10),
      })
      render(
        <Harness
          overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel({}, loader)] }}
        />,
      )

      addCondition('image:mean:0:Channel:0')
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
      expect(
        await screen.findByRole('option', { name: '1 µm/px, under 0.1 MiB (default)' }),
      ).toBeInTheDocument()
    })

    it('cancels a measurement, and measures again when asked', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const base = fakeCellImage({
        width: 8,
        height: 8,
        pixel: (x) => (x >= 4 ? 100 : 10),
      })
      const loader: CellImageLoader = {
        ...base.loader,
        fetchTileBytes: async (...args) => {
          await gate
          return base.loader.fetchTileBytes?.(...args) ?? new Uint8Array(0)
        },
      }
      render(
        <Harness
          overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel({}, loader)] }}
        />,
      )

      addCondition('image:mean:0:Channel:0')
      expect(await screen.findByText('Measuring DAPI… 0%')).toBeVisible()
      // The count waits for the measurement.
      expect(screen.getByTestId('status')).toHaveTextContent(/^Measuring$/)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(await screen.findByText('Measuring DAPI was cancelled.')).toBeVisible()

      release()
      fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
    })

    it('measures a link’s image conditions on opening', async () => {
      render(
        <Harness
          initial={[
            {
              kind: 'number',
              columnId: 'image:above:0:t50:Channel:0',
              operator: 'at-least',
              min: 50,
              max: Infinity,
            },
          ]}
          overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel()] }}
        />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
    })

    it('measures three channels at a time', async () => {
      const channels = ['A', 'B', 'C', 'D'].map((name, index) =>
        imageChannel({ id: `Channel:${index.toString()}`, name }),
      )
      render(<Harness overrides={{ cells: IMAGE_CELLS, imageChannels: channels }} />)

      addCondition('image:mean:0:Channel:0')
      addCondition('image:mean:0:Channel:1')
      addCondition('image:mean:0:Channel:2')

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('2 of 4 cells match')
      })
      const fourth = imageOptions().find(
        (option) => option.textContent === 'D mean (1 µm/px)',
      )
      expect(fourth).toBeDisabled()
    })

    it('says why an RGB image’s channels are not listed', () => {
      render(
        <Harness
          overrides={{ cells: IMAGE_CELLS, imageChannels: [imageChannel({ rgb: true })] }}
        />,
      )

      expect(
        imageOptions().map((option) => [
          option.textContent,
          option.hasAttribute('disabled'),
        ]),
      ).toEqual([['RGB images are not measured', true]])
    })
  })
})
