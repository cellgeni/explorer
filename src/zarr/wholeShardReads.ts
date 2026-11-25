import * as zarr from 'zarrita'
import { isShardedMetadata, zarrChunkKey, zarrStoredArrayMetadata } from './zarrStores'

type Selection = readonly (number | zarr.Slice)[]

// Reads a sharded Zarr v3 array a whole shard per request. zarrita reads a
// shard as a HEAD for its length, a range for its index and a range for each
// inner chunk: 12 requests for a shard of 10 planes, to a host that may take
// six at a time. A selection that takes every inner chunk of the shards it
// touches gets each shard in one GET instead, and zarrita reads the index and
// the inner chunks from those bytes.
export interface WholeShardReader {
  // Elements in a shard along each axis.
  readonly shardShape: readonly number[]
  // Whether the selection takes every element of each shard it touches that
  // lies inside the array.
  covers(selection: Selection): boolean
  // Reads a selection that `covers`.
  get(selection: Selection, signal?: AbortSignal): Promise<zarr.Chunk<zarr.DataType>>
}

// Null when the array is not sharded.
export async function openWholeShardReader(
  array: zarr.Array<zarr.DataType, zarr.Readable>,
): Promise<WholeShardReader | null> {
  const base = array.store
  const stored = await zarrStoredArrayMetadata(array)
  const metadata = stored?.metadataKey === 'zarr.json' ? stored.metadata : null
  const shardShape = metadata === null ? null : regularChunkShape(metadata)

  if (
    metadata === null ||
    shardShape === null ||
    shardShape.length !== array.shape.length ||
    !isShardedMetadata(metadata) ||
    base.getRange === undefined
  ) {
    return null
  }

  const getRange = base.getRange.bind(base)
  // Shards read whole, by store key, while the read that wanted them lasts;
  // a missing shard is undefined.
  const shards = new Map<string, Uint8Array | undefined>()
  const store: zarr.AsyncReadable = {
    get: async (key, options) => base.get(key, options),
    async getRange(key, range, options) {
      if (!shards.has(key)) {
        return getRange(key, range, options)
      }

      const bytes = shards.get(key)

      // Copies: zarrita reads a shard index as 64-bit integers, which need
      // an aligned buffer.
      return bytes === undefined
        ? undefined
        : 'suffixLength' in range
          ? bytes.slice(bytes.length - range.suffixLength)
          : bytes.slice(range.offset, range.offset + range.length)
    },
  }
  const shardArray = new zarr.Array(store, array.path, metadata as zarr.ArrayMetadata)
  const shape = array.shape

  return {
    shardShape,
    covers: (selection) => wholeShardCoords(selection, shape, shardShape) !== null,
    async get(selection, signal) {
      const coords = wholeShardCoords(selection, shape, shardShape)

      if (coords === null) {
        throw new Error('The selection leaves part of a shard unread.')
      }

      // Keys as zarrita resolves them from the array's location.
      const keys = coords.map(
        (shard) => shardArray.resolve(zarrChunkKey(metadata, shard)).path,
      )
      const options = signal === undefined ? undefined : { signal }
      const bytes = await Promise.all(keys.map((key) => base.get(key, options)))

      keys.forEach((key, index) => shards.set(key, bytes[index]))

      try {
        return await zarr.get(shardArray, [...selection], options ?? {})
      } finally {
        for (const key of keys) {
          shards.delete(key)
        }
      }
    },
  }
}

// The coordinates of the shards a selection touches, when it takes every
// element of each that lies inside the array; null when it leaves some
// unread.
function wholeShardCoords(
  selection: Selection,
  shape: readonly number[],
  shardShape: readonly number[],
): number[][] | null {
  if (selection.length !== shape.length) {
    return null
  }

  let coords: number[][] = [[]]

  for (let axis = 0; axis < shape.length; axis += 1) {
    const size = shape[axis] ?? 1
    const shardSize = shardShape[axis] ?? size
    const range = selectedRange(selection[axis], size)

    if (range === null || shardSize < 1) {
      return null
    }

    const [start, stop] = range
    const first = Math.floor(start / shardSize)
    const last = Math.floor((stop - 1) / shardSize)

    if (start !== first * shardSize || stop !== Math.min(size, (last + 1) * shardSize)) {
      return null
    }

    coords = coords.flatMap((prefix) =>
      Array.from({ length: last - first + 1 }, (_value, index) => [
        ...prefix,
        first + index,
      ]),
    )
  }

  return coords
}

// The elements [start, stop) that a step-1 selection takes on an axis; null
// for an empty selection or another step.
function selectedRange(
  index: number | zarr.Slice | undefined,
  size: number,
): readonly [number, number] | null {
  if (index === undefined) {
    return null
  }

  if (typeof index === 'number') {
    const position = index < 0 ? index + size : index
    return position >= 0 && position < size ? [position, position + 1] : null
  }

  if ((index.step ?? 1) !== 1) {
    return null
  }

  const start = clampedPosition(index.start ?? 0, size)
  const stop = clampedPosition(index.stop ?? size, size)
  return start < stop ? [start, stop] : null
}

function clampedPosition(position: number, size: number): number {
  return Math.min(size, Math.max(0, position < 0 ? position + size : position))
}

function regularChunkShape(metadata: Record<string, unknown>): readonly number[] | null {
  const grid = metadata.chunk_grid as
    | {
        readonly name?: unknown
        readonly configuration?: { readonly chunk_shape?: unknown }
      }
    | undefined
  const chunkShape = grid?.configuration?.chunk_shape

  return grid?.name === 'regular' &&
    Array.isArray(chunkShape) &&
    chunkShape.every((size) => typeof size === 'number')
    ? (chunkShape as number[])
    : null
}
