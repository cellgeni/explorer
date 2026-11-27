// A plain or typed array of numbers, as H5 and Zarr reads return them.
export type NumericArrayLike =
  | readonly number[]
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

// A reader of an array's values as numbers: 64-bit integers are converted,
// and an index past the end reads 0.
export function numericReader(values: NumericArrayLike): (index: number) => number {
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    return (index) => Number(values[index] ?? 0n)
  }

  const numbers = values as ArrayLike<number>
  return (index) => numbers[index] ?? 0
}
