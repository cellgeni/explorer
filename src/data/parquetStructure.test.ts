import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileMetaData, SchemaElement } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import { spatialDataShapesFixtureBytes } from '../test/spatialDataShapesFixtures'
import { rangeFetcher, xeniumCellsFixtureBytes } from '../test/xeniumCellsFixtures'
import { byteRangeFetcher, zipArchive } from '../test/zipFixtures'
import {
  NotParquetFileError,
  ParquetFileNotFoundError,
  parquetStructureFromMetadata,
  readParquetStructure,
  type ParquetSchemaNode,
} from './parquetStructure'

const ORIGIN = 'https://bucket.test'

function findNode(node: ParquetSchemaNode, path: string): ParquetSchemaNode | undefined {
  if (node.path === path) return node
  return node.children.map((child) => findNode(child, path)).find(Boolean)
}

function column(root: ParquetSchemaNode, path: string) {
  return findNode(root, path)?.column
}

describe('readParquetStructure', () => {
  it("reads a file's footer: schema, row groups and each column's totals", async () => {
    const url = `${ORIGIN}/run/cells.parquet`
    const bytes = xeniumCellsFixtureBytes('cells.parquet')
    const structure = await readParquetStructure(
      { url },
      { fetcher: rangeFetcher(bytes) },
    )

    expect(structure).toMatchObject({
      ref: { url },
      byteLength: bytes.byteLength,
      formatVersion: 2,
      createdBy: 'parquet-cpp-arrow version 26.0.1',
      rowCount: 10,
      columnCount: 8,
    })
    expect(structure.root.name).toBe('cells.parquet')
    expect(structure.root.children.map((child) => child.name)).toEqual([
      'cell_id',
      'x_centroid',
      'y_centroid',
      'transcript_counts',
      'total_counts',
      'cell_area',
      'nucleus_count',
      'segmentation_method',
    ])
    expect(structure.rowGroups).toEqual([
      expect.objectContaining({ rowCount: 4, uncompressedBytes: 1027 }),
      expect.objectContaining({ rowCount: 4, uncompressedBytes: 965 }),
      expect.objectContaining({ rowCount: 2, uncompressedBytes: 818 }),
    ])
    expect(structure.keyValueMetadata.map((entry) => entry.key)).toEqual(['ARROW:schema'])

    // Statistics combine over the three row groups.
    expect(column(structure.root, 'x_centroid')).toMatchObject({
      index: 1,
      codecs: ['ZSTD'],
      encodings: ['RLE', 'PLAIN'],
      valueCount: 10,
      nullCount: 0,
      min: 10.5,
      max: 19.5,
      dictionary: false,
      pageIndex: false,
      bloomFilter: false,
    })
    expect(column(structure.root, 'transcript_counts')).toMatchObject({
      min: 100n,
      max: 109n,
    })
    expect(column(structure.root, 'cell_area')?.nullCount).toBe(1)
    expect(column(structure.root, 'cell_id')).toMatchObject({
      min: 'bcdeklmn-1',
      max: 'bcdeklng-1',
    })
    const compressed = structure.root.children.reduce(
      (total, child) => total + (child.column?.compressedBytes ?? 0),
      0,
    )
    expect(structure.compressedBytes).toBe(compressed)
  })

  it('parses JSON key-value metadata and hides binary statistics', async () => {
    const structure = await readParquetStructure(
      { url: `${ORIGIN}/sample.zarr/shapes/cells/shapes.parquet` },
      { fetcher: rangeFetcher(spatialDataShapesFixtureBytes('cell_boundaries.parquet')) },
    )
    const geo = structure.keyValueMetadata.find((entry) => entry.key === 'geo')

    expect(geo?.json).toMatchObject({ version: '1.1.0', primary_column: 'geometry' })
    // WKB, so its statistics are bytes, not text.
    const geometry = column(structure.root, 'geometry')
    expect(geometry).toMatchObject({ dictionary: true, codecs: ['SNAPPY'] })
    expect(geometry).not.toHaveProperty('min')
    expect(geometry).not.toHaveProperty('max')
    expect(column(structure.root, '__index_level_0__')).toMatchObject({
      min: 'aaaa-1',
      max: 'aaad-1',
    })
  })

  it('reads a file inside a zipped store', async () => {
    const url = `${ORIGIN}/sample.zarr.zip`
    const fetcher = byteRangeFetcher(
      new Map([
        [
          url,
          zipArchive([
            { name: 'sample.zarr/.zgroup', data: new TextEncoder().encode('{}') },
            {
              name: 'sample.zarr/shapes/cells/shapes.parquet',
              data: spatialDataShapesFixtureBytes('cell_circles.parquet'),
            },
          ]),
        ],
      ]),
    )
    const structure = await readParquetStructure(
      { url, zipPath: 'shapes/cells/shapes.parquet' },
      { fetcher },
    )

    expect(structure.rowCount).toBe(3)
    expect(structure.root.name).toBe('shapes.parquet')
    expect(column(structure.root, 'radius')).toMatchObject({ min: 1, max: 2 })

    await expect(
      readParquetStructure({ url, zipPath: 'shapes/missing.parquet' }, { fetcher }),
    ).rejects.toBeInstanceOf(ParquetFileNotFoundError)
  })

  it('names the status of other failed reads', async () => {
    for (const [status, rangeOnly] of [
      [503, false],
      [429, false],
      [503, true],
    ] as const) {
      // With `rangeOnly`, the size probe succeeds and the footer read fails.
      const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) =>
        rangeOnly && init?.method === 'HEAD'
          ? new Response(null, { headers: { 'Content-Length': '1000' } })
          : new Response(null, { status })) as typeof fetch

      await expect(
        readParquetStructure({ url: `${ORIGIN}/busy.parquet` }, { fetcher }),
      ).rejects.toThrow(`${ORIGIN}/busy.parquet could not be read (HTTP ${status}).`)
    }
  })

  it('says when there is no file, or it is not Parquet', async () => {
    const missing = readParquetStructure(
      { url: `${ORIGIN}/missing.parquet` },
      { fetcher: byteRangeFetcher(new Map()) },
    )
    await expect(missing).rejects.toBeInstanceOf(ParquetFileNotFoundError)
    await expect(missing).rejects.toThrow('(HTTP 404)')

    // A refused HEAD is retried as a GET of one byte, as signed URLs need.
    const refused = (async () => new Response(null, { status: 403 })) as typeof fetch
    await expect(
      readParquetStructure({ url: `${ORIGIN}/private.parquet` }, { fetcher: refused }),
    ).rejects.toThrow('(HTTP 403)')

    const page = new TextEncoder().encode('<html><body>Not here</body></html>')
    await expect(
      readParquetStructure(
        { url: `${ORIGIN}/page.parquet` },
        { fetcher: rangeFetcher(page) },
      ),
    ).rejects.toBeInstanceOf(NotParquetFileError)
  })

  it('shows unsigned and integer-stored decimal statistics as the rows read', async () => {
    const bytes = new Uint8Array(
      readFileSync(
        join(process.cwd(), 'src/test/fixtures/parquet/unsigned-decimal.parquet'),
      ),
    )
    const structure = await readParquetStructure(
      { url: `${ORIGIN}/unsigned-decimal.parquet` },
      { fetcher: rangeFetcher(bytes) },
    )
    const bounds = (path: string) => {
      const summary = column(structure.root, path)
      return [summary?.min, summary?.max]
    }

    expect(bounds('u32')).toEqual([1, 3_000_000_000])
    expect(bounds('u64')).toEqual([1n, 2n ** 63n + 5n])
    expect(bounds('dec9')).toEqual([1.5, 123.45])
    expect(bounds('dec18')).toEqual([1.5, 123.45])
  })

  it('says a file too short for a footer is not Parquet', async () => {
    for (const text of ['', 'PAR1', 'xxxPAR1', 'PAR1xxxPAR1']) {
      await expect(
        readParquetStructure(
          { url: `${ORIGIN}/short.parquet` },
          { fetcher: rangeFetcher(new TextEncoder().encode(text)) },
        ),
      ).rejects.toMatchObject({
        name: 'NotParquetFileError',
        message: expect.stringContaining('too short for a Parquet file'),
      })
    }
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      readParquetStructure(
        { url: `${ORIGIN}/cells.parquet` },
        {
          fetcher: rangeFetcher(xeniumCellsFixtureBytes('cells.parquet')),
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('parquetStructureFromMetadata', () => {
  const schema: SchemaElement[] = [
    { name: 'schema', num_children: 2 },
    { name: 'point', num_children: 2, repetition_type: 'OPTIONAL' },
    { name: 'x', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    { name: 'y', type: 'DOUBLE', repetition_type: 'REQUIRED' },
    {
      name: 'tags',
      num_children: 1,
      repetition_type: 'OPTIONAL',
      logical_type: { type: 'LIST' },
    },
    { name: 'list', num_children: 1, repetition_type: 'REPEATED' },
    { name: 'element', type: 'BYTE_ARRAY', repetition_type: 'OPTIONAL' },
  ]

  function chunk(
    path: readonly string[],
    type: 'DOUBLE' | 'BYTE_ARRAY',
    statistics: NonNullable<
      NonNullable<
        FileMetaData['row_groups'][number]['columns'][number]['meta_data']
      >['statistics']
    >,
  ): FileMetaData['row_groups'][number]['columns'][number] {
    return {
      file_offset: 0n,
      meta_data: {
        type,
        encodings: ['PLAIN'],
        path_in_schema: [...path],
        codec: 'GZIP',
        num_values: 2n,
        total_uncompressed_size: 40n,
        total_compressed_size: 20n,
        data_page_offset: 0n,
        statistics,
      },
    }
  }

  it('nests fields and combines statistics only when every row group has them', () => {
    const metadata: FileMetaData = {
      version: 1,
      schema,
      num_rows: 4n,
      metadata_length: 512,
      row_groups: [0, 1].map((group) => ({
        num_rows: 2n,
        total_byte_size: 120n,
        columns: [
          chunk(['point', 'x'], 'DOUBLE', {
            min_value: group * 10,
            max_value: group * 10 + 5,
            null_count: 0n,
          }),
          // Only the first row group counts nulls.
          chunk(['point', 'y'], 'DOUBLE', {
            min_value: 1,
            max_value: 2,
            ...(group === 0 ? { null_count: 1n } : {}),
          }),
          // Deprecated statistics of text are not trusted.
          chunk(['tags', 'list', 'element'], 'BYTE_ARRAY', { min: 'a', max: 'z' }),
        ],
      })),
    }
    const structure = parquetStructureFromMetadata(metadata, {
      ref: { url: `${ORIGIN}/nested.parquet` },
      byteLength: 2_000,
    })

    expect(structure.columnCount).toBe(3)
    expect(structure.rowGroups).toEqual([
      { rowCount: 2, compressedBytes: 60, uncompressedBytes: 120 },
      { rowCount: 2, compressedBytes: 60, uncompressedBytes: 120 },
    ])
    expect(findNode(structure.root, 'tags/list/element')).toMatchObject({
      name: 'element',
      fieldPath: ['tags', 'list', 'element'],
      column: { index: 2, valueCount: 4, compressedBytes: 40 },
    })
    expect(findNode(structure.root, 'point')?.column).toBeUndefined()
    expect(column(structure.root, 'point/x')).toMatchObject({
      min: 0,
      max: 15,
      nullCount: 0,
    })
    expect(column(structure.root, 'point/y')).not.toHaveProperty('nullCount')
    expect(column(structure.root, 'tags/list/element')).not.toHaveProperty('min')
  })
})
