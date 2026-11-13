import * as zarr from 'zarrita'

type NumericChunkData =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

// Reads a whole array of one or more dimensions, as
// `zarr.get(array, [null, ...])` does. zarrita copies
// each chunk into the result one innermost row at a time, about 100 ns a row
// on the main thread: 150 ms for the Xenium matrix's [cells, 2] cell IDs.
// When every chunk spans all axes but the first, the result is the chunks'
// rows end to end, so each chunk is copied in one go instead.
export async function getWholeArray<D extends zarr.DataType, Store extends zarr.Readable>(
  array: zarr.Array<D, Store>,
): Promise<zarr.Chunk<D>> {
  const { shape, chunks } = array
  const zarritaCopy = () =>
    zarr.get(
      array,
      shape.map(() => null),
    )
  const rows = shape[0] ?? 0
  const chunkRows = chunks[0] ?? 0
  const spansTrailingAxes = chunks.every(
    (size, axis) => axis === 0 || size === shape[axis],
  )

  if (shape.length < 2 || rows === 0 || chunkRows <= 0 || !spansTrailingAxes) {
    return zarritaCopy()
  }

  const trailing = shape.slice(1)
  const rowSize = trailing.reduce((size, axis) => size * axis, 1)
  const decoded = await Promise.all(
    Array.from({ length: Math.ceil(rows / chunkRows) }, (_value, index) =>
      array.getChunk([index, ...trailing.map(() => 0)]),
    ),
  )
  const parts: NumericChunkData[] = []

  for (const chunk of decoded) {
    // Strings, booleans and column-major chunks take zarrita's own copy.
    if (!isNumericChunkData(chunk.data) || !isRowMajor(chunk.shape, chunk.stride)) {
      return zarritaCopy()
    }

    parts.push(chunk.data)
  }

  const data = emptyLike(parts[0] ?? new Uint8Array(0), rows * rowSize)
  const bytes = new Uint8Array(data.buffer)
  const rowBytes = rowSize * data.BYTES_PER_ELEMENT

  parts.forEach((part, index) => {
    const partRows = Math.min(chunkRows, rows - index * chunkRows)
    bytes.set(
      new Uint8Array(part.buffer, part.byteOffset, partRows * rowBytes),
      index * chunkRows * rowBytes,
    )
  })

  return {
    data: data as zarr.TypedArray<D>,
    shape: [...shape],
    stride: rowMajorStrides(shape),
  }
}

function isNumericChunkData(value: unknown): value is NumericChunkData {
  return (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  )
}

function emptyLike(source: NumericChunkData, length: number): NumericChunkData {
  if (source instanceof Int8Array) return new Int8Array(length)
  if (source instanceof Uint8Array) return new Uint8Array(length)
  if (source instanceof Int16Array) return new Int16Array(length)
  if (source instanceof Uint16Array) return new Uint16Array(length)
  if (source instanceof Int32Array) return new Int32Array(length)
  if (source instanceof Uint32Array) return new Uint32Array(length)
  if (source instanceof Float32Array) return new Float32Array(length)
  if (source instanceof Float64Array) return new Float64Array(length)
  if (source instanceof BigInt64Array) return new BigInt64Array(length)
  return new BigUint64Array(length)
}

function isRowMajor(shape: readonly number[], stride: readonly number[]): boolean {
  return rowMajorStrides(shape).every((value, axis) => stride[axis] === value)
}

function rowMajorStrides(shape: readonly number[]): number[] {
  const strides = new Array<number>(shape.length)
  let size = 1

  for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
    strides[axis] = size
    size *= shape[axis] ?? 1
  }

  return strides
}
