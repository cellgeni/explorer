import type { H5Structure } from '../../data/h5Structure'
import { isH5FileName } from '../../data/h5Structure'
import {
  H5T_CLASS,
  MAX_WHOLE_VLEN_PREVIEW_ELEMENTS,
  h5PreviewBlock,
  hasVariableLength,
  type H5DatasetInfo,
  type H5Dtype,
  type H5Filter,
  type H5StructureNode,
  type H5StructureNodeKind,
} from '../../data/h5StructureTypes'
import { formatBytes, formatCount, formatShape, nodeRole } from './storeStructureModel'

// Addresses whose structure Browse File can show as HDF5: by name.
export function isH5Url(value: string): boolean {
  try {
    return isH5FileName(new URL(value.trim()).pathname)
  } catch {
    return false
  }
}

export function sameH5File(a: string, b: string): boolean {
  return a === b
}

const KIND_LABELS: Readonly<Record<H5StructureNodeKind, string>> = {
  group: 'Group',
  dataset: 'Dataset',
  datatype: 'Datatype',
  'soft-link': 'Soft link',
  'external-link': 'External link',
}

export function h5KindLabel(node: H5StructureNode): string {
  return node.path === '' ? 'File' : KIND_LABELS[node.kind]
}

// The type in numpy's words where it has them: `float32`, `int64`, `bool`.
export function h5DtypeLabel(dtype: H5Dtype): string {
  switch (dtype.typeClass) {
    case H5T_CLASS.INTEGER:
      return integerLabel(dtype)
    case H5T_CLASS.FLOAT:
      return `float${dtype.size * 8}`
    case H5T_CLASS.STRING: {
      const encoding = dtype.cset === 1 ? 'UTF-8' : 'ASCII'
      return dtype.vlen
        ? `string (${encoding}, variable length)`
        : `string (${encoding}, ${formatCount(dtype.size, 'byte')})`
    }
    case H5T_CLASS.ENUM: {
      if (isBooleanEnum(dtype)) return 'bool'
      const names = (dtype.enumMembers ?? []).map(([name]) => name)
      return `enum ${integerLabel(dtype)} {${listLabel(names, 4)}}`
    }
    case H5T_CLASS.COMPOUND:
      return `compound {${listLabel(
        (dtype.members ?? []).map(
          (member) => `${member.name}: ${h5DtypeLabel(member.dtype)}`,
        ),
        4,
      )}}`
    case H5T_CLASS.REFERENCE:
      return dtype.refType === 'region' ? 'region reference' : 'object reference'
    case H5T_CLASS.VLEN:
      return `vlen<${dtype.base === undefined ? '?' : h5DtypeLabel(dtype.base)}>`
    case H5T_CLASS.ARRAY:
      return `${dtype.base === undefined ? '?' : h5DtypeLabel(dtype.base)}[${(dtype.arrayShape ?? []).join(' × ')}]`
    case H5T_CLASS.OPAQUE:
      return `opaque (${formatCount(dtype.size, 'byte')})`
    case H5T_CLASS.BITFIELD:
      return `bitfield${dtype.size * 8}`
    case H5T_CLASS.TIME:
      return 'time'
    default:
      return `type class ${dtype.typeClass}`
  }
}

function integerLabel(dtype: H5Dtype): string {
  return `${dtype.signed ? 'int' : 'uint'}${dtype.size * 8}`
}

// h5py writes numpy booleans as an enum of FALSE and TRUE.
function isBooleanEnum(dtype: H5Dtype): boolean {
  const members = dtype.enumMembers ?? []
  return (
    members.length === 2 &&
    members.some(([name, value]) => name === 'FALSE' && value === 0) &&
    members.some(([name, value]) => name === 'TRUE' && value === 1)
  )
}

function listLabel(items: readonly string[], limit: number): string {
  return items.length > limit
    ? `${items.slice(0, limit).join(', ')}, … ${items.length - limit} more`
    : items.join(', ')
}

// For multi-byte numbers only.
export function h5ByteOrderLabel(dtype: H5Dtype): string | null {
  const numeric =
    dtype.typeClass === H5T_CLASS.INTEGER ||
    dtype.typeClass === H5T_CLASS.FLOAT ||
    dtype.typeClass === H5T_CLASS.BITFIELD ||
    dtype.typeClass === H5T_CLASS.ENUM

  if (!numeric || dtype.size <= 1) return null
  return dtype.littleEndian ? 'Little-endian' : 'Big-endian'
}

const FILTER_NAMES: Readonly<Record<number, string>> = {
  1: 'gzip',
  2: 'shuffle',
  3: 'Fletcher-32 checksum',
  4: 'szip',
  5: 'n-bit',
  6: 'scale-offset',
  32000: 'LZF',
  32001: 'Blosc',
  32004: 'LZ4',
  32008: 'bitshuffle',
  32015: 'Zstandard',
}

// Filters past these are HDF5 plugins, which this h5wasm build does not have.
const BUILT_IN_FILTER_MAX = 255

export function h5FilterLabel(filter: H5Filter): string {
  const name = FILTER_NAMES[filter.id] ?? (filter.name || `filter ${filter.id}`)

  if (filter.id === 1 && filter.values[0] !== undefined) {
    return `${name} (level ${filter.values[0]})`
  }

  return filter.id > BUILT_IN_FILTER_MAX ? `${name} (plugin ${filter.id})` : name
}

// The formats the file was written as, from its root.
export function h5Conventions(structure: H5Structure): readonly string[] {
  const { root } = structure
  const attrs = root.attributes
  const childNames = new Set(root.children.map((child) => child.name))
  const conventions: string[] = []

  if (attrs['encoding-type'] === 'anndata') {
    const version = attrs['encoding-version']
    conventions.push(
      typeof version === 'string' ? `AnnData (encoding ${version})` : 'AnnData',
    )
  } else if (childNames.has('obs') && childNames.has('var')) {
    conventions.push('AnnData (before encoding versions)')
  }

  const matrix = root.children.find((child) => child.name === 'matrix')

  if (matrix?.kind === 'group' && isTenXMatrix(matrix)) {
    const software = attrs.software_version
    conventions.push(
      typeof software === 'string'
        ? `10x feature-barcode matrix (${software})`
        : '10x feature-barcode matrix',
    )
  }

  if (
    matrix?.kind === 'dataset' &&
    childNames.has('row_attrs') &&
    childNames.has('col_attrs')
  ) {
    conventions.push('Loom')
  }

  return conventions
}

function isTenXMatrix(node: H5StructureNode): boolean {
  const names = new Set(node.children.map((child) => child.name))
  return names.has('barcodes') && names.has('indptr') && names.has('indices')
}

export function h5ContentsLabel(structure: H5Structure): string {
  const links = countKinds(structure.root, ['soft-link', 'external-link'])
  const datatypes = countKinds(structure.root, ['datatype'])

  return [
    formatCount(structure.groupCount, 'group'),
    formatCount(structure.datasetCount, 'dataset'),
    ...(datatypes === 0 ? [] : [formatCount(datatypes, 'datatype')]),
    ...(links === 0 ? [] : [formatCount(links, 'link')]),
  ].join(' · ')
}

function countKinds(
  node: H5StructureNode,
  kinds: readonly H5StructureNodeKind[],
): number {
  return node.children.reduce(
    (total, child) =>
      total + (kinds.includes(child.kind) ? 1 : 0) + countKinds(child, kinds),
    0,
  )
}

// Why the tree may be incomplete, and what it leaves out.
export function h5Notes(structure: H5Structure): readonly string[] {
  const notes: string[] = []

  if (structure.truncated) {
    const shown = structure.groupCount + structure.datasetCount + structure.otherCount
    notes.push(
      `Stopped after ${formatCount(shown, 'object')}; groups marked “not listed” hold more.`,
    )
  }

  if (countKinds(structure.root, ['external-link']) > 0) {
    notes.push('External links point into other files, which are not read.')
  }

  return notes
}

// What a node is in the format that wrote it.
export function h5NodeRole(node: H5StructureNode): string | null {
  const role = nodeRole(node)

  if (role !== null) return role

  // AnnData before 0.7 marked sparse matrices this way.
  const legacySparse = node.attributes.h5sparse_format

  if (legacySparse === 'csr') return 'CSR matrix'
  if (legacySparse === 'csc') return 'CSC matrix'

  if (node.kind === 'group' && node.name === 'matrix' && isTenXMatrix(node)) {
    return '10x matrix'
  }

  return null
}

// The short description beside a node's name.
export function h5NodeSummary(node: H5StructureNode): string {
  switch (node.kind) {
    case 'dataset': {
      const { dataset } = node
      if (dataset === undefined) return 'dataset'
      return `${h5DtypeLabel(dataset.dtype)} · ${
        dataset.shape === null ? 'no dataspace' : formatShape(dataset.shape)
      }`
    }
    case 'group':
      return node.children.length > 0
        ? formatCount(node.children.length, 'item')
        : node.unlisted === true || h5NodeRole(node) !== null
          ? ''
          : 'empty'
    case 'datatype':
      return node.dtype === undefined ? 'datatype' : h5DtypeLabel(node.dtype)
    case 'soft-link':
      return `→ ${node.link?.target ?? '?'}`
    case 'external-link':
      return `→ ${node.link?.file ?? '?'}:${node.link?.target ?? '?'}`
  }
}

export function h5ChunkCount(dataset: H5DatasetInfo): number | null {
  const { shape, chunks } = dataset
  if (shape === null || chunks === null) return null
  return shape.reduce(
    (product, size, dimension) =>
      product * Math.ceil(size / Math.max(1, chunks[dimension] ?? size)),
    1,
  )
}

// Decoded bytes, for types of fixed size.
export function h5DecodedBytes(dataset: H5DatasetInfo): number | null {
  if (dataset.shape === null || hasVariableLength(dataset.dtype)) return null
  return product(dataset.shape) * dataset.dtype.size
}

export function h5MaxShapeLabel(dataset: H5DatasetInfo): string | null {
  const { shape, maxShape } = dataset

  if (
    maxShape === null ||
    shape === null ||
    (maxShape.length === shape.length &&
      maxShape.every((size, dimension) => size === shape[dimension]))
  ) {
    return null
  }

  return maxShape.length === 0
    ? 'scalar'
    : maxShape
        .map((size) => (size === null ? 'unlimited' : size.toLocaleString()))
        .join(' × ')
}

// Values are read as soon as a dataset is selected when their read costs at
// most this; past it, on request.
export const AUTO_READ_VALUES_BYTES = 4_000_000

// An element of a variable-length type is stored as a global heap ID; the
// heap holding its data is read too.
const HEAP_ID_BYTES = 16

// About the most a preview reads from the file: the chunks it touches, or the
// span of a contiguous dataset from its first element to the block's last.
export function h5PreviewReadBound(dataset: H5DatasetInfo): number | null {
  const { shape, chunks, dtype } = dataset

  if (shape === null) return null

  const elementBytes = hasVariableLength(dtype) ? HEAP_ID_BYTES : dtype.size

  if (shape.length === 0) return elementBytes

  const block = h5PreviewBlock(shape)

  if (block.some((size) => size === 0)) return 0

  if (chunks !== null) {
    const touched = block.reduce(
      (count, size, dimension) =>
        count * Math.ceil(size / Math.max(1, chunks[dimension] ?? size)),
      1,
    )
    return touched * product(chunks) * elementBytes
  }

  let lastOffset = 0
  let stride = 1

  for (let dimension = shape.length - 1; dimension >= 0; dimension -= 1) {
    lastOffset += ((block[dimension] ?? 1) - 1) * stride
    stride *= shape[dimension] ?? 1
  }

  return (lastOffset + 1) * elementBytes
}

// Why a dataset's values cannot be shown, or null when they can.
export function h5PreviewUnavailable(dataset: H5DatasetInfo): string | null {
  if (dataset.shape === null) {
    return 'It has no dataspace, so it holds no values.'
  }

  const plugin = dataset.filters.find((filter) => filter.id > BUILT_IN_FILTER_MAX)

  if (plugin !== undefined) {
    return `Its values are compressed with ${h5FilterLabel(plugin)}, an HDF5 plugin the browser’s HDF5 library does not have.`
  }

  const { dtype } = dataset
  const plainStrings = dtype.typeClass === H5T_CLASS.STRING && dtype.vlen

  if (
    !plainStrings &&
    hasVariableLength(dtype) &&
    product(dataset.shape) > MAX_WHOLE_VLEN_PREVIEW_ELEMENTS
  ) {
    return 'Its elements have variable-length parts, which can only be read for the whole dataset, and it is too large for that.'
  }

  return null
}

const MAX_VALUE_CHARACTERS = 200

// A value as text for the preview table.
export function formatH5Value(value: unknown, dtype: H5Dtype): string {
  const text = valueText(value, dtype)
  return text.length > MAX_VALUE_CHARACTERS
    ? `${text.slice(0, MAX_VALUE_CHARACTERS)}…`
    : text
}

function valueText(value: unknown, dtype: H5Dtype): string {
  if (value === null || value === undefined) return ''

  if (dtype.typeClass === H5T_CLASS.ENUM && typeof value === 'number') {
    if (isBooleanEnum(dtype)) return value === 0 ? 'False' : 'True'
    const member = dtype.enumMembers?.find(([, memberValue]) => memberValue === value)
    return member === undefined ? String(value) : member[0]
  }

  if (dtype.typeClass === H5T_CLASS.REFERENCE) {
    return dtype.refType === 'region' ? 'region reference' : 'object reference'
  }

  if (dtype.typeClass === H5T_CLASS.COMPOUND && Array.isArray(value)) {
    const members = dtype.members ?? []
    return `{${value
      .map((member, index) => {
        const field = members[index]
        return field === undefined
          ? valueText(member, dtype)
          : `${field.name}: ${valueText(member, field.dtype)}`
      })
      .join(', ')}}`
  }

  if (Array.isArray(value)) {
    const base = dtype.base ?? dtype
    return `[${value.map((item) => valueText(item, base)).join(', ')}]`
  }

  if (typeof value === 'string') return value
  if (
    typeof value === 'number' &&
    dtype.typeClass === H5T_CLASS.FLOAT &&
    dtype.size === 4
  ) {
    return float32Text(value)
  }
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return JSON.stringify(value) ?? String(value)
}

// The shortest decimal that reads back as the same float32, as numpy prints
// it, rather than the float64 it was widened to.
function float32Text(value: number): string {
  if (!Number.isFinite(value)) return value.toString()

  for (let digits = 1; digits < 9; digits += 1) {
    const text = Number(value.toPrecision(digits))
    if (Math.fround(text) === value) return text.toString()
  }

  return value.toString()
}

// Groups opened at first: the root, and its child groups when the file is
// small enough to show them all.
export function initiallyExpandedH5(structure: H5Structure): ReadonlySet<string> {
  const expanded = new Set([''])

  if (structure.groupCount + structure.datasetCount + structure.otherCount <= 200) {
    for (const child of structure.root.children) {
      if (child.children.length > 0) expanded.add(child.path)
    }
  }

  return expanded
}

export function h5ReadCostLabel(structure: H5Structure): string | null {
  const { range } = structure
  if (range === null) return null
  return `${formatBytes(range.fetchedBytes)} in ${formatCount(range.requests, 'request')}`
}

function product(values: readonly number[]): number {
  return values.reduce((total, value) => total * value, 1)
}
