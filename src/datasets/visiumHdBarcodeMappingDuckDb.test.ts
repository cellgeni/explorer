import { describe, expect, it, vi } from 'vitest'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  SqlParameter,
} from '../data/gex'
import {
  readVisiumHdBarcodeMappingsForCellWithDuckDb,
  type DuckDbBarcodeMappingClientLike,
} from './visiumHdBarcodeMappingDuckDb'

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

describe('readVisiumHdBarcodeMappingsForCellWithDuckDb', () => {
  it('queries barcode_mappings.parquet for one segmented cell', async () => {
    const statement = new FakeStatement([
      {
        square_002um: 's_002um_000001_000002-1',
        square_008um: 's_008um_000000_000000-1',
        square_016um: 's_016um_000000_000000-1',
        cell_id: 'cell-1',
        in_nucleus: false,
        in_cell: true,
      },
    ])
    const close = vi.fn(async () => undefined)
    const client: DuckDbBarcodeMappingClientLike = {
      conn: {
        prepare: vi.fn(async () => statement),
      },
      close,
    }

    await expect(
      readVisiumHdBarcodeMappingsForCellWithDuckDb(
        'https://example.test/visium',
        'cell-1',
        {
          createClient: async () => client,
        },
      ),
    ).resolves.toEqual([
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: 'cell-1',
        inNucleus: false,
        inCell: true,
      },
    ])

    expect(client.conn.prepare).toHaveBeenCalledWith(
      expect.stringContaining('cell_id = ?'),
    )
    expect(client.conn.prepare).toHaveBeenCalledWith(
      expect.stringContaining('read_parquet( ? )'),
    )
    expect(statement.params).toEqual([
      'https://example.test/visium/barcode_mappings.parquet',
      'cell-1',
    ])
    expect(close).toHaveBeenCalledOnce()
  })
})
