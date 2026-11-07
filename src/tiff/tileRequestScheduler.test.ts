import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { TileRequestScheduler } from './tileRequestScheduler'
import type { TileCacheEntry } from './tileCache'

interface PendingRequest {
  readonly key: string
  readonly signal: AbortSignal | undefined
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
    ): Promise<TileCacheEntry> {
      return new Promise((resolve) => {
        pending.push({
          key: `${level}:${col}:${row}`,
          signal,
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
})
