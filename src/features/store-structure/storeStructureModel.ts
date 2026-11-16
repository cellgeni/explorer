import { isParquetFileName, type ParquetFileRef } from '../../data/parquetStructure'
import { isIcechunkUrl } from '../../zarr/icechunkUrl'
import { isOmeZarrImageUrl } from '../../zarr/omeZarrUrl'
import type { ZarrStructure, ZarrStructureNode } from '../../zarr/zarrStructure'
import { isZarrZipUrl } from '../../zarr/zarrZipUrl'

// Addresses whose structure Browse Store can show: a `.zarr` store or a group
// inside one, a Zarr metadata file, a zipped store, or an Icechunk
// repository. Other folders may be Zarr stores too, but only opening them
// would tell.
export function isZarrStoreUrl(value: string): boolean {
  const url = value.trim()

  try {
    const { pathname } = new URL(url)
    return (
      isZarrZipUrl(url) ||
      isIcechunkUrl(url) ||
      isOmeZarrImageUrl(url) ||
      /\/(?:\.zgroup|\.zarray|\.?zmetadata)$/i.test(pathname.replace(/\/+$/, ''))
    )
  } catch {
    return false
  }
}

export function formatShape(shape: readonly number[]): string {
  return shape.length === 0
    ? 'scalar'
    : shape.map((size) => size.toLocaleString()).join(' × ')
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0

  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }

  return `${unit === 0 ? value.toLocaleString() : value.toLocaleString(undefined, { maximumSignificantDigits: 3 })} ${BYTE_UNITS[unit] ?? 'B'}`
}

export function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : plural}`
}

// Where the list of nodes came from, for the summary.
export function structureSourceLabel(structure: ZarrStructure): string {
  switch (structure.source) {
    case 'consolidated':
      return 'Consolidated metadata'
    case 'zip':
      return 'Zip directory'
    case 'icechunk':
      return 'Icechunk snapshot (main)'
    case 'walked':
      return structure.listing === null
        ? 'Walked from the root'
        : `Walked from the root with the host's ${structure.listing}`
  }
}

export function structureFormatLabel(structure: ZarrStructure): string {
  return structure.zarrFormat === null ? 'Zarr' : `Zarr v${structure.zarrFormat}`
}

export function structureContentsLabel(structure: ZarrStructure): string {
  return [
    formatCount(structure.groupCount, 'group'),
    formatCount(structure.arrayCount, 'array'),
    ...(structure.fileCount === 0 ? [] : [formatCount(structure.fileCount, 'file')]),
  ].join(' · ')
}

// Why the tree may be incomplete, if it may be.
export function structureNotes(structure: ZarrStructure): readonly string[] {
  const notes: string[] = []

  if (structure.truncated) {
    const shown = structure.groupCount + structure.arrayCount + structure.fileCount
    notes.push(`Stopped after ${formatCount(shown, 'node')}; the store holds more.`)
  }

  if (hasUnlisted(structure.root)) {
    notes.push(
      structure.listing === null
        ? 'The store has no consolidated metadata and the host does not list folders, so groups marked “not listed” may hold more than is shown.'
        : 'Some folders could not be listed, so groups marked “not listed” may hold more than is shown.',
    )
  }

  return notes
}

function hasUnlisted(node: ZarrStructureNode): boolean {
  return node.unlisted === true || node.children.some(hasUnlisted)
}

const ENCODING_ROLES: Readonly<Record<string, string>> = {
  anndata: 'AnnData',
  raw: 'AnnData raw',
  dataframe: 'dataframe',
  dict: 'dict',
  categorical: 'categorical',
  csr_matrix: 'CSR matrix',
  csc_matrix: 'CSC matrix',
  'nullable-integer': 'nullable integer',
  'nullable-boolean': 'nullable boolean',
  'nullable-string-array': 'nullable string',
  'string-array': 'strings',
  'awkward-array': 'awkward array',
  'ngff:shapes': 'SpatialData shapes',
  'ngff:points': 'SpatialData points',
}

// What a node is in the format that wrote it, from its attributes: an AnnData
// encoding, an OME-NGFF image, a SpatialData element. Null for plain nodes.
export function nodeRole(node: ZarrStructureNode): string | null {
  const attrs = node.attributes
  const ome = recordOrNull(attrs.ome) ?? attrs
  const encoding = attrs['encoding-type']

  if (typeof encoding === 'string' && ENCODING_ROLES[encoding] !== undefined) {
    return ENCODING_ROLES[encoding]
  }

  if (Array.isArray(ome.multiscales)) {
    const levels = recordOrNull(ome.multiscales[0])?.datasets
    const kind = recordOrNull(ome['image-label']) === null ? 'image' : 'label image'
    return Array.isArray(levels)
      ? `${kind}, ${formatCount(levels.length, 'level')}`
      : kind
  }

  if (Array.isArray(ome.labels)) return 'labels'
  if (recordOrNull(ome.plate) !== null) return 'plate'
  if (recordOrNull(ome.well) !== null) return 'well'
  if (recordOrNull(attrs.spatialdata_attrs) !== null && node.path === '') {
    return 'SpatialData'
  }
  if (attrs['bioformats2raw.layout'] !== undefined) return 'bioformats2raw'

  return null
}

// The short description beside a node's name.
export function nodeSummary(node: ZarrStructureNode): string {
  switch (node.kind) {
    case 'array':
      return node.array === undefined
        ? 'array'
        : `${node.array.dtype} · ${formatShape(node.array.shape)}`
    case 'file':
      return node.storedBytes === undefined ? 'file' : formatBytes(node.storedBytes)
    case 'folder':
      return node.children.length === 0
        ? 'folder'
        : `folder · ${formatCount(node.children.length, 'item')}`
    case 'group':
      // A role or "not listed" badge says more than "empty".
      return node.children.length > 0
        ? formatCount(node.children.length, 'item')
        : node.unlisted === true || nodeRole(node) !== null
          ? ''
          : 'empty'
  }
}

const SPATIALDATA_PARQUET: Readonly<Record<string, string>> = {
  'ngff:shapes': 'shapes.parquet',
  'ngff:points': 'points.parquet',
}

// Where a SpatialData shapes or points element keeps its geometry, when the
// tree cannot show it: consolidated metadata and Icechunk list Zarr nodes
// only.
export function parquetNote(node: ZarrStructureNode): string | null {
  const encoding = node.attributes['encoding-type']
  const file = typeof encoding === 'string' ? SPATIALDATA_PARQUET[encoding] : undefined

  if (file === undefined || node.children.some((child) => child.name === file)) {
    return null
  }

  return `Its geometry is in ${file}, beside this group's metadata. That is not Zarr, so the store's metadata does not list it.`
}

// A node's address, for stores read over plain HTTP; zip and Icechunk nodes
// have none of their own.
export function nodeUrl(
  structure: ZarrStructure,
  node: ZarrStructureNode,
): string | null {
  if (structure.source === 'zip' || structure.source === 'icechunk') {
    return null
  }

  if (node.path === '') {
    return structure.url
  }

  const url = new URL(structure.url)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${node.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  return url.toString()
}

// The Parquet file a node is, or holds, for Browse File: a `.parquet` file
// in a zip or a listed folder, or the shapes.parquet of a SpatialData shapes
// element that the store's metadata does not list. Points are written as a
// folder of parts, which only a listing names.
export function parquetFileOf(
  structure: ZarrStructure,
  node: ZarrStructureNode,
): ParquetFileRef | null {
  if (node.kind === 'file' && isParquetFileName(node.name)) {
    if (structure.source === 'zip') return { url: structure.url, zipPath: node.path }
    const url = nodeUrl(structure, node)
    return url === null ? null : { url }
  }

  const url = nodeUrl(structure, node)

  if (
    url === null ||
    node.attributes['encoding-type'] !== 'ngff:shapes' ||
    node.children.some((child) => child.name === 'shapes.parquet')
  ) {
    return null
  }

  return { url: `${url}/shapes.parquet` }
}

// Groups opened at first: the root, and its child groups when the store is
// small enough to show them all.
export function initiallyExpanded(structure: ZarrStructure): ReadonlySet<string> {
  const expanded = new Set([''])

  if (structure.groupCount + structure.arrayCount + structure.fileCount <= 200) {
    for (const child of structure.root.children) {
      if (child.children.length > 0) expanded.add(child.path)
    }
  }

  return expanded
}

// JSON for display, cut at `limit` characters.
export function formatJson(
  value: unknown,
  limit = 20_000,
): {
  readonly text: string
  readonly cut: boolean
  readonly shown: number
  readonly length: number
} {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  return text.length > limit
    ? { text: `${text.slice(0, limit)}\n…`, cut: true, shown: limit, length: text.length }
    : { text, cut: false, shown: text.length, length: text.length }
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
