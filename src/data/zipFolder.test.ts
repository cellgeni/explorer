import { afterEach, describe, expect, it, vi } from 'vitest'
import { byteRangeFetcher, zipArchive, type ByteRangeRequest } from '../test/zipFixtures'
import { readZipDirectory, type ZipDirectory } from './zipArchive'
import {
  clearZipFolders,
  registerZipFolder,
  withZipFolders,
  ZipFolderError,
  zipFolderFor,
  zipFolderRoot,
} from './zipFolder'

const ZIP = 'https://example.test/runs/run_outs.zip'
const image = Uint8Array.from({ length: 1000 }, (_, index) => (index * 31) % 251)
const notes = new TextEncoder().encode('notes '.repeat(200))
const experiment = new TextEncoder().encode('{"pixel_size": 0.2125}')

function archive(zip64: boolean): Uint8Array {
  return zipArchive(
    [
      { name: '__MACOSX/outs/._experiment.spatial', data: Uint8Array.of(1) },
      { name: 'outs/', data: new Uint8Array(0) },
      { name: 'outs/experiment.spatial', data: experiment },
      { name: 'outs/morphology 2d/image.tif', data: image },
      { name: 'outs/notes.txt', data: notes, deflate: true },
      { name: 'outs/empty.bin', data: new Uint8Array(0) },
    ],
    { zip64 },
  )
}

// The zip's host, which also sends an ETag.
function zipHost(zip64 = false) {
  const requests: ByteRangeRequest[] = []
  const files = byteRangeFetcher(new Map([[ZIP, archive(zip64)]]), requests)
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await files(input, init)
    const headers = new Headers(response.headers)
    headers.set('ETag', '"zip-etag"')
    return new Response(response.body, { status: response.status, headers })
  })

  return { requests, fetcher: fetcher as typeof fetch & typeof fetcher }
}

async function openFolder(zip64 = false) {
  const host = zipHost(zip64)
  const directory = await readZipDirectory(ZIP, { fetcher: host.fetcher })
  registerZipFolder({ url: ZIP, root: 'outs/', directory }, host.fetcher)
  host.requests.length = 0
  host.fetcher.mockClear()
  const elsewhere = vi.fn(async () => new Response('elsewhere'))

  return {
    ...host,
    elsewhere,
    fetch: withZipFolders(elsewhere as unknown as typeof fetch),
  }
}

async function bytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

afterEach(() => {
  clearZipFolders()
})

describe('zip folders', () => {
  it.each([false, true])(
    'reads ranges of a stored file at its place in the zip (ZIP64 %s)',
    async (zip64) => {
      const { fetch, fetcher, requests } = await openFolder(zip64)

      const first = await fetch(`${ZIP}/morphology 2d/image.tif`, {
        headers: { Range: 'bytes=10-19' },
      })

      expect(first.status).toBe(206)
      expect(first.headers.get('Content-Range')).toBe('bytes 10-19/1000')
      expect(first.headers.get('Content-Length')).toBe('10')
      expect(first.headers.get('ETag')).toBe('"zip-etag"')
      expect(await bytes(first)).toEqual(image.slice(10, 20))

      // An encoded URL names the same file; a range past the end is clamped.
      const last = await fetch(new URL(`${ZIP}/morphology%202d/image.tif`), {
        headers: { Range: 'bytes=990-2000' },
      })

      expect(last.headers.get('Content-Range')).toBe('bytes 990-999/1000')
      expect(await bytes(last)).toEqual(image.slice(990))

      // The local header is read once; every read skips the HTTP cache.
      expect(requests).toHaveLength(3)
      expect(requests.every((request) => request.url === ZIP)).toBe(true)
      expect(fetcher.mock.calls.map(([, init]) => init?.cache)).toEqual([
        'no-store',
        'no-store',
        'no-store',
      ])
    },
  )

  it('answers open, suffix, and unsatisfiable ranges as a host would', async () => {
    const { fetch } = await openFolder()
    const url = `${ZIP}/morphology 2d/image.tif`

    const suffix = await fetch(url, { headers: { Range: 'bytes=-5' } })
    expect(suffix.headers.get('Content-Range')).toBe('bytes 995-999/1000')
    expect(await bytes(suffix)).toEqual(image.slice(995))

    const open = await fetch(new Request(url, { headers: { Range: 'bytes=998-' } }))
    expect(await bytes(open)).toEqual(image.slice(998))

    const beyond = await fetch(url, { headers: { Range: 'bytes=1000-' } })
    expect(beyond.status).toBe(416)
    expect(beyond.headers.get('Content-Range')).toBe('bytes */1000')

    await expect(
      fetch(url, { headers: { Range: 'bytes=0-1,5-6' } }),
    ).rejects.toBeInstanceOf(ZipFolderError)
  })

  it('answers HEAD from the zip directory and a whole GET in one range', async () => {
    const { fetch, requests } = await openFolder()
    const url = `${ZIP}/morphology 2d/image.tif`

    const head = await fetch(url, { method: 'HEAD' })

    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Length')).toBe('1000')
    expect(head.headers.get('Accept-Ranges')).toBe('bytes')
    expect(head.headers.get('ETag')).toBe('"zip-etag"')
    expect(requests).toHaveLength(0)

    const whole = await fetch(url)

    expect(whole.status).toBe(200)
    expect(whole.headers.get('Content-Length')).toBe('1000')
    expect(await bytes(whole)).toEqual(image)
    expect(JSON.parse(await (await fetch(`${ZIP}/experiment.spatial`)).text())).toEqual({
      pixel_size: 0.2125,
    })

    const empty = await fetch(`${ZIP}/empty.bin`)
    expect(empty.status).toBe(200)
    expect(await bytes(empty)).toEqual(new Uint8Array(0))
  })

  it('inflates a deflated file whole, and ranges of it when it is small', async () => {
    const { fetch } = await openFolder()
    const url = `${ZIP}/notes.txt`

    expect((await fetch(url, { method: 'HEAD' })).headers.get('Accept-Ranges')).toBe(
      'none',
    )
    expect(await (await fetch(url)).text()).toBe('notes '.repeat(200))

    const range = await fetch(url, { headers: { Range: 'bytes=6-10' } })

    expect(range.status).toBe(206)
    expect(range.headers.get('Content-Range')).toBe(`bytes 6-10/${notes.length}`)
    expect(await range.text()).toBe('notes')
  })

  it('refuses ranges of a large deflated file without reading the zip', async () => {
    const fetcher = vi.fn()
    const directory: ZipDirectory = {
      url: ZIP,
      byteLength: 1_000_000,
      entries: new Map([
        [
          'transcripts.zarr.zip',
          {
            name: 'transcripts.zarr.zip',
            method: 8,
            compressedSize: 100,
            size: 64 * 1024 * 1024,
            localHeaderOffset: 0,
          },
        ],
      ]),
    }
    registerZipFolder({ url: ZIP, root: '', directory }, fetcher)

    await expect(
      withZipFolders(fetcher)(`${ZIP}/transcripts.zarr.zip`, {
        headers: { Range: 'bytes=0-99' },
      }),
    ).rejects.toThrow(
      'transcripts.zarr.zip in run_outs.zip is compressed in the zip, so it cannot be read in parts.',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('answers 404 for files the zip lacks and passes other URLs on', async () => {
    const { fetch, requests, elsewhere } = await openFolder()

    expect((await fetch(`${ZIP}/explorer.json`)).status).toBe(404)
    expect((await fetch(`${ZIP}/`)).status).toBe(404)
    // Paths are relative to the folder holding the dataset.
    expect((await fetch(`${ZIP}/outs/experiment.spatial`)).status).toBe(404)
    expect(requests).toHaveLength(0)

    expect(await (await fetch(ZIP)).text()).toBe('elsewhere')
    expect(await (await fetch('https://example.test/runs/other.zip/a')).text()).toBe(
      'elsewhere',
    )
    expect(elsewhere).toHaveBeenCalledTimes(2)
    expect(zipFolderFor(`${ZIP}`)?.root).toBe('outs/')
  })

  it("lets one reader's abort leave a shared local header read to the others", async () => {
    const { fetch } = await openFolder()
    const url = `${ZIP}/morphology 2d/image.tif`
    const controller = new AbortController()

    const aborted = fetch(url, {
      headers: { Range: 'bytes=0-9' },
      signal: controller.signal,
    })
    const other = fetch(url, { headers: { Range: 'bytes=0-9' } })
    controller.abort()

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    expect(await bytes(await other)).toEqual(image.slice(0, 10))
    await expect(fetch(url, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('rejects a cancelled read with the abort, not the failure it caused', async () => {
    const zip = archive(false)
    const host = byteRangeFetcher(new Map([[ZIP, zip]]))
    const directory = await readZipDirectory(ZIP, { fetcher: host })
    // Reads of the file stall until cancelled, then fail as Chromium reports
    // a failed body read of a Response built from a stream.
    registerZipFolder({ url: ZIP, root: 'outs/', directory }, async (input, init) => {
      const signal = init?.signal

      if (signal === undefined || signal === null) {
        return host(input, init)
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => {
            controller.error(new TypeError('Failed to fetch'))
          })
        },
      })
      return new Response(body, { status: 206 })
    })
    const controller = new AbortController()

    const response = await withZipFolders(vi.fn())(`${ZIP}/morphology 2d/image.tif`, {
      headers: { Range: 'bytes=0-9' },
      signal: controller.signal,
    })
    const read = response.arrayBuffer()
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports a host that ignores ranges', async () => {
    const zip = archive(false)
    const directory = await readZipDirectory(ZIP, {
      fetcher: byteRangeFetcher(new Map([[ZIP, zip]])),
    })
    registerZipFolder(
      { url: ZIP, root: 'outs/', directory },
      async () => new Response(Uint8Array.from(zip), { status: 200 }),
    )

    await expect(
      withZipFolders(vi.fn())(`${ZIP}/morphology 2d/image.tif`, {
        headers: { Range: 'bytes=0-9' },
      }),
    ).rejects.toThrow(
      'run_outs.zip: the host does not answer byte-range requests, so outs/morphology 2d/image.tif cannot be read from the zip.',
    )
  })

  it('finds the shallowest folder holding a file, ignoring macOS folders', () => {
    expect(
      zipFolderRoot(
        [
          '__MACOSX/experiment.spatial',
          'run/outs/experiment.spatial',
          'run/experiment.spatial',
        ],
        'experiment.spatial',
      ),
    ).toBe('run/')
    expect(zipFolderRoot(['experiment.spatial'], 'experiment.spatial')).toBe('')
    expect(zipFolderRoot(['a/experiment.xenium'], 'experiment.spatial')).toBeUndefined()
  })
})
