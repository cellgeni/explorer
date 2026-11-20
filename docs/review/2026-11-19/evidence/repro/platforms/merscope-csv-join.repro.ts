// MERSCOPE CSV join and cell-ID fidelity (review 2026-11-19, sub-area MERSCOPE).
// Expected values are written by hand from the inputs below, not from
// production helpers.
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/platforms/merscope-csv-join.repro.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { describe, expect, it } from 'vitest'
import { micrometers } from '../../../../../../src/data/coords'
import { MerscopeDataset } from '../../../../../../src/datasets/merscopeDataset'
import {
  parseMerscopeCellByGene,
  parseMerscopeCellMetadata,
} from '../../../../../../src/datasets/merscopeFormat'
import { readMerscopeTable } from '../../../../../../src/datasets/merscopeTableReader'
import { readSpatialDataShapes } from '../../../../../../src/datasets/spatialDataShapes'
import { IDENTITY_AFFINE } from '../../../../../../src/datasets/spatialDataTransforms'

const ROOT = 'https://example.test/region'
// Two 19-digit IDs that are the same IEEE double (both 1234567890123456768).
const ID_1 = '1234567890123456789'
const ID_2 = '1234567890123456790'
const ID_3 = '1234567890123456791'
const ID_COUNTS_ONLY = '1234567890123456792'
const ID_META_ONLY = '1234567890123456793'

// cell_by_gene.csv: BOM, unnamed ID column, CRLF, three Blank columns,
// counts written as 0.0, rows in another order than the metadata.
const COUNTS =
  '﻿,GENE_A,GENE_B,Blank-1,Blank-2,Blank-3\r\n' +
  `${ID_2},0.0,7.0,1.0,0.0,2.0\r\n` +
  `${ID_1},3.0,0.0,0.0,0.0,0.0\r\n` +
  `${ID_COUNTS_ONLY},9.0,9.0,0.0,0.0,0.0\r\n` +
  `${ID_3},0.0,0.0,0.0,0.0,0.0\r\n`
// cell_metadata.csv: quoted IDs, reversed order, one metadata-only cell.
const METADATA =
  'EntityID,fov,volume,center_x,center_y,transcript_count\n' +
  `"${ID_META_ONLY}",9,1,50,50,1\n` +
  `"${ID_3}",2,30,30,300,0\n` +
  `"${ID_1}",1,10,10,100,3\n` +
  `"${ID_2}",1,20,20,200,10\n`

function fetcherFor(files: Readonly<Record<string, string | Uint8Array>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = files[url.slice(ROOT.length + 1)]

    if (body === undefined) {
      return new Response(null, { status: 404 })
    }

    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
    return new Response(bytes.slice(), {
      headers: { 'Content-Length': String(bytes.byteLength) },
    })
  }) as typeof fetch
}

describe('MERSCOPE cell IDs above 2^53', () => {
  it('precondition: ID_1 and ID_2 are the same double', () => {
    expect(Number(ID_1)).toBe(Number(ID_2))
  })

  it('joins by exact ID string across reordering, missing rows, BOM, CRLF, quotes', async () => {
    const table = await readMerscopeTable({
      files: {
        cellByGene: `${ROOT}/cell_by_gene.csv`,
        cellMetadata: `${ROOT}/cell_metadata.csv`,
      },
      fetcher: fetcherFor({ 'cell_by_gene.csv': COUNTS, 'cell_metadata.csv': METADATA }),
    })

    // cell_by_gene order, the counts-only and metadata-only cells left out.
    expect(table.ids).toEqual([ID_2, ID_1, ID_3])
    expect(table.countsOnlyCells).toBe(1)
    expect(table.metadataOnlyCells).toBe(1)
    expect(table.genes).toEqual(['GENE_A', 'GENE_B'])
    expect(table.blankColumnCount).toBe(3)
    expect(Array.from(table.spatial)).toEqual([20, 200, 10, 100, 30, 300])
    // CSR by hand: ID_2 -> GENE_B 7; ID_1 -> GENE_A 3; ID_3 -> nothing.
    expect(Array.from(table.indptr)).toEqual([0, 1, 2, 2])
    expect(Array.from(table.indices)).toEqual([1, 0])
    expect(Array.from(table.data)).toEqual([7, 3])
    const blank = table.obs.find((column) => column.name === 'blank_count')
    expect(blank).toEqual({
      name: 'blank_count',
      kind: 'numeric',
      values: new Float64Array([3, 0, 0]),
    })
    const fov = table.obs.find((column) => column.name === 'fov')
    expect(fov).toEqual({
      name: 'fov',
      kind: 'categorical',
      codes: new Int32Array([0, 0, 1]),
      categories: ['1', '2'],
    })
  })

  it('keeps the two IDs distinct through MerscopeDataset reads', async () => {
    const dataset = new MerscopeDataset({
      baseUrl: ROOT,
      files: {
        cellByGene: `${ROOT}/cell_by_gene.csv`,
        cellMetadata: `${ROOT}/cell_metadata.csv`,
      },
      fetcher: fetcherFor({ 'cell_by_gene.csv': COUNTS, 'cell_metadata.csv': METADATA }),
    })
    const [ids, overview, matrix, cells] = await Promise.all([
      dataset.cellIds(),
      dataset.overview(),
      dataset.matrix([ID_1, ID_2]),
      dataset.cells({
        kind: 'box',
        bbox: {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(100),
          maxY: micrometers(400),
        },
      }),
    ])

    expect(ids).toEqual([ID_2, ID_1, ID_3])
    expect(
      overview.map((point) => [point.cellId, point.position.x, point.transcriptCount]),
    ).toEqual([
      [ID_2, 20, 10],
      [ID_1, 10, 3],
      [ID_3, 30, 0],
    ])
    expect(matrix.cells.get(ID_1)).toMatchObject({ geneNames: ['GENE_A'], counts: [3] })
    expect(matrix.cells.get(ID_2)).toMatchObject({ geneNames: ['GENE_B'], counts: [7] })
    expect(cells.map((cell) => [cell.id, cell.transcriptCount]).sort()).toEqual(
      [
        [ID_1, 3],
        [ID_2, 10],
        [ID_3, 0],
      ].sort(),
    )
  })

  it('boundary EntityID (Parquet INT64) arrives as bigint and stays exact', async () => {
    // src/test/fixtures/merscope/cell_boundaries.parquet: INT64 EntityID,
    // 1577590100000000000 and ...001 are the same double (make_fixtures.py).
    const bytes = readFileSync(
      join(process.cwd(), 'src/test/fixtures/merscope/cell_boundaries.parquet'),
    )
    // Through Response, as production's wholeFile path does (same-realm ArrayBuffer).
    const file = await new Response(new Uint8Array(bytes)).arrayBuffer()
    const metadata = await parquetMetadataAsync(file)
    const raw = await parquetReadObjects({ file, metadata, columns: ['EntityID'] })
    expect(typeof raw[0]?.EntityID).toBe('bigint')

    const shapes = await readSpatialDataShapes({
      url: `${ROOT}/cell_boundaries.parquet`,
      affine: IDENTITY_AFFINE,
      idColumn: 'EntityID',
      planeColumn: 'ZIndex',
      wholeFile: true,
      fetcher: fetcherFor({ 'cell_boundaries.parquet': new Uint8Array(bytes) }),
    })
    // Planes 0-6 -> middle plane 3; 4 outlines on it (make_fixtures.py).
    expect(shapes.plane).toBe(3)
    expect(shapes.ids).toEqual([
      '1577590100000000000',
      '1577590100000000001',
      '1577590100000000002',
      '1577590100000000099',
    ])
    // Plane 3 outlines are 8 um squares centred on (1010, 2010).
    expect(Array.from(shapes.bounds.subarray(0, 4))).toEqual([1006, 2006, 1014, 2014])
  })
})

describe('MERSCOPE CSV quoting (RFC 4180)', () => {
  it('a quoted metadata value containing a comma', () => {
    const text = 'EntityID,center_x,center_y,cell_type\n' + `${ID_1},1,1,"T cell, CD4+"\n`
    let outcome: string
    try {
      const metadata = parseMerscopeCellMetadata(text)
      outcome = `parsed: ${JSON.stringify(metadata.columns.at(-1))}`
    } catch (error) {
      outcome = `threw: ${(error as Error).message}`
    }
    console.log('[quoted comma]', outcome)
    // RFC 4180 reading: one cell, cell_type = 'T cell, CD4+'.
    expect(outcome).toBe(
      'parsed: {"name":"cell_type","kind":"text","values":["T cell, CD4+"]}',
    )
  })

  it('a quoted value with an escaped double quote', () => {
    const metadata = parseMerscopeCellMetadata(
      'EntityID,center_x,center_y,label\n' + `${ID_1},1,1,"a ""b"""\n`,
    )
    console.log('[escaped quote]', JSON.stringify(metadata.columns.at(-1)))
    expect(metadata.columns.at(-1)).toEqual({
      name: 'label',
      kind: 'text',
      values: ['a "b"'],
    })
  })

  it('a duplicated cell ID in cell_by_gene.csv', () => {
    const counts = parseMerscopeCellByGene(
      'cell,GENE_A\n' + `${ID_1},1\n` + `${ID_1},2\n`,
    )
    console.log('[duplicate id]', JSON.stringify(counts.ids))
    expect(counts.ids).toEqual([ID_1, ID_1])
  })
})
