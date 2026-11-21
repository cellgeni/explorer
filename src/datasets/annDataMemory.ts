// AnnData held in memory: what the MERSCOPE and Space Ranger readers build,
// and AnnDataH5adDataset reads as a `memorySource`.

import type { NumericArrayLike } from '../data/numericArray'

// An AnnData object held as plain arrays. `uns` values become scalar datasets
// (numbers, strings), arrays, or nested groups (records).
export interface AnnDataMemoryTable {
  readonly obsNames: readonly string[]
  readonly obs: readonly AnnDataMemoryColumn[]
  readonly varNames: readonly string[]
  readonly var?: readonly AnnDataMemoryColumn[]
  readonly X: {
    readonly kind: 'csr'
    readonly data: NumericArrayLike
    readonly indices: NumericArrayLike
    readonly indptr: NumericArrayLike
  }
  readonly obsm: Readonly<
    Record<string, { readonly values: NumericArrayLike; readonly columns: number }>
  >
  readonly uns?: AnnDataMemoryUns
}

export type AnnDataMemoryColumn =
  | {
      readonly name: string
      readonly kind: 'numeric'
      readonly values: NumericArrayLike
    }
  | {
      readonly name: string
      readonly kind: 'categorical'
      readonly codes: NumericArrayLike
      readonly categories: readonly string[]
    }
  | { readonly name: string; readonly kind: 'string'; readonly values: readonly string[] }

export interface AnnDataMemoryUns {
  readonly [key: string]: AnnDataMemoryUns | number | string | NumericArrayLike
}
