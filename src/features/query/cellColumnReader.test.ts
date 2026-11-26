import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import { lazyIdLookup } from '../../data/lazyIdLookup'
import {
  CELL_QUERY_TEST_CELLS as CELLS,
  CELL_QUERY_TEST_URL as URL_A,
  testCellIds as ids,
} from '../../test/cellQueryHarness'
import { datasetSetOptionId } from '../plots/plotsPanelModel'
import { CellImageMeasurements } from './cellImageMeasurements'
import {
  cellColumnNeeds,
  CellColumnReader,
  cellColumnState,
  type CellColumnContext,
  type CellColumnLoaders,
} from './cellColumnReader'
import { overviewCellColumns, type CellQueryColumn } from './cellQueryModel'

const URL_B = 'https://example.test/other.h5ad'

const KMEANS_COLUMN: CellQueryColumn = {
  id: `set:${datasetSetOptionId('kmeans')}`,
  label: 'kmeans',
  kind: 'category',
  group: 'Classes',
  source: { kind: 'set', setKind: 'dataset', setId: datasetSetOptionId('kmeans') },
}
const SCORE_COLUMN: CellQueryColumn = {
  id: 'track:score',
  label: 'Score',
  kind: 'number',
  group: 'Metadata',
  source: { kind: 'track', trackId: 'score' },
}
const TRANSCRIPTS_COLUMN: CellQueryColumn = {
  id: 'cell:transcriptCount',
  label: 'Transcripts',
  kind: 'number',
  group: 'Cell',
  source: { kind: 'cell', field: 'transcriptCount' },
}
const KMEANS: readonly Annotation[] = [
  { id: 'analysis:kmeans:a', label: 'kmeans: A', cellIds: ids('c4') },
  { id: 'analysis:kmeans:b', label: 'kmeans: B', cellIds: ids('c1', 'c2', 'c3', 'x9') },
]
// A dataset track whose values are read on demand.
const SCORE: ContinuousCellMetadataTrack = {
  id: 'score',
  label: 'Score',
  values: null,
  cellCount: 2,
  min: 0.5,
  max: 2,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function loaders(overrides: Partial<CellColumnLoaders> = {}): CellColumnLoaders {
  return {
    loadSetAnnotations: vi.fn<CellColumnLoaders['loadSetAnnotations']>(
      async () => KMEANS,
    ),
    loadMetadataTrackValues: vi.fn<CellColumnLoaders['loadMetadataTrackValues']>(
      async () => [
        { cellId: ids('c2')[0]!, value: 2 },
        { cellId: ids('c3')[0]!, value: 0.5 },
      ],
    ),
    appendDebugEvent: vi.fn(),
    ...overrides,
  }
}

function context(datasetUrl: string | null = URL_A): Omit<CellColumnContext, 'loads'> {
  return {
    datasetUrl,
    cells: CELLS,
    placedCellIds: lazyIdLookup(
      CELLS,
      (cell) => cell.id,
      () => true,
    ),
    cellColumns: overviewCellColumns(CELLS),
    annotations: [],
    savedSelections: [],
    metadataTracks: [SCORE],
    imageSnapshot: new CellImageMeasurements().getSnapshot(),
    imageOverLimit: new Map(),
  }
}

function stateOf(reader: CellColumnReader, column: CellQueryColumn, url = URL_A) {
  return cellColumnState(column, { ...context(url), loads: reader.getSnapshot() })
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('CellColumnReader', () => {
  it('reads what the columns in use need, once, while reading is on', async () => {
    const load = loaders()
    const reader = new CellColumnReader(load)
    const needs = cellColumnNeeds([KMEANS_COLUMN, SCORE_COLUMN], [SCORE])
    expect(needs).toEqual({ setGroupIds: ['kmeans'], trackIds: ['score'] })

    reader.sync(URL_A, needs, false)
    await settled()
    expect(load.loadSetAnnotations).not.toHaveBeenCalled()
    expect(stateOf(reader, KMEANS_COLUMN).status).toBe('loading')

    const listener = vi.fn()
    reader.subscribe(listener)
    reader.sync(URL_A, needs, true)
    reader.sync(URL_A, needs, true)
    await settled()

    expect(load.loadSetAnnotations).toHaveBeenCalledTimes(1)
    expect(load.loadMetadataTrackValues).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalled()
    expect(load.appendDebugEvent).toHaveBeenCalledWith(
      'Cell query: reading annotation set kmeans',
    )
    const kmeans = stateOf(reader, KMEANS_COLUMN)
    expect(kmeans.status === 'ready' && kmeans.classes).toEqual([
      { id: 'analysis:kmeans:a', label: 'A', count: 1 },
      { id: 'analysis:kmeans:b', label: 'B', count: 3 },
    ])
    const score = stateOf(reader, SCORE_COLUMN)
    expect(score.status === 'ready' && score.request()).toEqual({
      type: 'number-column-by-id',
      columnId: 'track:score',
      cellIds: ['c2', 'c3'],
      values: Float64Array.from([2, 0.5]),
    })
    // Reads for another dataset count as not started.
    expect(stateOf(reader, KMEANS_COLUMN, URL_B).status).toBe('loading')
  })

  it('keeps a failed read while it is needed, and reads it again after', async () => {
    const loadSetAnnotations = vi
      .fn<CellColumnLoaders['loadSetAnnotations']>()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValue(KMEANS)
    const load = loaders({ loadSetAnnotations })
    const reader = new CellColumnReader(load)
    const needs = cellColumnNeeds([KMEANS_COLUMN], [])

    reader.sync(URL_A, needs, true)
    await settled()
    expect(stateOf(reader, KMEANS_COLUMN)).toEqual({
      status: 'error',
      message: 'HTTP 503',
    })
    expect(load.appendDebugEvent).toHaveBeenCalledWith(
      'Cell query: annotation set kmeans failed: HTTP 503',
    )

    reader.sync(URL_A, needs, true)
    await settled()
    expect(loadSetAnnotations).toHaveBeenCalledTimes(1)

    reader.sync(URL_A, cellColumnNeeds([], []), true)
    reader.sync(URL_A, needs, true)
    await settled()
    expect(loadSetAnnotations).toHaveBeenCalledTimes(2)
    expect(stateOf(reader, KMEANS_COLUMN).status).toBe('ready')
  })

  it('stops the reads in flight when another dataset opens', async () => {
    const pending = deferred<readonly Annotation[]>()
    const loadSetAnnotations = vi.fn<CellColumnLoaders['loadSetAnnotations']>(
      () => pending.promise,
    )
    const reader = new CellColumnReader(loaders({ loadSetAnnotations }))
    const needs = cellColumnNeeds([KMEANS_COLUMN], [])

    reader.sync(URL_A, needs, true)
    const signal = loadSetAnnotations.mock.calls[0]?.[1]?.signal
    const waiting = reader.read(KMEANS_COLUMN, () => context(URL_A))
    reader.sync(URL_B, needs, false)

    expect(signal?.aborted).toBe(true)
    pending.resolve(KMEANS)
    await expect(waiting).rejects.toThrow('Another dataset was opened.')
    expect(stateOf(reader, KMEANS_COLUMN, URL_B).status).toBe('loading')

    // A read set is forgotten, and the window told.
    reader.sync(URL_A, needs, true)
    await settled()
    expect(loadSetAnnotations).toHaveBeenCalledTimes(2)
    expect(stateOf(reader, KMEANS_COLUMN).status).toBe('ready')
    const listener = vi.fn()
    reader.subscribe(listener)
    reader.sync(URL_B, needs, false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(reader.getSnapshot()).toEqual({
      url: URL_B,
      sets: new Map(),
      tracks: new Map(),
    })
  })

  it('reads a column for a caller, a failed read again, and waits no longer than asked', async () => {
    const pending = deferred<readonly Annotation[]>()
    const loadSetAnnotations = vi
      .fn<CellColumnLoaders['loadSetAnnotations']>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementation(() => pending.promise)
    const reader = new CellColumnReader(loaders({ loadSetAnnotations }))
    reader.sync(URL_A, cellColumnNeeds([KMEANS_COLUMN], []), true)
    await settled()
    expect(stateOf(reader, KMEANS_COLUMN).status).toBe('error')

    const controller = new AbortController()
    const stopped = reader.read(KMEANS_COLUMN, () => context(), controller.signal)
    const read = reader.read(KMEANS_COLUMN, () => context())
    controller.abort()
    await expect(stopped).rejects.toThrow(/abort/i)

    // One read again, shared, and the abort did not stop it.
    expect(loadSetAnnotations).toHaveBeenCalledTimes(2)
    pending.resolve(KMEANS)
    const request = await read
    expect(
      request.type === 'category-column' && request.classes.map((c) => c.label),
    ).toEqual(['A', 'B'])
  })

  it('reads the overview columns without loading anything', async () => {
    const load = loaders()
    const reader = new CellColumnReader(load)
    reader.sync(URL_A, cellColumnNeeds([TRANSCRIPTS_COLUMN], []), true)

    await expect(reader.read(TRANSCRIPTS_COLUMN, () => context())).resolves.toEqual({
      type: 'number-column',
      columnId: 'cell:transcriptCount',
      values: Float64Array.from([10, 25, 40, 5]),
    })
    expect(load.loadSetAnnotations).not.toHaveBeenCalled()
  })

  it('rejects a read with no dataset, and a column it cannot read', async () => {
    const reader = new CellColumnReader(loaders())
    await expect(reader.read(KMEANS_COLUMN, () => context(null))).rejects.toThrow(
      'No dataset is open.',
    )

    reader.sync(URL_A, cellColumnNeeds([], []), true)
    const gone: CellQueryColumn = {
      ...SCORE_COLUMN,
      source: { kind: 'track', trackId: 'x' },
    }
    await expect(reader.read(gone, () => context())).rejects.toThrow(
      'The dataset no longer lists this column.',
    )
  })
})
