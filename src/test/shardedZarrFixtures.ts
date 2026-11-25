// A sharded Zarr v3 uint8 array as files under `arrayUrl`: its `zarr.json`
// and a shard file per shard, each holding its inner chunks in C order, then
// an index of each chunk's offset and length as little-endian 64-bit
// integers. Elements outside the array are 0, and `missingShard` leaves out
// the shards it picks.
export function shardedArrayFiles(options: {
  readonly arrayUrl: string
  readonly shape: readonly number[]
  readonly shardShape: readonly number[]
  readonly chunkShape: readonly number[]
  readonly dimensionNames: readonly string[]
  readonly value: (index: readonly number[]) => number
  readonly missingShard?: (shard: readonly number[]) => boolean
}): Map<string, Uint8Array> {
  const { arrayUrl, shape, shardShape, chunkShape } = options
  const files = new Map<string, Uint8Array>([
    [
      `${arrayUrl}/zarr.json`,
      new TextEncoder().encode(
        JSON.stringify({
          zarr_format: 3,
          node_type: 'array',
          shape,
          data_type: 'uint8',
          chunk_grid: { name: 'regular', configuration: { chunk_shape: shardShape } },
          chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
          codecs: [
            {
              name: 'sharding_indexed',
              configuration: {
                chunk_shape: chunkShape,
                codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
                index_codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
                index_location: 'end',
              },
            },
          ],
          fill_value: 0,
          dimension_names: options.dimensionNames,
        }),
      ),
    ],
  ])
  const shardGrid = shape.map((size, axis) =>
    Math.ceil(size / (shardShape[axis] ?? size)),
  )
  const innerGrid = shardShape.map((size, axis) => size / (chunkShape[axis] ?? size))

  for (const shard of indicesInOrder(shardGrid)) {
    if (options.missingShard?.(shard) === true) {
      continue
    }

    const chunks = indicesInOrder(innerGrid).map((inner) =>
      Uint8Array.from(indicesInOrder(chunkShape), (element) => {
        const index = element.map(
          (position, axis) =>
            (shard[axis] ?? 0) * (shardShape[axis] ?? 1) +
            (inner[axis] ?? 0) * (chunkShape[axis] ?? 1) +
            position,
        )

        return index.every((position, axis) => position < (shape[axis] ?? 0))
          ? options.value(index)
          : 0
      }),
    )
    files.set(`${arrayUrl}/c/${shard.join('/')}`, shardBytes(chunks))
  }

  return files
}

function shardBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const dataLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const bytes = new Uint8Array(dataLength + chunks.length * 16)
  const view = new DataView(bytes.buffer)
  let offset = 0

  chunks.forEach((chunk, index) => {
    bytes.set(chunk, offset)
    view.setBigUint64(dataLength + index * 16, BigInt(offset), true)
    view.setBigUint64(dataLength + index * 16 + 8, BigInt(chunk.length), true)
    offset += chunk.length
  })

  return bytes
}

// Every index of an array of this shape, in C order.
function indicesInOrder(shape: readonly number[]): number[][] {
  return shape.reduce<number[][]>(
    (indices, size) =>
      indices.flatMap((prefix) =>
        Array.from({ length: size }, (_value, position) => [...prefix, position]),
      ),
    [[]],
  )
}
