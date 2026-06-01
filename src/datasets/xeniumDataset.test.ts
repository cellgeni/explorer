import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import { XeniumDataset } from './xeniumDataset'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  SqlParameter,
} from '../data/gex'
import type { CellId } from '../data/cellid'
import type { DuckDbClientLike, XeniumDuckDbConnection } from './xeniumDataset'
import type { GexResult } from '../data/gex'
import type { TiffPyramidLoader } from '../tiff/loader'

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
  const duckDbClient: DuckDbClientLike = { conn }

  return new XeniumDataset({
    baseUrl: 'https://example.test/xenium/',
    duckDbClient,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          payload: {
            instrument: {
              micrometers_per_pixel: 0.5,
            },
          },
        }),
      ),
    openTiff: async () => ({}) as TiffPyramidLoader,
    ...overrides,
  })
}

describe('XeniumDataset', () => {
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

  it('groups boundary vertices into polygon elements', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([
      [
        { cell_id: cellId, x: 0, y: 0 },
        { cell_id: cellId, x: 10, y: 0 },
        { cell_id: cellId, x: 10, y: 10 },
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
    expect(conn.preparedSql[0]).toContain('ORDER BY b.cell_id, b.file_row_number')
    expect(conn.preparedSql[0]).toContain('b.vertex_x BETWEEN')
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
    const transcriptReader = vi.fn(
      async (): Promise<GexResult> => ({
        geneNames: [],
        cells: new Map(),
      }),
    )
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
      'https://example.test/xenium/morphology_mip.ome.tif',
    )
  })
})
