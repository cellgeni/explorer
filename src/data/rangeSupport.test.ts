import { describe, expect, it, vi } from 'vitest'
import { assertHttpRangeSupport } from './rangeSupport'

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

  it('fails loudly when Content-Range is not exposed through CORS', async () => {
    const fetcher = vi.fn(async () => rangeResponse(206, null))

    await expect(
      assertHttpRangeSupport('https://example.test/xenium/cells.parquet', {
        fetcher,
        label: 'cells.parquet',
      }),
    ).rejects.toThrow(
      'cells.parquet cannot be range-read. The Range probe returned HTTP 206 but Content-Range was not exposed to the browser.',
    )
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
})

function rangeResponse(status: number, contentRange: string | null): Response {
  return new Response(new Uint8Array([1]), {
    status,
    ...(contentRange === null ? {} : { headers: { 'Content-Range': contentRange } }),
  })
}
