import { noteReadableResponse } from './hostResponses'

// Hosts that drop CORS headers from error responses (see hostResponses.ts)
// make a missing file look like a network failure. When such a host serves
// folder index pages (Apache or nginx autoindex, as ftp.ebi.ac.uk does),
// detection reads the dataset folder's index once and registers it here.
// Readers then skip files it does not list, or report them as not found,
// instead of requesting them.

export interface FolderListing {
  // The folder URL, ending in '/'.
  readonly folderUrl: string
  // Decoded child names; folders end in '/'.
  readonly names: ReadonlySet<string>
  // Index pages usually hide dotfiles, so a dotfile missing from the page
  // only counts as missing when the page lists some dotfile.
  readonly listsDotfiles: boolean
}

export interface ReadFolderListingOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export class FileNotListedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FileNotListedError'
  }
}

const INDEX_PAGE_TITLE = /<title[^>]*>\s*(?:index of|directory listing for)\b/i
const HREF_ATTRIBUTE = /<a\s[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const MAX_INDEX_PAGE_BYTES = 8 * 1024 * 1024

const folderListings = new Map<string, FolderListing>()

// The folder's index page, or null when the host does not serve a readable
// one. Never throws, except when `signal` aborts.
export async function readFolderListing(
  folderUrl: string,
  options: ReadFolderListingOptions = {},
): Promise<FolderListing | null> {
  const url = withTrailingSlash(folderUrl)
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)

  try {
    const response = await fetcher(url, {
      cache: 'no-cache',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    noteReadableResponse(url, response.status)
    const contentLength = Number(response.headers.get('Content-Length') ?? 0)

    if (!response.ok || contentLength > MAX_INDEX_PAGE_BYTES) {
      await response.body?.cancel()
      return null
    }

    return parseFolderListing(await response.text(), url)
  } catch (cause) {
    if (options.signal?.aborted === true) {
      throw cause
    }

    return null
  }
}

export function parseFolderListing(
  html: string,
  folderUrl: string,
): FolderListing | null {
  if (!INDEX_PAGE_TITLE.test(html)) {
    return null
  }

  const folder = new URL(withTrailingSlash(folderUrl))
  const names = new Set<string>()

  for (const match of html.matchAll(HREF_ATTRIBUTE)) {
    const name = childName(decodeHtmlEntities(match[1] ?? match[2] ?? ''), folder)

    if (name !== undefined) {
      names.add(name)
    }
  }

  // An index with no entries is more likely a page this parser misread than
  // an empty dataset folder, so it rules nothing out.
  if (names.size === 0) {
    return null
  }

  return {
    folderUrl: folder.toString(),
    names,
    listsDotfiles: [...names].some((name) => name.startsWith('.')),
  }
}

export function setFolderListing(
  folderUrl: string,
  listing: FolderListing | null | undefined,
): void {
  const key = withTrailingSlash(folderUrl)

  if (listing === null || listing === undefined) {
    folderListings.delete(key)
  } else {
    folderListings.set(key, listing)
  }
}

export function clearFolderListings(): void {
  folderListings.clear()
}

// The registered listing that shows `url` does not exist: the listing of one
// of its folders that lacks the next path segment.
export function folderListingMissing(url: string): FolderListing | undefined {
  let target: URL

  try {
    target = new URL(url)
  } catch {
    return undefined
  }

  for (const listing of folderListings.values()) {
    const folder = new URL(listing.folderUrl)

    if (target.origin !== folder.origin || !target.pathname.startsWith(folder.pathname)) {
      continue
    }

    const segment = /^([^/]+)(\/)?/.exec(target.pathname.slice(folder.pathname.length))

    if (segment?.[1] === undefined) {
      continue
    }

    const name = safeDecode(segment[1])

    if (name.startsWith('.') && !listing.listsDotfiles) {
      continue
    }

    // A file URL can only be a folder in the listing when a path follows it;
    // a bare name may be either, for URLs that omit a folder's trailing '/'.
    const listed =
      listing.names.has(`${name}/`) ||
      (segment[2] === undefined && listing.names.has(name))

    if (!listed) {
      return listing
    }
  }

  return undefined
}

export function isListedAsMissing(url: string): boolean {
  return folderListingMissing(url) !== undefined
}

export function fileNotListedError(
  label: string,
  url: string,
): FileNotListedError | undefined {
  const listing = folderListingMissing(url)

  return listing === undefined
    ? undefined
    : new FileNotListedError(
        `${label} was not found. ${url} is not in the folder listing of ${listing.folderUrl}. Check that the file exists at this path.`,
      )
}

function childName(href: string, folder: URL): string | undefined {
  if (href.length === 0 || href.startsWith('?') || href.startsWith('#')) {
    return undefined
  }

  let url: URL

  try {
    url = new URL(href, folder)
  } catch {
    return undefined
  }

  if (
    url.origin !== folder.origin ||
    url.search.length > 0 ||
    !url.pathname.startsWith(folder.pathname)
  ) {
    return undefined
  }

  const child = /^([^/]+)(\/?)$/.exec(url.pathname.slice(folder.pathname.length))

  return child?.[1] === undefined ? undefined : `${safeDecode(child[1])}${child[2] ?? ''}`
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function withTrailingSlash(url: string): string {
  return `${url.trim().replace(/\/+$/, '')}/`
}
