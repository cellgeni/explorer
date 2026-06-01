import { describe, expect, it } from 'vitest'
import { intToCellId } from './cellid'
import {
  aggregateGex,
  createGeneFeatureIndex,
  gexFromTranscriptsParquet,
  isGeneFeature,
  selectionToSql,
} from './gex'
import { micrometers } from './coords'
import type {
  ArrowTableLike,
  DuckDbPreparedStatementLike,
  Selection,
  SqlParameter,
  TranscriptDuckDbConnection,
} from './gex'

class FakeTable implements ArrowTableLike {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  toArray(): readonly Record<string, unknown>[] {
    return this.rows
  }
}

class FakePreparedStatement implements DuckDbPreparedStatementLike {
  params: readonly SqlParameter[] = []

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query(...params: SqlParameter[]): Promise<ArrowTableLike> {
    this.params = params
    return new FakeTable(this.rows)
  }
}

class FakeConnection implements TranscriptDuckDbConnection {
  preparedSql = ''
  readonly statement: FakePreparedStatement

  constructor(rows: readonly Record<string, unknown>[]) {
    this.statement = new FakePreparedStatement(rows)
  }

  async prepare(sql: string): Promise<DuckDbPreparedStatementLike> {
    this.preparedSql = sql
    return this.statement
  }
}

describe('selectionToSql', () => {
  it('keeps the circle bbox predicate before the exact radius predicate', () => {
    const fragment = selectionToSql(
      {
        kind: 'circle',
        cx: micrometers(100),
        cy: micrometers(200),
        radius: micrometers(25),
      },
      'x_location',
      'y_location',
    )

    expect(fragment.sql).toContain('x_location BETWEEN ? AND ?')
    expect(fragment.sql).toContain('y_location BETWEEN ? AND ?')
    expect(fragment.sql).toContain('(x_location-?)*(x_location-?)')
    expect(fragment.params).toEqual([75, 125, 175, 225, 100, 100, 200, 200, 625])
  })

  it('uses bbox pushdown plus ST_Within for polygon selections', () => {
    const selection: Selection = {
      kind: 'polygon',
      points: [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(15) },
      ],
    }
    const fragment = selectionToSql(selection, 'x_centroid', 'y_centroid')

    expect(fragment.sql).toContain('x_centroid BETWEEN ? AND ?')
    expect(fragment.sql).toContain('ST_Within(ST_Point(x_centroid, y_centroid)')
    expect(fragment.params).toEqual([0, 10, 0, 15, 'POLYGON((0 0, 10 0, 10 15, 0 0))'])
  })
})

describe('transcripts parquet GEX', () => {
  it('aggregates transcript rows into sparse per-cell counts', async () => {
    const cellId = intToCellId(0x1234abcd, 1)
    const conn = new FakeConnection([
      { cell_id: cellId, gene: 'Gad1', count: 3n },
      { cell_id: cellId, gene: 'Slc17a7', count: 2 },
      { cell_id: null, gene: 'OutsideCell', count: 5 },
    ])

    const result = await gexFromTranscriptsParquet(
      conn,
      'https://example/transcripts.parquet',
      {
        kind: 'circle',
        cx: micrometers(100),
        cy: micrometers(200),
        radius: micrometers(25),
      },
    )

    expect(conn.preparedSql).toContain('FROM read_parquet( ? )')
    expect(conn.preparedSql).not.toMatch(/ST_DWithin/i)
    expect(result.geneNames).toEqual(['Gad1', 'OutsideCell', 'Slc17a7'])
    expect(result.cells.get(cellId)).toEqual({
      geneNames: ['Gad1', 'Slc17a7'],
      counts: [3, 2],
    })
  })

  it('uses cell_id IN UNNEST for cells-only transcript scope', async () => {
    const cellId = intToCellId(1, 1)
    const conn = new FakeConnection([])

    await gexFromTranscriptsParquet(
      conn,
      'https://example/transcripts.parquet',
      {
        kind: 'circle',
        cx: micrometers(0),
        cy: micrometers(0),
        radius: micrometers(10),
      },
      'cells-only',
      [cellId],
      30,
    )

    expect(conn.preparedSql).toContain('cell_id IN (SELECT * FROM UNNEST( ? ))')
    expect(conn.statement.params).toEqual([
      'https://example/transcripts.parquet',
      [String(cellId)],
      30,
    ])
  })
})

describe('GEX helpers', () => {
  it('filters non-gene feature names and feature types', () => {
    expect(isGeneFeature('Gad1', 'Gene Expression')).toBe(true)
    expect(isGeneFeature('NegControlProbe_001', 'Gene Expression')).toBe(false)
    expect(isGeneFeature('BLANK_001', undefined)).toBe(false)
    expect(isGeneFeature('Antisense_Gad1', undefined)).toBe(false)
    expect(isGeneFeature('Gad1', 'Antibody Capture')).toBe(false)
    expect([...createGeneFeatureIndex(['Gad1', 'BLANK_1', 'Actb'], [])]).toEqual([0, 2])
  })

  it('aggregates sparse per-cell GEX counts', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const totals = aggregateGex(
      new Map([
        [cellA, { geneNames: ['Gad1', 'Actb'], counts: [2, 5] }],
        [cellB, { geneNames: ['Gad1'], counts: [4] }],
      ]),
    )

    expect(totals).toEqual([
      { gene: 'Gad1', count: 6 },
      { gene: 'Actb', count: 5 },
    ])
  })
})
