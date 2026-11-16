import type { SchemaElement } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import { readParquetStructure } from '../../data/parquetStructure'
import { spatialDataShapesFixtureBytes } from '../../test/spatialDataShapesFixtures'
import { rangeFetcher, xeniumCellsFixtureBytes } from '../../test/xeniumCellsFixtures'
import {
  compressionLabel,
  formatPreviewValue,
  formatStatValue,
  geoColumnFacts,
  isParquetUrl,
  keyValueText,
  parquetAnnotationLabel,
  parquetColumnRole,
  parquetContentsLabel,
  parquetConventions,
  parquetNodeSummary,
  parquetTypeLabel,
  previewReadBound,
} from './parquetStructureModel'
import { findNode } from './structureTree'

describe('parquet structure model', () => {
  it('recognises Parquet file addresses', () => {
    for (const url of [
      'https://bucket.test/run/cells.parquet',
      'https://bucket.test/run/CELLS.PARQUET',
      'https://bucket.test/sample.zarr/shapes/cells/shapes.parquet?x=1',
      'https://bucket.test/table.parq',
      '  https://bucket.test/table.pq  ',
    ]) {
      expect(isParquetUrl(url), url).toBe(true)
    }

    for (const url of [
      '',
      'cells.parquet',
      'https://bucket.test/sample.zarr',
      'https://bucket.test/points.parquet/',
      'https://bucket.test/cells.csv',
    ]) {
      expect(isParquetUrl(url), url).toBe(false)
    }
  })

  it('names types as a reader sees them, and as the file stores them', () => {
    const cases: readonly [SchemaElement, string, string | null][] = [
      [
        { name: 'a', type: 'BYTE_ARRAY', logical_type: { type: 'STRING' } },
        'string',
        'STRING',
      ],
      [{ name: 'a', type: 'BYTE_ARRAY', converted_type: 'UTF8' }, 'string', 'UTF8'],
      [{ name: 'a', type: 'BYTE_ARRAY' }, 'binary', null],
      [{ name: 'a', type: 'DOUBLE' }, 'double', null],
      [
        {
          name: 'a',
          type: 'INT32',
          logical_type: { type: 'INTEGER', bitWidth: 8, isSigned: false },
        },
        'uint8',
        'INTEGER(8, unsigned)',
      ],
      [
        {
          name: 'a',
          type: 'INT64',
          logical_type: { type: 'TIMESTAMP', unit: 'MICROS', isAdjustedToUTC: true },
        },
        'timestamp[us, UTC]',
        'TIMESTAMP(MICROS, UTC)',
      ],
      [
        { name: 'a', type: 'INT32', converted_type: 'DECIMAL', precision: 9, scale: 2 },
        'decimal(9, 2)',
        'DECIMAL',
      ],
      [
        { name: 'a', type: 'FIXED_LEN_BYTE_ARRAY', type_length: 16 },
        'fixed binary[16]',
        null,
      ],
      [{ name: 'a', num_children: 1, logical_type: { type: 'LIST' } }, 'list', 'LIST'],
      [{ name: 'a', num_children: 2 }, 'struct', null],
    ]

    for (const [element, type, annotation] of cases) {
      expect(parquetTypeLabel(element)).toBe(type)
      expect(parquetAnnotationLabel(element)).toBe(annotation)
    }
  })

  it('reads GeoParquet and pandas roles from the key-value metadata', async () => {
    const structure = await readParquetStructure(
      { url: 'https://bucket.test/shapes.parquet' },
      { fetcher: rangeFetcher(spatialDataShapesFixtureBytes('cell_boundaries.parquet')) },
    )
    const geometry = findNode(structure.root, 'geometry')
    const index = findNode(structure.root, '__index_level_0__')

    expect(parquetConventions(structure)).toEqual([
      'GeoParquet 1.1.0',
      'pandas',
      'Arrow schema',
    ])
    expect(parquetContentsLabel(structure)).toBe('4 rows · 2 columns · 1 row group')
    expect(geometry === undefined ? null : parquetColumnRole(structure, geometry)).toBe(
      'WKB geometry',
    )
    expect(index === undefined ? null : parquetColumnRole(structure, index)).toBe(
      'pandas index',
    )
    expect(geometry === undefined ? null : geoColumnFacts(structure, geometry)).toEqual({
      encoding: 'WKB',
      primary: true,
      geometryTypes: ['Polygon', 'MultiPolygon', 'Polygon Z'],
      crs: 'None given',
      bbox: '[0, 0, 15, 12]',
    })
    expect(index === undefined ? null : geoColumnFacts(structure, index)).toBeNull()
    expect(index === undefined ? '' : parquetNodeSummary(index)).toMatch(
      /^string · \d+ B$/,
    )
    expect(parquetNodeSummary(structure.root)).toBe('2 fields')

    const arrow = structure.keyValueMetadata.find((entry) => entry.key === 'ARROW:schema')
    expect(arrow === undefined ? null : keyValueText(arrow)).toEqual({
      text: '',
      note: expect.stringContaining('base64'),
    })
  })

  it('formats statistics and sizes', () => {
    expect(formatStatValue(10.5)).toBe('10.5')
    expect(formatStatValue(12_345_678_901n)).toBe('12,345,678,901')
    expect(formatStatValue('a'.repeat(100))).toBe(`"${'a'.repeat(80)}…"`)
    expect(formatStatValue(new Date(Date.UTC(2024, 0, 2)))).toBe(
      '2024-01-02T00:00:00.000Z',
    )
    expect(formatStatValue(false)).toBe('false')
    expect(compressionLabel(1_000, 3_000)).toBe('1 KB (3 KB uncompressed, 3×)')
    expect(compressionLabel(1_000, 1_050)).toBe('1 KB (1.05 KB uncompressed)')
    expect(compressionLabel(5_100, 52_800_000)).toBe(
      '5.1 KB (52.8 MB uncompressed, 10,353×)',
    )
  })

  it('formats previewed values, with WKB as geometry', () => {
    const point = new Uint8Array(21)
    const view = new DataView(point.buffer)
    point[0] = 1
    view.setUint32(1, 1, true)
    view.setFloat64(5, 4131.5, true)
    view.setFloat64(13, -2, true)
    const polygon = new Uint8Array(9 + 4 + 5 * 16)
    const polygonView = new DataView(polygon.buffer)
    polygon[0] = 1
    polygonView.setUint32(1, 3, true)
    polygonView.setUint32(5, 1, true)
    polygonView.setUint32(9, 5, true)

    expect(formatPreviewValue(null)).toBeNull()
    expect(formatPreviewValue(undefined)).toBeNull()
    expect(formatPreviewValue('a'.repeat(70))).toBe(`${'a'.repeat(60)}…`)
    expect(formatPreviewValue(1234567)).toBe('1234567')
    expect(formatPreviewValue(9_007_199_254_740_993n)).toBe('9007199254740993')
    expect(formatPreviewValue(new Date(Date.UTC(2024, 0, 1, 0, 0, 1)))).toBe(
      '2024-01-01T00:00:01.000Z',
    )
    expect(formatPreviewValue(Uint8Array.of(1, 2, 255))).toBe('3 bytes: 0x0102ff')
    expect(formatPreviewValue(point, { wkb: true })).toBe('Point (4131.5, -2)')
    expect(formatPreviewValue(polygon, { wkb: true })).toBe('Polygon, 5 points')
    // Not WKB after all: shown as bytes.
    expect(formatPreviewValue(Uint8Array.of(9, 9), { wkb: true })).toBe('2 bytes: 0x0909')
    expect(formatPreviewValue({ x: 1n, tags: ['a'] })).toBe('{"x":"1","tags":["a"]}')
  })

  it('bounds what a row preview reads by its row group', async () => {
    const structure = await readParquetStructure(
      { url: 'https://bucket.test/cells.parquet' },
      { fetcher: rangeFetcher(xeniumCellsFixtureBytes('cells.parquet')) },
    )

    expect(previewReadBound(structure)).toBe(structure.rowGroups[0]?.compressedBytes)
    expect(
      previewReadBound({
        ...structure,
        metadata: { ...structure.metadata, row_groups: [] },
      }),
    ).toBeNull()
  })
})
