import { createAsyncLimiter } from '../utils/asyncLimiter'
import type { AsyncByteSource } from './persistentByteRangeCache'

export const DEFAULT_COALESCED_RANGE_CONCURRENCY = 4
export const DEFAULT_COALESCED_RANGE_GAP_BYTES = 256 * 1024
export const DEFAULT_COALESCED_RANGE_MAX_BYTES = 8 * 1024 * 1024

export interface CoalescingAsyncBufferOptions {
  // Range requests in flight at once.
  readonly maxConcurrent?: number
  // Slices this far apart or closer share a request; the bytes between are
  // read and dropped.
  readonly maxGapBytes?: number
  // A shared request stops growing at this size. A larger slice is read alone.
  readonly maxRangeBytes?: number
}

export interface CoalescingAsyncBuffer {
  readonly byteLength: number
  slice(start: number, end?: number): Promise<ArrayBuffer>
}

interface PendingSlice {
  readonly start: number
  readonly end: number
  readonly resolve: (bytes: ArrayBuffer) => void
  readonly reject: (error: unknown) => void
}

interface CoalescedRange {
  readonly start: number
  end: number
  readonly slices: PendingSlice[]
}

// hyparquet asks for every column chunk of a read at once, one range request
// each: 6,738 for the Visium HD reference's barcode_mappings.parquet, which
// Chromium fails with net::ERR_INSUFFICIENT_RESOURCES. This buffer collects
// the slices asked for in one turn, merges neighbours into larger ranges, and
// keeps at most `maxConcurrent` range requests in flight, in file order. Each
// slice resolves with a copy of its bytes, so a range is freed once read.
export function coalescingAsyncBuffer(
  file: AsyncByteSource,
  options: CoalescingAsyncBufferOptions = {},
): CoalescingAsyncBuffer {
  const limit = createAsyncLimiter(
    Math.max(1, options.maxConcurrent ?? DEFAULT_COALESCED_RANGE_CONCURRENCY),
  )
  const maxGapBytes = options.maxGapBytes ?? DEFAULT_COALESCED_RANGE_GAP_BYTES
  const maxRangeBytes = options.maxRangeBytes ?? DEFAULT_COALESCED_RANGE_MAX_BYTES
  let pending: PendingSlice[] = []

  function flush(): void {
    const batch = pending
    pending = []

    for (const range of coalesceSlices(batch, maxGapBytes, maxRangeBytes)) {
      limit(async () => file.slice(range.start, range.end)).then(
        (bytes) => {
          for (const slice of range.slices) {
            slice.resolve(bytes.slice(slice.start - range.start, slice.end - range.start))
          }
        },
        (error: unknown) => {
          for (const slice of range.slices) {
            slice.reject(error)
          }
        },
      )
    }
  }

  return {
    byteLength: file.byteLength,
    slice(start, end = file.byteLength) {
      if (end <= start) {
        return Promise.resolve(new ArrayBuffer(0))
      }

      return new Promise<ArrayBuffer>((resolve, reject) => {
        if (pending.length === 0) {
          queueMicrotask(flush)
        }

        pending.push({ start, end, resolve, reject })
      })
    },
  }
}

function coalesceSlices(
  slices: readonly PendingSlice[],
  maxGapBytes: number,
  maxRangeBytes: number,
): CoalescedRange[] {
  const ranges: CoalescedRange[] = []
  let current: CoalescedRange | undefined

  for (const slice of [...slices].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (
      current !== undefined &&
      slice.start <= current.end + maxGapBytes &&
      Math.max(current.end, slice.end) - current.start <= maxRangeBytes
    ) {
      current.end = Math.max(current.end, slice.end)
      current.slices.push(slice)
      continue
    }

    current = { start: slice.start, end: slice.end, slices: [slice] }
    ranges.push(current)
  }

  return ranges
}
