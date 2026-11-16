import { readFolderListing } from '../data/folderListing'

// Zarr has no listing of its own, and plain HTTP has none either, so stores
// without consolidated metadata name only some children in their attributes.
// Many hosts list folders anyway: an S3 bucket that allows ListObjectsV2, or a
// server with index pages. This lists a store's folders where the host does.

export type FolderListingKind = 'S3 listing' | 'index page'

export interface ListedFile {
  readonly name: string
  // Bytes, when the listing gives them (S3 does; index pages do not).
  readonly size?: number
}

export interface FolderEntries {
  // Child folder names, without a trailing '/'.
  readonly folders: readonly string[]
  readonly files: readonly ListedFile[]
}

export interface ZarrFolderLister {
  // The folder's children, or null when the host offers no listing. `path` is
  // relative to the store root, without leading or trailing '/'.
  list(path: string): Promise<FolderEntries | null>
  // The listing used, once the first list() has settled it.
  kind(): FolderListingKind | null
}

const LISTING_TIMEOUT_MS = 15_000
const MAX_S3_LISTING_PAGES = 20

// The kind of listing is settled on first use: S3 ListObjectsV2 at a
// virtual-hosted bucket (the host is the bucket), then at a path-style one
// (the first path segment is), then an index page.
export function createZarrFolderLister(
  rootUrl: string,
  fetcher: typeof fetch | undefined,
): ZarrFolderLister {
  const root = new URL(rootUrl)
  const rootPath = root.pathname.replace(/\/+$/, '')
  const rootKey = decodeURIComponent(rootPath.replace(/^\/+/, ''))
  const [bucket = '', ...bucketKey] = rootKey.split('/')
  const fetchFn = fetcher ?? globalThis.fetch.bind(globalThis)
  const s3Endpoints: readonly S3Endpoint[] = [
    { url: `${root.origin}/`, prefix: rootKey },
    ...(bucket === ''
      ? []
      : [
          {
            url: `${root.origin}/${encodeURIComponent(bucket)}`,
            prefix: bucketKey.join('/'),
          },
        ]),
  ]
  type Mode =
    | { readonly kind: 'S3 listing'; readonly endpoint: S3Endpoint }
    | { readonly kind: 'index page' }
  let settled: Promise<Mode | null> | undefined
  let settledKind: FolderListingKind | null = null

  const listS3 = (endpoint: S3Endpoint, path: string) =>
    listS3Folder(fetchFn, endpoint.url, joinKey(endpoint.prefix, path))
  const listIndexPage = async (path: string): Promise<FolderEntries | null> => {
    const folder = path === '' ? `${rootPath}/` : `${rootPath}/${path}/`
    const listing = await readFolderListing(`${root.origin}${folder}`, {
      fetcher: fetchFn,
    })

    if (listing === null) {
      return null
    }

    const names = Array.from(listing.names)
    return {
      folders: names
        .filter((name) => name.endsWith('/'))
        .map((name) => name.slice(0, -1)),
      files: names.filter((name) => !name.endsWith('/')).map((name) => ({ name })),
    }
  }
  const listWith = (mode: Mode, path: string) =>
    mode.kind === 'S3 listing' ? listS3(mode.endpoint, path) : listIndexPage(path)

  // Tries each listing on the first folder asked for.
  async function firstListing(
    path: string,
  ): Promise<{ readonly mode: Mode | null; readonly entries: FolderEntries | null }> {
    for (const endpoint of s3Endpoints) {
      const entries = await listS3(endpoint, path)

      if (entries !== null) {
        return { mode: { kind: 'S3 listing', endpoint }, entries }
      }
    }

    const entries = await listIndexPage(path)
    return { mode: entries === null ? null : { kind: 'index page' }, entries }
  }

  return {
    async list(path) {
      if (settled === undefined) {
        const first = firstListing(path)
        settled = first.then(({ mode }) => mode)
        const { mode, entries } = await first
        settledKind = mode?.kind ?? null
        return entries
      }

      const mode = await settled
      return mode === null ? null : listWith(mode, path)
    },
    kind() {
      return settledKind
    },
  }
}

interface S3Endpoint {
  readonly url: string
  // The store's key prefix in the bucket, without a trailing '/'.
  readonly prefix: string
}

function joinKey(prefix: string, path: string): string {
  return `${[prefix, path].filter((part) => part.length > 0).join('/')}/`
}

// Child folders and files under `prefix` (which ends in '/'), or null when
// the endpoint does not answer with an S3 ListBucketResult.
async function listS3Folder(
  fetcher: typeof fetch,
  endpointUrl: string,
  prefix: string,
): Promise<FolderEntries | null> {
  const folders: string[] = []
  const files: ListedFile[] = []
  let continuationToken: string | undefined

  for (let page = 0; page < MAX_S3_LISTING_PAGES; page += 1) {
    const query = [
      'list-type=2',
      'delimiter=%2F',
      `prefix=${encodeURIComponent(prefix)}`,
      ...(continuationToken === undefined
        ? []
        : [`continuation-token=${encodeURIComponent(continuationToken)}`]),
    ].join('&')
    let text: string

    try {
      const response = await fetcher(`${endpointUrl}?${query}`, {
        signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
      })

      if (!response.ok) {
        await response.body?.cancel()
        return null
      }

      text = await response.text()
    } catch {
      return null
    }

    if (!/<ListBucketResult[\s>]/.test(text)) {
      return null
    }

    for (const match of text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g)) {
      const name = childName(decodeXmlText(match[1] ?? ''), prefix).replace(/\/$/, '')

      if (name.length > 0) {
        folders.push(name)
      }
    }

    for (const match of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = match[1] ?? ''
      const key = /<Key>([^<]*)<\/Key>/.exec(body)?.[1]
      const name = key === undefined ? '' : childName(decodeXmlText(key), prefix)
      const size = Number(/<Size>\s*(\d+)\s*<\/Size>/.exec(body)?.[1] ?? Number.NaN)

      if (name.length > 0 && !name.includes('/')) {
        files.push(Number.isFinite(size) ? { name, size } : { name })
      }
    }

    const nextToken = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(
      text,
    )?.[1]

    if (!/<IsTruncated>\s*true\s*<\/IsTruncated>/.test(text) || nextToken === undefined) {
      return { folders, files }
    }

    continuationToken = decodeXmlText(nextToken)
  }

  return { folders, files }
}

function childName(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : ''
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    }

    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    }

    return XML_ENTITIES[name.toLowerCase()] ?? entity
  })
}
