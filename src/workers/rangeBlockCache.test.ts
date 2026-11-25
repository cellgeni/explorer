import { describe, expect, it } from 'vitest'
import { RangeBlockCache, type RangeBlockCacheOptions } from './rangeBlockCache'

const KiB = 1024

function fileBytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => index % 251)
}

// A cache over an in-memory file that records each request as [start, end).
function createCache(size: number, options: RangeBlockCacheOptions = {}) {
  const file = fileBytes(size)
  const requests: (readonly [number, number])[] = []
  const cache = new RangeBlockCache(
    size,
    (start, end) => {
      requests.push([start, end])
      return file.slice(start, end)
    },
    {
      blockSize: 4 * KiB,
      firstFetchBytes: 16 * KiB,
      maxFetchBytes: 64 * KiB,
      ...options,
    },
  )

  return {
    cache,
    file,
    requests,
    read(position: number, length: number): Uint8Array {
      const target = new Uint8Array(length)
      const copied = cache.readInto(target, position)
      return target.subarray(0, copied)
    },
  }
}

describe('RangeBlockCache', () => {
  it('copies bytes across block boundaries and stops at the end of the file', () => {
    const harness = createCache(100 * KiB)

    expect(harness.read(4 * KiB - 10, 30)).toEqual(
      harness.file.slice(4 * KiB - 10, 4 * KiB + 20),
    )
    expect(harness.read(100 * KiB - 5, 20)).toEqual(harness.file.slice(100 * KiB - 5))
    expect(harness.read(100 * KiB, 20)).toEqual(new Uint8Array())
    expect(harness.read(200 * KiB, 20)).toEqual(new Uint8Array())
  })

  it('fetches the first fetch size for a miss and serves later reads from it', () => {
    const harness = createCache(1024 * KiB)

    harness.read(5 * KiB, 100)
    harness.read(10 * KiB, 4 * KiB)
    harness.read(4 * KiB, 12 * KiB)

    expect(harness.requests).toEqual([[4 * KiB, 20 * KiB]])
    expect(harness.cache.stats()).toEqual({ requests: 1, fetchedBytes: 16 * KiB })
  })

  it('doubles the fetch for sequential misses, up to the largest fetch', () => {
    const harness = createCache(1024 * KiB)

    for (let position = 0; position < 400 * KiB; position += 2 * KiB) {
      harness.read(position, 2 * KiB)
    }

    expect(harness.requests.map(([start, end]) => (end - start) / KiB)).toEqual([
      16, 32, 64, 64, 64, 64, 64, 64,
    ])
  })

  it('treats a small skip as sequential and a distant miss as a new stream', () => {
    const harness = createCache(1024 * KiB)

    harness.read(0, 100)
    // Within one fetch of the stream's end: continues it with a doubled fetch.
    harness.read(24 * KiB, 100)
    // Far away: a new stream starts at the first fetch size.
    harness.read(600 * KiB, 100)

    expect(harness.requests).toEqual([
      [0, 16 * KiB],
      [24 * KiB, 56 * KiB],
      [600 * KiB, 616 * KiB],
    ])
  })

  it('fetches what a read needs in one request and reads ahead after it', () => {
    const harness = createCache(1024 * KiB)

    expect(harness.read(100 * KiB, 40 * KiB)).toEqual(
      harness.file.slice(100 * KiB, 140 * KiB),
    )
    expect(harness.requests).toEqual([[100 * KiB, 140 * KiB]])
  })

  it('stops read-ahead at a cached block rather than fetching it again', () => {
    const harness = createCache(1024 * KiB)

    harness.read(40 * KiB, 100)
    harness.read(0, 100)
    // Continues the stream from 0, whose doubled fetch would reach 48 KiB.
    harness.read(16 * KiB, 100)

    expect(harness.requests).toEqual([
      [40 * KiB, 56 * KiB],
      [0, 16 * KiB],
      [16 * KiB, 40 * KiB],
    ])
  })

  it('reads behind a stream whose misses move backward, doubling each fetch', () => {
    const harness = createCache(1024 * KiB)

    // As HDF5 reads a string heap: each miss is just before the last fetch.
    harness.read(200 * KiB, 4 * KiB)
    expect(harness.read(196 * KiB, 4 * KiB)).toEqual(
      harness.file.slice(196 * KiB, 200 * KiB),
    )
    harness.read(192 * KiB, 100)
    harness.read(176 * KiB, 100)
    harness.read(144 * KiB, 100)

    expect(harness.requests).toEqual([
      [200 * KiB, 216 * KiB],
      // The first miss before a stream may be a one-off: only what it needs.
      [196 * KiB, 200 * KiB],
      [180 * KiB, 196 * KiB],
      [148 * KiB, 180 * KiB],
      [84 * KiB, 148 * KiB],
    ])
    // All of it is cached: reading the range again fetches nothing.
    expect(harness.read(84 * KiB, 132 * KiB)).toEqual(
      harness.file.slice(84 * KiB, 216 * KiB),
    )
    expect(harness.requests).toHaveLength(5)
  })

  it('fills the gap up to the stream on a miss just before it', () => {
    const harness = createCache(1024 * KiB)

    harness.read(200 * KiB, 100)
    harness.read(190 * KiB, 100)

    expect(harness.requests).toEqual([
      [200 * KiB, 216 * KiB],
      [188 * KiB, 200 * KiB],
    ])
  })

  it('keeps the fetch sizes of reading ahead and reading behind apart', () => {
    const harness = createCache(1024 * KiB)

    harness.read(200 * KiB, 100)
    harness.read(196 * KiB, 100)
    harness.read(192 * KiB, 100)
    // Reading ahead doubles from the first fetch, not from the backward ones.
    harness.read(216 * KiB, 100)

    expect(harness.requests).toEqual([
      [200 * KiB, 216 * KiB],
      [196 * KiB, 200 * KiB],
      [180 * KiB, 196 * KiB],
      [216 * KiB, 248 * KiB],
    ])
  })

  it('reads behind at most 4 MiB at a time with the default sizes', () => {
    const MiB = 1024 * KiB
    const sizes: number[] = []
    let lowest = 40 * MiB
    const cache = new RangeBlockCache(64 * MiB, (start, end) => {
      sizes.push((end - start) / KiB)
      lowest = Math.min(lowest, start)
      return new Uint8Array(end - start)
    })
    const target = new Uint8Array(100)

    cache.readInto(target, lowest)
    for (let miss = 0; miss < 5; miss += 1) {
      cache.readInto(target, lowest - 100)
    }

    // In KiB: the first fetch, the one-off block, then 1, 2 and 4 MiB.
    expect(sizes).toEqual([1024, 64, 1024, 2048, 4096, 4096])
  })

  it('serves bytes from the head without a request', () => {
    const file = fileBytes(64 * KiB)
    const harness = createCache(64 * KiB, { head: file.slice(0, 16 * KiB) })

    expect(harness.read(1000, 10 * KiB)).toEqual(file.slice(1000, 1000 + 10 * KiB))
    expect(harness.requests).toEqual([])
  })

  it('evicts the least recently read blocks beyond its budget', () => {
    const harness = createCache(1024 * KiB, { budgetBytes: 32 * KiB })

    harness.read(0, 100)
    harness.read(500 * KiB, 100)
    // The first fetch is still cached and is now the most recently read.
    harness.read(0, 100)
    harness.read(800 * KiB, 100)
    harness.read(0, 100)
    harness.read(500 * KiB, 100)

    expect(harness.requests.map(([start]) => start / KiB)).toEqual([0, 500, 800, 500])
  })

  it('passes a read larger than its budget through uncached', () => {
    const harness = createCache(1024 * KiB, { budgetBytes: 32 * KiB })

    expect(harness.read(100 * KiB, 200 * KiB)).toEqual(
      harness.file.slice(100 * KiB, 300 * KiB),
    )
    harness.read(150 * KiB, 100)

    expect(harness.requests).toHaveLength(2)
  })

  it('throws when a request returns the wrong number of bytes', () => {
    const cache = new RangeBlockCache(64 * KiB, () => new Uint8Array(10), {
      blockSize: 4 * KiB,
      firstFetchBytes: 16 * KiB,
    })

    expect(() => cache.readInto(new Uint8Array(10), 0)).toThrow(
      'A range read of bytes 0-16383 returned 10 bytes.',
    )
  })

  it('passes on a failed request and retries the range on the next read', () => {
    const file = fileBytes(64 * KiB)
    let fail = true
    const cache = new RangeBlockCache(
      64 * KiB,
      (start, end) => {
        if (fail) {
          throw new Error('offline')
        }

        return file.slice(start, end)
      },
      { blockSize: 4 * KiB, firstFetchBytes: 16 * KiB },
    )
    const target = new Uint8Array(100)

    expect(() => cache.readInto(target, 0)).toThrow('offline')
    fail = false
    expect(cache.readInto(target, 0)).toBe(100)
    expect(target).toEqual(file.slice(0, 100))
  })
})
