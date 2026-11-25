import * as zarr from 'zarrita'
import { describe, expect, it } from 'vitest'
import { shardedArrayFiles } from '../test/shardedZarrFixtures'
import { byteRangeFetcher, type ByteRangeRequest } from '../test/zipFixtures'
import { openWholeShardReader } from './wholeShardReads'
import { createZarrFetchStore } from './zarrStores'

const ROOT_URL = 'https://example.test/stack.zarr'
const ALL = zarr.slice(null)

// 5 × 3 × 4 voxels (z, y, x), each z * 16 + y * 4 + x, in shards two planes
// deep of 1 × 2 × 2 inner chunks.
async function openStack(
  options: { readonly missingShard?: (shard: readonly number[]) => boolean } = {},
) {
  const files = shardedArrayFiles({
    arrayUrl: `${ROOT_URL}/0`,
    shape: [5, 3, 4],
    shardShape: [2, 4, 4],
    chunkShape: [1, 2, 2],
    dimensionNames: ['z', 'y', 'x'],
    value: ([z = 0, y = 0, x = 0]) => z * 16 + y * 4 + x,
    ...(options.missingShard === undefined ? {} : { missingShard: options.missingShard }),
  })
  const requests: ByteRangeRequest[] = []
  const store = createZarrFetchStore(ROOT_URL, {
    fetcher: byteRangeFetcher(files, requests),
  })
  const array = await zarr.open.v3(zarr.root(store).resolve('0'), { kind: 'array' })

  return { array, requests }
}

// The voxels of planes [zStart, zEnd), with those of `missingPlanes` 0.
function stackVoxels(
  zStart: number,
  zEnd: number,
  missingPlanes: readonly number[] = [],
) {
  const voxels: number[] = []

  for (let z = zStart; z < zEnd; z += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        voxels.push(missingPlanes.includes(z) ? 0 : z * 16 + y * 4 + x)
      }
    }
  }

  return voxels
}

function shardRequests(requests: readonly ByteRangeRequest[]): string[] {
  return requests
    .filter((request) => request.url.includes('/0/c/'))
    .map((request) =>
      [request.method, request.url.slice(`${ROOT_URL}/0/`.length), request.range ?? '']
        .join(' ')
        .trim(),
    )
    .sort()
}

describe('whole-shard reads', () => {
  it('reads each shard a selection takes in one request', async () => {
    const { array, requests } = await openStack()
    const reader = await openWholeShardReader(array)
    const chunk = await reader?.get([zarr.slice(0, 4), ALL, ALL])

    expect(reader?.shardShape).toEqual([2, 4, 4])
    expect(chunk?.shape).toEqual([4, 3, 4])
    expect(Array.from(chunk?.data ?? [])).toEqual(stackVoxels(0, 4))
    expect(shardRequests(requests)).toEqual(['GET c/0/0/0', 'GET c/1/0/0'])
  })

  it('reads a missing shard as the fill value', async () => {
    const { array } = await openStack({ missingShard: ([z]) => z === 1 })
    const reader = await openWholeShardReader(array)
    const chunk = await reader?.get([zarr.slice(0, 5), ALL, ALL])

    expect(Array.from(chunk?.data ?? [])).toEqual(stackVoxels(0, 5, [2, 3]))
  })

  it('covers only selections that leave no part of a shard unread', async () => {
    const { array } = await openStack()
    const reader = await openWholeShardReader(array)

    // Whole shards, including the last, which the array cuts to one plane.
    expect(reader?.covers([zarr.slice(0, 2), ALL, ALL])).toBe(true)
    expect(reader?.covers([zarr.slice(2, null), zarr.slice(0, 3), ALL])).toBe(true)
    expect(reader?.covers([4, ALL, ALL])).toBe(true)
    expect(reader?.covers([zarr.slice(-1, null), ALL, ALL])).toBe(true)
    // Part of a shard along z, y or x, one plane of two, and a step.
    expect(reader?.covers([zarr.slice(1, 3), ALL, ALL])).toBe(false)
    expect(reader?.covers([zarr.slice(0, 2), zarr.slice(0, 2), ALL])).toBe(false)
    expect(reader?.covers([zarr.slice(0, 2), ALL, zarr.slice(1, null)])).toBe(false)
    expect(reader?.covers([0, ALL, ALL])).toBe(false)
    expect(reader?.covers([zarr.slice(0, 2, 2), ALL, ALL])).toBe(false)
    await expect(reader?.get([zarr.slice(1, 3), ALL, ALL])).rejects.toThrow(
      'part of a shard',
    )
  })

  it('opens no reader for an array that is not sharded', async () => {
    const files = new Map([
      [
        `${ROOT_URL}/0/zarr.json`,
        new TextEncoder().encode(
          JSON.stringify({
            zarr_format: 3,
            node_type: 'array',
            shape: [2, 2],
            data_type: 'uint8',
            chunk_grid: { name: 'regular', configuration: { chunk_shape: [1, 2] } },
            chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
            codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
            fill_value: 0,
          }),
        ),
      ],
    ])
    const store = createZarrFetchStore(ROOT_URL, { fetcher: byteRangeFetcher(files) })
    const array = await zarr.open.v3(zarr.root(store).resolve('0'), { kind: 'array' })

    await expect(openWholeShardReader(array)).resolves.toBeNull()
  })
})
