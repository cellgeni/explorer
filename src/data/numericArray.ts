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

export type NumericTypedArray = Exclude<NumericArrayLike, readonly number[]>

export function isNumericTypedArray(value: unknown): value is NumericTypedArray {
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

// A reader of an array's values as numbers: 64-bit integers are converted,
// and an index past the end reads 0.
export function numericReader(values: NumericArrayLike): (index: number) => number {
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    return (index) => Number(values[index] ?? 0n)
  }

  const numbers = values as ArrayLike<number>
  return (index) => numbers[index] ?? 0
}

// A column's values as a Float64Array: the array itself when it is one.
export function float64Column(values: NumericArrayLike): Float64Array {
  if (values instanceof Float64Array) {
    return values
  }

  const column = new Float64Array(values.length)

  // A loop rather than Float64Array.from(values, Number), which took twice as
  // long on the 460-plex's 64-bit integer columns.
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    for (let index = 0; index < values.length; index += 1) {
      column[index] = Number(values[index])
    }
  } else if (Array.isArray(values)) {
    values.forEach((value, index) => {
      column[index] = Number(value ?? 0)
    })
  } else {
    column.set(values as ArrayLike<number>)
  }

  return column
}

// An array's values as numbers, indexed directly: 64-bit integers converted
// once per array.
const plainNumbersByArray = new WeakMap<BigInt64Array | BigUint64Array, Float64Array>()

export function plainNumbers(values: NumericArrayLike): ArrayLike<number> {
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    let numbers = plainNumbersByArray.get(values)

    if (numbers === undefined) {
      numbers = float64Column(values)
      plainNumbersByArray.set(values, numbers)
    }

    return numbers
  }

  return values as ArrayLike<number>
}
