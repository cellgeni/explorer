import { describe, expect, it, vi } from 'vitest'
import * as zarr from 'zarrita'
import { getWholeArray } from './zarrWholeArray'

const encoder = new TextEncoder()

// An uncompressed Zarr v2 array whose element i is `values[i]` in C order.
async function v2Array(options: {
  readonly shape: readonly number[]
  readonly chunks: readonly number[]
  readonly dtype: string
  readonly order?: 'C' | 'F'
  readonly encode: (shape: readonly number[], origin: readonly number[]) => Uint8Array
}) {
  const store = new Map<string, Uint8Array>([
    [
      '/.zarray',
      encoder.encode(
        JSON.stringify({
          zarr_format: 2,
          shape: options.shape,
          chunks: options.chunks,
          dtype: options.dtype,
          compressor: null,
          filters: null,
          fill_value: 0,
          order: options.order ?? 'C',
        }),
      ),
    ],
  ])
  const grid = options.shape.map((size, axis) =>
    Math.ceil(size / (options.chunks[axis] ?? 1)),
  )

  for (const coords of gridCoords(grid)) {
    const origin = coords.map((coord, axis) => coord * (options.chunks[axis] ?? 1))
    store.set(`/${coords.join('.')}`, options.encode(options.chunks, origin))
  }

  return zarr.open.v2(zarr.root(store), { kind: 'array' })
}

function gridCoords(grid: readonly number[]): number[][] {
  return grid.reduce<number[][]>(
    (all, size) =>
      all.flatMap((prefix) => Array.from({ length: size }, (_v, i) => [...prefix, i])),
    [[]],
  )
}

// Chunk bytes for a 2D array whose element (row, col) is row * 10 + col.
function uint32Chunk(order: 'C' | 'F', cols: number) {
  return (chunkShape: readonly number[], origin: readonly number[]) => {
    const [rows = 0, chunkCols = 0] = chunkShape
    const values = new Uint32Array(rows * chunkCols)

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < chunkCols; col += 1) {
        const value = ((origin[0] ?? 0) + row) * 10 + (origin[1] ?? 0) + col
        values[order === 'C' ? row * chunkCols + col : col * rows + row] =
          col + (origin[1] ?? 0) < cols ? value : 0
      }
    }

    return new Uint8Array(values.buffer)
  }
}

async function expectSameAsZarrita(array: zarr.Array<zarr.DataType, zarr.Readable>) {
  const expected = await zarr.get(
    array,
    array.shape.map(() => null),
  )
  const actual = await getWholeArray(array)

  expect(Array.from(actual.data as ArrayLike<unknown>)).toEqual(
    Array.from(expected.data as ArrayLike<unknown>),
  )
  expect(actual.shape).toEqual(expected.shape)
  expect(actual.stride).toEqual(expected.stride)
  return actual
}

describe('getWholeArray', () => {
  it('copies row chunks whole, including a partial last chunk', async () => {
    const array = await v2Array({
      shape: [5, 2],
      chunks: [2, 2],
      dtype: '<u4',
      encode: uint32Chunk('C', 2),
    })
    const actual = await expectSameAsZarrita(array)

    expect(actual.data).toBeInstanceOf(Uint32Array)
    expect(Array.from(actual.data as Uint32Array)).toEqual([
      0, 1, 10, 11, 20, 21, 30, 31, 40, 41,
    ])

    // Each of the three chunks is decoded once; zarrita's get is not used.
    const getChunk = vi.spyOn(array, 'getChunk')
    await getWholeArray(array)
    expect(getChunk).toHaveBeenCalledTimes(3)
  })

  it('reads 64-bit integers', async () => {
    const array = await v2Array({
      shape: [3, 1],
      chunks: [2, 1],
      dtype: '<i8',
      encode: (chunkShape, origin) =>
        new Uint8Array(
          BigInt64Array.from({ length: chunkShape[0] ?? 0 }, (_v, row) =>
            BigInt((origin[0] ?? 0) + row - 1),
          ).buffer,
        ),
    })

    const actual = await expectSameAsZarrita(array)
    expect(Array.from(actual.data as BigInt64Array)).toEqual([-1n, 0n, 1n])
  })

  it('leaves arrays chunked across columns or stored column-major to zarrita', async () => {
    await expectSameAsZarrita(
      await v2Array({
        shape: [3, 3],
        chunks: [2, 2],
        dtype: '<u4',
        encode: uint32Chunk('C', 3),
      }),
    )
    await expectSameAsZarrita(
      await v2Array({
        shape: [3, 2],
        chunks: [2, 2],
        dtype: '<u4',
        order: 'F',
        encode: uint32Chunk('F', 2),
      }),
    )
  })

  it('reads one-dimensional and boolean arrays', async () => {
    await expectSameAsZarrita(
      await v2Array({
        shape: [3],
        chunks: [2],
        dtype: '<u2',
        encode: (chunkShape, origin) =>
          new Uint8Array(
            Uint16Array.from(
              { length: chunkShape[0] ?? 0 },
              (_v, i) => (origin[0] ?? 0) + i,
            ).buffer,
          ),
      }),
    )
    await expectSameAsZarrita(
      await v2Array({
        shape: [2, 2],
        chunks: [1, 2],
        dtype: '|b1',
        encode: (_chunkShape, origin) => Uint8Array.from([1, origin[0] ?? 0]),
      }),
    )
  })
})
