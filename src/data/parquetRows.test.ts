import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spatialDataShapesFixtureBytes } from '../test/spatialDataShapesFixtures'
import { rangeFetcher, xeniumCellsFixtureBytes } from '../test/xeniumCellsFixtures'
import { byteRangeFetcher, zipArchive, type ByteRangeRequest } from '../test/zipFixtures'
import { readParquetRows } from './parquetRows'
import { readParquetStructure } from './parquetStructure'

// src/test/fixtures/parquet (see make_fixtures.py there).
function parquetFixture(name: 'pages.parquet' | 'nested.parquet'): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/parquet', name)),
  )
}

async function preview(bytes: Uint8Array, rows?: number) {
  const fetcher = rangeFetcher(bytes)
  const structure = await readParquetStructure(
    { url: 'https://bucket.test/file.parquet' },
    { fetcher },
  )
  return readParquetRows(structure, { fetcher, ...(rows === undefined ? {} : { rows }) })
}

function values(rows: Awaited<ReturnType<typeof preview>>, name: string) {
  return rows.columns.find((column) => column.name === name)?.values
}

describe('readParquetRows', () => {
  it('reads the first rows of each top-level column', async () => {
    const rows = await preview(parquetFixture('pages.parquet'))

    expect(rows).toMatchObject({ rowCount: 20, rowGroup: 0 })
    expect(rows.columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'score',
      'seen',
      'flag',
    ])
    expect(values(rows, 'id')?.slice(0, 3)).toEqual([0n, 1n, 2n])
    expect(values(rows, 'id')).toHaveLength(20)
    expect(values(rows, 'name')?.slice(0, 2)).toEqual(['cell-00000', 'cell-00001'])
    expect(values(rows, 'score')?.slice(0, 3)).toEqual([null, 0.25, 0.5])
    expect(values(rows, 'seen')?.[1]).toEqual(new Date('2024-01-01T00:00:01Z'))
    expect(values(rows, 'flag')?.slice(0, 2)).toEqual([true, false])
    expect(rows.bytesRead).toBeGreaterThan(0)
  })

  it('fetches the start of a column chunk, not all of it', async () => {
    const bytes = parquetFixture('pages.parquet')
    const url = 'https://bucket.test/pages.parquet'
    const requests: ByteRangeRequest[] = []
    const fetcher = byteRangeFetcher(new Map([[url, bytes]]), requests)
    const structure = await readParquetStructure({ url }, { fetcher })
    const id = structure.metadata.row_groups[0]?.columns[0]?.meta_data
    const start = Number(id?.data_page_offset)
    const end = start + Number(id?.total_compressed_size)
    requests.length = 0

    await readParquetRows(structure, { fetcher })

    // 5,000 ids in ~1 KB pages, ~20 KB in all; 20 rows sit in the first page.
    const fetched = requests
      .map((request) => /^bytes=(\d+)-(\d+)$/.exec(request.range ?? ''))
      .filter(
        (match) => match !== null && Number(match[1]) >= start && Number(match[1]) < end,
      )
      .reduce((total, match) => total + Number(match?.[2]) - Number(match?.[1]) + 1, 0)
    expect(end - start).toBeGreaterThan(15_000)
    expect(fetched).toBeLessThan(10_000)
    expect(requests.some((request) => request.method === 'HEAD')).toBe(false)
  })

  it('reads further pages when the first ones hold too few rows', async () => {
    const rows = await preview(parquetFixture('pages.parquet'), 1_200)

    expect(values(rows, 'id')).toHaveLength(1_200)
    expect(values(rows, 'id')?.[1_199]).toBe(1_199n)
    expect(values(rows, 'score')?.[1_199]).toBe(1_199 / 4)
  })

  it('assembles nested columns', async () => {
    const rows = await preview(parquetFixture('nested.parquet'))

    expect(rows.rowCount).toBe(3)
    expect(values(rows, 'id')).toEqual([1, 2, 3])
    expect(values(rows, 'tags')).toEqual([['a', 'b'], [], undefined])
    expect(values(rows, 'point')).toEqual([{ x: 1.5, y: 2.5 }, { x: 3, y: 4 }, undefined])
  })

  it('stops at the first row group, and keeps binary columns as bytes', async () => {
    const cells = await preview(xeniumCellsFixtureBytes('cells.parquet'))
    // Row groups of 4 cells.
    expect(cells).toMatchObject({ rowCount: 4, rowGroup: 0 })
    expect(values(cells, 'cell_id')?.[0]).toBe('bcdeklmn-1')
    expect(values(cells, 'cell_area')).toEqual([30, 31, 32, null])

    const shapes = await preview(spatialDataShapesFixtureBytes('cell_boundaries.parquet'))
    expect(values(shapes, 'geometry')?.[0]).toBeInstanceOf(Uint8Array)
    expect(values(shapes, '__index_level_0__')?.[0]).toBe('aaaa-1')
  })

  it('reads rows from a file inside a zipped store', async () => {
    const url = 'https://bucket.test/sample.zarr.zip'
    const fetcher = byteRangeFetcher(
      new Map([
        [
          url,
          zipArchive([
            { name: 'sample.zarr/.zgroup', data: new TextEncoder().encode('{}') },
            {
              name: 'sample.zarr/shapes/circles/shapes.parquet',
              data: spatialDataShapesFixtureBytes('cell_circles.parquet'),
              deflate: true,
            },
          ]),
        ],
      ]),
    )
    const structure = await readParquetStructure(
      { url, zipPath: 'shapes/circles/shapes.parquet' },
      { fetcher },
    )
    const rows = await readParquetRows(structure, { fetcher })

    expect(values(rows, 'radius')).toEqual([1, 2, 1.5])
    expect(values(rows, '__index_level_0__')).toEqual([7n, 8n, 9n])
  })

  it('stops when aborted', async () => {
    const bytes = parquetFixture('pages.parquet')
    const fetcher = rangeFetcher(bytes)
    const structure = await readParquetStructure(
      { url: 'https://bucket.test/file.parquet' },
      { fetcher },
    )
    const controller = new AbortController()
    controller.abort()

    await expect(
      readParquetRows(structure, { fetcher, signal: controller.signal }),
    ).rejects.toThrow()
  })
})
