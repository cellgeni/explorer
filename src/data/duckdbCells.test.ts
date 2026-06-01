import { describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import { micrometers } from './coords'
import { readCellsOverviewWithDuckDb } from './duckdbCells'
import type { ArrowTableLike, DuckDbPreparedStatementLike, SqlParameter } from './gex'
import type { DuckDbOverviewClientLike } from './duckdbCells'

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

describe('readCellsOverviewWithDuckDb', () => {
  it('reads overview columns through DuckDB and parses numeric row values', async () => {
    const cellId = intToCellId(1, 2)
    const statement = new FakeStatement([
      {
        cell_id: cellId,
        x_centroid: 10,
        y_centroid: 20n,
        transcript_counts: 30n,
        cell_area: 40,
      },
    ])
    const close = vi.fn(async () => undefined)
    const client: DuckDbOverviewClientLike = {
      conn: {
        prepare: vi.fn(async () => statement),
      },
      close,
    }

    await expect(
      readCellsOverviewWithDuckDb({
        url: 'https://example.test/xenium/cells.parquet',
        limit: 100,
        createClient: async () => client,
      }),
    ).resolves.toEqual([
      {
        cellId,
        position: { x: micrometers(10), y: micrometers(20) },
        transcriptCount: 30,
        cellArea: 40,
      },
    ])

    expect(client.conn.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT cell_id,'),
    )
    expect(client.conn.prepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT ?'))
    expect(statement.params).toEqual(['https://example.test/xenium/cells.parquet', 100])
    expect(close).toHaveBeenCalledOnce()
  })

  it('omits cell IDs and limits when requested for all-cell overview drawing', async () => {
    const statement = new FakeStatement([
      {
        x_centroid: 1,
        y_centroid: 2,
        transcript_counts: 3,
        cell_area: 4,
      },
    ])
    const client: DuckDbOverviewClientLike = {
      conn: {
        prepare: vi.fn(async () => statement),
      },
    }

    await readCellsOverviewWithDuckDb({
      url: 'https://example.test/xenium/cells.parquet',
      includeCellIds: false,
      createClient: async () => client,
    })

    expect(client.conn.prepare).toHaveBeenCalledWith(
      expect.not.stringContaining('cell_id'),
    )
    expect(client.conn.prepare).toHaveBeenCalledWith(
      expect.not.stringContaining('LIMIT ?'),
    )
    expect(statement.params).toEqual(['https://example.test/xenium/cells.parquet'])
  })
})
