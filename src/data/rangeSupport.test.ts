import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearFolderListings,
  parseFolderListing,
  setFolderListing,
} from './folderListing'
import { clearHostResponses, noteReadableResponse } from './hostResponses'
import { assertHttpRangeSupport } from './rangeSupport'

afterEach(() => {
  vi.unstubAllGlobals()
  clearFolderListings()
  clearHostResponses()
})

describe('HTTP Range support diagnostics', () => {
  it('accepts a one-byte HTTP 206 response with an exposed Content-Range', async () => {
    const fetcher = vi.fn(async () => rangeResponse(206, 'bytes 0-0/100'))

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).resolves.toBeUndefined()

    expect(fetcher).toHaveBeenCalledWith('https://example.test/xenium/cells.parquet', {
      method: 'GET',
      headers: {
        Range: 'bytes=0-0',
      },
    })
  })

  it('fails loudly when the server ignores the Range request', async () => {
    const fetcher = vi.fn(async () => rangeResponse(200, null))

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).rejects.toThrow(
      'cells.parquet cannot be range-read. Expected HTTP 206 for Range: bytes=0-0, received HTTP 200.',
    )
  })

  it('reports a 404 or 403 as a missing or unreadable file, not a Range problem', async () => {
    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells-renamed.parquet', {
        fetcher: vi.fn(async () => rangeResponse(404, null)),
        label: 'cells-renamed.parquet',
      }),
    ).rejects.toThrow(
      'cells-renamed.parquet was not found. The Range probe received HTTP 404 for https://example.test/xenium/cells-renamed.parquet. Check that the file exists at this path.',
    )
    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells-renamed.parquet', {
        fetcher: vi.fn(async () => rangeResponse(403, null)),
        label: 'cells-renamed.parquet',
      }),
    ).rejects.toThrow(
      'cells-renamed.parquet could not be read. The Range probe received HTTP 403 for https://example.test/xenium/cells-renamed.parquet. The file is missing (buckets that deny listing return 403 for missing keys) or not publicly readable.',
    )
  })

  it('reports a 5xx as a server error, not a Range problem', async () => {
    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher: vi.fn(async () => rangeResponse(503, null)),
        label: 'cells.parquet',
      }),
    ).rejects.toThrow(
      'cells.parquet could not be read. The Range probe received HTTP 503 for https://example.test/xenium/cells.parquet. The host returned a server error, so Range support was not tested.',
    )
  })

  it('accepts HTTP 206 when CORS does not expose Content-Range', async () => {
    const fetcher = vi.fn(async () => rangeResponse(206, null))

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).resolves.toBeUndefined()
  })

  it('reports a file the folder index page does not list without requesting it', async () => {
    const fetcher = vi.fn(async () => rangeResponse(206, null))
    setFolderListing(
      'https://example.test/xenium/',
      parseFolderListing(
        '<title>Index of /xenium</title><a href="cells.parquet">cells.parquet</a>',
        'https://example.test/xenium/',
      ),
    )

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/transcripts.parquet', {
        fetcher,
        label: 'transcripts.parquet',
      }),
    ).rejects.toMatchObject({
      name: 'FileNotListedError',
      message:
        'transcripts.parquet was not found. https://example.test/xenium/transcripts.parquet is not in the folder listing of https://example.test/xenium/. Check that the file exists at this path.',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports a failed probe as a likely missing file on hosts that hide error responses', async () => {
    noteReadableResponse('https://example.test/xenium/experiment.xenium', 200)
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).rejects.toMatchObject({
      name: 'LikelyMissingFileError',
      message: expect.stringContaining(
        'cells.parquet could not be read. The request for https://example.test/xenium/cells.parquet failed without a readable response',
      ),
    })
  })

  it('surfaces CORS and network failures with an actionable message', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).rejects.toThrow(
      'cells.parquet cannot be range-read. The Range probe failed before an HTTP response was available.',
    )
  })

  it('reuses a successful default range probe for the same file', async () => {
    const fetcher = vi.fn(async () => rangeResponse(206, 'bytes 0-0/100'))
    vi.stubGlobal('fetch', fetcher)
    const url = 'https://example.test/xenium/range-cache-test.parquet'

    await assertHttpRangeSupport(url, { label: 'range-cache-test.parquet' })
    await assertHttpRangeSupport(url, { label: 'range-cache-test.parquet' })

    expect(fetcher).toHaveBeenCalledOnce()
  })
})

function rangeResponse(status: number, contentRange: string | null): Response {
  return new Response(new Uint8Array([1]), {
    status,
    ...(contentRange === null ? {} : { headers: { 'Content-Range': contentRange } }),
  })
}
