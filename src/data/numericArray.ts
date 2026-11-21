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
