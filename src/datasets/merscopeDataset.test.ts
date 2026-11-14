import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { MerscopeDataset, type MerscopeFileUrls } from './merscopeDataset'
import { MERSCOPE_CSV_MAX_BYTES } from './merscopeFormat'

// src/test/fixtures/merscope (see make_fixtures.py there).
const ROOT = 'https://example.test/region_0'
const ID_A = '1577590100000000000'
const ID_B = '1577590100000000001'
const ID_C = '1577590100000000002'
const FILES: MerscopeFileUrls = {
  cellByGene: `${ROOT}/cell_by_gene.csv`,
  cellMetadata: `${ROOT}/cell_metadata.csv`,
  cellBoundaries: `${ROOT}/cell_boundaries.parquet`,
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/merscope', name)),
  )
}

// Serves fixture files by name, whole or by range, with their length.
function fixtureFetcher(
  overrides: Readonly<Record<string, Uint8Array | Response>> = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const name = url.slice(ROOT.length + 1)
    const override = overrides[name]

    if (override instanceof Response) {
      return override
    }

    let bytes: Uint8Array

    try {
      bytes = override ?? fixture(name)
    } catch {
      return new Response(null, { status: 404 })
    }

    const headers = new Headers(init?.headers)
    const range = /bytes=(\d+)-(\d+)?/.exec(headers.get('Range') ?? '')

    if (init?.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    if (range !== null) {
      const start = Number(range[1])
      const end = range[2] === undefined ? bytes.byteLength : Number(range[2]) + 1
      return new Response(bytes.slice(start, end), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end - 1}/${bytes.byteLength}`,
          'Content-Length': String(end - start),
        },
      })
    }

    return new Response(bytes.slice(), {
      headers: { 'Content-Length': String(bytes.byteLength) },
    })
  }) as typeof fetch
}

function dataset(
  options: {
    readonly files?: Partial<MerscopeFileUrls>
    readonly fetcher?: typeof fetch
  } = {},
): MerscopeDataset {
  return new MerscopeDataset({
    baseUrl: ROOT,
    files: { ...FILES, ...options.files },
    cellBoundariesByteLength: 4570,
    fetcher: options.fetcher ?? fixtureFetcher(),
  })
}

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

describe('MerscopeDataset', () => {
  it('reads cells at their stage positions with the metadata transcript counts', async () => {
    const merscope = dataset()
    const [meta, overview, genes] = await Promise.all([
      merscope.meta(),
      merscope.overview(),
      merscope.genePanel(),
    ])

    expect(meta).toMatchObject({
      platform: 'merscope',
      units: { dataUnit: 'micrometer', micrometersPerPixel: 1 },
      capabilities: { transcripts: false, cellBoundaries: true, pyramidImage: false },
      segmentations: [{ id: 'cell', kind: 'cell', path: 'cell_boundaries.parquet' }],
    })
    expect(meta.extent).toMatchObject({ minX: 1010, minY: 2010, maxX: 1030, maxY: 2030 })
    expect(genes).toEqual(['GENE_A', 'GENE_B', 'GENE_C'])
    expect(
      overview.map((point) => [
        point.cellId,
        point.position.x,
        point.position.y,
        point.transcriptCount,
      ]),
    ).toEqual([
      [ID_A, 1010, 2010, 6],
      [ID_B, 1030, 2010, 9],
      [ID_C, 1020, 2030, 2],
    ])
  })

  it('offers fov as categories and the other metadata as tracks', async () => {
    const merscope = dataset()
    const [groups, tracks, matrix] = await Promise.all([
      merscope.annotationGroups(),
      merscope.metadataTracks(),
      merscope.matrix([ID_B]),
    ])

    expect(groups.map((group) => [group.label, group.groupCount])).toEqual([['fov', 2]])
    expect(tracks.map((track) => track.label)).toEqual([
      'volume',
      'anisotropy',
      'transcript_count',
      'perimeter_area_ratio',
      'solidity',
      'DAPI_raw',
      'DAPI_high_pass',
      'total_counts',
      'blank_count',
    ])
    const blankTrack = tracks.find((track) => track.label === 'blank_count')
    expect(await merscope.metadataTrackValues(blankTrack?.id ?? '')).toEqual([
      { cellId: ID_A, value: 1 },
      { cellId: ID_B, value: 2 },
      { cellId: ID_C, value: 0 },
    ])
    expect(matrix.cells.get(ID_B)).toMatchObject({
      geneNames: ['GENE_B'],
      counts: [5],
    })
  })

  it('adds transcript counts to ROI cells and selected-gene elements', async () => {
    const merscope = dataset()
    const [cells, expression] = await Promise.all([
      merscope.cells({ kind: 'box', bbox: bbox(1000, 2000, 1025, 2020) }),
      merscope.geneExpression(bbox(1000, 2000, 1040, 2040), ['GENE_B']),
    ])

    expect(cells).toEqual([
      { id: ID_A, position: { x: 1010, y: 2010 }, transcriptCount: 6 },
    ])
    expect(
      expression.elements.map((element) => [
        element.id,
        element.count,
        element.transcriptCount,
      ]),
    ).toEqual([
      [ID_A, 0, 6],
      [ID_B, 5, 9],
      [ID_C, 0, 2],
    ])
  })

  it('draws the middle plane outline of each table cell', async () => {
    const merscope = dataset()
    const all = await merscope.elements(bbox(0, 0, 5000, 5000))
    const one = await merscope.elements(bbox(1005, 2005, 1012, 2012))

    // The outline of a cell in neither table is left out.
    expect(all.elements.map((element) => element.id)).toEqual([ID_A, ID_B, ID_C])
    expect(one.elements).toEqual([
      {
        id: ID_A,
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { x: 1006, y: 2006 },
              { x: 1014, y: 2006 },
              { x: 1014, y: 2014 },
              { x: 1006, y: 2014 },
              { x: 1006, y: 2006 },
            ],
          ],
        },
      },
    ])
    // Cells still in view keep their objects.
    expect((await merscope.elements(bbox(1000, 2000, 1040, 2020))).elements[0]).toBe(
      one.elements[0],
    )
    expect(await merscope.summary()).toEqual({
      cellCount: 3,
      geneCount: 3,
      blankColumnCount: 2,
      countsOnlyCells: 0,
      metadataOnlyCells: 0,
      emptyColumns: [],
      cellBoundaries: { fileName: 'cell_boundaries.parquet', byteLength: 4570 },
    })
  })

  it('reads gzipped files whatever their names', async () => {
    const merscope = dataset({
      files: { cellBoundaries: `${ROOT}/cell_boundaries.parquet.gz` },
      fetcher: fixtureFetcher({
        'cell_by_gene.csv': gzipSync(fixture('cell_by_gene.csv')),
      }),
    })

    expect(await merscope.genePanel()).toEqual(['GENE_A', 'GENE_B', 'GENE_C'])
    expect(
      (await merscope.elements(bbox(0, 0, 5000, 5000))).elements.map(
        (element) => element.id,
      ),
    ).toEqual([ID_A, ID_B, ID_C])
  })

  it('refuses a CSV above the size limit before downloading it', async () => {
    const merscope = dataset({
      fetcher: fixtureFetcher({
        'cell_metadata.csv': new Response('x', {
          headers: { 'Content-Length': String(MERSCOPE_CSV_MAX_BYTES + 1) },
        }),
      }),
    })

    await expect(merscope.genePanel()).rejects.toThrow(
      'cell_metadata.csv is 300.0 MB, above the 300.0 MB browser load limit.',
    )
  })

  it('reports boundaries that belong to none of the cells', async () => {
    const merscope = dataset({
      fetcher: fixtureFetcher({
        'cell_by_gene.csv': new TextEncoder().encode('cell,GENE_A\n42,1\n'),
        'cell_metadata.csv': new TextEncoder().encode(
          'EntityID,center_x,center_y\n42,1,1\n',
        ),
      }),
    })

    await expect(merscope.elements(bbox(0, 0, 5000, 5000))).rejects.toThrow(
      'None of the 4 outlines in cell_boundaries.parquet belong to cells in the cell tables',
    )
  })

  it('has no boundaries without a boundary file', async () => {
    const merscope = new MerscopeDataset({
      baseUrl: ROOT,
      files: { cellByGene: FILES.cellByGene, cellMetadata: FILES.cellMetadata },
      fetcher: fixtureFetcher(),
    })

    expect((await merscope.meta()).capabilities.cellBoundaries).toBe(false)
    expect(await merscope.elements(bbox(0, 0, 5000, 5000))).toEqual({ elements: [] })
    expect((await merscope.summary()).cellBoundaries).toBeNull()
  })
})
