import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Serves src/test/fixtures/anndata-zarr (see make_fixtures.py there) at
// https://anndata.test/, optionally with a folder listing.
export const ANNDATA_ZARR_FIXTURE_ORIGIN = 'https://anndata.test'

const FIXTURE_DIR = join(process.cwd(), 'src/test/fixtures/anndata-zarr')

export interface AnnDataZarrFixtureFetcherOptions {
  // The listing the host offers:
  // - 'virtual-hosted': the origin is an S3 bucket answering ListObjectsV2.
  // - 'path-style': fixtures are served under /bucket/, an S3 bucket at
  //   /bucket answering ListObjectsV2.
  // - 'index page': folder URLs ending in '/' serve autoindex pages.
  readonly listing?: 'virtual-hosted' | 'path-style' | 'index page'
  // Served path prefixes (as `/store`) mapped to fixture paths (as
  // `/tiny.zarr`), to serve a fixture under another name.
  readonly aliases?: Readonly<Record<string, string>>
  // Fixture paths answered as missing, for example `/tiny.zarr/.zmetadata`.
  readonly hidden?: readonly string[]
  // Status for missing paths: 404, or 403 like an S3 bucket that denies
  // listing.
  readonly missingStatus?: number
  // Each request's path and query.
  readonly requests?: string[]
}

export function annDataZarrFixtureFetcher(
  options: AnnDataZarrFixtureFetcherOptions = {},
): typeof fetch {
  const bucketPrefix = options.listing === 'path-style' ? '/bucket' : ''
  const missing = () => new Response(null, { status: options.missingStatus ?? 404 })

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    options.requests?.push(`${url.pathname}${url.search}`)

    if (url.origin !== ANNDATA_ZARR_FIXTURE_ORIGIN) {
      throw new TypeError(`Failed to fetch ${request.url}`)
    }

    if (url.searchParams.get('list-type') === '2') {
      const isBucket =
        options.listing === 'virtual-hosted'
          ? url.pathname === '/'
          : options.listing === 'path-style' && /^\/bucket\/?$/.test(url.pathname)

      return isBucket
        ? s3Listing(fixturePath(`/${url.searchParams.get('prefix') ?? ''}`), url)
        : new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    }

    if (!url.pathname.startsWith(`${bucketPrefix}/`)) {
      return missing()
    }

    const path = fixturePath(decodeURIComponent(url.pathname.slice(bucketPrefix.length)))

    if (options.hidden?.includes(path)) {
      return missing()
    }

    if (options.listing === 'index page' && path.endsWith('/')) {
      return (await indexPage(path)) ?? missing()
    }

    let bytes: Uint8Array<ArrayBuffer>

    try {
      bytes = new Uint8Array(await readFile(join(FIXTURE_DIR, path)))
    } catch {
      return missing()
    }

    // Zarr v3 shard indexes are read from the end, found with HEAD.
    if (request.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') ?? '')

    if (range === null) {
      return new Response(bytes)
    }

    const start =
      range[1] === ''
        ? Math.max(0, bytes.byteLength - Number(range[2]))
        : Number(range[1])
    const end =
      range[1] === '' || range[2] === ''
        ? bytes.byteLength - 1
        : Math.min(Number(range[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }) as typeof fetch

  function fixturePath(path: string): string {
    const alias = Object.entries(options.aliases ?? {}).find(([prefix]) =>
      path.startsWith(prefix),
    )

    return alias === undefined ? path : alias[1] + path.slice(alias[0].length)
  }

  async function indexPage(path: string): Promise<Response | null> {
    const entries = await readdir(join(FIXTURE_DIR, path), { withFileTypes: true }).catch(
      () => null,
    )

    if (entries === null) {
      return null
    }

    const links = entries
      .map((entry) => `<a href="${entry.name}${entry.isDirectory() ? '/' : ''}">x</a>`)
      .join('\n')
    return new Response(
      `<html><title>Index of ${path}</title><body>${links}</body></html>`,
    )
  }
}

async function s3Listing(prefixPath: string, url: URL): Promise<Response> {
  const prefix = url.searchParams.get('prefix') ?? ''
  const entries = await readdir(join(FIXTURE_DIR, prefixPath), {
    withFileTypes: true,
  }).catch(() => [])
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        `<CommonPrefixes><Prefix>${prefix}${entry.name}/</Prefix></CommonPrefixes>`,
    )
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => `<Contents><Key>${prefix}${entry.name}</Key></Contents>`)

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Prefix>${prefix}</Prefix><IsTruncated>false</IsTruncated>${files.join('')}${folders.join('')}</ListBucketResult>`,
  )
}
