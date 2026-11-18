import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHostResponses,
  fetchHead,
  likelyMissingFileError,
  noteReadableResponse,
} from './hostResponses'

const URL_ON_HOST = 'https://ftp.example.test/run-1/morphology_focus/ch0000.ome.tif'

afterEach(() => {
  clearHostResponses()
})

describe('failed requests on hosts that hide error responses', () => {
  it('reports a failed fetch as a likely missing file once the host has answered', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)
    const cause = new TypeError('Failed to fetch')

    expect(likelyMissingFileError('ch0000.ome.tif', URL_ON_HOST, cause)).toMatchObject({
      name: 'LikelyMissingFileError',
      message: expect.stringContaining(
        `ch0000.ome.tif could not be read. The request for ${URL_ON_HOST} failed without a readable response, although other files on ftp.example.test were readable, so the file is most likely missing.`,
      ),
      cause,
    })
  })

  it('keeps the original error for hosts that never answered', () => {
    expect(
      likelyMissingFileError(
        'ch0000.ome.tif',
        URL_ON_HOST,
        new TypeError('Failed to fetch'),
      ),
    ).toBeUndefined()
  })

  it('keeps the original error for hosts that send CORS headers with errors', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)
    noteReadableResponse('https://ftp.example.test/run-1/explorer.json', 404)

    expect(
      likelyMissingFileError(
        'ch0000.ome.tif',
        URL_ON_HOST,
        new TypeError('Failed to fetch'),
      ),
    ).toBeUndefined()
  })

  it('keeps errors that are not failed fetches', () => {
    noteReadableResponse('https://ftp.example.test/run-1/experiment.xenium', 200)

    expect(
      likelyMissingFileError('ch0000.ome.tif', URL_ON_HOST, new Error('decode failed')),
    ).toBeUndefined()
  })
})

describe('HEAD requests on hosts whose CORS rules allow GET only', () => {
  const FILE_URL = 'https://bucket.example.test/store.zarr/X/data/0'

  function getOnlyHost(file: Response | (() => Response)) {
    const requests: string[] = []
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push(`${method} ${new Headers(init?.headers).get('Range') ?? ''}`.trim())

      if (method === 'HEAD') {
        throw new TypeError('Failed to fetch')
      }

      return typeof file === 'function' ? file() : file
    }) as typeof fetch
    return { fetcher, requests }
  }

  it('reads the size from a one-byte Range GET when HEAD fails', async () => {
    const { fetcher, requests } = getOnlyHost(
      () =>
        new Response(new Uint8Array([1]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-0/53246462', 'Content-Length': '1' },
        }),
    )

    const response = await fetchHead(fetcher, FILE_URL)

    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    expect(response.headers.get('Content-Length')).toBe('53246462')
    expect(response.body).toBeNull()
    expect(requests).toEqual(['HEAD', 'GET bytes=0-0'])

    // The origin answered GET, so it is not sent HEAD again.
    await fetchHead(fetcher, 'https://bucket.example.test/store.zarr/obs/.zattrs')
    expect(requests).toEqual(['HEAD', 'GET bytes=0-0', 'GET bytes=0-0'])
  })

  it('passes on the status of a missing file', async () => {
    const { fetcher } = getOnlyHost(() => new Response(null, { status: 404 }))

    const response = await fetchHead(fetcher, FILE_URL)

    expect(response.status).toBe(404)
    expect(response.ok).toBe(false)
  })

  it('keeps the size of a whole-file answer from a host that ignores Range', async () => {
    const { fetcher } = getOnlyHost(
      () => new Response('{"zarr_format":2}', { headers: { 'Content-Length': '17' } }),
    )

    const response = await fetchHead(fetcher, FILE_URL)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('17')
  })

  it('throws the HEAD failure when the GET fails too', async () => {
    const cause = new TypeError('Failed to fetch')
    const fetcher = vi.fn(async () => {
      throw cause
    }) as unknown as typeof fetch

    await expect(fetchHead(fetcher, FILE_URL)).rejects.toBe(cause)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not fall back on an origin that has answered HEAD', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(_input).endsWith('/missing')) {
        throw new TypeError('Failed to fetch')
      }

      return new Response(null, { status: init?.method === 'HEAD' ? 200 : 206 })
    }) as unknown as typeof fetch

    await fetchHead(fetcher, 'https://bucket.example.test/present')
    await expect(
      fetchHead(fetcher, 'https://bucket.example.test/missing'),
    ).rejects.toThrow('Failed to fetch')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not fall back when a HEAD sent alongside succeeds first', async () => {
    let failMissing: (error: Error) => void = () => undefined
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith('/missing')
        ? new Promise<Response>((_resolve, reject) => {
            failMissing = reject
          })
        : Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch

    const missing = fetchHead(fetcher, 'https://bucket.example.test/missing')
    await fetchHead(fetcher, 'https://bucket.example.test/present')
    failMissing(new TypeError('Failed to fetch'))

    await expect(missing).rejects.toThrow('Failed to fetch')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
