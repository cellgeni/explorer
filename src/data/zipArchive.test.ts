import { describe, expect, it } from 'vitest'
import { byteRangeFetcher, zipArchive, type ByteRangeRequest } from '../test/zipFixtures'
import { readZipDirectory, readZipEntry, ZipArchiveError } from './zipArchive'

const URL = 'https://example.test/region_0.vzg'
const pyramid = Uint8Array.from({ length: 200_000 }, (_, index) => (index * 7919) % 251)
const manifest = new TextEncoder().encode('{"microns_per_pixel": 0.108}')

function archive(zip64: boolean): Uint8Array {
  return zipArchive(
    [
      { name: 'pictures/', data: new Uint8Array(0) },
      { name: 'pictures/manifest.json', data: manifest, deflate: true },
      { name: 'pictures/pyrmosaic_DAPI_z3.tif', data: pyramid, deflate: true },
      { name: 'stored.bin', data: pyramid.subarray(0, 1000) },
    ],
    { zip64 },
  )
}

describe('zip archives', () => {
  it.each([false, true])(
    'lists entries and inflates one in one request (ZIP64 %s)',
    async (zip64) => {
      const requests: ByteRangeRequest[] = []
      const fetcher = byteRangeFetcher(new Map([[URL, archive(zip64)]]), requests)
      const directory = await readZipDirectory(URL, { fetcher })

      expect(Array.from(directory.entries.keys())).toEqual([
        'pictures/manifest.json',
        'pictures/pyrmosaic_DAPI_z3.tif',
        'stored.bin',
      ])
      expect(directory.entries.get('pictures/pyrmosaic_DAPI_z3.tif')).toMatchObject({
        method: 8,
        size: pyramid.length,
      })

      requests.length = 0
      const progress: number[] = []
      const entry = directory.entries.get('pictures/pyrmosaic_DAPI_z3.tif')!
      const bytes = await readZipEntry(URL, entry, {
        fetcher,
        onProgress: (received) => progress.push(received),
      })

      expect(bytes).toEqual(pyramid)
      expect(requests).toHaveLength(1)
      expect(progress.at(-1)).toBe(entry.compressedSize)
      expect(
        await readZipEntry(URL, directory.entries.get('stored.bin')!, { fetcher }),
      ).toEqual(pyramid.subarray(0, 1000))
      expect(
        new TextDecoder().decode(
          await readZipEntry(URL, directory.entries.get('pictures/manifest.json')!, {
            fetcher,
          }),
        ),
      ).toBe('{"microns_per_pixel": 0.108}')
    },
  )

  it.each([false, true])(
    'reads an entry whose local extra field is longer than 1 KiB (deflated %s)',
    async (deflate) => {
      const requests: ByteRangeRequest[] = []
      const fetcher = byteRangeFetcher(
        new Map([
          [
            URL,
            zipArchive([
              {
                name: 'padded.bin',
                data: pyramid,
                deflate,
                localExtra: new Uint8Array(3000),
              },
            ]),
          ],
        ]),
        requests,
      )
      const directory = await readZipDirectory(URL, { fetcher })
      requests.length = 0

      await expect(
        readZipEntry(URL, directory.entries.get('padded.bin')!, { fetcher }),
      ).resolves.toEqual(pyramid)
      // The first range, then the rest of the data.
      expect(requests).toHaveLength(2)
    },
  )

  it('finds the end record when the archive comment holds its signature', async () => {
    const comment = new Uint8Array(40)
    comment.set([0x50, 0x4b, 0x05, 0x06], 10)
    const fetcher = byteRangeFetcher(
      new Map([[URL, zipArchive([{ name: 'a.bin', data: manifest }], { comment })]]),
    )

    const directory = await readZipDirectory(URL, { fetcher })

    expect(Array.from(directory.entries.keys())).toEqual(['a.bin'])
  })

  it('reads backslashes in entry names as folder separators', async () => {
    const fetcher = byteRangeFetcher(
      new Map([
        [URL, zipArchive([{ name: 'outs\\analysis\\clusters.csv', data: manifest }])],
      ]),
    )

    const directory = await readZipDirectory(URL, { fetcher })

    expect(Array.from(directory.entries.keys())).toEqual(['outs/analysis/clusters.csv'])
    const bytes = await readZipEntry(
      URL,
      directory.entries.get('outs/analysis/clusters.csv')!,
      { fetcher },
    )
    expect(new TextDecoder().decode(bytes)).toBe('{"microns_per_pixel": 0.108}')
  })

  it('reports files that are not zips, and hosts without ranges', async () => {
    const notZip = byteRangeFetcher(new Map([[URL, new Uint8Array(100)]]))
    await expect(readZipDirectory(URL, { fetcher: notZip })).rejects.toThrow(
      'region_0.vzg: is not a zip (no end of central directory).',
    )

    const bytes = archive(false)
    const noRanges = (async (...[, init]: Parameters<typeof fetch>) =>
      init?.method === 'HEAD'
        ? new Response(null, { headers: { 'Content-Length': String(bytes.length) } })
        : new Response(bytes.slice())) as typeof fetch
    await expect(readZipDirectory(URL, { fetcher: noRanges })).rejects.toThrow(
      ZipArchiveError,
    )
  })

  it('refuses an entry whose data does not match its size', async () => {
    const fetcher = byteRangeFetcher(new Map([[URL, archive(true)]]))
    const directory = await readZipDirectory(URL, { fetcher })
    const entry = directory.entries.get('pictures/pyrmosaic_DAPI_z3.tif')!

    await expect(
      readZipEntry(URL, { ...entry, size: entry.size - 1 }, { fetcher }),
    ).rejects.toThrow('is longer than its directory entry')
  })
})
