import { describe, expect, it } from 'vitest'
import { byteRangeFetcher, zipArchive, type ByteRangeRequest } from '../test/zipFixtures'
import { openZippedZarrStore, ZarrZipRootError, zarrRootInZip } from './zarrZipStore'
import { isZarrZipUrl } from './zarrZipUrl'

const ZIP_URL = 'https://example.test/stores/sample.zarr.zip'
const encoder = new TextEncoder()

describe('zipped Zarr stores', () => {
  it('recognises zip URLs by suffix', () => {
    expect(isZarrZipUrl(ZIP_URL)).toBe(true)
    expect(isZarrZipUrl('https://example.test/stores/sample.ZIP?x=1')).toBe(true)
    expect(isZarrZipUrl('https://example.test/stores/sample.zarr')).toBe(false)
    expect(isZarrZipUrl('not a url')).toBe(false)
  })

  it('finds the store root at the top of the zip or in one folder', () => {
    expect(zarrRootInZip(ZIP_URL, ['.zgroup', '.zattrs', 'images/.zgroup'])).toBe('')
    expect(
      zarrRootInZip(ZIP_URL, [
        'sample.zarr/',
        'sample.zarr/tables/table/.zattrs',
        'sample.zarr/zarr.json',
        '__MACOSX/._zarr.json',
      ]),
    ).toBe('sample.zarr/')
  })

  it('rejects zips with no Zarr store or with several', () => {
    expect(() => zarrRootInZip(ZIP_URL, ['README.md', 'data/cells.parquet'])).toThrow(
      ZarrZipRootError,
    )
    expect(() =>
      zarrRootInZip(ZIP_URL, ['a.zarr/zarr.json', 'b.zarr/zarr.json']),
    ).toThrow('holds more than one Zarr store (a.zarr/, b.zarr/)')
  })

  it('reads keys relative to a store folder and stored files by range', async () => {
    const parquet = encoder.encode(`PAR1${'x'.repeat(4_000)}PAR1`)
    const requests: ByteRangeRequest[] = []
    const fetcher = byteRangeFetcher(
      new Map([
        [
          ZIP_URL,
          zipArchive([
            { name: 'sample.zarr/', data: new Uint8Array() },
            { name: 'sample.zarr/zarr.json', data: encoder.encode('{"zarr_format":3}') },
            { name: 'sample.zarr/shapes/cells/shapes.parquet', data: parquet },
            { name: 'notes.txt', data: encoder.encode('outside the store') },
          ]),
        ],
      ]),
      requests,
    )
    const zip = await openZippedZarrStore(ZIP_URL, { fetcher })

    expect(zip.root).toBe('sample.zarr/')
    expect(zip.fileCount).toBe(2)
    expect(zip.entry('notes.txt')).toBeUndefined()
    expect(zip.entry('shapes/cells/shapes.parquet')).toEqual({
      size: parquet.length,
      compressed: false,
    })
    expect(new TextDecoder().decode(await zip.store.get('/zarr.json'))).toBe(
      '{"zarr_format":3}',
    )
    expect(zip.file('shapes/cells/missing.parquet')).toBeNull()

    const file = zip.file('shapes/cells/shapes.parquet')
    expect(file?.byteLength).toBe(parquet.length)
    requests.length = 0
    const footer = await file?.slice(parquet.length - 4)

    expect(new TextDecoder().decode(footer)).toBe('PAR1')
    // The local header, then the 4 footer bytes; not the whole entry.
    expect(requests.map((request) => rangeLength(request.range))).toEqual([30, 4])
    // Opening again with the same fetcher reuses the store.
    await expect(openZippedZarrStore(ZIP_URL, { fetcher })).resolves.toBe(zip)
  })

  it('inflates a compressed file once for all its slices', async () => {
    const url = 'https://example.test/stores/deflated.zarr.zip'
    const parquet = encoder.encode(`PAR1${'y'.repeat(10_000)}PAR1`)
    const requests: ByteRangeRequest[] = []
    const fetcher = byteRangeFetcher(
      new Map([
        [
          url,
          zipArchive([
            { name: '.zgroup', data: encoder.encode('{"zarr_format":2}') },
            { name: 'shapes/cells/shapes.parquet', data: parquet, deflate: true },
          ]),
        ],
      ]),
      requests,
    )
    const zip = await openZippedZarrStore(url, { fetcher })
    const file = zip.file('shapes/cells/shapes.parquet')

    expect(zip.root).toBe('')
    expect(zip.entry('shapes/cells/shapes.parquet')).toEqual({
      size: parquet.length,
      compressed: true,
    })
    requests.length = 0
    const [head, tail] = await Promise.all([
      file?.slice(0, 4),
      file?.slice(-4 + parquet.length),
    ])

    expect(new TextDecoder().decode(head)).toBe('PAR1')
    expect(new TextDecoder().decode(tail)).toBe('PAR1')
    // One local header read and one read of the compressed data.
    expect(requests).toHaveLength(2)
  })

  it('rejects a zip with no Zarr store', async () => {
    const url = 'https://example.test/stores/other.zip'
    const fetcher = byteRangeFetcher(
      new Map([[url, zipArchive([{ name: 'README.md', data: encoder.encode('hi') }])]]),
    )

    await expect(openZippedZarrStore(url, { fetcher })).rejects.toThrow(
      `The zip at ${url} holds no Zarr store`,
    )
  })
})

function rangeLength(range: string | null): number {
  const [start, end] = (range ?? '').replace('bytes=', '').split('-').map(Number)
  return (end ?? Number.NaN) - (start ?? Number.NaN) + 1
}
