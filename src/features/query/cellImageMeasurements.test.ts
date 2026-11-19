import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { cell, fakeCellImage, fakeOmeZarrCellImage } from '../../test/cellImageFixtures'
import { measureTileBytes } from '../../workers/tileMeasureCore'
import { measureChunkCells } from '../../workers/zarrDecodeCore'
import { CELL_IMAGE_ASK_BYTES, CELL_IMAGE_REFUSE_BYTES } from './cellImageMeasurer'
import type { CellImageLoader } from './cellImageMeasurer'
import {
  CellImageMeasurements,
  type CellImageColumnNeed,
  type CellImageMeasurementContext,
  type CellImageMeasurementSpec,
} from './cellImageMeasurements'

// 8 x 8 in 4 x 4 tiles: the right half 100, the left 10.
function image() {
  return fakeCellImage({ width: 8, height: 8, pixel: (x) => (x >= 4 ? 100 : 10) })
}

const CELLS = [cell(4, 4), cell(1, 1), cell(7, 7)]

function spec(
  overrides: Partial<CellImageMeasurementSpec> = {},
): CellImageMeasurementSpec {
  return {
    channelId: 'Channel:0',
    level: 0,
    z: null,
    radius: 1,
    threshold: null,
    ...overrides,
  }
}

function mean(overrides: Partial<CellImageMeasurementSpec> = {}): CellImageColumnNeed {
  return {
    columnId: `mean:${JSON.stringify(overrides)}`,
    stat: 'mean',
    spec: spec(overrides),
  }
}

function above(threshold: number, overrides: Partial<CellImageMeasurementSpec> = {}) {
  return {
    columnId: `above:${threshold.toString()}:${JSON.stringify(overrides)}`,
    stat: 'above',
    spec: spec({ ...overrides, threshold }),
  } satisfies CellImageColumnNeed
}

function setup(loader: CellImageLoader = image().loader) {
  const close = vi.fn()
  const findThreshold = vi.fn(async () => 42)
  const store = new CellImageMeasurements({
    createTileMeasurer: () => ({
      measure: measureTileBytes,
      measureChunk: (chunk, measure) =>
        measureChunkCells(
          chunk.source,
          chunk.bytes === undefined ? null : chunk.bytes.slice().buffer,
          chunk.window,
          measure,
        ),
      close,
    }),
    findThreshold,
  })
  const onMeasured = vi.fn()
  const context: CellImageMeasurementContext = {
    cells: CELLS,
    loaderFor: (channelId) => (channelId === 'Channel:0' ? loader : null),
    onMeasured,
  }
  const stateOf = (columnId: string) => {
    const key = store.keyFor(columnId)
    return key === undefined ? undefined : store.state(key)
  }
  const ready = async (columnId: string) => {
    await vi.waitFor(() => {
      expect(stateOf(columnId)?.status).toBe('ready')
    })
    const state = stateOf(columnId)
    if (state?.status !== 'ready') throw new Error('not ready')
    return state.result
  }
  return { store, context, close, findThreshold, onMeasured, stateOf, ready }
}

describe('CellImageMeasurements', () => {
  it('measures a column, then closes its workers', async () => {
    const { store, context, close, onMeasured, ready } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    const need = mean()

    store.sync([need], context)
    const result = await ready(need.columnId)

    expect(Array.from(result.mean)).toEqual([55, 10, 100])
    expect(listener).toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    expect(onMeasured).toHaveBeenCalledTimes(1)
  })

  // Progress renders the panel's conditions alone: App, and with it the
  // canvas, renders only when a measurement's state changes (plan 26-G).
  it('publishes progress apart from state changes', async () => {
    const { loader } = fakeCellImage({ width: 64, height: 64, pixel: () => 1 })
    const { store, context, ready } = setup(loader)
    const cells = Array.from({ length: 256 }, (_, index) =>
      cell((index % 16) * 4 + 2, Math.floor(index / 16) * 4 + 2),
    )
    const states = vi.fn()
    const progress = vi.fn()
    store.subscribe(states)
    store.subscribeProgress(progress)
    const need = mean()

    store.sync([need], { ...context, cells })
    await ready(need.columnId)

    // Planning, measuring, ready.
    expect(states).toHaveBeenCalledTimes(3)
    expect(progress.mock.calls.length).toBeGreaterThan(50)
  })

  it('takes the mean and the share above from one pass', async () => {
    const { loader, fetches } = image()
    const { store, context, ready } = setup(loader)
    const needs = [mean(), above(50)]

    store.sync(needs, context)
    await ready(needs[0]?.columnId ?? '')
    const result = await ready(needs[1]?.columnId ?? '')

    expect(store.keyFor(needs[0]?.columnId ?? '')).toBe(
      store.keyFor(needs[1]?.columnId ?? ''),
    )
    expect(Array.from(result.above)).toEqual([50, 0, 100])
    expect(fetches).toHaveLength(4)
  })

  it('keeps the mean on a finished pass when the threshold changes', async () => {
    const { store, context, ready } = setup()
    const first = [mean(), above(50)]
    store.sync(first, context)
    await ready(first[1]?.columnId ?? '')
    const meanKey = store.keyFor(first[0]?.columnId ?? '')

    const second = [mean(), above(90)]
    store.sync(second, context)

    expect(store.keyFor(second[0]?.columnId ?? '')).toBe(meanKey)
    expect(store.keyFor(second[1]?.columnId ?? '')).not.toBe(meanKey)
    const result = await ready(second[1]?.columnId ?? '')
    expect(Array.from(result.above)).toEqual([50, 0, 100])
  })

  it('asks before a read over the budget, and measures once told to', async () => {
    const loader = {
      ...image().loader,
      tileReadBytes: async () => CELL_IMAGE_ASK_BYTES + 1,
    }
    const { store, context, stateOf, ready } = setup(loader)
    const need = mean()

    store.sync([need], context)
    await vi.waitFor(() => {
      expect(stateOf(need.columnId)).toEqual({
        status: 'asking',
        size: { bytes: CELL_IMAGE_ASK_BYTES + 1, exact: true },
      })
    })

    store.measure(store.keyFor(need.columnId) ?? '')
    await ready(need.columnId)
  })

  it('refuses a read over the limit', async () => {
    const loader = {
      ...image().loader,
      tileReadBytes: async () => CELL_IMAGE_REFUSE_BYTES + 1,
    }
    const { store, context, stateOf } = setup(loader)
    const need = mean()

    store.sync([need], context)

    await vi.waitFor(() => {
      expect(stateOf(need.columnId)?.status).toBe('refused')
    })
  })

  it('cancels, and measures again when asked', async () => {
    let release: () => void = () => undefined
    const base = image().loader
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader: CellImageLoader = {
      ...base,
      fetchTileBytes: async (...args) => {
        await gate
        return base.fetchTileBytes?.(...args) ?? new Uint8Array(0)
      },
    }
    const { store, context, stateOf, ready } = setup(loader)
    const need = mean()

    store.sync([need], context)
    await vi.waitFor(() => {
      expect(stateOf(need.columnId)?.status).toBe('measuring')
    })
    const key = store.keyFor(need.columnId) ?? ''
    expect(store.progress(key)).toBe(0)

    store.cancel(key)
    release()
    expect(stateOf(need.columnId)).toEqual({ status: 'cancelled' })

    store.measure(key)
    await ready(need.columnId)
  })

  it('stops a measurement no column needs', async () => {
    const base = image().loader
    const signals: AbortSignal[] = []
    const loader: CellImageLoader = {
      ...base,
      fetchTileBytes: (_level, _col, _row, signal) => {
        if (signal !== undefined) signals.push(signal)
        return new Promise(() => undefined)
      },
    }
    const { store, context, stateOf } = setup(loader)
    const need = mean()

    store.sync([need], context)
    await vi.waitFor(() => {
      expect(signals.length).toBeGreaterThan(0)
    })
    store.sync([], context)

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(stateOf(need.columnId)).toBeUndefined()
  })

  it('keeps a few finished measurements for columns that come back', async () => {
    const { loader, fetches } = image()
    const { store, context, ready } = setup(loader)
    const need = mean()

    store.sync([need], context)
    await ready(need.columnId)
    store.sync([], context)
    store.sync([need], context)

    expect(store.state(store.keyFor(need.columnId) ?? '')?.status).toBe('ready')
    expect(fetches).toHaveLength(4)
  })

  it('forgets every measurement for other cells', async () => {
    const { store, context, ready } = setup()
    const need = mean()

    store.sync([need], context)
    await ready(need.columnId)
    store.sync([need], { ...context, cells: [cell(1, 1)] })

    expect(store.state(store.keyFor(need.columnId) ?? '')?.status).toBe('planning')
    const result = await ready(need.columnId)
    expect(Array.from(result.mean)).toEqual([10])
  })

  it('reports a channel or plane it has no loader for', async () => {
    const { store, context, stateOf } = setup()
    const other = mean({ channelId: 'Channel:9' })
    const plane = mean({ z: 3 })

    store.sync([other, plane], { ...context, loaderFor: () => null })

    await vi.waitFor(() => {
      expect(stateOf(other.columnId)).toEqual({
        status: 'error',
        message: 'The image no longer has this channel.',
      })
      expect(stateOf(plane.columnId)).toEqual({
        status: 'error',
        message: 'Show plane 3 on the canvas to measure it.',
      })
    })
  })

  it('finds thresholds for channels auto-contrast has not read, one at a time', async () => {
    const { store, findThreshold } = setup()
    const loader = image().loader as unknown as ImagePyramidLoader

    store.findThresholds([
      { id: 'a', loader },
      { id: 'b', loader },
    ])
    expect(store.threshold('a')).toBe('finding')
    await vi.waitFor(() => {
      expect(store.threshold('b')).toBe(42)
    })
    store.findThresholds([{ id: 'a', loader }])

    expect(findThreshold).toHaveBeenCalledTimes(2)
  })
  it('measures an OME-Zarr channel, and sizes its levels from its chunks', async () => {
    const { loader } = await fakeOmeZarrCellImage({
      width: 8,
      height: 8,
      levels: 2,
      pixel: (x) => (x >= 4 ? 100 : 10),
    })
    const { store, context, ready } = setup(loader)
    const need = mean()

    store.sync([need], context)
    const result = await ready(need.columnId)
    store.findLevelSizes([{ id: 'Channel:0', loader }])

    expect(Array.from(result.mean)).toEqual([55, 10, 100])
    await vi.waitFor(() => {
      expect(store.getSnapshot().levelSizes('Channel:0')).toEqual([
        { bytes: 4 * 4 * 4 * 2, exact: false },
        { bytes: 4 * 4 * 2, exact: false },
      ])
    })
  })
})
