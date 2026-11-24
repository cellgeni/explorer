import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { TileRequestScheduler, TileRequestSlots } from './tileRequestScheduler'
import type { ImagePyramidTileFetchOptions } from '../data/imagePyramid'
import type { TileCacheEntry } from './tileCache'

interface PendingRequest {
  readonly key: string
  readonly signal: AbortSignal | undefined
  readonly fetchOptions: ImagePyramidTileFetchOptions | undefined
  readonly resolve: () => void
}

function fakeCache() {
  const pending: PendingRequest[] = []
  const bounds = {
    minX: micrometers(0),
    maxX: micrometers(1),
    minY: micrometers(0),
    maxY: micrometers(1),
  }

  return {
    pending,
    request(
      _loader: string,
      level: number,
      col: number,
      row: number,
      signal?: AbortSignal,
      fetchOptions?: ImagePyramidTileFetchOptions,
    ): Promise<TileCacheEntry> {
      return new Promise((resolve) => {
        pending.push({
          key: `${level}:${col}:${row}`,
          signal,
          fetchOptions,
          resolve: () => {
            resolve(
              signal?.aborted === true
                ? {
                    state: 'error',
                    bounds,
                    error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
                  }
                : ({
                    state: 'ready',
                    level,
                    bounds,
                    bitmap: {} as ImageBitmap,
                    sourceWidth: 1,
                    sourceHeight: 1,
                  } as unknown as TileCacheEntry),
            )
          },
        })
      })
    },
  }
}

const tiles = (...cols: number[]) => cols.map((col) => ({ col, row: 0 }))

describe('tile request scheduler', () => {
  it('keeps loading wanted tiles when the view moves and cancels the rest', async () => {
    const cache = fakeCache()
    const onSettled = vi.fn()
    const scheduler = new TileRequestScheduler(cache)

    scheduler.update({
      loader: 'image',
      level: 2,
      tiles: tiles(0, 1, 2),
      maxConcurrentRequests: 2,
      onSettled,
    })

    expect(cache.pending.map((request) => request.key)).toEqual(['2:0:0', '2:1:0'])

    scheduler.update({
      loader: 'image',
      level: 2,
      tiles: tiles(1, 3),
      maxConcurrentRequests: 2,
      onSettled,
    })

    expect(cache.pending[0]?.signal?.aborted).toBe(true)
    expect(cache.pending[1]?.signal?.aborted).toBe(false)
    // Tile 1 kept loading; tile 3 took the freed slot.
    expect(cache.pending.map((request) => request.key)).toEqual([
      '2:0:0',
      '2:1:0',
      '2:3:0',
    ])

    cache.pending[0]?.resolve()
    cache.pending[1]?.resolve()
    await vi.waitFor(() => {
      expect(onSettled).toHaveBeenCalledOnce()
    })
  })

  it('starts queued tiles in priority order as slots free up', async () => {
    const cache = fakeCache()
    const scheduler = new TileRequestScheduler(cache)

    scheduler.update({
      loader: 'image',
      level: 1,
      tiles: tiles(5, 4, 3),
      maxConcurrentRequests: 1,
      onSettled: () => {},
    })
    cache.pending[0]?.resolve()

    await vi.waitFor(() => {
      expect(cache.pending.map((request) => request.key)).toEqual(['1:5:0', '1:4:0'])
    })
  })

  it('cancels everything when the image changes', () => {
    const cache = fakeCache()
    const scheduler = new TileRequestScheduler(cache)
    const update = (loader: string) => {
      scheduler.update({
        loader,
        level: 0,
        tiles: tiles(0),
        maxConcurrentRequests: 1,
        onSettled: () => {},
      })
    }

    update('first')
    update('second')

    expect(cache.pending.map((request) => request.signal?.aborted)).toEqual([true, false])
  })

  it('tells each tile fetch which tiles are still queued', () => {
    const cache = fakeCache()
    const scheduler = new TileRequestScheduler(cache)

    scheduler.update({
      loader: 'image',
      level: 3,
      tiles: tiles(0, 1, 2),
      maxConcurrentRequests: 2,
      onSettled: () => {},
    })

    expect(cache.pending.map((request) => request.fetchOptions?.upcoming)).toEqual([
      tiles(1, 2),
      tiles(2),
    ])
  })

  it('frees the slot of a tile whose bytes come from another request', async () => {
    const cache = fakeCache()
    const onSettled = vi.fn()
    const scheduler = new TileRequestScheduler(cache)

    scheduler.update({
      loader: 'image',
      level: 0,
      tiles: tiles(0, 1, 2, 3),
      maxConcurrentRequests: 1,
      onSettled,
    })
    expect(cache.pending.map((request) => request.key)).toEqual(['0:0:0'])

    // Tile 0 waits on its own request; tile 1 then rides on it.
    cache.pending[0]?.fetchOptions?.onSharedRead?.()
    expect(cache.pending.map((request) => request.key)).toEqual(['0:0:0', '0:1:0'])
    cache.pending[1]?.fetchOptions?.onSharedRead?.()
    expect(cache.pending.map((request) => request.key)).toEqual([
      '0:0:0',
      '0:1:0',
      '0:2:0',
    ])

    // Settling a tile that gave up its slot starts nothing more.
    cache.pending[0]?.resolve()
    await vi.waitFor(() => {
      expect(onSettled).toHaveBeenCalledOnce()
    })
    expect(cache.pending).toHaveLength(3)

    // A shared-read notice after the view moved on frees nothing.
    scheduler.update({
      loader: 'image',
      level: 0,
      tiles: tiles(3),
      maxConcurrentRequests: 1,
      onSettled,
    })
    expect(cache.pending.map((request) => request.key)).toEqual([
      '0:0:0',
      '0:1:0',
      '0:2:0',
      '0:3:0',
    ])
    cache.pending[2]?.fetchOptions?.onSharedRead?.()
    expect(cache.pending).toHaveLength(4)
  })

  describe('a failed tile (EXP-296)', () => {
    const bounds = {
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    }

    // Fails each tile's first read, which may be read again a second later.
    // Before then, as the cache does, it hands back the failure unread.
    function flakyCache() {
      const requested: string[] = []
      const failures = new Map<string, TileCacheEntry>()

      return {
        requested,
        request(
          _loader: string,
          level: number,
          col: number,
          row: number,
        ): Promise<TileCacheEntry> {
          const key = `${level}:${col}:${row}`
          const failure = failures.get(key)

          if (
            failure?.state === 'error' &&
            failure.retryAt !== undefined &&
            Date.now() < failure.retryAt
          ) {
            return Promise.resolve(failure)
          }

          requested.push(key)

          if (failure === undefined) {
            const failed: TileCacheEntry = {
              state: 'error',
              bounds,
              error: new TypeError('Failed to fetch'),
              failures: 1,
              retryAt: Date.now() + 1_000,
            }
            failures.set(key, failed)
            return Promise.resolve(failed)
          }

          return Promise.resolve({
            state: 'ready',
            level,
            bounds,
            bitmap: {} as ImageBitmap,
            sourceWidth: 1,
            sourceHeight: 1,
          } as unknown as TileCacheEntry)
        },
      }
    }

    it('is asked for again once its retry time comes, with the view still', async () => {
      vi.useFakeTimers()
      try {
        const cache = flakyCache()
        const onSettled = vi.fn()
        const scheduler = new TileRequestScheduler(cache)

        scheduler.update({
          loader: 'image',
          level: 0,
          tiles: tiles(0),
          maxConcurrentRequests: 1,
          onSettled,
        })
        await vi.advanceTimersByTimeAsync(999)
        expect(cache.requested).toEqual(['0:0:0'])
        expect(onSettled).toHaveBeenCalledOnce()

        await vi.advanceTimersByTimeAsync(1)
        expect(cache.requested).toEqual(['0:0:0', '0:0:0'])
        expect(onSettled).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    // Timers can fire a millisecond before Date.now() reaches their time,
    // when the cache would hand the failure back unread.
    it('waits again when its timer fires before the retry time', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let now = 0
      const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        const cache = flakyCache()
        const onSettled = vi.fn()
        const scheduler = new TileRequestScheduler(cache)

        scheduler.update({
          loader: 'image',
          level: 0,
          tiles: tiles(0),
          maxConcurrentRequests: 1,
          onSettled,
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(onSettled).toHaveBeenCalledOnce()

        // The timer fires with Date.now() a millisecond short.
        now = 999
        await vi.advanceTimersByTimeAsync(1_000)
        expect(cache.requested).toEqual(['0:0:0'])
        expect(onSettled).toHaveBeenCalledOnce()

        now = 1_000
        await vi.advanceTimersByTimeAsync(1)
        expect(cache.requested).toEqual(['0:0:0', '0:0:0'])
        expect(onSettled).toHaveBeenCalledTimes(2)
      } finally {
        dateNow.mockRestore()
        vi.useRealTimers()
      }
    })

    it('is not asked for again once no client wants it, or after a cancel', async () => {
      vi.useFakeTimers()
      try {
        const cache = flakyCache()
        const scheduler = new TileRequestScheduler(cache)
        const update = (...cols: number[]) => {
          scheduler.update({
            loader: 'image',
            level: 0,
            tiles: tiles(...cols),
            maxConcurrentRequests: 1,
            onSettled: () => {},
          })
        }

        update(0)
        await vi.advanceTimersByTimeAsync(0)
        update(1)
        await vi.advanceTimersByTimeAsync(2_000)
        // Tile 1 failed too, and was read again; tile 0 was not.
        expect(cache.requested).toEqual(['0:0:0', '0:1:0', '0:1:0'])

        update(2)
        await vi.advanceTimersByTimeAsync(0)
        scheduler.cancel()
        await vi.advanceTimersByTimeAsync(2_000)
        expect(cache.requested).toEqual(['0:0:0', '0:1:0', '0:1:0', '0:2:0'])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('shared by several canvases (plan 23-D11)', () => {
    const update = (
      scheduler: TileRequestScheduler<string>,
      client: string,
      cols: readonly number[],
      options: { readonly priority?: number; readonly onSettled?: () => void } = {},
    ) => {
      scheduler.update({
        loader: 'image',
        level: 0,
        tiles: tiles(...cols),
        maxConcurrentRequests: 10,
        onSettled: options.onSettled ?? (() => {}),
        client,
        ...(options.priority === undefined ? {} : { priority: options.priority }),
      })
    }

    it('reads a tile two canvases want once and tells both', async () => {
      const cache = fakeCache()
      const scheduler = new TileRequestScheduler(cache)
      const first = vi.fn()
      const second = vi.fn()

      update(scheduler, 'a', [0, 1], { onSettled: first })
      update(scheduler, 'b', [1, 2], { onSettled: second })

      expect(cache.pending.map((request) => request.key)).toEqual([
        '0:0:0',
        '0:1:0',
        '0:2:0',
      ])

      cache.pending[1]?.resolve()
      await vi.waitFor(() => {
        expect(second).toHaveBeenCalledOnce()
      })
      expect(first).toHaveBeenCalledOnce()
    })

    it('keeps a tile another canvas still wants and cancels it once none does', () => {
      const cache = fakeCache()
      const scheduler = new TileRequestScheduler(cache)

      update(scheduler, 'a', [0])
      update(scheduler, 'b', [0])
      scheduler.release('a')
      expect(cache.pending[0]?.signal?.aborted).toBe(false)

      scheduler.release('b')
      expect(cache.pending[0]?.signal?.aborted).toBe(true)
    })

    it('reads the tiles of the canvas with the lowest priority first', async () => {
      const cache = fakeCache()
      const scheduler = new TileRequestScheduler(cache)
      const updateOne = (client: string, cols: readonly number[], priority: number) => {
        scheduler.update({
          loader: 'image',
          level: 0,
          tiles: tiles(...cols),
          maxConcurrentRequests: 1,
          onSettled: () => {},
          client,
          priority,
        })
      }

      updateOne('below', [5, 6], 3)
      updateOne('above', [7], 1)
      expect(cache.pending.map((request) => request.key)).toEqual(['0:5:0'])

      // Tile 5 had started; tile 7 goes next, before the rest of 'below'.
      cache.pending[0]?.resolve()
      await vi.waitFor(() => {
        expect(cache.pending.map((request) => request.key)).toEqual(['0:5:0', '0:7:0'])
      })
    })

    it('keeps the requests of several schedulers under one limit', async () => {
      const slots = new TileRequestSlots(3)
      const firstCache = fakeCache()
      const secondCache = fakeCache()
      const first = new TileRequestScheduler(firstCache, slots)
      const second = new TileRequestScheduler(secondCache, slots)

      update(first, 'a', [0, 1])
      update(second, 'a', [0, 1, 2])

      expect(firstCache.pending).toHaveLength(2)
      expect(secondCache.pending).toHaveLength(1)
      expect(slots.inUse).toBe(3)

      // A tile of the first scheduler settles; the second takes its slot.
      firstCache.pending[0]?.resolve()
      await vi.waitFor(() => {
        expect(secondCache.pending).toHaveLength(2)
      })
      expect(slots.inUse).toBe(3)

      // Cancelling frees the first's slot, and the second's last tile starts.
      first.cancel()
      expect(secondCache.pending).toHaveLength(3)
      expect(slots.inUse).toBe(3)
      second.release('a')
      expect(slots.inUse).toBe(0)
    })
  })
})
