import { fromCustomClient } from 'geotiff'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRemoteTiff, remoteTiffVersion } from './remoteTiff'
import type { BaseClient, GeoTIFF } from 'geotiff'

vi.mock('geotiff', () => ({
  fromCustomClient: vi.fn(),
}))

const mockedFromCustomClient = vi.mocked(fromCustomClient)

afterEach(() => {
  mockedFromCustomClient.mockReset()
  vi.unstubAllGlobals()
})

describe('remote TIFF version', () => {
  it('takes the size and ETag from the header read that opens the file', async () => {
    const fetch = stubTiffServer({
      'Content-Range': 'bytes 0-1023/52428800',
      ETag: '"etag-1"',
      'Last-Modified': 'Mon, 16 Nov 2026 10:00:00 GMT',
    })

    const tiff = await openRemoteTiff('https://example.test/image.ome.tif', {
      allowFullFile: false,
    })

    expect(remoteTiffVersion(tiff)).toBe('52428800 "etag-1"')
    // The header and IFD reads; nothing extra for the version.
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/image.ome.tif',
      expect.objectContaining({ headers: { Range: 'bytes=0-1023' } }),
    )
  })

  it('falls back to Last-Modified when CORS hides the size and ETag', async () => {
    stubTiffServer({ 'Last-Modified': 'Mon, 16 Nov 2026 10:00:00 GMT' })

    const tiff = await openRemoteTiff('https://example.test/image.ome.tif', {
      allowFullFile: false,
    })

    expect(remoteTiffVersion(tiff)).toBe(' Mon, 16 Nov 2026 10:00:00 GMT')
  })

  it('has no version for a file it did not open', () => {
    expect(remoteTiffVersion({} as GeoTIFF)).toBe('')
  })
})

// Serves 206 responses with `headers`; the mocked geotiff reads the header
// and then an IFD through the client, as GeoTIFF.fromSource does.
function stubTiffServer(headers: Record<string, string>) {
  const fetch = vi.fn(
    async () => new Response(new Uint8Array(1024), { status: 206, headers }),
  )

  vi.stubGlobal('fetch', fetch)
  mockedFromCustomClient.mockImplementation(async (client: BaseClient) => {
    await client.request({ headers: { Range: 'bytes=0-1023' } })
    await client.request({ headers: { Range: 'bytes=4096-5119' } })
    return {} as GeoTIFF
  })

  return fetch
}
