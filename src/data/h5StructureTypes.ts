// The structure of an HDF5 file (H5, H5AD, Loom), for browsing it: its groups,
// datasets, committed datatypes and links, with each one's attributes. The H5
// file worker walks the file (src/workers/h5StructureCore.ts); the structure
// drawer shows it. Plain data, so it can cross from the worker, and helpers
// both sides use.

// HDF5 datatype classes (H5T_class_t).
export const H5T_CLASS = {
  INTEGER: 0,
  FLOAT: 1,
  TIME: 2,
  STRING: 3,
  BITFIELD: 4,
  OPAQUE: 5,
  COMPOUND: 6,
  REFERENCE: 7,
  ENUM: 8,
  VLEN: 9,
  ARRAY: 10,
} as const

export interface H5Dtype {
  readonly typeClass: number
  // Bytes per element in memory; a variable-length string is a pointer.
  readonly size: number
  readonly signed: boolean
  readonly littleEndian: boolean
  readonly vlen: boolean
  // 0 for ASCII, 1 for UTF-8.
  readonly cset?: number
  readonly refType?: 'object' | 'region'
  readonly members?: readonly H5DtypeMember[]
  // Name and value, for an enumeration such as h5py's booleans.
  readonly enumMembers?: readonly (readonly [string, number])[]
  // The element type of a variable-length sequence or an array type.
  readonly base?: H5Dtype
  readonly arrayShape?: readonly number[]
}

export interface H5DtypeMember {
  readonly name: string
  readonly dtype: H5Dtype
}

export interface H5Filter {
  readonly id: number
  readonly name: string
  readonly values: readonly number[]
}

export interface H5DatasetInfo {
  // Null for a dataset with no dataspace; [] for a scalar.
  readonly shape: readonly number[] | null
  // Null entries are unlimited.
  readonly maxShape: readonly (number | null)[] | null
  // Null unless the dataset is chunked.
  readonly chunks: readonly number[] | null
  readonly dtype: H5Dtype
  readonly filters: readonly H5Filter[]
}

export type H5StructureNodeKind =
  | 'group'
  | 'dataset'
  | 'datatype'
  | 'soft-link'
  | 'external-link'

export interface H5SkippedAttribute {
  readonly name: string
  readonly reason: string
}

export interface H5StructureNode {
  // Names from the root joined with '/'; '' is the root.
  readonly path: string
  readonly name: string
  readonly kind: H5StructureNodeKind
  // Values as JSON, as h5wasm reads them.
  readonly attributes: Readonly<Record<string, unknown>>
  readonly skippedAttributes: readonly H5SkippedAttribute[]
  readonly dataset?: H5DatasetInfo
  // A committed datatype's type.
  readonly dtype?: H5Dtype
  // A soft link whose target is missing, or an external link. Soft links to
  // objects that exist are shown as those objects.
  readonly link?: { readonly target: string; readonly file?: string }
  // The walk stopped before listing this group's children.
  readonly unlisted?: boolean
  readonly children: readonly H5StructureNode[]
}

export interface H5StructureWalk {
  readonly root: H5StructureNode
  readonly groupCount: number
  readonly datasetCount: number
  // Links and committed datatypes.
  readonly otherCount: number
  // The walk stopped at its node limit or depth limit.
  readonly truncated: boolean
}

// The first values of a dataset: a block from its origin, at most
// `H5_PREVIEW_ROWS` along the first dimension, `H5_PREVIEW_COLUMNS` along the
// second, and 1 along any other.
export interface H5ValuePreview {
  // The block's shape; [] for a scalar.
  readonly shape: readonly number[]
  // Row-major. Compound elements are arrays of member values.
  readonly values: readonly unknown[]
}

export const H5_PREVIEW_ROWS = 100
export const H5_PREVIEW_COLUMNS = 20

// Datasets whose elements have variable-length parts other than plain strings
// are read whole for a preview, up to this many elements.
export const MAX_WHOLE_VLEN_PREVIEW_ELEMENTS = 10_000

// The block a preview reads, for a dataset of `shape`.
export function h5PreviewBlock(shape: readonly number[]): number[] {
  return shape.map((size, dimension) =>
    Math.min(
      size,
      dimension === 0 ? H5_PREVIEW_ROWS : dimension === 1 ? H5_PREVIEW_COLUMNS : 1,
    ),
  )
}

// A variable-length string, or a type holding one: h5wasm 0.10 frees these
// for the whole dataspace after a slice, which aborts its module.
export function hasVariableLength(dtype: H5Dtype): boolean {
  return (
    dtype.vlen ||
    dtype.typeClass === H5T_CLASS.VLEN ||
    (dtype.members?.some((member) => hasVariableLength(member.dtype)) ?? false) ||
    (dtype.base !== undefined && hasVariableLength(dtype.base))
  )
}
