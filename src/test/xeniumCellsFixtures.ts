import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AsyncBuffer } from 'hyparquet'

// src/test/fixtures/xenium (see make_fixtures.py there): 10 cells in row
// groups of 4. Cell 3 has no area and cell 5 no segmentation method;
// cells_v1.parquet has no nucleus_count or segmentation_method.
export type XeniumCellsFixture = 'cells.parquet' | 'cells_v1.parquet'

export const XENIUM_CELLS_FIXTURE_ROWS = 10

export function xeniumCellsFixtureBytes(name: XeniumCellsFixture): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/xenium', name)),
  )
}

export function asyncBufferFromBytes(bytes: Uint8Array): AsyncBuffer {
  return {
    byteLength: bytes.byteLength,
    slice: (start, end) => bytes.slice(start, end).buffer,
  }
}

// Serves `bytes` at any URL, with HEAD and Range, as hyparquet's
// `asyncBufferFromUrl` reads it.
export function rangeFetcher(bytes: Uint8Array): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)

    if (request.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') ?? '')

    if (match === null) {
      return new Response(bytes.slice(), { status: 200 })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }) as typeof fetch
}
