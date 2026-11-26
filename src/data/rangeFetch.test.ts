import { describe, expect, it, vi } from 'vitest'
import { rangeReadsWithoutHttpCache } from './rangeFetch'

const URL = 'https://example.test/xenium/cells.parquet'

describe('rangeReadsWithoutHttpCache', () => {
  it('sends Range requests with no-store and others as they are', async () => {
    const fetcher = vi.fn(async () => new Response(null))
    const signal = new AbortController().signal
    const fetchRange = rangeReadsWithoutHttpCache(fetcher)

    await fetchRange(URL, { headers: { Range: 'bytes=0-9' }, signal })
    await fetchRange(URL, { headers: new Headers({ range: 'bytes=10-19' }) })
    await fetchRange(URL, { method: 'HEAD', signal })
    await fetchRange(URL)

    expect(fetcher.mock.calls).toEqual([
      [URL, { headers: { Range: 'bytes=0-9' }, signal, cache: 'no-store' }],
      [URL, { headers: new Headers({ range: 'bytes=10-19' }), cache: 'no-store' }],
      [URL, { method: 'HEAD', signal }],
      [URL, undefined],
    ])
  })

  it("reads a Request's own Range header", async () => {
    const fetcher = vi.fn(async () => new Response(null))
    const request = new Request(URL, { headers: { Range: 'bytes=0-9' } })

    await rangeReadsWithoutHttpCache(fetcher)(request)

    expect(fetcher).toHaveBeenCalledWith(request, { cache: 'no-store' })
  })
})
