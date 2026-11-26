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
    // The header's read, which takes in the IFD; nothing extra for the
    // version.
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/image.ome.tif',
      expect.objectContaining({ headers: { Range: 'bytes=0-65535' } }),
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

describe('remote TIFF reads', () => {
  it('reads on from a short read and answers later reads inside it from memory', async () => {
    const file = numberedBytes(200_000)
    const fetch = stubFile(file)
    const client = await openClient()

    const header = await client.request({ headers: { Range: 'bytes=0-1023' } })
    const ifd = await client.request({ headers: { Range: 'bytes=40000-44047' } })

    expect(fetch).toHaveBeenCalledOnce()
    expect(rangeOf(fetch.mock.calls[0])).toBe('bytes=0-65535')
    expect(header.status).toBe(206)
    expect(new Uint8Array(await header.getData())).toEqual(file.slice(0, 1024))
    expect(new Uint8Array(await ifd.getData())).toEqual(file.slice(40_000, 44_048))
    expect(ifd.getHeader('content-range')).toBe('bytes 40000-44047/200000')

    // A later read past it reads on, less far, from its own start.
    await client.request({ headers: { Range: 'bytes=70000-70099' } })
    expect(rangeOf(fetch.mock.calls[1])).toBe('bytes=70000-86383')
  })

  it('sends reads with a signal, and reads as long as it would read, as asked', async () => {
    const fetch = stubFile(numberedBytes(300_000))
    const client = await openClient()

    await client.request({
      headers: { Range: 'bytes=0-1023' },
      signal: new AbortController().signal,
    })
    await client.request({ headers: { Range: 'bytes=100000-116383' } })

    expect(fetch.mock.calls.map(rangeOf)).toEqual(['bytes=0-1023', 'bytes=100000-116383'])
  })

  it('gives geotiff a read that is not answered 206 as it came', async () => {
    stubFetch(async () => new Response('missing', { status: 404 }))
    const client = await openClient()

    const response = await client.request({ headers: { Range: 'bytes=0-1023' } })

    expect(response.status).toBe(404)
    expect(response.ok).toBe(false)
  })

  it('answers a read at the end of a short file as the host would', async () => {
    const file = numberedBytes(2_000)
    const fetch = stubFile(file)
    const client = await openClient()

    await client.request({ headers: { Range: 'bytes=0-1023' } })
    const tail = await client.request({ headers: { Range: 'bytes=1500-2547' } })
    const past = await client.request({ headers: { Range: 'bytes=3000-3099' } })

    expect(new Uint8Array(await tail.getData())).toEqual(file.slice(1500))
    expect(tail.getHeader('content-range')).toBe('bytes 1500-1999/2000')
    // Past the end, the host answers.
    expect(past.status).toBe(416)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // Chromium lets one request at a time use a URL's HTTP cache entry.
  it('skips the HTTP cache for a read sent while another is on its way', async () => {
    const file = numberedBytes(300_000)
    const held: (() => void)[] = []
    const fetch = stubFetch(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          held.push(() => {
            resolve(rangeResponse(file, init))
          })
        }),
    )
    const client = await openClient()

    const first = client.request({ headers: { Range: 'bytes=0-1023' } })
    const second = client.request({ headers: { Range: 'bytes=100000-101023' } })
    await vi.waitFor(() => {
      expect(held).toHaveLength(2)
    })
    held.splice(0).forEach((answer) => {
      answer()
    })
    await Promise.all([first, second])
    const third = client.request({ headers: { Range: 'bytes=200000-201023' } })
    await vi.waitFor(() => {
      expect(held).toHaveLength(1)
    })
    held.splice(0).forEach((answer) => {
      answer()
    })
    await third

    expect(fetch.mock.calls.map(([, init]) => init?.cache)).toEqual([
      undefined,
      'no-store',
      undefined,
    ])
  })

  it('reads a range on its own when the read it waited for failed', async () => {
    const file = numberedBytes(100_000)
    const fetch = stubFetch(async (_input, init) =>
      rangeOf([undefined, init]) === 'bytes=0-65535'
        ? new Response(null, { status: 403 })
        : rangeResponse(file, init),
    )
    const client = await openClient()

    const first = client.request({ headers: { Range: 'bytes=0-1023' } })
    const second = client.request({ headers: { Range: 'bytes=2000-2099' } })

    expect((await first).status).toBe(403)
    expect(new Uint8Array(await (await second).getData())).toEqual(file.slice(2000, 2100))
    expect(fetch.mock.calls.map(rangeOf)).toEqual(['bytes=0-65535', 'bytes=2000-2099'])
  })

  it('does not cut a range from a read the host answered short', async () => {
    const file = numberedBytes(100_000)
    // A host that sends at most 1 kB, though the file goes on.
    const fetch = stubFetch(async (_input, init) => {
      const [start = 0] = (rangeOf([undefined, init])?.match(/\d+/g) ?? []).map(Number)
      return rangeResponse(file.slice(0, start + 1024), init, file.byteLength)
    })
    const client = await openClient()

    await client.request({ headers: { Range: 'bytes=0-1023' } })
    const straddling = await client.request({ headers: { Range: 'bytes=1000-1099' } })

    expect(new Uint8Array(await straddling.getData())).toEqual(file.slice(1000, 1100))
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

// Opens a file through the mocked geotiff and returns the client it gets.
async function openClient(): Promise<BaseClient> {
  let opened: BaseClient | undefined

  mockedFromCustomClient.mockImplementation(async (client: BaseClient) => {
    opened = client
    return {} as GeoTIFF
  })
  await openRemoteTiff('https://example.test/image.ome.tif', { allowFullFile: false })

  if (opened === undefined) {
    throw new Error('geotiff was not given a client.')
  }

  return opened
}

function stubFetch(
  answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const fetch = vi.fn(answer)

  vi.stubGlobal('fetch', fetch)
  return fetch
}

function stubFile(file: Uint8Array) {
  return stubFetch(async (_input, init) => rangeResponse(file, init))
}

// `total` stands in for the file's size when `file` holds only its start.
function rangeResponse(
  file: Uint8Array,
  init: RequestInit | undefined,
  total = file.byteLength,
): Response {
  const [start = 0, end = 0] = (
    new Headers(init?.headers).get('Range')?.match(/\d+/g) ?? []
  ).map(Number)

  if (start >= file.byteLength) {
    return new Response(null, { status: 416 })
  }

  const last = Math.min(end, file.byteLength - 1)

  return new Response(file.slice(start, last + 1), {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${last}/${total}` },
  })
}

function rangeOf(call: readonly unknown[] | undefined): string | null {
  return new Headers((call?.[1] as RequestInit | undefined)?.headers).get('Range')
}

function rangeLength(init: RequestInit | undefined): number {
  const [start = 0, end = 0] = (rangeOf([undefined, init])?.match(/\d+/g) ?? []).map(
    Number,
  )
  return end - start + 1
}

function numberedBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 251)
}

// Serves 206 responses with `headers`; the mocked geotiff reads the header
// and then an IFD through the client, as GeoTIFF.fromSource does.
function stubTiffServer(headers: Record<string, string>) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(new Uint8Array(rangeLength(init)), { status: 206, headers }),
  )

  vi.stubGlobal('fetch', fetch)
  mockedFromCustomClient.mockImplementation(async (client: BaseClient) => {
    await client.request({ headers: { Range: 'bytes=0-1023' } })
    await client.request({ headers: { Range: 'bytes=4096-5119' } })
    return {} as GeoTIFF
  })

  return fetch
}
