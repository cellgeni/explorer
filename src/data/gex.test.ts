import { describe, expect, it, vi } from 'vitest'
import { cellIdToInt, intToCellId } from './cellid'
import {
  aggregateGex,
  createGeneFeatureIndex,
  FullFileMatrixBudgetExceededError,
  gexFromCellMajorSparseArrays,
  gexFromCellFeatureMatrixH5,
  gexFromFeatureBarcodeMatrixH5,
  gexFromFeatureMajorSparseArrays,
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

  it('uses scalar cell_id parameters for cells-only transcript scope', async () => {
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

    expect(conn.preparedSql).toContain('cell_id IN (?)')
    expect(conn.statement.params).toEqual([
      'https://example/transcripts.parquet',
      String(cellId),
      30,
    ])
  })

  it('skips cells-only transcript queries with no cell ids', async () => {
    const conn = new FakeConnection([])

    const result = await gexFromTranscriptsParquet(
      conn,
      'https://example/transcripts.parquet',
      {
        kind: 'circle',
        cx: micrometers(0),
        cy: micrometers(0),
        radius: micrometers(10),
      },
      'cells-only',
      [],
    )

    expect(conn.preparedSql).toBe('')
    expect(result).toEqual({
      geneNames: [],
      cells: new Map(),
    })
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

  it('extracts selected genes from feature-major matrix arrays', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)
    const cellIdData = cellIdsToUint32Pairs([cellA, cellB, cellC])

    const result = gexFromFeatureMajorSparseArrays({
      cellIds: [cellB, cellA],
      selectedGenes: ['gad1', 'Actb', 'Gad1'],
      geneNames: ['Actb', 'Gad1', 'NegControlProbe_001'],
      featureTypes: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
      cellIdData,
      cellIdStride: 2,
      indptr: new Uint32Array([0, 2, 5, 6]),
      indices: new Uint32Array([0, 2, 0, 1, 2, 1]),
      data: new Uint32Array([7, 1, 2, 3, 4, 99]),
    })

    expect(result.geneNames).toEqual(['Gad1', 'Actb'])
    expect(result.cells.get(cellA)).toEqual({
      geneNames: ['Gad1', 'Actb'],
      counts: [2, 7],
    })
    expect(result.cells.get(cellB)).toEqual({
      geneNames: ['Gad1'],
      counts: [3],
    })
    expect(result.cells.has(cellC)).toBe(false)
  })

  it('extracts ROI genes from cell-major matrix arrays', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)
    const indices = new BigInt64Array([1n, 2n, 0n, 1n, 0n, 1n])
    const data = new Int32Array([3, 99, 100, 100, 7, 2])

    const result = gexFromCellMajorSparseArrays({
      cellIds: [cellA, cellB, cellC],
      geneNames: ['Actb', 'Gad1', 'NegControlProbe_001'],
      featureTypes: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
      cellIdRows: new Map([
        [cellB, 0],
        [cellA, 2],
      ]),
      indptr: new BigInt64Array([0n, 2n, 4n, 6n]),
      indicesDataset: {
        slice: (ranges) => {
          const [start = 0, end = indices.length] = ranges[0] ?? []
          return indices.subarray(start ?? 0, end ?? indices.length)
        },
      },
      dataDataset: {
        slice: (ranges) => {
          const [start = 0, end = data.length] = ranges[0] ?? []
          return data.subarray(start ?? 0, end ?? data.length)
        },
      },
    })

    expect(result.geneNames).toEqual(['Actb', 'Gad1'])
    expect(result.cells.get(cellA)).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [7, 2],
    })
    expect(result.cells.get(cellB)).toEqual({
      geneNames: ['Gad1'],
      counts: [3],
    })
    expect(result.cells.get(cellC)).toEqual({ geneNames: [], counts: [] })
  })

  it('reads ROI genes from a cell_feature_matrix.h5 file with h5wasm', async () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)
    const bytes = await createTinyH5CellFeatureMatrix([cellA, cellB])
    const body = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(body).set(bytes)
    const originalFetch = globalThis.fetch

    globalThis.fetch = async () => new Response(body)

    try {
      const result = await gexFromCellFeatureMatrixH5(
        'https://example.test/xenium/cell_feature_matrix.h5',
        [cellB, cellC, cellA],
      )

      expect(result.geneNames).toEqual(['Actb', 'Gad1'])
      expect(result.cells.get(cellA)).toEqual({
        geneNames: ['Actb'],
        counts: [5],
      })
      expect(result.cells.get(cellB)).toEqual({
        geneNames: ['Actb', 'Gad1'],
        counts: [2, 3],
      })
      expect(result.cells.get(cellC)).toEqual({ geneNames: [], counts: [] })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reads generic barcode rows from a feature-barcode matrix H5 file', async () => {
    const bytes = await createTinyH5CellFeatureMatrix(['AAAC-1', 'TTGG-1'])
    const body = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(body).set(bytes)
    const originalFetch = globalThis.fetch

    globalThis.fetch = async () => new Response(body)

    try {
      const result = await gexFromFeatureBarcodeMatrixH5(
        'https://example.test/visium/filtered_feature_bc_matrix.h5',
        ['TTGG-1', 'missing-barcode', 'AAAC-1'],
      )

      expect(result.geneNames).toEqual(['Actb', 'Gad1'])
      expect(result.cells.get('AAAC-1')).toEqual({
        geneNames: ['Actb'],
        counts: [5],
      })
      expect(result.cells.get('TTGG-1')).toEqual({
        geneNames: ['Actb', 'Gad1'],
        counts: [2, 3],
      })
      expect(result.cells.get('missing-barcode')).toEqual({
        geneNames: [],
        counts: [],
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects oversized H5 matrices before fetching the full file', async () => {
    const originalFetch = globalThis.fetch
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: {
            'content-length': String(128 * 1024 * 1024),
          },
        })
      }

      throw new Error('Unexpected full matrix fetch')
    })

    globalThis.fetch = fetcher

    try {
      await expect(
        gexFromFeatureBarcodeMatrixH5(
          'https://example.test/visium/oversized_feature_bc_matrix.h5',
          ['AAAC-1'],
          { maxFullFileBytes: 64 * 1024 * 1024 },
        ),
      ).rejects.toBeInstanceOf(FullFileMatrixBudgetExceededError)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

function cellIdsToUint32Pairs(cellIds: readonly string[]): Uint32Array {
  const values = new Uint32Array(cellIds.length * 2)

  for (let index = 0; index < cellIds.length; index += 1) {
    const cellId = cellIds[index]

    if (cellId === undefined) {
      continue
    }

    const { prefix, suffix } = cellIdToInt(cellId)
    values[index * 2] = prefix
    values[index * 2 + 1] = suffix
  }

  return values
}

async function createTinyH5CellFeatureMatrix(
  cellIds: readonly string[],
): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/vitest-cell-feature-matrix-${cellIds.join('-')}.h5`

  try {
    FS.unlink(fileName)
  } catch {
    // No previous fixture file exists for the first run.
  }

  const file = new h5wasm.File(fileName, 'w')
  const matrix = file.create_group('matrix')
  const features = matrix.create_group('features')

  matrix.create_dataset({ name: 'barcodes', data: [...cellIds] })
  features.create_dataset({
    name: 'name',
    data: ['Actb', 'Gad1', 'NegControlProbe_001'],
  })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })
  matrix.create_dataset({
    name: 'indptr',
    data: new BigInt64Array([0n, 2n, 4n]),
  })
  matrix.create_dataset({
    name: 'indices',
    data: new Int32Array([0, 2, 0, 1]),
  })
  matrix.create_dataset({
    name: 'data',
    data: new Int32Array([5, 99, 2, 3]),
  })
  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)

  return bytes
}
