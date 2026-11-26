import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import { geneExpressionScores } from '../rendering/geneExpressionRenderer'
import { XeniumDataset } from './xeniumDataset'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  SqlParameter,
} from '../data/gex'
import type { CellId } from '../data/cellid'
import type { DuckDbClientLike } from './xeniumDataset'
import type { GexResult } from '../data/gex'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { XeniumDuckDbConnection } from './xeniumDatasetRows'

class FakeTable implements ArrowTableLike {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  toArray(): readonly Record<string, unknown>[] {
    return this.rows
  }
}

class FakeStatement implements DuckDbPreparedStatementLike {
  params: readonly SqlParameter[] = []

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query(...params: SqlParameter[]): Promise<ArrowTableLike> {
    this.params = params
    return new FakeTable(this.rows)
  }
}

class FakeConnection implements XeniumDuckDbConnection {
  readonly preparedSql: string[] = []
  readonly statements: FakeStatement[] = []

  constructor(
    private readonly rowsByQuery: readonly (readonly Record<string, unknown>[])[],
  ) {}

  async prepare(sql: string): Promise<DuckDbPreparedStatementLike> {
    const rows = this.rowsByQuery[this.statements.length] ?? []
    const statement = new FakeStatement(rows)

    this.preparedSql.push(sql)
    this.statements.push(statement)
    return statement
  }
}

function makeDataset(
  conn: XeniumDuckDbConnection,
  overrides: Partial<ConstructorParameters<typeof XeniumDataset>[0]> = {},
) {
  const duckDbClient: DuckDbClientLike = { conn, loadSpatial: async () => {} }

  return new XeniumDataset({
    baseUrl: 'https://example.test/xenium/',
    duckDbClient,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          pixel_size: 0.5,
          images: {
            morphology_filepath: 'morphology.ome.tif',
            morphology_focus_filepath: 'morphology_focus/morphology_focus_0000.ome.tif',
          },
        }),
      ),
    openTiff: async () => ({}) as TiffPyramidLoader,
    ...overrides,
  })
}

describe('XeniumDataset', () => {
  it('reads its metadata again after a failed read', async () => {
    const conn = new FakeConnection([
      [{ minX: 1, maxX: 20, minY: 2, maxY: 30 }],
      [{ minX: 1, maxX: 20, minY: 2, maxY: 30 }],
    ])
    let failures = 1
    const dataset = makeDataset(conn, {
      fetcher: async () => {
        if (failures > 0) {
          failures -= 1
          throw new TypeError('Failed to fetch')
        }

        return new Response(JSON.stringify({ pixel_size: 0.5 }))
      },
    })

    await expect(dataset.meta()).rejects.toThrow('Failed to fetch')
    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'xenium',
      units: { micrometersPerPixel: micrometers(0.5) },
    })
  })

  it('loads metadata with capability flags and cell extent', async () => {
    const conn = new FakeConnection([[{ minX: 1, maxX: 20, minY: 2, maxY: 30 }]])
    const dataset = makeDataset(conn)

    await expect(dataset.meta()).resolves.toMatchObject({
      platform: 'xenium',
      units: {
        micrometersPerPixel: micrometers(0.5),
      },
      extent: {
        minX: micrometers(1),
        maxX: micrometers(20),
        minY: micrometers(2),
        maxY: micrometers(30),
      },
      capabilities: {
        transcripts: true,
        cellBoundaries: true,
        pyramidImage: true,
        multiChannel: false,
      },
    })
  })

  it('reads each cell outline from a row of vertex lists', async () => {
    const cellId = intToCellId(1, 1)
    // DuckDB returns each list as an Arrow vector of FLOAT.
    const list = (values: readonly number[]) => ({
      toArray: () => Float32Array.from(values),
    })
    const conn = new FakeConnection([
      [
        { cell_id: cellId, x: list([0, 10, 10]), y: list([0, 0, 10]) },
        // Fewer than three vertices is not an outline.
        { cell_id: intToCellId(2, 1), x: list([0, 1]), y: list([0, 1]) },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.elements({
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      }),
    ).resolves.toEqual({
      elements: [
        {
          id: cellId,
          geometry: {
            kind: 'polygon',
            rings: [
              [
                { x: micrometers(0), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(0) },
                { x: micrometers(10), y: micrometers(10) },
              ],
            ],
          },
        },
      ],
    })
    expect(conn.statements[0]?.params).toContain(
      'https://example.test/xenium/cell_boundaries.parquet',
    )
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(-75),
      micrometers(85),
      micrometers(-75),
      micrometers(85),
      'https://example.test/xenium/cell_boundaries.parquet',
      micrometers(-150),
      micrometers(160),
      micrometers(-150),
      micrometers(160),
    ])
    // DuckDB gathers each cell's vertices in file order, a row per cell,
    // without an ordered aggregate (see queryXeniumBoundaryRings).
    expect(conn.preparedSql[0]).toContain(
      "list_sort(list({'r': b.file_row_number, 'x': b.vertex_x, 'y': b.vertex_y}))",
    )
    expect(conn.preparedSql[0]).toContain('list_transform(v, lambda p: p.y) AS y')
    expect(conn.preparedSql[0]).not.toContain('ORDER BY b.file_row_number')
    expect(conn.preparedSql[0]).toContain('GROUP BY b.cell_id\n)\nORDER BY cell_id\n')
    // FLOAT vertex bounds are cast so DuckDB can prune row groups; DOUBLE
    // centroid bounds are not.
    expect(conn.preparedSql[0]).toContain(
      'b.vertex_x BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.preparedSql[0]).toContain(
      'b.vertex_y BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.preparedSql[0]).toContain('x_centroid BETWEEN ? AND ?')
    expect(conn.preparedSql[0]).toContain('y_centroid BETWEEN ? AND ?')
  })

  it('reads the outlines of given cells by where the file keeps them (plan 23-H)', async () => {
    const validateRangeSupport = vi.fn(async () => {})
    const a = intToCellId(1, 1)
    const b = intToCellId(2, 1)
    const conn = new FakeConnection([
      [{ cell_rows: 4n, vertex_rows: 100n }],
      [
        { cell_id: a, x: 0, y: 0, file_row_number: 75n },
        { cell_id: a, x: 4, y: 0, file_row_number: 76n },
        { cell_id: a, x: 4, y: 4, file_row_number: 77n },
      ],
      // b was not where its row says; the box read around it finds none.
      [],
    ])
    const dataset = makeDataset(conn, { validateRangeSupport })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    await expect(
      dataset.cellOutlines([
        { id: a, overviewRow: 3, bbox },
        { id: b, overviewRow: 2_000_000, bbox },
      ]),
    ).resolves.toEqual([
      {
        id: a,
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { x: micrometers(0), y: micrometers(0) },
              { x: micrometers(4), y: micrometers(0) },
              { x: micrometers(4), y: micrometers(4) },
            ],
          ],
        },
      },
    ])

    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_boundaries.parquet',
      { label: 'cell_boundaries.parquet' },
    )
    // 25 vertices per cell: a's start near row 75, 30,000 rows either side.
    const boundaries = 'https://example.test/xenium/cell_boundaries.parquet'
    expect(conn.statements[1]?.params).toEqual([
      boundaries,
      0,
      30_075,
      a,
      boundaries,
      50_000_000 - 30_000,
      50_000_000 + 30_000,
      b,
    ])
    // A number parameter binds as DOUBLE; the cast keeps row-group pruning.
    expect(conn.preparedSql[1]).toContain(
      'file_row_number BETWEEN CAST(? AS BIGINT) AND CAST(? AS BIGINT)',
    )
    expect(conn.preparedSql[1]).toContain('UNION ALL')
    expect(conn.preparedSql[2]).toContain('x_centroid BETWEEN ? AND ?')

    // The file's layout is read once.
    await dataset.cellOutlines([{ id: a, overviewRow: 3, bbox }])
    expect(conn.preparedSql.filter((sql) => sql.includes('count(*)'))).toHaveLength(1)
  })

  it('lists cell and nucleus outlines read from Parquet', async () => {
    const conn = new FakeConnection([[{ minX: 1, maxX: 20, minY: 2, maxY: 30 }]])

    await expect(makeDataset(conn).meta()).resolves.toMatchObject({
      segmentations: [
        { kind: 'cell', sourceKind: 'parquet', path: 'cell_boundaries.parquet' },
        { kind: 'nucleus', sourceKind: 'parquet', path: 'nucleus_boundaries.parquet' },
      ],
    })
  })

  it('splits nucleus vertices by cell and label and numbers extra nuclei', async () => {
    const conn = new FakeConnection([
      [
        { cell_id: 'aaaaaaaa-1', label_id: 7n, x: [0, 2, 2], y: [0, 0, 2] },
        { cell_id: 'aaaaaaaa-1', label_id: 8n, x: [4, 6, 6], y: [4, 4, 6] },
        { cell_id: 'bbbbbbbb-1', label_id: 9n, x: [9], y: [9] },
        { cell_id: 'cccccccc-1', label_id: 10n, x: [1, 3, 3], y: [8, 8, 9] },
      ],
    ])
    const validateRangeSupport = vi.fn(async () => undefined)
    const dataset = makeDataset(conn, { validateRangeSupport })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    const elements = await dataset.segmentationElements('nucleus', bbox)

    expect(elements.map((element) => element.id)).toEqual([
      'aaaaaaaa-1',
      'aaaaaaaa-1#nucleus-2',
      'cccccccc-1',
    ])
    expect(elements[1]).toEqual({
      id: 'aaaaaaaa-1#nucleus-2',
      geometry: {
        kind: 'polygon',
        rings: [
          [
            { x: micrometers(4), y: micrometers(4) },
            { x: micrometers(6), y: micrometers(4) },
            { x: micrometers(6), y: micrometers(6) },
          ],
        ],
      },
      metadata: { segmentation: { kind: 'nucleus', cellId: 'aaaaaaaa-1' } },
    })
    expect(validateRangeSupport).toHaveBeenCalledWith(
      'https://example.test/xenium/nucleus_boundaries.parquet',
      { label: 'nucleus_boundaries.parquet' },
    )
    // Nuclei are picked by their own vertices: cells.parquet is not read.
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/nucleus_boundaries.parquet',
      micrometers(-150),
      micrometers(160),
      micrometers(-150),
      micrometers(160),
      micrometers(-75),
      micrometers(85),
      micrometers(-75),
      micrometers(85),
    ])
    expect(conn.preparedSql[0]).toContain('SELECT b.cell_id, b.label_id,')
    expect(conn.preparedSql[0]).toContain('list_transform(v, lambda p: p.x) AS x')
    expect(conn.preparedSql[0]).toContain('GROUP BY b.cell_id, b.label_id')
    expect(conn.preparedSql[0]).toContain('HAVING avg(b.vertex_x) BETWEEN ? AND ?')
    expect(conn.preparedSql[0]).toContain('ORDER BY cell_id, label_id\n')
    expect(conn.preparedSql[0]).toContain(
      'b.vertex_x BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
  })

  it('groups nuclei by cell when the file has no label_id column', async () => {
    const preparedSql: string[] = []
    const rows = [{ cell_id: 'aaaaaaaa-1', x: [0, 2, 2], y: [0, 0, 2] }]
    const conn: XeniumDuckDbConnection = {
      async prepare(sql) {
        preparedSql.push(sql)

        return {
          async query() {
            if (sql.includes('label_id')) {
              throw new Error(
                'Binder Error: Table "b" does not have a column named "label_id"',
              )
            }

            return new FakeTable(rows)
          },
        }
      },
    }
    const dataset = makeDataset(conn, { validateRangeSupport: async () => undefined })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    await expect(dataset.segmentationElements('nucleus', bbox)).resolves.toMatchObject([
      { id: 'aaaaaaaa-1' },
    ])
    await expect(dataset.segmentationElements('nucleus', bbox)).resolves.toHaveLength(1)
    // The second request goes straight to the query without label_id.
    expect(preparedSql.map((sql) => sql.includes('label_id'))).toEqual([
      true,
      false,
      false,
    ])
  })

  it('retries every request that asked for label_id before the first one failed', async () => {
    const conn: XeniumDuckDbConnection = {
      async prepare(sql) {
        return {
          async query() {
            if (sql.includes('label_id')) {
              throw new Error(
                'Binder Error: Table "b" does not have a column named "label_id"',
              )
            }

            return new FakeTable([{ cell_id: 'aaaaaaaa-1', x: [0, 2, 2], y: [0, 0, 2] }])
          },
        }
      },
    }
    const dataset = makeDataset(conn, { validateRangeSupport: async () => undefined })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    // Zooming starts several viewport requests before any of them returns.
    await expect(
      Promise.all([
        dataset.segmentationElements('nucleus', bbox),
        dataset.segmentationElements('nucleus', bbox),
        dataset.segmentationElements('nucleus', bbox),
      ]),
    ).resolves.toEqual([
      [expect.objectContaining({ id: 'aaaaaaaa-1' })],
      [expect.objectContaining({ id: 'aaaaaaaa-1' })],
      [expect.objectContaining({ id: 'aaaaaaaa-1' })],
    ])
  })

  it('names a missing nucleus file before querying it', async () => {
    const conn = new FakeConnection([])
    const dataset = makeDataset(conn, {
      validateRangeSupport: async () => {
        throw new Error('nucleus_boundaries.parquet was not found.')
      },
    })

    await expect(
      dataset.segmentationElements('nucleus', {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      }),
    ).rejects.toThrow('nucleus_boundaries.parquet was not found.')
    expect(conn.preparedSql).toEqual([])
  })

  it('delegates matrix, transcripts, and pyramid image loading', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([[{ cell_id: cellId }]])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Gad1'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Gad1'], counts: [1] }])),
      }),
    )
    const transcriptReader = vi.fn(async (): Promise<GexResult> => ({
      geneNames: [],
      cells: new Map(),
    }))
    const overviewReader = vi.fn(async () => [
      {
        cellId,
        position: { x: micrometers(1), y: micrometers(2) },
        transcriptCount: 3,
      },
    ])
    const openTiff = vi.fn(async () => ({}) as TiffPyramidLoader)
    const dataset = makeDataset(conn, {
      matrixReader,
      transcriptReader,
      overviewReader,
      openTiff,
    })

    await dataset.matrix([cellId])
    await dataset.overviewCells(500)
    await dataset.transcripts(
      {
        kind: 'circle',
        cx: micrometers(5),
        cy: micrometers(5),
        radius: micrometers(2),
      },
      'cells-only',
      25,
    )
    await expect(dataset.image()).resolves.toMatchObject({ kind: 'pyramid' })

    expect(matrixReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
    )
    expect(overviewReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cells.parquet',
      500,
    )
    expect(transcriptReader).toHaveBeenCalledWith(
      conn,
      'https://example.test/xenium/transcripts.parquet',
      expect.objectContaining({ kind: 'circle' }),
      'cells-only',
      [cellId],
      25,
    )
    expect(openTiff).toHaveBeenCalledWith(
      'https://example.test/xenium/morphology_focus/morphology_focus_0000.ome.tif',
      undefined,
      undefined,
      undefined,
    )
  })

  it('warms and reuses the memoized DuckDB client before ROI queries', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 1,
          y_centroid: 2,
          transcript_counts: 3,
          cell_area: 4,
        },
      ],
    ])
    const createDuckDbClient = vi.fn(async (): Promise<DuckDbClientLike> => ({
      conn,
      loadSpatial: async () => {},
    }))
    const dataset = new XeniumDataset({
      baseUrl: 'https://example.test/xenium/',
      createDuckDbClient,
      fetcher: async () => new Response(JSON.stringify({})),
      openTiff: async () => ({}) as TiffPyramidLoader,
    })

    await dataset.warm()
    await dataset.cells({
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })

    expect(createDuckDbClient).toHaveBeenCalledOnce()
    expect(conn.preparedSql[0]).toContain('FROM read_parquet( ? )')
  })

  it('starts DuckDB again after a start fails, sharing each start between queries', async () => {
    const cellId = intToCellId(1, 1)
    const row = {
      cell_id: cellId,
      x_centroid: 1,
      y_centroid: 2,
      transcript_counts: 3,
      cell_area: 4,
    }
    const conn = new FakeConnection([[row], [row]])
    const createDuckDbClient = vi
      .fn<() => Promise<DuckDbClientLike>>()
      .mockRejectedValueOnce(new Error('extension download failed'))
      .mockResolvedValue({ conn, loadSpatial: async () => {} })
    const dataset = new XeniumDataset({
      baseUrl: 'https://example.test/xenium/',
      createDuckDbClient,
      fetcher: async () => new Response(JSON.stringify({})),
      openTiff: async () => ({}) as TiffPyramidLoader,
    })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    await expect(dataset.cells(bbox)).rejects.toThrow('extension download failed')
    const [first, second] = await Promise.all([dataset.cells(bbox), dataset.cells(bbox)])

    expect(first.map((cell) => cell.id)).toEqual([cellId])
    expect(second.map((cell) => cell.id)).toEqual([cellId])
    expect(createDuckDbClient).toHaveBeenCalledTimes(2)
  })

  it('closes the DuckDB client it started when disposed, and starts another after', async () => {
    const close = vi.fn(async () => {})
    const conn = new FakeConnection([[], []])
    const createDuckDbClient = vi.fn(async (): Promise<DuckDbClientLike> => ({
      conn,
      loadSpatial: async () => {},
      close,
    }))
    const dataset = new XeniumDataset({
      baseUrl: 'https://example.test/xenium/',
      createDuckDbClient,
      fetcher: async () => new Response(JSON.stringify({})),
      openTiff: async () => ({}) as TiffPyramidLoader,
    })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    await dataset.cells(bbox)
    dataset.dispose()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await dataset.cells(bbox)

    expect(createDuckDbClient).toHaveBeenCalledTimes(2)
  })

  it('leaves a DuckDB client passed in open when disposed', async () => {
    const close = vi.fn(async () => {})
    const dataset = makeDataset(new FakeConnection([[]]), {
      duckDbClient: {
        conn: new FakeConnection([[]]),
        loadSpatial: async () => {},
        close,
      },
    })

    await dataset.cells({
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })
    dataset.dispose()
    await Promise.resolve()

    expect(close).not.toHaveBeenCalled()
  })

  it('loads transcript expression directly for known cell ids', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([])
    const transcriptReader = vi.fn(async (): Promise<GexResult> => ({
      geneNames: ['Actb'],
      cells: new Map([[cellId, { geneNames: ['Actb'], counts: [4] }]]),
    }))
    const dataset = makeDataset(conn, { transcriptReader })

    await expect(dataset.transcriptsForCellIds([cellId], 30)).resolves.toMatchObject({
      geneNames: ['Actb'],
    })

    expect(transcriptReader).toHaveBeenCalledWith(
      conn,
      'https://example.test/xenium/transcripts.parquet',
      expect.objectContaining({ kind: 'circle' }),
      'cells-only',
      [cellId],
      30,
    )
    expect(conn.preparedSql).toHaveLength(0)
  })

  it('loads raw transcript rows within a bounding box for ROI export', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsInBbox(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(1),
          maxY: micrometers(20),
        },
        { limit: 250, minQv: 30 },
      ),
    ).resolves.toEqual([
      {
        cellId,
        featureName: 'Actb',
        position: { x: micrometers(2), y: micrometers(3) },
        zLocation: 1,
        qv: 35,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    expect(conn.preparedSql[0]).toContain('FROM read_parquet( ? )')
    expect(conn.preparedSql[0]).toContain(
      'x_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.preparedSql[0]).toContain(
      'y_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      250,
    ])
  })

  it('exports a transcript outside every cell (UNASSIGNED) with no cell', async () => {
    const cellId = intToCellId(1, 1)
    const row = {
      feature_name: 'Actb',
      x_location: 2,
      y_location: 3,
      z_location: 1,
      qv: 35,
      overlaps_nucleus: false,
      is_gene: true,
    }
    const dataset = makeDataset(
      new FakeConnection([
        [
          { ...row, cell_id: cellId },
          // XOA 1.3 and later write UNASSIGNED; earlier output wrote null.
          { ...row, cell_id: 'UNASSIGNED' },
        ],
      ]),
    )

    const transcripts = await dataset.transcriptsInBbox(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(1),
        maxY: micrometers(20),
      },
      { limit: 250, minQv: 30 },
    )

    expect(transcripts.map((transcript) => transcript.cellId)).toEqual([cellId, null])
  })

  it('loads raw transcript rows for a selected cell', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForCellId(cellId, { limit: 500, minQv: 30 }),
    ).resolves.toEqual([
      {
        cellId,
        featureName: 'Actb',
        position: { x: micrometers(2), y: micrometers(3) },
        zLocation: 1,
        qv: 35,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    expect(conn.preparedSql[0]).toContain('cell_id = ?')
    expect(conn.preparedSql[0]).toContain('ORDER BY z_location, feature_name')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      500,
    ])
  })

  it('loads selected-cell transcript z distribution with aggregate SQL', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_count: 4,
          z_count: 3,
          missing_z_count: 1,
          min_z: 0,
          max_z: 2,
          bin_index: 0,
          bin_count: 2,
        },
        {
          transcript_count: 4,
          z_count: 3,
          missing_z_count: 1,
          min_z: 0,
          max_z: 2,
          bin_index: 1,
          bin_count: 1,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cellTranscriptZDistributionForCellId(cellId, {
        limit: 500,
        minQv: 30,
        binCount: 2,
      }),
    ).resolves.toEqual({
      bins: [
        { minZ: 0, maxZ: 1, count: 2, percent: 66.66666666666666 },
        { minZ: 1, maxZ: 2, count: 1, percent: 33.33333333333333 },
      ],
      transcriptCount: 4,
      zCount: 3,
      missingZCount: 1,
      minZ: 0,
      maxZ: 2,
      maxBinCount: 2,
      hitTranscriptLimit: false,
      minQv: 30,
    })
    expect(conn.preparedSql[0]).toContain('SELECT z_location')
    expect(conn.preparedSql[0]).toContain('COUNT(z_location) AS z_count')
    expect(conn.preparedSql[0]).toContain('GROUP BY bin_index')
    expect(conn.preparedSql[0]).not.toContain('feature_name')
    expect(conn.preparedSql[0]).not.toContain('x_location')
    expect(conn.preparedSql[0]).not.toContain('ORDER BY z_location')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      500,
      2,
      2,
    ])
  })

  it('adds spatial predicates to selected-cell transcript z distribution queries', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_count: 2,
          z_count: 2,
          missing_z_count: 0,
          min_z: 1,
          max_z: 2,
          bin_index: 0,
          bin_count: 2,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await dataset.cellTranscriptZDistributionForCellId(cellId, {
      limit: 500,
      minQv: 30,
      binCount: 2,
      bbox: {
        minX: micrometers(10),
        maxX: micrometers(20),
        minY: micrometers(30),
        maxY: micrometers(40),
      },
    })

    expect(conn.preparedSql[0]).toContain('cell_id = ?')
    expect(conn.preparedSql[0]).toContain(
      'x_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.preparedSql[0]).toContain(
      'y_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      cellId,
      30,
      micrometers(10),
      micrometers(20),
      micrometers(30),
      micrometers(40),
      500,
      2,
      2,
    ])
  })

  it('loads raw transcript rows within a lasso ROI for exact export', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          overlaps_nucleus: true,
          is_gene: true,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForSelection(
        {
          kind: 'lasso',
          bbox: {
            minX: micrometers(0),
            maxX: micrometers(10),
            minY: micrometers(1),
            maxY: micrometers(20),
          },
          points: [
            { x: micrometers(0), y: micrometers(1) },
            { x: micrometers(10), y: micrometers(1) },
            { x: micrometers(10), y: micrometers(20) },
          ],
        },
        { limit: 250, minQv: 30 },
      ),
    ).resolves.toHaveLength(1)

    expect(conn.preparedSql[0]).toContain('ST_Within')
    expect(conn.preparedSql[0]).toContain(
      'x_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.preparedSql[0]).toContain(
      'y_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)',
    )
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      'POLYGON((0 1, 10 1, 10 20, 0 1))',
      30,
      250,
    ])
  })

  it('loads exact transcript points and gene/FOV groups for a viewport', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          transcript_id: 12,
          cell_id: cellId,
          feature_name: 'Actb',
          x_location: 2,
          y_location: 3,
          z_location: 1,
          qv: 35,
          fov_name: 'FOV-001',
          overlaps_nucleus: 1,
          nucleus_distance: 0,
          is_gene: true,
        },
      ],
      [
        {
          feature_name: 'Actb',
          fov_name: 'FOV-001',
          count: 7,
          mean_qv: 33.5,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.transcriptsForViewport(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(1),
          maxY: micrometers(20),
        },
        {
          pointLimit: 250,
          groupLimit: 12,
          minQv: 30,
          geneOnly: true,
          featureNames: ['Actb'],
        },
      ),
    ).resolves.toEqual({
      points: [
        {
          id: '12',
          transcriptId: '12',
          cellId,
          cellAssignment: 'known',
          featureName: 'Actb',
          fovName: 'FOV-001',
          position: { x: micrometers(2), y: micrometers(3) },
          zLocation: 1,
          qv: 35,
          overlapsNucleus: true,
          nucleusDistance: 0,
          isGene: true,
        },
      ],
      groups: [
        {
          featureName: 'Actb',
          fovName: 'FOV-001',
          count: 7,
          meanQv: 33.5,
        },
      ],
      hitPointLimit: false,
    })
    expect(conn.preparedSql[0]).not.toContain('ORDER BY')
    expect(conn.preparedSql[0]).toContain('feature_name IN (?)')
    expect(conn.preparedSql[1]).toContain('GROUP BY feature_name, fov_name')
    for (const sql of conn.preparedSql) {
      expect(sql).toContain('x_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)')
      expect(sql).toContain('y_location BETWEEN CAST(? AS FLOAT) AND CAST(? AS FLOAT)')
    }
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      'Actb',
      251,
    ])
    expect(conn.statements[1]?.params).toEqual([
      'https://example.test/xenium/transcripts.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(1),
      micrometers(20),
      30,
      'Actb',
      12,
    ])
  })

  it('marks an exact transcript point outside every cell (UNASSIGNED) as unassigned', async () => {
    const cellId = intToCellId(1, 1)
    const row = {
      feature_name: 'Actb',
      x_location: 2,
      y_location: 3,
      qv: 35,
      fov_name: 'FOV-001',
      is_gene: true,
    }
    const dataset = makeDataset(
      new FakeConnection([
        [
          { ...row, transcript_id: 12, cell_id: cellId },
          { ...row, transcript_id: 13, cell_id: 'UNASSIGNED' },
        ],
        [],
      ]),
    )

    const result = await dataset.transcriptsForViewport(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(1),
        maxY: micrometers(20),
      },
      { pointLimit: 250, groupLimit: 12, minQv: 30, geneOnly: true, featureNames: [] },
    )

    expect(
      result.points.map((point) => [
        point.transcriptId,
        point.cellId,
        point.cellAssignment,
      ]),
    ).toEqual([
      ['12', cellId, 'known'],
      ['13', null, 'unassigned'],
    ])
  })

  it('loads viewport-scoped expression counts for selected genes', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 2,
          y_centroid: 3,
          transcript_counts: 25,
          cell_area: 40,
        },
      ],
    ])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb', 'Gad1', 'Slc17a7'],
        cells: new Map(
          ids.map((id) => [
            id,
            { geneNames: ['Actb', 'Gad1', 'Slc17a7'], counts: [7, 2, 3] },
          ]),
        ),
      }),
    )
    const dataset = makeDataset(conn, { matrixReader })

    await expect(
      dataset.geneExpression(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(0),
          maxY: micrometers(20),
        },
        ['Slc17a7', 'Gad1', 'Gad1'],
        { limit: 100 },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        genes: ['Gad1', 'Slc17a7'],
        maxCount: 5,
        elements: [
          {
            id: cellId,
            position: { x: micrometers(2), y: micrometers(3) },
            transcriptCount: 25,
            cellArea: 40,
            count: 5,
          },
        ],
        timing: {
          viewportCellsMs: expect.any(Number),
          matrixReadMs: expect.any(Number),
          scoreCellsMs: expect.any(Number),
          totalMs: expect.any(Number),
        },
      }),
    )

    expect(conn.preparedSql[0]).toContain('SELECT cell_id')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(0),
      micrometers(20),
      100,
    ])
    expect(matrixReader).toHaveBeenCalledWith(
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      [cellId],
    )
  })

  it('loads true cell ids and observations for a rectangular ROI', async () => {
    const cellId = intToCellId(1, 5)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          cell_feature_matrix_row: 17n,
          x_centroid: 12,
          y_centroid: 24,
          transcript_counts: 90,
          cell_area: 35,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cells(
        {
          minX: micrometers(10),
          maxX: micrometers(20),
          minY: micrometers(20),
          maxY: micrometers(30),
        },
        { limit: 75 },
      ),
    ).resolves.toEqual([
      {
        id: cellId,
        position: { x: micrometers(12), y: micrometers(24) },
        transcriptCount: 90,
        cellArea: 35,
        cellFeatureMatrixRow: 17,
      },
    ])

    expect(conn.preparedSql[0]).toContain('FROM read_parquet')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(10),
      micrometers(20),
      micrometers(20),
      micrometers(30),
      75,
    ])
  })

  it('loads true cell ids and observations for a lasso ROI', async () => {
    const cellId = intToCellId(1, 5)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          cell_feature_matrix_row: 17n,
          x_centroid: 12,
          y_centroid: 24,
          transcript_counts: 90,
          cell_area: 35,
        },
      ],
    ])
    const dataset = makeDataset(conn)

    await expect(
      dataset.cells(
        {
          kind: 'lasso',
          bbox: {
            minX: micrometers(10),
            maxX: micrometers(20),
            minY: micrometers(20),
            maxY: micrometers(30),
          },
          points: [
            { x: micrometers(10), y: micrometers(20) },
            { x: micrometers(20), y: micrometers(20) },
            { x: micrometers(20), y: micrometers(30) },
          ],
        },
        { limit: 75 },
      ),
    ).resolves.toHaveLength(1)

    expect(conn.preparedSql[0]).toContain('ST_Within')
    expect(conn.preparedSql[0]).toContain('x_centroid BETWEEN ? AND ?')
    expect(conn.preparedSql[0]).not.toContain('CAST(? AS FLOAT)')
    expect(conn.preparedSql[0]).toContain('ORDER BY file_row_number')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(10),
      micrometers(20),
      micrometers(20),
      micrometers(30),
      'POLYGON((10 20, 20 20, 20 30, 10 20))',
      75,
    ])
  })

  it('loads the spatial extension before lasso queries only', async () => {
    const calls: string[] = []
    const conn: XeniumDuckDbConnection = {
      async prepare(sql) {
        calls.push(sql.includes('ST_Within') ? 'polygon query' : 'query')
        return new FakeStatement([])
      },
    }
    const loadSpatial = vi.fn(async () => {
      calls.push('load spatial')
    })
    const transcriptReader = vi.fn(async (): Promise<GexResult> => ({
      geneNames: [],
      cells: new Map(),
    }))
    const dataset = makeDataset(conn, {
      duckDbClient: { conn, loadSpatial },
      transcriptReader,
    })
    const bbox = {
      minX: micrometers(10),
      maxX: micrometers(20),
      minY: micrometers(20),
      maxY: micrometers(30),
    }
    const points = [
      { x: micrometers(10), y: micrometers(20) },
      { x: micrometers(20), y: micrometers(20) },
      { x: micrometers(20), y: micrometers(30) },
    ]

    await dataset.cells(bbox)
    await dataset.transcriptsForSelection({ kind: 'box', bbox })
    await dataset.transcripts(
      {
        kind: 'circle',
        cx: micrometers(15),
        cy: micrometers(25),
        radius: micrometers(5),
      },
      'cells-only',
      20,
    )

    expect(calls).toEqual(['query', 'query', 'query'])
    calls.length = 0

    await dataset.cells({ kind: 'lasso', bbox, points })
    await dataset.transcriptsForSelection({ kind: 'lasso', bbox, points })
    await dataset.transcripts({ kind: 'polygon', points }, 'cells-only', 20)

    expect(calls).toEqual([
      'load spatial',
      'polygon query',
      'load spatial',
      'polygon query',
      'load spatial',
      'polygon query',
    ])
  })

  it('reports a spatial extension that did not load instead of querying', async () => {
    const conn = new FakeConnection([])
    const spatialError = new Error(
      "Lasso selections need DuckDB's spatial extension, which did not load: Failed to fetch",
    )
    const dataset = makeDataset(conn, {
      duckDbClient: { conn, loadSpatial: () => Promise.reject(spatialError) },
    })

    await expect(
      dataset.cells({
        kind: 'lasso',
        bbox: {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(0),
          maxY: micrometers(10),
        },
        points: [
          { x: micrometers(0), y: micrometers(0) },
          { x: micrometers(10), y: micrometers(0) },
          { x: micrometers(10), y: micrometers(10) },
        ],
      }),
    ).rejects.toBe(spatialError)
    expect(conn.preparedSql).toEqual([])
  })

  it('loads annotations from analysis.zarr and cell-feature matrix row ids', async () => {
    const conn = new FakeConnection([])
    const annotations = [
      {
        id: 'analysis:0:0',
        label: 'graphclust: Cluster 1',
        cellIds: [intToCellId(1, 1)],
      },
    ]
    const analysisAnnotationReader = vi.fn(async () => annotations)
    const dataset = makeDataset(conn, { analysisAnnotationReader })

    await expect(dataset.annotations()).resolves.toBe(annotations)
    expect(analysisAnnotationReader).toHaveBeenCalledWith(
      'https://example.test/xenium/analysis.zarr.zip',
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      {},
    )

    await dataset.annotations({ groupId: 'analysis:1' })
    expect(analysisAnnotationReader).toHaveBeenLastCalledWith(
      'https://example.test/xenium/analysis.zarr.zip',
      'https://example.test/xenium/cell_feature_matrix.zarr.zip',
      { groupId: 'analysis:1' },
    )
  })

  it("scores expression from the selected genes' expressing matrix rows", async () => {
    const cellIds = [1, 2, 3, 4].map((suffix) => intToCellId(7, suffix))
    const conn = new FakeConnection([
      [0, 1, 2, 3].map((row) => ({
        cell_feature_matrix_row: row,
        x_centroid: row * 10,
        y_centroid: row * 20,
        transcript_counts: 30 + row,
        cell_area: 40 + row,
      })),
      [0, 1, 2, 3].map((row) => ({
        cell_feature_matrix_row: row,
        cell_id: cellIds[row],
      })),
    ])
    const matrixReader = vi.fn()
    const selectedGeneRowsReader = vi.fn(async () => ({
      nCells: 4,
      features: [
        { gene: 'Actb', rows: new Uint32Array([1, 3]), counts: new Uint32Array([2, 5]) },
        { gene: 'Gad1', rows: new Uint32Array([3]), counts: new Uint32Array([1]) },
      ],
      cellIdForRow: (row: number) => cellIds[row] ?? intToCellId(0, 0),
    }))
    const dataset = makeDataset(conn, {
      baseUrl: 'https://example.test/xenium-rows/',
      matrixReader,
      selectedGeneRowsReader,
    })

    const batch = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(100),
        minY: micrometers(0),
        maxY: micrometers(100),
      },
      ['Gad1', 'Actb'],
      { limit: 1_000, sampleStride: 40 },
    )

    expect(batch).toMatchObject({
      genes: ['Actb', 'Gad1'],
      cellCount: 4,
      maxCount: 6,
      geneCounts: [
        { gene: 'Actb', count: 7 },
        { gene: 'Gad1', count: 1 },
      ],
      elements: [
        {
          id: cellIds[1],
          position: { x: micrometers(10), y: micrometers(20) },
          transcriptCount: 31,
          cellArea: 41,
          cellFeatureMatrixRow: 1,
          count: 2,
        },
        {
          id: cellIds[3],
          position: { x: micrometers(30), y: micrometers(60) },
          transcriptCount: 33,
          cellArea: 43,
          cellFeatureMatrixRow: 3,
          count: 6,
        },
      ],
    })
    // Only the expressing cells are returned, but the z-score counts the other
    // two as 0: means 0, 1, 0 and 3 have mean 1 and SD 1.22.
    expect(
      geneExpressionScores(batch.elements, batch.genes, 'z-score', batch.cellCount),
    ).toEqual([0, expect.closeTo(1.633, 3)])
    expect(matrixReader).not.toHaveBeenCalled()
    expect(conn.preparedSql[0]).not.toContain('cell_id')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium-rows/cells.parquet',
      micrometers(0),
      micrometers(100),
      micrometers(0),
      micrometers(100),
      1_000,
    ])
    expect(conn.preparedSql[1]).toContain('file_row_number IN')
  })

  it('falls back to per-cell matrix reads when cell rows do not match the matrix', async () => {
    const cellId = intToCellId(8, 1)
    const conn = new FakeConnection([
      [
        {
          cell_feature_matrix_row: 0,
          x_centroid: 1,
          y_centroid: 2,
          transcript_counts: 3,
          cell_area: 4,
        },
      ],
      [{ cell_feature_matrix_row: 0, cell_id: intToCellId(9, 9) }],
      [
        {
          cell_id: cellId,
          x_centroid: 1,
          y_centroid: 2,
          transcript_counts: 3,
          cell_area: 4,
        },
      ],
    ])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Actb'], counts: [4] }])),
      }),
    )
    const dataset = makeDataset(conn, {
      baseUrl: 'https://example.test/xenium-misaligned/',
      matrixReader,
      selectedGeneRowsReader: async () => ({
        nCells: 1,
        features: [
          { gene: 'Actb', rows: new Uint32Array([0]), counts: new Uint32Array([4]) },
        ],
        cellIdForRow: () => cellId,
      }),
    })

    const batch = await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
      ['Actb'],
    )

    expect(matrixReader).toHaveBeenCalledOnce()
    expect(batch.elements).toMatchObject([{ id: cellId, count: 4 }])
    expect(batch.cellCount).toBe(1)
  })

  it('reads every viewport cell for sampled expression queries', async () => {
    const cellId = intToCellId(1, 2)
    const conn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 4,
          y_centroid: 6,
          transcript_counts: 12,
          cell_area: 18,
        },
      ],
    ])
    const matrixReader = vi.fn(
      async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Actb'], counts: [2] }])),
      }),
    )
    const dataset = makeDataset(conn, { matrixReader })

    await dataset.geneExpression(
      {
        minX: micrometers(0),
        maxX: micrometers(10),
        minY: micrometers(0),
        maxY: micrometers(20),
      },
      ['Actb'],
      { limit: 100, sampleStride: 3 },
    )

    expect(conn.preparedSql[0]).not.toContain('hash(cell_id)')
    expect(conn.statements[0]?.params).toEqual([
      'https://example.test/xenium/cells.parquet',
      micrometers(0),
      micrometers(10),
      micrometers(0),
      micrometers(20),
      100,
    ])
  })

  // Whole-section previews ask with no limit, and must score every cell.
  it('reads every cell in the box when no limit is given', async () => {
    const box = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(20),
    }
    const cellId = intToCellId(1, 2)
    const rowsConn = new FakeConnection([
      [
        {
          cell_feature_matrix_row: 0,
          x_centroid: 4,
          y_centroid: 6,
          transcript_counts: 12,
          cell_area: 18,
        },
      ],
      [{ cell_feature_matrix_row: 0, cell_id: cellId }],
    ])
    const byRows = makeDataset(rowsConn, {
      baseUrl: 'https://example.test/xenium-rows/',
      selectedGeneRowsReader: async () => ({
        nCells: 1,
        features: [
          { gene: 'Actb', rows: new Uint32Array([0]), counts: new Uint32Array([2]) },
        ],
        cellIdForRow: () => cellId,
      }),
    })
    const perCellConn = new FakeConnection([
      [
        {
          cell_id: cellId,
          x_centroid: 4,
          y_centroid: 6,
          transcript_counts: 12,
          cell_area: 18,
        },
      ],
    ])
    const perCell = makeDataset(perCellConn, {
      matrixReader: async (_url: string, ids: readonly CellId[]): Promise<GexResult> => ({
        geneNames: ['Actb'],
        cells: new Map(ids.map((id) => [id, { geneNames: ['Actb'], counts: [2] }])),
      }),
    })

    await byRows.geneExpression(box, ['Actb'])
    await perCell.geneExpression(box, ['Actb'])

    for (const conn of [rowsConn, perCellConn]) {
      expect(conn.preparedSql[0]).not.toContain('LIMIT')
      expect(conn.statements[0]?.params).toHaveLength(5)
    }
  })
})
