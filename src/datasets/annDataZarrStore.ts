import type * as zarr from 'zarrita'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import {
  createZarrFolderLister,
  type FolderListingKind,
  type ZarrFolderLister,
} from '../zarr/zarrFolderLister'
import {
  consolidatedZarrStore,
  createZarrFetchStore,
  isZarrMetadataKey,
  readConsolidatedZarrMetadata,
  type ConsolidatedZarrStore,
} from '../zarr/zarrStores'

// An AnnData store as `adata.write_zarr` writes it, read over HTTP. Zarr has
// no listing of its own, so its groups and arrays come from consolidated
// metadata or, for stores written without it, from walking the groups the
// viewer reads. AnnData names the children of dataframes, categoricals,
// nullable arrays, and sparse matrices in their attributes; the children of
// obsm and uns/spatial come from the host's listing (S3 ListObjectsV2 or an
// index page) or, without one, from well-known obsm names.

export interface OpenedAnnDataZarrStore {
  readonly store: ConsolidatedZarrStore
  readonly zarrFormat: 2 | 3
  // Where the list of groups and arrays came from.
  readonly metadata: 'consolidated' | 'walked'
  // The listing that named the obsm and uns/spatial children of a walked
  // store; null when the host has none and obsm was probed by name.
  readonly listing: FolderListingKind | null
}

export interface OpenAnnDataZarrStoreOptions {
  readonly fetcher?: typeof fetch
  // obsm keys probed by name when the host has no listing.
  readonly obsmKeys?: readonly string[]
}

type NodeKind = 'array' | 'group'

interface WalkNode {
  readonly path: string
  // Set when the parent's encoding fixes it, as for a categorical's codes.
  readonly kind?: NodeKind
}

interface ReadNode {
  readonly path: string
  readonly kind: NodeKind
  readonly attrs: Readonly<Record<string, unknown>>
}

// The root groups the viewer reads; a walk leaves out layers, raw, and the
// pairwise matrices.
const WALKED_ROOT_CHILDREN = ['X', 'obs', 'var', 'obsm', 'uns'] as const
const METADATA_FETCH_CONCURRENCY = 16
// Compressed X chunks kept so switching genes does not refetch them.
const MATRIX_CHUNK_CACHE_MAX_BYTES = 256 * 1024 * 1024

const GROUP_ENCODINGS = new Set([
  'anndata',
  'raw',
  'dataframe',
  'dict',
  'categorical',
  'csr_matrix',
  'csc_matrix',
  'nullable-integer',
  'nullable-boolean',
  'nullable-string-array',
  'awkward-array',
])
const ARRAY_ENCODINGS = new Set(['array', 'string-array', 'numeric-scalar', 'string'])

export async function openAnnDataZarrStore(
  url: string,
  options: OpenAnnDataZarrStoreOptions = {},
): Promise<OpenedAnnDataZarrStore> {
  const base = memoizedMetadataStore(
    createZarrFetchStore(
      url,
      options.fetcher === undefined ? {} : { fetcher: options.fetcher },
    ),
  )
  const consolidated = await readConsolidatedZarrMetadata(base)

  if (consolidated !== null) {
    return {
      store: annDataZarrStore(base, consolidated.knownMetadata),
      zarrFormat: consolidated.zarrFormat,
      metadata: 'consolidated',
      listing: null,
    }
  }

  const zarrFormat = await rootZarrFormat(base, url)
  const lister = createZarrFolderLister(url, options.fetcher)
  const knownMetadata = await walkAnnDataStore(
    base,
    zarrFormat,
    lister,
    options.obsmKeys ?? [],
  )

  return {
    store: annDataZarrStore(base, knownMetadata),
    zarrFormat,
    metadata: 'walked',
    listing: lister.kind(),
  }
}

function annDataZarrStore(
  base: Required<zarr.AsyncReadable>,
  knownMetadata: ReadonlyMap<string, unknown>,
): ConsolidatedZarrStore {
  return consolidatedZarrStore(base, knownMetadata, {
    chunkCacheMaxBytes: MATRIX_CHUNK_CACHE_MAX_BYTES,
    cacheChunk: (key) => key.startsWith('/X/'),
  })
}

// Opening requests the root metadata more than once (consolidated metadata,
// format, root attributes); each key is fetched once.
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

async function rootZarrFormat(base: zarr.AsyncReadable, url: string): Promise<2 | 3> {
  const [v3, v2] = await Promise.all([
    readJson(base, '/zarr.json'),
    readJson(base, '/.zgroup'),
  ])

  if (recordOrNull(v3)?.node_type === 'group') {
    return 3
  }

  if (v2 !== undefined) {
    return 2
  }

  throw new Error(`No Zarr group was found at ${url} (no zarr.json or .zgroup).`)
}

// Reads the metadata of the groups the viewer uses, level by level, into the
// keys consolidated metadata would hold.
async function walkAnnDataStore(
  base: zarr.AsyncReadable,
  zarrFormat: 2 | 3,
  lister: ZarrFolderLister,
  obsmKeys: readonly string[],
): Promise<Map<string, unknown>> {
  const knownMetadata = new Map<string, unknown>()
  let level: readonly WalkNode[] = [{ path: '', kind: 'group' }]

  while (level.length > 0) {
    const children = await mapWithConcurrency(
      level,
      METADATA_FETCH_CONCURRENCY,
      async (node) => {
        const read =
          zarrFormat === 3
            ? await readV3Node(base, node, knownMetadata)
            : await readV2Node(base, node, knownMetadata)

        return read === null ? [] : walkedChildren(read, lister, obsmKeys)
      },
    )
    level = children.flat()
  }

  return knownMetadata
}

async function readV3Node(
  base: zarr.AsyncReadable,
  node: WalkNode,
  knownMetadata: Map<string, unknown>,
): Promise<ReadNode | null> {
  const key = metadataKey(node.path, 'zarr.json')
  const metadata = recordOrNull(await readJson(base, key))
  const kind = metadata?.node_type

  if (
    metadata === null ||
    (kind !== 'array' && kind !== 'group') ||
    (node.kind !== undefined && kind !== node.kind)
  ) {
    return null
  }

  knownMetadata.set(key, metadata)
  return { path: node.path, kind, attrs: recordOrNull(metadata.attributes) ?? {} }
}

// A node's AnnData encoding in .zattrs names its kind, so only .zarray or
// .zgroup is requested, not both. A kind the parent fixes is requested
// alongside .zattrs.
async function readV2Node(
  base: zarr.AsyncReadable,
  node: WalkNode,
  knownMetadata: Map<string, unknown>,
): Promise<ReadNode | null> {
  const attrsKey = metadataKey(node.path, '.zattrs')
  const fixed =
    node.kind === undefined
      ? undefined
      : readJson(base, v2MetadataKey(node.path, node.kind))
  const attrs = recordOrNull(await readJson(base, attrsKey))
  const encodedKind = node.kind ?? kindFromEncoding(attrs?.['encoding-type'])
  const kinds: readonly NodeKind[] =
    encodedKind === undefined ? ['array', 'group'] : [encodedKind]

  for (const kind of kinds) {
    const key = v2MetadataKey(node.path, kind)
    const metadata =
      fixed !== undefined && kind === node.kind ? await fixed : await readJson(base, key)

    if (metadata === undefined) {
      continue
    }

    knownMetadata.set(key, metadata)

    if (attrs !== null) {
      knownMetadata.set(attrsKey, attrs)
    }

    return { path: node.path, kind, attrs: attrs ?? {} }
  }

  return null
}

async function walkedChildren(
  node: ReadNode,
  lister: ZarrFolderLister,
  obsmKeys: readonly string[],
): Promise<WalkNode[]> {
  if (node.kind !== 'group') {
    return []
  }

  const child = (name: string, kind?: NodeKind): WalkNode => ({
    path: node.path === '' ? name : `${node.path}/${name}`,
    ...(kind === undefined ? {} : { kind }),
  })

  if (node.path === '') {
    return WALKED_ROOT_CHILDREN.map((name) => child(name))
  }

  if (node.path === 'uns') {
    return [child('spatial')]
  }

  // Embeddings are arrays, so names probed without a listing are only
  // looked for as arrays.
  if (node.path === 'obsm') {
    const listed = await lister.list(node.path)
    return listed === null
      ? obsmKeys.map((name) => child(name, 'array'))
      : listed.folders.map((name) => child(name))
  }

  // Visium scale factors and tissue images sit under library ids that only
  // a listing names.
  if (node.path === 'uns/spatial' || node.path.startsWith('uns/spatial/')) {
    return ((await lister.list(node.path))?.folders ?? []).map((name) => child(name))
  }

  // obsm dataframes are not embeddings, so their columns are not read.
  if (node.path.startsWith('obsm/')) {
    return []
  }

  switch (node.attrs['encoding-type']) {
    case 'dataframe':
      return dataframeColumns(node.attrs).map((name) => child(name))
    case 'categorical':
      return [child('codes', 'array'), child('categories', 'array')]
    case 'nullable-integer':
    case 'nullable-boolean':
    case 'nullable-string-array':
      return [child('values', 'array'), child('mask', 'array')]
    case 'csr_matrix':
    case 'csc_matrix':
      return [child('data', 'array'), child('indices', 'array'), child('indptr', 'array')]
    default:
      return []
  }
}

function dataframeColumns(attrs: Readonly<Record<string, unknown>>): string[] {
  const columns = Array.isArray(attrs['column-order']) ? attrs['column-order'] : []
  const names = [attrs._index, ...columns].filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  )

  return Array.from(new Set(names))
}

function kindFromEncoding(encoding: unknown): NodeKind | undefined {
  if (typeof encoding !== 'string') {
    return undefined
  }

  if (GROUP_ENCODINGS.has(encoding)) {
    return 'group'
  }

  return ARRAY_ENCODINGS.has(encoding) ? 'array' : undefined
}

function metadataKey(path: string, file: string): string {
  return path === '' ? `/${file}` : `/${path}/${file}`
}

function v2MetadataKey(path: string, kind: NodeKind): string {
  return metadataKey(path, kind === 'array' ? '.zarray' : '.zgroup')
}

async function readJson(store: zarr.AsyncReadable, key: string): Promise<unknown> {
  const bytes = await store.get(key as zarr.AbsolutePath)

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

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
