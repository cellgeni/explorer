import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Serves src/test/fixtures/icechunk (see make_fixtures.py there) at
// https://example.test/, with Range support.
export const ICECHUNK_FIXTURE_ORIGIN = 'https://example.test'

const FIXTURE_DIR = join(process.cwd(), 'src/test/fixtures/icechunk')

export interface IcechunkFixtureRequest {
  readonly method: string
  readonly path: string
  readonly range: string | null
}

export interface IcechunkFixtureFetcherOptions {
  // Served path prefixes (as `/copy.icechunk`) mapped to fixture paths (as
  // `/tiny.h5ad.icechunk`), to serve a fixture under another name.
  readonly aliases?: Readonly<Record<string, string>>
  // Content-Length reported by HEAD for these paths, as for a file over the
  // browser load limit.
  readonly headLengths?: Readonly<Record<string, number>>
  // Status for paths with no fixture file: 404, or 403 like an S3 bucket that
  // denies listing.
  readonly missingStatus?: number
  // Answer Range requests with the whole file, like hosts without Range.
  readonly ignoreRange?: boolean
  readonly requests?: IcechunkFixtureRequest[]
}

export function icechunkFixtureFetcher(
  options: IcechunkFixtureFetcherOptions = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const range = request.headers.get('Range')
    options.requests?.push({ method: request.method, path: url.pathname, range })

    if (url.origin !== ICECHUNK_FIXTURE_ORIGIN) {
      throw new TypeError(`Failed to fetch ${request.url}`)
    }

    const alias = Object.entries(options.aliases ?? {}).find(([prefix]) =>
      url.pathname.startsWith(prefix),
    )
    const fixturePath =
      alias === undefined ? url.pathname : alias[1] + url.pathname.slice(alias[0].length)
    let bytes: Uint8Array<ArrayBuffer>

    try {
      bytes = new Uint8Array(await readFile(join(FIXTURE_DIR, fixturePath)))
    } catch {
      return new Response(null, { status: options.missingStatus ?? 404 })
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Length': String(
            options.headLengths?.[url.pathname] ?? bytes.byteLength,
          ),
        },
      })
    }

    const match = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range)

    if (match === null || options.ignoreRange === true) {
      return new Response(bytes, { status: 200 })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }) as typeof fetch
}
