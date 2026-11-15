// A block cache over a remote file read by synchronous range requests, for
// h5wasm in a worker: the HDF5 library reads its file synchronously, so each
// miss blocks until its request returns. Requests are serial, which makes
// round trips the main cost, so the cache reads ahead on sequential access.

// Reads bytes `start` to `end` (exclusive) of the file, all of them, or throws.
export type SyncRangeRead = (start: number, end: number) => Uint8Array

export interface RangeBlockCacheOptions {
  // The unit of caching and of request alignment.
  readonly blockSize?: number
  // How much a miss away from earlier reads fetches. HDF5 metadata is small
  // and scattered, so this sits near one round trip's worth of bandwidth.
  readonly firstFetchBytes?: number
  // A miss that continues an earlier fetch doubles that stream's fetch, up to
  // this size, so a scan of a large dataset needs few requests.
  readonly maxFetchBytes?: number
  // Cached bytes kept; the least recently read blocks go first.
  readonly budgetBytes?: number
  // Bytes from the start of the file that the caller already holds.
  readonly head?: Uint8Array
}

export interface RangeBlockCacheStats {
  readonly requests: number
  readonly fetchedBytes: number
}

interface ReadStream {
  // The block after the last one this stream fetched.
  next: number
  // Blocks the stream's last request fetched.
  blocks: number
}

export const RANGE_BLOCK_BYTES = 64 * 1024
export const RANGE_FIRST_FETCH_BYTES = 1024 * 1024
const DEFAULT_MAX_FETCH_BYTES = 16 * 1024 * 1024
const DEFAULT_BUDGET_BYTES = 128 * 1024 * 1024
// HDF5 reads a chunked dataset's index and its chunks, and the reader of a
// sparse matrix reads two datasets in turn, so a few streams interleave.
const MAX_STREAMS = 8

export class RangeBlockCache {
  readonly size: number
  private readonly read: SyncRangeRead
  private readonly blockSize: number
  private readonly firstFetchBlocks: number
  private readonly maxFetchBlocks: number
  private readonly budgetBytes: number
  // Insertion order is recency order: a read block is moved to the end.
  private readonly blocks = new Map<number, Uint8Array>()
  private readonly streams: ReadStream[] = []
  private cachedBytes = 0
  private requests = 0
  private fetchedBytes = 0

  constructor(size: number, read: SyncRangeRead, options: RangeBlockCacheOptions = {}) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError(`Range file size must be a non-negative integer, not ${size}.`)
    }

    this.size = size
    this.read = read
    this.blockSize = options.blockSize ?? RANGE_BLOCK_BYTES
    this.firstFetchBlocks = Math.max(
      1,
      Math.ceil((options.firstFetchBytes ?? RANGE_FIRST_FETCH_BYTES) / this.blockSize),
    )
    this.maxFetchBlocks = Math.max(
      this.firstFetchBlocks,
      Math.floor((options.maxFetchBytes ?? DEFAULT_MAX_FETCH_BYTES) / this.blockSize),
    )
    this.budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES

    if (options.head !== undefined) {
      this.store(0, options.head.subarray(0, Math.min(options.head.byteLength, size)))
    }
  }

  stats(): RangeBlockCacheStats {
    return { requests: this.requests, fetchedBytes: this.fetchedBytes }
  }

  // Copies the file from `position` into `target`, and returns how many bytes
  // it copied: fewer than asked only at the end of the file.
  readInto(target: Uint8Array, position: number): number {
    const length = Math.max(0, Math.min(target.byteLength, this.size - position))
    const end = position + length
    const lastNeeded = Math.floor((end - 1) / this.blockSize)
    let cursor = position

    while (cursor < end) {
      const block = Math.floor(cursor / this.blockSize)
      const cached = this.blocks.get(block)
      const start = block * this.blockSize
      let bytes: Uint8Array

      if (cached === undefined) {
        bytes = this.fetchFrom(block, lastNeeded)
      } else {
        this.touch(block, cached)
        bytes = cached
      }

      const to = Math.min(end, start + bytes.byteLength)
      target.set(bytes.subarray(cursor - start, to - start), cursor - position)
      cursor = to
    }

    return length
  }

  // Fetches the missing blocks from `block` that the current read needs, up to
  // its last block `lastNeeded`, and when they reach it, reads ahead by the
  // stream's fetch size. Returns the fetched bytes, which start at `block`.
  private fetchFrom(block: number, lastNeeded: number): Uint8Array {
    const lastBlock = Math.floor((this.size - 1) / this.blockSize)
    const stream = this.streamFor(block)
    let count = 1

    while (block + count <= lastNeeded && !this.blocks.has(block + count)) {
      count += 1
    }

    if (block + count > lastNeeded) {
      const limit = Math.min(block + Math.max(count, stream.blocks), lastBlock + 1)

      while (block + count < limit && !this.blocks.has(block + count)) {
        count += 1
      }
    }

    const start = block * this.blockSize
    const end = Math.min(this.size, (block + count) * this.blockSize)
    const bytes = this.read(start, end)

    if (bytes.byteLength !== end - start) {
      throw new Error(
        `A range read of bytes ${start}-${end - 1} returned ${bytes.byteLength} bytes.`,
      )
    }

    this.requests += 1
    this.fetchedBytes += bytes.byteLength
    stream.next = block + count

    // A read larger than the budget passes through uncached.
    if (bytes.byteLength <= this.budgetBytes) {
      this.store(start, bytes)
    }

    return bytes
  }

  // The stream a miss at `block` continues, with its next fetch size set. A
  // miss within one fetch of a stream's end continues it, so a scan that skips
  // a little still counts as sequential.
  private streamFor(block: number): ReadStream {
    const index = this.streams.findIndex(
      (stream) => block >= stream.next && block < stream.next + stream.blocks,
    )

    if (index >= 0) {
      const [stream] = this.streams.splice(index, 1) as [ReadStream]
      stream.blocks = Math.min(stream.blocks * 2, this.maxFetchBlocks)
      this.streams.push(stream)
      return stream
    }

    const stream = { next: block, blocks: this.firstFetchBlocks }
    this.streams.push(stream)

    if (this.streams.length > MAX_STREAMS) {
      this.streams.shift()
    }

    return stream
  }

  // Caches `bytes`, read from `start`, a copy per block so evicting a block
  // frees it.
  private store(start: number, bytes: Uint8Array): void {
    const firstBlock = Math.floor(start / this.blockSize)

    for (let offset = 0; offset < bytes.byteLength; offset += this.blockSize) {
      const block = firstBlock + offset / this.blockSize
      const previous = this.blocks.get(block)

      if (previous !== undefined) {
        this.cachedBytes -= previous.byteLength
        this.blocks.delete(block)
      }

      const copy = bytes.slice(offset, offset + this.blockSize)
      this.blocks.set(block, copy)
      this.cachedBytes += copy.byteLength
    }

    this.evict()
  }

  private touch(block: number, bytes: Uint8Array): void {
    this.blocks.delete(block)
    this.blocks.set(block, bytes)
  }

  private evict(): void {
    for (const [block, bytes] of this.blocks) {
      if (this.cachedBytes <= this.budgetBytes) {
        return
      }

      this.blocks.delete(block)
      this.cachedBytes -= bytes.byteLength
    }
  }
}
