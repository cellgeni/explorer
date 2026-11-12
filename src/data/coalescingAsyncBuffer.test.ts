import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COALESCED_RANGE_CONCURRENCY,
  coalescingAsyncBuffer,
} from './coalescingAsyncBuffer'

const BYTES = Uint8Array.from({ length: 1_000 }, (_, index) => index % 251)

// A file over BYTES that records each read and how many are in flight. A read
// stays in flight until the next macrotask, or until `hold` is released.
function recordingFile(options: { readonly hold?: Promise<void> } = {}) {
  const reads: [number, number][] = []
  let inFlight = 0
  let peak = 0

  return {
    reads,
    peak: () => peak,
    file: {
      byteLength: BYTES.byteLength,
      async slice(start: number, end = BYTES.byteLength): Promise<ArrayBuffer> {
        reads.push([start, end])
        inFlight += 1
        peak = Math.max(peak, inFlight)

        try {
          await (options.hold ?? new Promise((resolve) => setTimeout(resolve, 0)))
          return BYTES.slice(start, end).buffer
        } finally {
          inFlight -= 1
        }
      },
    },
  }
}

function bytesOf(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)]
}

describe('coalescingAsyncBuffer', () => {
  it('reads slices asked for together in one request and returns each slice', async () => {
    const recorded = recordingFile()
    const buffer = coalescingAsyncBuffer(recorded.file, { maxGapBytes: 10 })

    // Out of order, overlapping, with a 5-byte gap, as hyparquet asks.
    const slices = await Promise.all([
      buffer.slice(120, 130),
      buffer.slice(100, 110),
      buffer.slice(105, 115),
      buffer.slice(100, 110),
    ])

    expect(recorded.reads).toEqual([[100, 130]])
    expect(slices.map(bytesOf)).toEqual([
      bytesOf(BYTES.slice(120, 130).buffer),
      bytesOf(BYTES.slice(100, 110).buffer),
      bytesOf(BYTES.slice(105, 115).buffer),
      bytesOf(BYTES.slice(100, 110).buffer),
    ])
  })

  it('reads slices further apart than the gap, or past the size cap, separately', async () => {
    const recorded = recordingFile()
    const buffer = coalescingAsyncBuffer(recorded.file, {
      maxGapBytes: 10,
      maxRangeBytes: 50,
    })

    await Promise.all([
      buffer.slice(0, 20),
      buffer.slice(25, 45),
      // 11 bytes after the last slice: a new request.
      buffer.slice(56, 60),
      // Would make the second request 64 bytes long.
      buffer.slice(60, 120),
      buffer.slice(900),
    ])

    expect(recorded.reads).toEqual([
      [0, 45],
      [56, 60],
      [60, 120],
      [900, 1_000],
    ])
  })

  it('keeps at most maxConcurrent requests in flight, in file order', async () => {
    const recorded = recordingFile()
    const buffer = coalescingAsyncBuffer(recorded.file, { maxRangeBytes: 1 })
    const starts = Array.from({ length: 200 }, (_, index) => (index * 37) % 1_000)

    // One slice per byte range, asked for at once, as hyparquet does for each
    // column chunk of a read.
    const slices = await Promise.all(
      starts.map((start) => buffer.slice(start, start + 1)),
    )

    expect(recorded.peak()).toBe(DEFAULT_COALESCED_RANGE_CONCURRENCY)
    expect(recorded.reads).toHaveLength(200)
    expect(recorded.reads.map(([start]) => start)).toEqual(
      [...starts].sort((a, b) => a - b),
    )
    expect(slices.map((slice) => bytesOf(slice)[0])).toEqual(
      starts.map((start) => BYTES[start]),
    )
  })

  it('limits requests across batches as well as within one', async () => {
    let release = () => {}
    const recorded = recordingFile({
      hold: new Promise<void>((resolve) => {
        release = resolve
      }),
    })
    const buffer = coalescingAsyncBuffer(recorded.file, {
      maxConcurrent: 2,
      maxGapBytes: 0,
    })
    const first = [buffer.slice(0, 1), buffer.slice(10, 11)]

    await Promise.resolve()
    const second = [buffer.slice(20, 21), buffer.slice(30, 31)]
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(recorded.reads).toEqual([
      [0, 1],
      [10, 11],
    ])

    release()
    await Promise.all([...first, ...second])
    expect(recorded.reads).toHaveLength(4)
    expect(recorded.peak()).toBe(2)
  })

  it('rejects the slices of a failed request and serves the others', async () => {
    const buffer = coalescingAsyncBuffer(
      {
        byteLength: BYTES.byteLength,
        async slice(start, end) {
          if (start === 500) {
            throw new TypeError('Failed to fetch')
          }

          return BYTES.slice(start, end).buffer
        },
      },
      { maxGapBytes: 0 },
    )

    const [ok, failedA, failedB] = await Promise.allSettled([
      buffer.slice(0, 10),
      buffer.slice(500, 510),
      buffer.slice(505, 520),
    ])

    expect(ok.status).toBe('fulfilled')
    expect(failedA).toMatchObject({ status: 'rejected', reason: { name: 'TypeError' } })
    expect(failedB).toMatchObject({ status: 'rejected', reason: { name: 'TypeError' } })
  })

  it('returns empty slices without a request', async () => {
    const recorded = recordingFile()
    const buffer = coalescingAsyncBuffer(recorded.file)

    await expect(buffer.slice(10, 10)).resolves.toHaveProperty('byteLength', 0)
    expect(recorded.reads).toEqual([])
  })
})
