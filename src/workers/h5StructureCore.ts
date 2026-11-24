import type { Metadata } from 'h5wasm'
import {
  H5T_CLASS,
  MAX_WHOLE_VLEN_PREVIEW_ELEMENTS,
  h5PreviewBlock,
  hasVariableLength,
  type H5DatasetInfo,
  type H5Dtype,
  type H5SkippedAttribute,
  type H5StructureNode,
  type H5StructureWalk,
  type H5ValuePreview,
} from '../data/h5StructureTypes'

// Browse File's walk of an HDF5 file and its first values of a dataset, run in
// the H5 file worker (src/workers/h5FileCore.ts).

type H5wasm = typeof import('h5wasm').default
type H5wasmFile = InstanceType<H5wasm['File']>
type H5wasmGroup = InstanceType<H5wasm['Group']>
type H5wasmDataset = InstanceType<H5wasm['Dataset']>
type H5Module = Awaited<H5wasm['ready']>

export const DEFAULT_MAX_H5_STRUCTURE_NODES = 5_000

// Deeper groups are left unlisted. Soft links to a group above them would
// otherwise be walked forever.
const MAX_H5_STRUCTURE_DEPTH = 32

// Attributes with more elements are named but not read.
const MAX_ATTRIBUTE_ELEMENTS = 10_000

// Reported at most this often during a walk.
const PROGRESS_INTERVAL_MS = 100

// Above this H5T_STD_UNLIMITED, which h5wasm returns as a number, is lost.
const UNLIMITED_DIMENSION = Number.MAX_SAFE_INTEGER

export interface H5StructureWalkOptions {
  readonly maxNodes?: number
  readonly onProgress?: (count: number) => void
  // Throws a failed range read, after which h5wasm's values are not to be
  // trusted.
  readonly check?: () => void
}

export function walkH5Structure(
  h5wasm: H5wasm,
  file: H5wasmFile,
  rootName: string,
  options: H5StructureWalkOptions = {},
): H5StructureWalk {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_H5_STRUCTURE_NODES
  const check = options.check ?? (() => undefined)
  let groupCount = 0
  let datasetCount = 0
  let otherCount = 0
  let truncated = false
  let reportedAt = 0
  const count = () => groupCount + datasetCount + otherCount

  const report = () => {
    if (options.onProgress === undefined) return
    const now = performance.now()
    if (now - reportedAt < PROGRESS_INTERVAL_MS) return
    reportedAt = now
    options.onProgress(count())
  }

  // A group's node, its children filled in as the walk reaches it. The walk
  // goes level by level, so a deep branch (or a loop of hard links, which
  // has no end) cannot spend the object budget before the root's other
  // children are listed.
  interface PendingGroup {
    readonly group: H5wasmGroup
    readonly path: string
    // Where the group is in the file: a soft link's target, not its path.
    readonly filePath: string
    readonly depth: number
    readonly node: { -readonly [Key in keyof H5StructureNode]: H5StructureNode[Key] }
    readonly children: H5StructureNode[]
  }
  const pending: PendingGroup[] = []

  const groupNode = (
    group: H5wasmGroup,
    path: string,
    filePath: string,
    name: string,
    depth: number,
  ): H5StructureNode => {
    groupCount += 1
    const attrs = readAttributes(group)
    check()
    const children: H5StructureNode[] = []
    const node = { path, name, kind: 'group' as const, ...attrs, children }
    pending.push({ group, path, filePath, depth, node, children })
    return node
  }

  const markUnlisted = (entry: PendingGroup) => {
    entry.node.unlisted = true
    truncated = true
  }

  const listChildren = (entry: PendingGroup) => {
    const { group, path, filePath, depth } = entry
    let names: readonly string[]

    try {
      names = group.keys()
    } catch {
      // HDF5 resolves at most 16 soft links in one path; past that, or in a
      // damaged file, a group cannot be listed.
      markUnlisted(entry)
      return
    }
    check()

    if (depth >= MAX_H5_STRUCTURE_DEPTH) {
      if (names.length > 0) markUnlisted(entry)
      return
    }

    for (const childName of names) {
      if (count() >= maxNodes) {
        markUnlisted(entry)
        break
      }

      const childPath = path === '' ? childName : `${path}/${childName}`
      const ownPath = filePath === '' ? childName : `${filePath}/${childName}`
      const target = safely(() => group.get_link(`/${ownPath}`))
      const childFilePath =
        typeof target === 'string' ? softLinkTargetPath(filePath, target) : ownPath

      // A soft link to this group or one above it would be walked again and
      // again, until HDF5 refuses the path.
      if (typeof target === 'string' && encloses(childFilePath, filePath)) {
        otherCount += 1
        entry.children.push({
          path: childPath,
          name: childName,
          kind: 'soft-link',
          attributes: {},
          skippedAttributes: [],
          link: { target, enclosing: true },
          children: [],
        })
        continue
      }

      const child = visitEntity(
        safely(() => group.get(childName)),
        childPath,
        childFilePath,
        childName,
        depth + 1,
      )
      check()

      if (child !== null) entry.children.push(child)
      report()
    }
  }

  const visitEntity = (
    entity: unknown,
    path: string,
    filePath: string,
    name: string,
    depth: number,
  ): H5StructureNode | null => {
    if (entity instanceof h5wasm.Group) {
      return groupNode(entity, path, filePath, name, depth)
    }
    if (entity instanceof h5wasm.Dataset) {
      datasetCount += 1
      const dataset = datasetInfo(entity)
      return {
        path,
        name,
        kind: 'dataset',
        ...readAttributes(entity),
        ...(dataset === null ? {} : { dataset }),
        children: [],
      }
    }

    if (entity instanceof h5wasm.Datatype) {
      otherCount += 1
      const dtype = safely(() => dtypeOf(entity.metadata))
      return {
        path,
        name,
        kind: 'datatype',
        ...readAttributes(entity),
        ...(dtype === null ? {} : { dtype }),
        children: [],
      }
    }

    if (isRecord(entity) && entity.type === 'BrokenSoftLink') {
      otherCount += 1
      return {
        path,
        name,
        kind: 'soft-link',
        attributes: {},
        skippedAttributes: [],
        link: { target: String(entity.target) },
        children: [],
      }
    }

    if (isRecord(entity) && entity.type === 'ExternalLink') {
      otherCount += 1
      return {
        path,
        name,
        kind: 'external-link',
        attributes: {},
        skippedAttributes: [],
        link: { target: String(entity.obj_path), file: String(entity.filename) },
        children: [],
      }
    }

    return null
  }

  const root = groupNode(file, '', '', rootName, 0)

  for (let index = 0; index < pending.length; index += 1) {
    listChildren(pending[index]!)
  }

  options.onProgress?.(count())
  return { root, groupCount, datasetCount, otherCount, truncated }
}

// Where a soft link points, as a path from the root without the leading
// slash: an absolute target, or one relative to the link's group.
function softLinkTargetPath(groupPath: string, target: string): string {
  const joined = target.startsWith('/') ? target : `${groupPath}/${target}`
  return joined
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/')
}

// Whether `outer` is `inner` or a group above it; '' is the root.
function encloses(outer: string, inner: string): boolean {
  return outer === '' || outer === inner || inner.startsWith(`${outer}/`)
}

function readAttributes(entity: { readonly attrs: unknown }): {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly skippedAttributes: readonly H5SkippedAttribute[]
} {
  const attributes: Record<string, unknown> = {}
  const skippedAttributes: H5SkippedAttribute[] = []
  let records: Record<string, { readonly metadata: Metadata; readonly value: unknown }>

  try {
    records = entity.attrs as typeof records
  } catch {
    return { attributes, skippedAttributes }
  }

  for (const [name, attribute] of Object.entries(records)) {
    try {
      const elements = attribute.metadata.total_size

      if (elements > MAX_ATTRIBUTE_ELEMENTS) {
        skippedAttributes.push({
          name,
          reason: `${elements.toLocaleString()} values, too many to show`,
        })
        continue
      }

      attributes[name] = attributeValue(attribute.value, attribute.metadata)
    } catch (error) {
      skippedAttributes.push({
        name,
        reason: error instanceof Error ? error.message : 'h5wasm could not read it',
      })
    }
  }

  return { attributes, skippedAttributes }
}

function datasetInfo(dataset: H5wasmDataset): H5DatasetInfo | null {
  const metadata = safely(() => dataset.metadata)

  if (metadata === null) {
    return null
  }

  return {
    shape: metadata.shape,
    maxShape:
      metadata.maxshape?.map((size) => (size >= UNLIMITED_DIMENSION ? null : size)) ??
      null,
    chunks: metadata.chunks,
    dtype: dtypeOf(metadata),
    filters: (safely(() => dataset.filters) ?? []).map((filter) => ({
      id: filter.id,
      name: filter.name,
      values: [...filter.cd_values],
    })),
  }
}

export function dtypeOf(metadata: Metadata): H5Dtype {
  const base = metadata.vlen_type ?? metadata.array_type

  return {
    typeClass: metadata.type,
    size: metadata.size,
    signed: metadata.signed,
    littleEndian: metadata.littleEndian,
    vlen: metadata.vlen,
    ...(metadata.cset === undefined ? {} : { cset: metadata.cset }),
    ...(metadata.ref_type === undefined ? {} : { refType: metadata.ref_type }),
    ...(metadata.compound_type === undefined
      ? {}
      : {
          members: metadata.compound_type.members.map((member) => ({
            name: member.name,
            dtype: dtypeOf(member),
          })),
        }),
    ...(metadata.enum_type === undefined
      ? {}
      : { enumMembers: Object.entries(metadata.enum_type.members) }),
    ...(base === undefined ? {} : { base: dtypeOf(base) }),
    ...(metadata.array_type?.shape == null
      ? {}
      : { arrayShape: metadata.array_type.shape }),
  }
}

export function previewH5Dataset(
  module: H5Module,
  dataset: H5wasmDataset,
  check: () => void = () => undefined,
): H5ValuePreview {
  const metadata = dataset.metadata
  check()
  const { shape } = metadata

  if (shape === null) {
    throw new Error('The dataset has no dataspace, so it holds no values.')
  }

  if (shape.length === 0) {
    const value = dataset.value
    check()
    return { shape: [], values: [plainValue(value)] }
  }

  const block = h5PreviewBlock(shape)
  const elements = block.reduce((product, size) => product * size, 1)

  if (elements === 0) {
    return { shape: block, values: [] }
  }

  const dtype = dtypeOf(metadata)

  if (
    dtype.typeClass === H5T_CLASS.STRING &&
    dtype.vlen &&
    (dtype.size === 4 || dtype.size === 8)
  ) {
    return { shape: block, values: readVariableStrings(module, dataset, metadata, block) }
  }

  if (hasVariableLength(dtype)) {
    if (metadata.total_size > MAX_WHOLE_VLEN_PREVIEW_ELEMENTS) {
      throw new Error(
        'Its values have variable-length parts, which can only be read for the whole dataset, and it is too large for that.',
      )
    }

    const whole = listOf(dataset.value)
    check()
    return { shape: block, values: blockOf(whole, shape, block) }
  }

  // h5wasm does not check H5Dread's status, so a read that fails (an external
  // storage file that is not there) would show whatever memory held.
  probeRead(module, dataset, metadata, block.length)
  const raw: unknown = dataset.slice(block.map((size) => [0, size]))
  check()
  return { shape: block, values: elementsOf(raw, metadata, block.length) }
}

// One value per element, as the values table takes them: h5wasm gives opaque
// and bitfield data as all their bytes, and nests an array type's elements by
// the dataset's whole shape.
function elementsOf(raw: unknown, metadata: Metadata, dimensions: number): unknown[] {
  if (raw instanceof Uint8Array && isByteType(metadata)) {
    return byteElements(raw, metadata.size)
  }

  if (metadata.type === H5T_CLASS.ARRAY && Array.isArray(raw) && dimensions > 1) {
    return raw.flat(dimensions - 1).map(plainValue)
  }

  return listOf(raw)
}

function isByteType(metadata: Metadata): boolean {
  return metadata.type === H5T_CLASS.OPAQUE || metadata.type === H5T_CLASS.BITFIELD
}

// Each element's bytes as h5dump writes them: "64:65:66".
function byteElements(bytes: Uint8Array, size: number): string[] {
  const elements: string[] = []

  for (let start = 0; start + size <= bytes.length; start += size) {
    elements.push(
      Array.from(bytes.subarray(start, start + size), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(':'),
    )
  }

  return elements
}

// Reads the first element through H5Dread and throws if HDF5 cannot.
function probeRead(
  module: H5Module,
  dataset: H5wasmDataset,
  metadata: Metadata,
  dimensions: number,
): void {
  const buffer = module._malloc(Math.max(1, metadata.size))

  if (buffer === 0) {
    throw new Error('h5wasm ran out of memory reading the dataset.')
  }

  try {
    const status = module.get_dataset_data(
      dataset.file_id,
      dataset.path,
      Array.from({ length: dimensions }, () => 1n),
      Array.from({ length: dimensions }, () => 0n),
      Array.from({ length: dimensions }, () => 1n),
      BigInt(buffer),
    )

    if (status < 0) {
      throw new Error(
        `HDF5 could not read ${dataset.path}. Its values may be stored in another file (external storage), which Browse File cannot reach.`,
      )
    }
  } finally {
    module._free(buffer)
  }
}

// An attribute's value for its JSON: nested by its shape, NaN and infinity
// kept, 64-bit integers past 2^53 kept exact (as bigint), opaque and bitfield
// bytes as h5dump writes them, and references named, not given as bytes.
function attributeValue(value: unknown, metadata: Metadata): unknown {
  if (metadata.type === H5T_CLASS.REFERENCE) {
    const name = metadata.ref_type === 'region' ? 'region reference' : 'object reference'
    return metadata.shape === null || metadata.shape.length === 0
      ? name
      : nestedByShape(
          Array.from({ length: metadata.total_size }, () => name),
          metadata.shape,
        )
  }

  const elements =
    value instanceof Uint8Array && isByteType(metadata)
      ? byteElements(value, metadata.size)
      : ArrayBuffer.isView(value) && !(value instanceof DataView)
        ? Array.from(value as unknown as ArrayLike<unknown>, attributeNumber)
        : null

  if (elements === null) {
    return Array.isArray(value) && metadata.shape !== null && metadata.shape.length > 1
      ? nestedByShape(value.map(plainValue), metadata.shape)
      : attributeNumber(plainValue(value))
  }

  if (metadata.shape === null || metadata.shape.length === 0) {
    return elements[0]
  }

  return nestedByShape(elements, metadata.shape)
}

// A 64-bit integer as a number when that is exact, else as a bigint.
function attributeNumber(value: unknown): unknown {
  return typeof value === 'bigint' &&
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value
}

function nestedByShape(values: readonly unknown[], shape: readonly number[]): unknown {
  if (shape.length <= 1) return [...values]
  const inner = shape.slice(1).reduce((product, size) => product * size, 1)
  return Array.from({ length: shape[0] ?? 0 }, (_, index) =>
    nestedByShape(values.slice(index * inner, (index + 1) * inner), shape.slice(1)),
  )
}

// The block's strings, read by hyperslab as h5wasm's slice does, without its
// reclaim of the whole dataspace. HDF5 allocated each string with malloc, so
// each is freed once decoded; left, a block of long strings stayed in the
// worker's heap on every read (100 strings of 1 MiB: about 115 MB a read).
function readVariableStrings(
  module: H5Module,
  dataset: H5wasmDataset,
  metadata: Metadata,
  block: readonly number[],
): string[] {
  const elements = block.reduce((product, size) => product * size, 1)
  const pointerBytes = metadata.size
  const pointers = module._malloc(elements * pointerBytes)

  if (pointers === 0) {
    throw new Error('h5wasm ran out of memory reading the dataset.')
  }

  try {
    const status = module.get_dataset_data(
      dataset.file_id,
      dataset.path,
      block.map((size) => BigInt(size)),
      block.map(() => 0n),
      block.map(() => 1n),
      BigInt(pointers),
    )

    if (status < 0) {
      throw new Error(`HDF5 could not read ${dataset.path}.`)
    }

    const view = new DataView(
      module.HEAPU8.buffer,
      module.HEAPU8.byteOffset + pointers,
      elements * pointerBytes,
    )
    const read = metadata.cset === 1 ? module.UTF8ToString : module.AsciiToString
    const stringPointers: number[] = []

    for (let index = 0; index < elements; index += 1) {
      stringPointers.push(
        pointerBytes === 8
          ? Number(view.getBigUint64(index * 8, true))
          : view.getUint32(index * 4, true),
      )
    }

    try {
      return stringPointers.map((pointer) => (pointer === 0 ? '' : read(pointer)))
    } finally {
      for (const pointer of stringPointers) {
        if (pointer !== 0) module._free(pointer)
      }
    }
  } finally {
    module._free(pointers)
  }
}

// The block at the origin of a row-major list of `shape`.
function blockOf(
  values: readonly unknown[],
  shape: readonly number[],
  block: readonly number[],
): unknown[] {
  const strides = shape.map((_, dimension) =>
    shape.slice(dimension + 1).reduce((product, size) => product * size, 1),
  )
  const out: unknown[] = []
  const index = block.map(() => 0)
  const total = block.reduce((product, size) => product * size, 1)

  for (let count = 0; count < total; count += 1) {
    out.push(
      values[
        index.reduce(
          (offset, at, dimension) => offset + at * (strides[dimension] ?? 0),
          0,
        )
      ],
    )

    for (let dimension = block.length - 1; dimension >= 0; dimension -= 1) {
      index[dimension] = (index[dimension] ?? 0) + 1
      if ((index[dimension] ?? 0) < (block[dimension] ?? 0)) break
      index[dimension] = 0
    }
  }

  return out
}

function listOf(value: unknown): unknown[] {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<unknown>)
  }

  return Array.isArray(value) ? value.map(plainValue) : [plainValue(value)]
}

// Typed arrays inside compound or array elements become lists; references
// keep only their bytes.
function plainValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<unknown>)
  }

  if (Array.isArray(value)) {
    return value.map(plainValue)
  }

  if (isRecord(value) && value.ref_data instanceof Uint8Array) {
    return { reference: Array.from(value.ref_data) }
  }

  return value
}

function safely<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
