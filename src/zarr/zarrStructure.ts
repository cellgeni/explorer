import type * as zarr from 'zarrita'
import { abortable } from '../utils/abortable'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import { isIcechunkUrl } from './icechunkUrl'
import {
  createZarrFolderLister,
  type FolderListingKind,
  type ZarrFolderLister,
} from './zarrFolderLister'
import {
  createZarrFetchStore,
  isZarrMetadataKey,
  readConsolidatedZarrMetadata,
} from './zarrStores'
import { isZarrZipUrl } from './zarrZipUrl'

// The groups and arrays of a Zarr store, for browsing its structure. Where
// the list comes from depends on the store:
// - consolidated metadata (v2 `.zmetadata`, v3 `consolidated_metadata`)
//   lists every node;
// - a zip's directory lists every file, and its metadata files are read from
//   the zip;
// - an Icechunk snapshot lists every node;
// - otherwise the store is walked from its root. A host listing (S3
//   ListObjectsV2 or an index page) names each group's children; without one,
//   only the children that a group's attributes name are found (AnnData
//   encodings, OME-NGFF multiscales, labels, plates and wells,
//   bioformats2raw series, SpatialData's element groups).

export type ZarrStructureSource = 'consolidated' | 'zip' | 'icechunk' | 'walked'

// 'folder' is a directory that holds no Zarr metadata, such as a SpatialData
// `points.parquet` folder; 'file' is anything stored that is not Zarr
// metadata or an array's chunk.
export type ZarrStructureNodeKind = 'group' | 'array' | 'folder' | 'file'

export interface ZarrArraySummary {
  readonly shape: readonly number[]
  // Chunk shape, or the shard shape of a sharded array.
  readonly chunks: readonly number[]
  // The chunk shape inside each shard.
  readonly innerChunks?: readonly number[]
  readonly dtype: string
  readonly dimensionNames?: readonly (string | null)[]
  // Filters and compressor (v2) or codecs (v3), in order, as `name(key=value)`.
  readonly codecs: readonly string[]
  // The codecs inside each shard.
  readonly innerCodecs?: readonly string[]
  readonly fillValue: unknown
  // v2 memory order, C or F.
  readonly order?: string
  readonly chunkCount: number
  // Bytes once decoded, when the data type has a fixed size.
  readonly decodedBytes?: number
}

export interface ZarrStructureNode {
  // Relative to the store root, without a leading '/'; '' is the root.
  readonly path: string
  readonly name: string
  readonly kind: ZarrStructureNodeKind
  readonly attributes: Readonly<Record<string, unknown>>
  // The `.zarray` / `.zgroup` or `zarr.json` document, without attributes.
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly array?: ZarrArraySummary
  readonly children: readonly ZarrStructureNode[]
  // A group known only from the paths below it.
  readonly implicit?: boolean
  // A group whose children could not all be listed.
  readonly unlisted?: boolean
  // A file's size; for an array in a zip, its chunk files' total.
  readonly storedBytes?: number
  // Chunk files stored, for an array in a zip.
  readonly storedChunks?: number
}

export interface ZarrStructure {
  // The store root the structure was read from.
  readonly url: string
  readonly source: ZarrStructureSource
  readonly zarrFormat: 2 | 3 | null
  // The host listing a walk used, if any.
  readonly listing: FolderListingKind | null
  readonly root: ZarrStructureNode
  readonly groupCount: number
  readonly arrayCount: number
  readonly fileCount: number
  // The walk or the zip's files went past the node limit.
  readonly truncated: boolean
  // What the root's attributes say the store is, as `AnnData 0.1.0`.
  readonly conventions: readonly string[]
  readonly zip?: {
    readonly fileCount: number
    // Folder inside the zip that holds the store, or ''.
    readonly root: string
    readonly bytes: number
  }
}

export interface ReadZarrStructureOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  // Nodes read so far, while a walk or a zip's metadata reads are under way.
  readonly onProgress?: (nodesRead: number) => void
  readonly maxNodes?: number
}

export class ZarrStructureNotFoundError extends Error {
  readonly url: string

  constructor(url: string) {
    super(
      `No Zarr metadata was found at ${url}: none of zarr.json, .zgroup, .zarray, or .zattrs could be read.`,
    )
    this.name = 'ZarrStructureNotFoundError'
    this.url = url
  }
}

export const DEFAULT_MAX_STRUCTURE_NODES = 5_000
const METADATA_FETCH_CONCURRENCY = 16
const METADATA_FILE_NAMES = new Set(['zarr.json', '.zarray', '.zgroup', '.zattrs'])
// Consolidated metadata and macOS zip folders are not part of the hierarchy.
const IGNORED_FILE_NAMES = new Set(['.zmetadata', 'zmetadata', '.DS_Store'])
const STORE_METADATA_FILE = /\/(?:zarr\.json|\.zattrs|\.zgroup|\.zarray|\.?zmetadata)$/i
// obsm keys looked for by name when nothing lists them.
const WELL_KNOWN_OBSM_KEYS = ['spatial', 'X_spatial', 'X_umap', 'X_tsne', 'X_pca']
const ANNDATA_ROOT_KEYS = [
  'X',
  'layers',
  'obs',
  'obsm',
  'obsp',
  'raw',
  'uns',
  'var',
  'varm',
  'varp',
]
const SPATIALDATA_ELEMENT_KINDS = ['images', 'labels', 'points', 'shapes', 'tables']

// The URL with the hash and any trailing metadata file name or '/' removed,
// as the store's root.
export function zarrStoreRootUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(STORE_METADATA_FILE, '')
  return parsed.toString()
}

export async function readZarrStructure(
  url: string,
  options: ReadZarrStructureOptions = {},
): Promise<ZarrStructure> {
  const rootUrl = zarrStoreRootUrl(url)

  if (isZarrZipUrl(rootUrl)) {
    return readZipStructure(rootUrl, options)
  }

  if (isIcechunkUrl(rootUrl)) {
    return readIcechunkStructure(rootUrl, options)
  }

  return readHttpStructure(rootUrl, options)
}

// Flat records, assembled into the tree once every node is known.
interface FlatNode {
  readonly path: string
  readonly kind: ZarrStructureNodeKind
  readonly zarrFormat?: 2 | 3
  readonly metadata?: Record<string, unknown>
  readonly attributes?: Record<string, unknown>
  readonly unlisted?: boolean
  readonly storedBytes?: number
  readonly storedChunks?: number
}

async function readIcechunkStructure(
  url: string,
  options: ReadZarrStructureOptions,
): Promise<ZarrStructure> {
  const { openIcechunkRepository } = await import('./icechunkStore')
  const repository = await openIcechunkRepository(url, {
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  return structureFromFlatNodes({
    url,
    source: 'icechunk',
    zarrFormat: 3,
    listing: null,
    flat: flatNodesFromMetadata(repository.metadata),
    truncated: false,
  })
}

async function readHttpStructure(
  url: string,
  options: ReadZarrStructureOptions,
): Promise<ZarrStructure> {
  const store = memoizedMetadataStore(
    createZarrFetchStore(
      url,
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    ),
  )
  const consolidated = await readConsolidatedZarrMetadata(
    store,
    options.signal === undefined ? {} : { signal: options.signal },
  )

  if (consolidated !== null) {
    return structureFromFlatNodes({
      url,
      source: 'consolidated',
      zarrFormat: consolidated.zarrFormat,
      listing: null,
      flat: flatNodesFromMetadata(consolidated.knownMetadata),
      truncated: false,
    })
  }

  const walk = await walkStore(url, store, options)

  return structureFromFlatNodes({
    url,
    source: 'walked',
    zarrFormat: walk.zarrFormat,
    listing: walk.listing,
    flat: walk.flat,
    truncated: walk.truncated,
  })
}

// The root metadata is asked for when looking for consolidated metadata, for
// the format, and when the walk starts; each key is fetched once.
function memoizedMetadataStore(base: zarr.FetchStore): Required<zarr.AsyncReadable> {
  const metadata = new Map<string, Promise<Uint8Array | undefined>>()

  return {
    get(key, options) {
      if (!isZarrMetadataKey(key)) {
        return base.get(key, options)
      }

      let pending = metadata.get(key)

      if (pending === undefined) {
        pending = base.get(key, options)
        metadata.set(key, pending)
        pending.catch(() => {
          metadata.delete(key)
        })
      }

      return pending
    },
    getRange(key, range, options) {
      return base.getRange(key, range, options)
    },
  }
}

async function readZipStructure(
  url: string,
  options: ReadZarrStructureOptions,
): Promise<ZarrStructure> {
  const { openZippedZarrStore } = await import('./zarrZipStore')
  const zip = await abortable(
    openZippedZarrStore(
      url,
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    ),
    options.signal,
  )
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_STRUCTURE_NODES
  const paths = zip.paths()
  const consolidated = await readConsolidatedZarrMetadata(
    zip.store,
    options.signal === undefined ? {} : { signal: options.signal },
  )
  const known = new Map<string, unknown>(consolidated?.knownMetadata ?? [])
  const unread = paths.filter(
    (path) => METADATA_FILE_NAMES.has(baseName(path)) && !known.has(`/${path}`),
  )
  // Reading the metadata of more nodes than are shown is wasted.
  const toRead = unread.slice(0, maxNodes * 2)
  let read = 0

  await mapWithConcurrency(toRead, METADATA_FETCH_CONCURRENCY, async (path) => {
    options.signal?.throwIfAborted()
    const json = await readJson(zip.store, `/${path}`, options.signal)

    if (json !== undefined) {
      known.set(`/${path}`, json)
    }

    read += 1
    options.onProgress?.(read)
  })

  const zarrNodes = flatNodesFromMetadata(known)
  const nodeKinds = new Map(zarrNodes.map((node) => [node.path, node.kind]))

  // Folders with a metadata file whose contents were not read, which may be
  // arrays: their files count towards them but are not listed.
  for (const path of unread.slice(toRead.length)) {
    const folder = parentPath(path)

    if (!nodeKinds.has(folder)) {
      nodeKinds.set(folder, 'folder')
    }
  }

  const stored = new Map<string, { bytes: number; chunks: number }>()
  const files: FlatNode[] = []
  let bytes = 0
  let truncated = toRead.length < unread.length

  for (const path of paths) {
    const size = zip.entry(path)?.size ?? 0
    bytes += size
    const name = baseName(path)

    if (METADATA_FILE_NAMES.has(name) || IGNORED_FILE_NAMES.has(name)) {
      continue
    }

    const owner = owningNode(path, nodeKinds)

    if (owner !== undefined && nodeKinds.get(owner) !== 'group') {
      const total = stored.get(owner) ?? { bytes: 0, chunks: 0 }
      total.bytes += size
      total.chunks += 1
      stored.set(owner, total)
      continue
    }

    if (files.length + zarrNodes.length >= maxNodes) {
      truncated = true
      continue
    }

    files.push({ path, kind: 'file', storedBytes: size })
  }

  const flat = zarrNodes.map((node) => {
    const total = stored.get(node.path)
    return total === undefined || node.kind !== 'array'
      ? node
      : { ...node, storedBytes: total.bytes, storedChunks: total.chunks }
  })

  return {
    ...structureFromFlatNodes({
      url,
      source: 'zip',
      zarrFormat: consolidated?.zarrFormat ?? formatOfNodes(zarrNodes),
      listing: null,
      flat: [...flat, ...files],
      truncated,
    }),
    zip: { fileCount: zip.fileCount, root: zip.root, bytes },
  }
}

// The deepest Zarr node folder that holds `path`, other than the path itself.
function owningNode(
  path: string,
  nodeKinds: ReadonlyMap<string, ZarrStructureNodeKind>,
): string | undefined {
  let folder = parentPath(path)

  for (;;) {
    if (nodeKinds.has(folder)) {
      return folder
    }

    if (folder === '') {
      return undefined
    }

    folder = parentPath(folder)
  }
}

function formatOfNodes(nodes: readonly FlatNode[]): 2 | 3 | null {
  return (
    nodes.find((node) => node.path === '')?.zarrFormat ?? nodes[0]?.zarrFormat ?? null
  )
}

// Nodes from metadata keyed by store key ('/obs/.zattrs', '/X/zarr.json'), as
// consolidated metadata and Icechunk snapshots give it.
function flatNodesFromMetadata(metadata: ReadonlyMap<string, unknown>): FlatNode[] {
  interface Draft {
    kind?: 'group' | 'array'
    zarrFormat?: 2 | 3
    metadata?: Record<string, unknown>
    attributes?: Record<string, unknown>
  }
  const drafts = new Map<string, Draft>()

  for (const [key, value] of metadata) {
    const document = recordOrNull(value)
    const fileName = baseName(key)

    if (document === null || !METADATA_FILE_NAMES.has(fileName)) {
      continue
    }

    const path = parentPath(key.replace(/^\/+/, ''))
    const draft = drafts.get(path) ?? {}
    drafts.set(path, draft)

    if (fileName === '.zattrs') {
      draft.attributes = document
      draft.zarrFormat ??= 2
    } else if (fileName === 'zarr.json') {
      const { attributes, ...rest } = document
      draft.kind = rest.node_type === 'array' ? 'array' : 'group'
      draft.zarrFormat = 3
      draft.metadata = rest
      draft.attributes = recordOrNull(attributes) ?? {}
    } else {
      draft.kind = fileName === '.zarray' ? 'array' : 'group'
      draft.zarrFormat = 2
      draft.metadata = document
    }
  }

  return Array.from(drafts, ([path, draft]) => ({
    path,
    // A folder with attributes and no .zgroup is still a group.
    kind: draft.kind ?? 'group',
    ...(draft.zarrFormat === undefined ? {} : { zarrFormat: draft.zarrFormat }),
    ...(draft.metadata === undefined ? {} : { metadata: draft.metadata }),
    ...(draft.attributes === undefined ? {} : { attributes: draft.attributes }),
  }))
}

interface WalkResult {
  readonly zarrFormat: 2 | 3
  readonly listing: FolderListingKind | null
  readonly flat: FlatNode[]
  readonly truncated: boolean
}

interface WalkItem {
  readonly path: string
  // Set when the parent's encoding fixes it, as for a categorical's codes.
  readonly kind?: 'group' | 'array'
  // A folder a listing showed, which may hold no Zarr metadata.
  readonly listed?: boolean
}

interface WalkContext {
  readonly store: Required<zarr.AsyncReadable>
  readonly zarrFormat: 2 | 3
  readonly lister: ZarrFolderLister
  readonly signal: AbortSignal | undefined
}

// Reads the root, then each level's nodes at once, until no group names more
// children or the node limit is reached.
async function walkStore(
  url: string,
  store: Required<zarr.AsyncReadable>,
  options: ReadZarrStructureOptions,
): Promise<WalkResult> {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_STRUCTURE_NODES
  const zarrFormat = await rootFormat(url, store, options.signal)
  const context: WalkContext = {
    store,
    zarrFormat,
    lister: createZarrFolderLister(url, options.fetcher),
    signal: options.signal,
  }
  const flat: FlatNode[] = []
  const seen = new Set<string>([''])
  let level: readonly WalkItem[] = [{ path: '' }]
  let truncated = false
  let read = 0

  while (level.length > 0) {
    options.signal?.throwIfAborted()
    const results = await mapWithConcurrency(
      level,
      METADATA_FETCH_CONCURRENCY,
      async (item) => {
        const result = await walkNode(context, item)
        read += 1
        options.onProgress?.(read)
        return result
      },
    )
    const next: WalkItem[] = []

    for (const result of results) {
      if (result === null) {
        continue
      }

      flat.push(result.node, ...result.files)

      for (const child of result.children) {
        if (!seen.has(child.path)) {
          seen.add(child.path)
          next.push(child)
        }
      }
    }

    const room = maxNodes - flat.length

    if (next.length > room) {
      truncated = true
    }

    level = next.slice(0, Math.max(0, room))
  }

  return { zarrFormat, listing: context.lister.kind(), flat, truncated }
}

async function rootFormat(
  url: string,
  store: zarr.AsyncReadable,
  signal: AbortSignal | undefined,
): Promise<2 | 3> {
  const [v3, ...v2] = await Promise.all(
    ['/zarr.json', '/.zgroup', '/.zarray', '/.zattrs'].map((key) =>
      readJson(store, key, signal),
    ),
  )
  const nodeType = recordOrNull(v3)?.node_type

  if (nodeType === 'group' || nodeType === 'array') {
    return 3
  }

  if (v2.some((document) => recordOrNull(document) !== null)) {
    return 2
  }

  throw new ZarrStructureNotFoundError(url)
}

interface WalkedNode {
  readonly node: FlatNode
  // Files a listing showed beside the node's metadata.
  readonly files: readonly FlatNode[]
  readonly children: readonly WalkItem[]
}

async function walkNode(
  context: WalkContext,
  item: WalkItem,
): Promise<WalkedNode | null> {
  const read =
    context.zarrFormat === 3
      ? await readV3Node(context, item)
      : await readV2Node(context, item)

  if (read === null && item.listed !== true) {
    return null
  }

  const node: FlatNode = read ?? { path: item.path, kind: 'folder' }

  if (node.kind === 'array') {
    return { node, files: [], children: [] }
  }

  const child = (name: string, kind?: 'group' | 'array'): WalkItem => ({
    path: joinPath(item.path, name),
    ...(kind === undefined ? {} : { kind }),
  })
  const listed = await context.lister.list(item.path)

  if (listed !== null) {
    return {
      node,
      files: listed.files
        .filter(
          (file) =>
            !METADATA_FILE_NAMES.has(file.name) && !IGNORED_FILE_NAMES.has(file.name),
        )
        .map((file) => ({
          path: joinPath(item.path, file.name),
          kind: 'file' as const,
          ...(file.size === undefined ? {} : { storedBytes: file.size }),
        })),
      children: listed.folders.map((name) => ({ ...child(name), listed: true })),
    }
  }

  // Without a listing, a folder's contents are unknown.
  if (node.kind === 'folder') {
    return { node: { ...node, unlisted: true }, files: [], children: [] }
  }

  const named = await namedChildren(context, item.path, node.attributes ?? {})
  return {
    node: named.complete ? node : { ...node, unlisted: true },
    files: [],
    children: named.children.map((entry) => child(entry.name, entry.kind)),
  }
}

async function readV3Node(
  context: WalkContext,
  item: WalkItem,
): Promise<FlatNode | null> {
  const document = recordOrNull(
    await readJson(context.store, metadataKey(item.path, 'zarr.json'), context.signal),
  )
  const nodeType = document?.node_type

  if (document === null || (nodeType !== 'array' && nodeType !== 'group')) {
    return null
  }

  const { attributes, ...metadata } = document
  return {
    path: item.path,
    kind: nodeType,
    zarrFormat: 3,
    metadata,
    attributes: recordOrNull(attributes) ?? {},
  }
}

// `.zattrs` with `.zarray` and `.zgroup`, or with the one the parent fixes,
// all at once.
async function readV2Node(
  context: WalkContext,
  item: WalkItem,
): Promise<FlatNode | null> {
  const kinds: readonly ('array' | 'group')[] =
    item.kind === undefined ? ['array', 'group'] : [item.kind]
  const [attributes, ...documents] = await Promise.all([
    readJson(context.store, metadataKey(item.path, '.zattrs'), context.signal),
    ...kinds.map((kind) =>
      readJson(
        context.store,
        metadataKey(item.path, kind === 'array' ? '.zarray' : '.zgroup'),
        context.signal,
      ),
    ),
  ])
  const attrs = recordOrNull(attributes)
  const index = documents.findIndex((document) => recordOrNull(document) !== null)
  const metadata = recordOrNull(documents[index])
  const kind = kinds[index]

  if (metadata === null || kind === undefined) {
    // Attributes alone still make a group, as in stores written without
    // .zgroup files.
    return attrs === null || item.kind === 'array'
      ? null
      : { path: item.path, kind: 'group', zarrFormat: 2, attributes: attrs }
  }

  return {
    path: item.path,
    kind,
    zarrFormat: 2,
    metadata,
    ...(attrs === null ? {} : { attributes: attrs }),
  }
}

interface NamedChildren {
  readonly children: readonly {
    readonly name: string
    readonly kind?: 'group' | 'array'
  }[]
  // False when the group may hold children its attributes do not name.
  readonly complete: boolean
}

// The children a group's attributes name, following the conventions of the
// formats the viewer reads.
async function namedChildren(
  context: WalkContext,
  path: string,
  attrs: Readonly<Record<string, unknown>>,
): Promise<NamedChildren> {
  const ome = recordOrNull(attrs.ome) ?? attrs
  const names = (list: readonly string[], kind?: 'group' | 'array') =>
    list.map((name) => (kind === undefined ? { name } : { name, kind }))

  switch (attrs['encoding-type']) {
    case 'anndata':
      return { children: names(ANNDATA_ROOT_KEYS), complete: true }
    case 'raw':
      return { children: names(['X', 'var', 'varm']), complete: true }
    case 'dataframe':
      return { children: names(dataframeColumns(attrs)), complete: true }
    case 'categorical':
      return { children: names(['codes', 'categories'], 'array'), complete: true }
    case 'nullable-integer':
    case 'nullable-boolean':
    case 'nullable-string-array':
      return { children: names(['values', 'mask'], 'array'), complete: true }
    case 'csr_matrix':
    case 'csc_matrix':
      return {
        children: names(['data', 'indices', 'indptr'], 'array'),
        complete: true,
      }
    case 'dict':
      return {
        children: baseName(path) === 'obsm' ? names(WELL_KNOWN_OBSM_KEYS) : [],
        complete: false,
      }
  }

  const multiscales = Array.isArray(ome.multiscales) ? ome.multiscales : null

  if (multiscales !== null) {
    const datasets = multiscales.flatMap((entry) => {
      const list = recordOrNull(entry)?.datasets
      return Array.isArray(list)
        ? list.map((dataset) => recordOrNull(dataset)?.path).filter(isNonEmptyString)
        : []
    })
    return {
      children: [...names(unique(datasets), 'array'), { name: 'labels', kind: 'group' }],
      complete: true,
    }
  }

  if (Array.isArray(ome.labels)) {
    return { children: names(ome.labels.filter(isNonEmptyString)), complete: true }
  }

  const plate = recordOrNull(ome.plate)

  if (plate !== null) {
    const wells = Array.isArray(plate.wells) ? plate.wells : []
    return {
      children: names(
        unique(wells.map((well) => recordOrNull(well)?.path).filter(isNonEmptyString)),
      ),
      complete: true,
    }
  }

  const well = recordOrNull(ome.well)

  if (well !== null) {
    const images = Array.isArray(well.images) ? well.images : []
    return {
      children: names(
        unique(images.map((image) => recordOrNull(image)?.path).filter(isNonEmptyString)),
      ),
      complete: true,
    }
  }

  // bioformats2raw puts each image series at the root, listed in OME/.zattrs.
  if (attrs['bioformats2raw.layout'] !== undefined) {
    const series = await bioformatsSeries(context, path)
    return {
      children: names(['OME', ...(series ?? ['0'])], 'group'),
      complete: series !== null,
    }
  }

  // A SpatialData root holds one group per element kind; element names are
  // only in consolidated metadata or a listing.
  if (recordOrNull(attrs.spatialdata_attrs) !== null && path === '') {
    return { children: names(SPATIALDATA_ELEMENT_KINDS, 'group'), complete: true }
  }

  return { children: [], complete: false }
}

async function bioformatsSeries(
  context: WalkContext,
  path: string,
): Promise<string[] | null> {
  const omePath = joinPath(path, 'OME')
  const document = recordOrNull(
    context.zarrFormat === 3
      ? recordOrNull(
          await readJson(
            context.store,
            metadataKey(omePath, 'zarr.json'),
            context.signal,
          ),
        )?.attributes
      : await readJson(context.store, metadataKey(omePath, '.zattrs'), context.signal),
  )
  const series = recordOrNull(document?.ome)?.series ?? document?.series
  return Array.isArray(series) ? series.filter(isNonEmptyString) : null
}

function dataframeColumns(attrs: Readonly<Record<string, unknown>>): string[] {
  const columns = Array.isArray(attrs['column-order']) ? attrs['column-order'] : []
  return unique([attrs._index, ...columns].filter(isNonEmptyString))
}

interface AssembleInput {
  readonly url: string
  readonly source: ZarrStructureSource
  readonly zarrFormat: 2 | 3 | null
  readonly listing: FolderListingKind | null
  readonly flat: readonly FlatNode[]
  readonly truncated: boolean
}

interface MutableNode {
  path: string
  kind: ZarrStructureNodeKind
  flat?: FlatNode
  implicit: boolean
  children: MutableNode[]
}

// Builds the tree, adding the folders between nodes that no metadata
// describes: groups when Zarr nodes sit below them, plain folders otherwise.
export function structureFromFlatNodes(input: AssembleInput): ZarrStructure {
  const nodes = new Map<string, MutableNode>()
  const ensure = (path: string, kind: ZarrStructureNodeKind): MutableNode => {
    const existing = nodes.get(path)

    if (existing !== undefined) {
      return existing
    }

    const created: MutableNode = { path, kind, implicit: true, children: [] }
    nodes.set(path, created)

    if (path !== '') {
      const parentKind = kind === 'group' || kind === 'array' ? 'group' : 'folder'
      ensure(parentPath(path), parentKind).children.push(created)
    }

    return created
  }
  const isZarr = (node: FlatNode) => node.kind === 'group' || node.kind === 'array'
  // Zarr nodes first, so the folders above them are made groups.
  const ordered = [...input.flat].sort(
    (left, right) => Number(isZarr(right)) - Number(isZarr(left)),
  )

  for (const flat of ordered) {
    const node = ensure(flat.path, isZarr(flat) ? 'group' : flat.kind)
    node.kind = flat.kind
    node.flat = flat
    node.implicit = false
  }

  const root = ensure('', 'group')
  let groupCount = 0
  let arrayCount = 0
  let fileCount = 0

  const freeze = (node: MutableNode): ZarrStructureNode => {
    const flat = node.flat

    if (node.kind === 'group') groupCount += 1
    if (node.kind === 'array') arrayCount += 1
    if (node.kind === 'file') fileCount += 1

    const array =
      node.kind === 'array' && flat?.metadata !== undefined
        ? summarizeZarrArray(flat.metadata)
        : undefined
    const children = node.children.sort(compareNodes).map(freeze)

    return {
      path: node.path,
      name: node.path === '' ? '/' : baseName(node.path),
      kind: node.kind,
      attributes: flat?.attributes ?? {},
      ...(flat?.metadata === undefined ? {} : { metadata: flat.metadata }),
      ...(array === undefined ? {} : { array }),
      children,
      ...(node.implicit && node.kind === 'group' ? { implicit: true } : {}),
      ...(flat?.unlisted === true ? { unlisted: true } : {}),
      ...(flat?.storedBytes === undefined ? {} : { storedBytes: flat.storedBytes }),
      ...(flat?.storedChunks === undefined ? {} : { storedChunks: flat.storedChunks }),
    }
  }

  const frozenRoot = freeze(root)

  return {
    url: input.url,
    source: input.source,
    zarrFormat: input.zarrFormat,
    listing: input.listing,
    root: frozenRoot,
    groupCount,
    arrayCount,
    fileCount,
    truncated: input.truncated,
    conventions: storeConventions(frozenRoot.attributes),
  }
}

const KIND_ORDER: Readonly<Record<ZarrStructureNodeKind, number>> = {
  group: 0,
  folder: 1,
  array: 2,
  file: 3,
}

function compareNodes(left: MutableNode, right: MutableNode): number {
  return (
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    baseName(left.path).localeCompare(baseName(right.path), undefined, {
      numeric: true,
    })
  )
}

// What the root's attributes say the store is.
export function storeConventions(
  attrs: Readonly<Record<string, unknown>>,
): readonly string[] {
  const conventions: string[] = []
  const ome = recordOrNull(attrs.ome)
  const spatialData = recordOrNull(attrs.spatialdata_attrs)

  if (spatialData !== null) {
    conventions.push(versioned('SpatialData', spatialData.version))
  }

  if (attrs['encoding-type'] === 'anndata') {
    conventions.push(versioned('AnnData', attrs['encoding-version']))
  }

  const multiscales = ome?.multiscales ?? attrs.multiscales

  if (Array.isArray(multiscales)) {
    conventions.push(
      versioned('OME-NGFF image', ome?.version ?? recordOrNull(multiscales[0])?.version),
    )
  }

  if (recordOrNull(ome?.plate ?? attrs.plate) !== null) {
    conventions.push(
      versioned('OME-NGFF plate', ome?.version ?? recordOrNull(attrs.plate)?.version),
    )
  }

  if (attrs['bioformats2raw.layout'] !== undefined) {
    conventions.push('bioformats2raw')
  }

  return conventions
}

function versioned(name: string, version: unknown): string {
  return typeof version === 'string' || typeof version === 'number'
    ? `${name} ${String(version)}`
    : name
}

// Shape, chunking, data type and codecs of a v2 `.zarray` or v3 `zarr.json`.
export function summarizeZarrArray(
  metadata: Readonly<Record<string, unknown>>,
): ZarrArraySummary {
  const shape = numberList(metadata.shape) ?? []
  const isV3 = metadata.zarr_format === 3
  const codecs = isV3 ? recordList(metadata.codecs) : []
  const sharding = codecs.find((codec) => codec.name === 'sharding_indexed')
  const shardingConfig = recordOrNull(sharding?.configuration)
  const chunks =
    numberList(
      isV3
        ? recordOrNull(recordOrNull(metadata.chunk_grid)?.configuration)?.chunk_shape
        : metadata.chunks,
    ) ?? shape
  const innerChunks = numberList(shardingConfig?.chunk_shape)
  const dtype = isV3 ? v3DataType(metadata.data_type) : v2DataType(metadata)
  const itemSize = isV3 ? v3ItemSize(metadata.data_type) : v2ItemSize(metadata.dtype)
  const elementCount = shape.reduce((product, size) => product * size, 1)
  const chunkCount = shape.reduce(
    (product, size, axis) =>
      product * Math.ceil(size / Math.max(1, chunks[axis] ?? size)),
    1,
  )
  const dimensionNames = Array.isArray(metadata.dimension_names)
    ? metadata.dimension_names.map((name) => (typeof name === 'string' ? name : null))
    : undefined

  return {
    shape,
    chunks,
    ...(innerChunks === null ? {} : { innerChunks }),
    dtype,
    ...(dimensionNames === undefined ? {} : { dimensionNames }),
    codecs: isV3
      ? codecs.map((codec) => codecLabel(codec, 'name'))
      : [
          ...recordList(metadata.filters).map((filter) => codecLabel(filter, 'id')),
          ...(recordOrNull(metadata.compressor) === null
            ? []
            : [codecLabel(recordOrNull(metadata.compressor) ?? {}, 'id')]),
        ],
    ...(sharding === undefined
      ? {}
      : {
          innerCodecs: recordList(shardingConfig?.codecs).map((codec) =>
            codecLabel(codec, 'name'),
          ),
        }),
    fillValue: metadata.fill_value ?? null,
    ...(typeof metadata.order === 'string' ? { order: metadata.order } : {}),
    chunkCount,
    ...(itemSize === undefined ? {} : { decodedBytes: elementCount * itemSize }),
  }
}

// `zstd(level=0)`, `blosc(cname=lz4, clevel=5)`: the codec's name and its
// scalar and list settings.
function codecLabel(
  codec: Readonly<Record<string, unknown>>,
  nameKey: 'id' | 'name',
): string {
  const name = typeof codec[nameKey] === 'string' ? codec[nameKey] : 'unknown'
  const settings = nameKey === 'name' ? (recordOrNull(codec.configuration) ?? {}) : codec
  const parts = Object.entries(settings).flatMap(([key, value]) => {
    if (key === nameKey || key === 'codecs' || key === 'index_codecs') return []
    if (typeof value === 'string' || typeof value === 'number') return [`${key}=${value}`]
    if (typeof value === 'boolean') return [`${key}=${String(value)}`]
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return [`${key}=[${value.join(', ')}]`]
    }
    return []
  })

  return parts.length === 0 ? name : `${name}(${parts.join(', ')})`
}

const V2_KINDS: Readonly<Record<string, string>> = {
  b: 'bool',
  i: 'int',
  u: 'uint',
  f: 'float',
  c: 'complex',
}

// NumPy type strings as their names: `<f4` is float32, `|O` with a vlen-utf8
// filter a variable-length string.
function v2DataType(metadata: Readonly<Record<string, unknown>>): string {
  const dtype = metadata.dtype

  if (typeof dtype !== 'string') {
    return Array.isArray(dtype) ? 'structured' : 'unknown'
  }

  const match = /^[<>|=]?([a-zA-Z])(\d*)(\[[^\]]+\])?$/.exec(dtype)

  if (match === null) {
    return dtype
  }

  const [, code = '', size = '', unit = ''] = match

  if (code === 'O') {
    const filters = recordList(metadata.filters).map((filter) => filter.id)
    return filters.includes('vlen-utf8')
      ? 'string (variable length)'
      : filters.includes('vlen-bytes')
        ? 'bytes (variable length)'
        : 'object'
  }

  if (code === 'b' && size === '1') return 'bool'
  if (code === 'U') return `string (${size} characters)`
  if (code === 'S') return `bytes (${size})`
  if (code === 'M') return `datetime64${unit}`
  if (code === 'm') return `timedelta64${unit}`

  const kind = V2_KINDS[code]
  return kind === undefined || size === '' ? dtype : `${kind}${Number(size) * 8}`
}

function v2ItemSize(dtype: unknown): number | undefined {
  if (typeof dtype !== 'string') {
    return undefined
  }

  const match = /^[<>|=]?([a-zA-Z])(\d+)/.exec(dtype)

  if (match === null || match[1] === 'O') {
    return undefined
  }

  // NumPy's U holds UTF-32 code points.
  return Number(match[2]) * (match[1] === 'U' ? 4 : 1)
}

function v3DataType(dataType: unknown): string {
  if (typeof dataType === 'string') {
    return dataType
  }

  const name = recordOrNull(dataType)?.name
  return typeof name === 'string' ? name : 'unknown'
}

const V3_ITEM_SIZES: Readonly<Record<string, number>> = {
  bool: 1,
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  float16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  int64: 8,
  uint64: 8,
  float64: 8,
  complex64: 8,
  complex128: 16,
}

function v3ItemSize(dataType: unknown): number | undefined {
  const name = v3DataType(dataType)
  const raw = /^r(\d+)$/.exec(name)
  return raw === null ? V3_ITEM_SIZES[name] : Number(raw[1]) / 8
}

async function readJson(
  store: zarr.AsyncReadable,
  key: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let bytes: Uint8Array | undefined

  try {
    bytes = await store.get(
      key as zarr.AbsolutePath,
      signal === undefined ? undefined : { signal },
    )
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }

    return undefined
  }

  if (bytes === undefined) {
    return undefined
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    // An HTML page served for a missing key is not metadata.
    return undefined
  }
}

function metadataKey(path: string, file: string): string {
  return path === '' ? `/${file}` : `/${path}/${file}`
}

function joinPath(path: string, name: string): string {
  return path === '' ? name : `${path}/${name}`
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function numberList(value: unknown): readonly number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
    ? (value as number[])
    : null
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((item) => recordOrNull(item)).filter((item) => item !== null)
    : []
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
