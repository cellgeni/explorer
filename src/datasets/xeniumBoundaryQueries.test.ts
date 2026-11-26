// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDuckDB,
  NODE_RUNTIME,
  VoidLogger,
  type DuckDBBindings,
  type DuckDBConnection,
} from '@duckdb/duckdb-wasm/blocking'
import { micrometers } from '../data/coords'
import type { ArrowTableLike, SqlParameter } from '../data/gex'
import {
  readXeniumBoundaryElements,
  readXeniumNucleusBoundaryElements,
} from './xeniumDatasetReaders'
import type { XeniumDuckDbConnection } from './xeniumDatasetRows'

// The outline queries run in DuckDB itself here, not against a fake, so
// that what they ask of it (vertices gathered per cell in file order, FLOAT
// bounds) is checked: the bundled DuckDB, compiled to WebAssembly, run in
// Node.

const require = createRequire(import.meta.url)
let db: DuckDBBindings
let duck: DuckDBConnection
let folder: string

beforeAll(async () => {
  db = await createDuckDB(
    {
      mvp: {
        mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'),
        mainWorker:
          require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs'),
      },
      eh: {
        mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'),
        mainWorker: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs'),
      },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  )
  await db.instantiate(() => {})
  duck = db.connect()
  folder = mkdtempSync(join(tmpdir(), 'xenium-outlines-'))

  // Cells b, a and c, in that order in both files, so the result's order by
  // cell ID is the query's doing. a has two nuclei; c lies outside the box.
  duck.query(`COPY (SELECT * FROM (VALUES
    ('bbbbbbbb-1', 20.0, 20.0), ('aaaaaaaa-1', 10.0, 10.0), ('cccccccc-1', 500.0, 500.0)
  ) AS t(cell_id, x_centroid, y_centroid)) TO '${join(folder, 'cells.parquet')}'`)
  duck.query(`COPY (SELECT cell_id, CAST(vertex_x AS FLOAT) AS vertex_x,
      CAST(vertex_y AS FLOAT) AS vertex_y, label_id FROM (VALUES
    ('bbbbbbbb-1', 21.5, 20.0, 1), ('bbbbbbbb-1', 19.0, 22.0, 1), ('bbbbbbbb-1', 18.5, 18.25, 1),
    ('aaaaaaaa-1', 12.0, 10.0, 1), ('aaaaaaaa-1', 8.0, 10.0, 1), ('aaaaaaaa-1', 10.0, 12.0, 1),
    ('aaaaaaaa-1', 11.0, 9.0, 2), ('aaaaaaaa-1', 9.0, 9.0, 2), ('aaaaaaaa-1', 10.0, 8.0, 2),
    ('cccccccc-1', 501.0, 500.0, 1), ('cccccccc-1', 499.0, 500.0, 1), ('cccccccc-1', 500.0, 501.0, 1)
  ) AS t(cell_id, vertex_x, vertex_y, label_id))
  TO '${join(folder, 'boundaries.parquet')}'`)
})

afterAll(() => {
  duck.close()
  rmSync(folder, { recursive: true, force: true })
})

const box = {
  minX: micrometers(0),
  maxX: micrometers(30),
  minY: micrometers(0),
  maxY: micrometers(30),
}

function connection(): XeniumDuckDbConnection {
  return {
    prepare: async (sql: string) => {
      const statement = duck.prepare(sql)

      return {
        query: async (...params: SqlParameter[]): Promise<ArrowTableLike> =>
          statement.query(...params) as unknown as ArrowTableLike,
      }
    },
  }
}

const points = (values: readonly (readonly [number, number])[]) =>
  values.map(([x, y]) => ({ x: micrometers(x), y: micrometers(y) }))

describe('Xenium outline queries in DuckDB', () => {
  it('reads each cell in the box as one outline, vertices in file order', async () => {
    const batch = await readXeniumBoundaryElements(
      connection(),
      {
        cells: join(folder, 'cells.parquet'),
        cellBoundaries: join(folder, 'boundaries.parquet'),
      },
      box,
    )

    expect(batch.elements).toEqual([
      {
        id: 'aaaaaaaa-1',
        geometry: {
          kind: 'polygon',
          rings: [
            points([
              [12, 10],
              [8, 10],
              [10, 12],
              [11, 9],
              [9, 9],
              [10, 8],
            ]),
          ],
        },
      },
      {
        id: 'bbbbbbbb-1',
        geometry: {
          kind: 'polygon',
          rings: [
            points([
              [21.5, 20],
              [19, 22],
              [18.5, 18.25],
            ]),
          ],
        },
      },
    ])
  })

  it('reads a nucleus per cell and label, numbering a cell second nucleus', async () => {
    const nuclei = await readXeniumNucleusBoundaryElements(
      connection(),
      { nucleusBoundaries: join(folder, 'boundaries.parquet') },
      box,
      { labelIds: true },
    )

    expect(nuclei.map(({ id, geometry }) => [id, geometry])).toEqual([
      [
        'aaaaaaaa-1',
        {
          kind: 'polygon',
          rings: [
            points([
              [12, 10],
              [8, 10],
              [10, 12],
            ]),
          ],
        },
      ],
      [
        'aaaaaaaa-1#nucleus-2',
        {
          kind: 'polygon',
          rings: [
            points([
              [11, 9],
              [9, 9],
              [10, 8],
            ]),
          ],
        },
      ],
      [
        'bbbbbbbb-1',
        {
          kind: 'polygon',
          rings: [
            points([
              [21.5, 20],
              [19, 22],
              [18.5, 18.25],
            ]),
          ],
        },
      ],
    ])
  })

  it('picks nuclei by their own vertices, without cells.parquet', async () => {
    // For the 30 µm box, vertices are read 150 µm around it and nuclei kept
    // within 75 µm. None of these cells is in cells.parquet. d is kept; e's
    // vertex mean is past 75 µm; f is cut at the edge of the read, and the
    // mean of the three vertices left (177) is past 75 µm too.
    const file = join(folder, 'nuclei.parquet')
    duck.query(`COPY (SELECT cell_id, CAST(vertex_x AS FLOAT) AS vertex_x,
        CAST(vertex_y AS FLOAT) AS vertex_y, label_id FROM (VALUES
      ('dddddddd-1', 101.0, 15.0, 1), ('dddddddd-1', 99.0, 15.0, 1), ('dddddddd-1', 100.0, 16.0, 1),
      ('eeeeeeee-1', 107.0, 15.0, 1), ('eeeeeeee-1', 105.0, 15.0, 1), ('eeeeeeee-1', 106.0, 16.0, 1),
      ('ffffffff-1', 176.0, 15.0, 1), ('ffffffff-1', 178.0, 15.0, 1), ('ffffffff-1', 177.0, 16.0, 1),
      ('ffffffff-1', 184.0, 15.0, 1), ('ffffffff-1', 186.0, 16.0, 1)
    ) AS t(cell_id, vertex_x, vertex_y, label_id)) TO '${file}'`)

    const nuclei = await readXeniumNucleusBoundaryElements(
      connection(),
      { nucleusBoundaries: file },
      box,
      { labelIds: true },
    )

    expect(nuclei.map(({ id }) => id)).toEqual(['dddddddd-1'])
  })

  it('reads 5,000 outlines of 25 vertices within 64 MB', async () => {
    // Gathered with an ordered aggregate, list(vertex_x ORDER BY
    // file_row_number), these outlines needed 128–256 MB, about 40 KB each,
    // and 73,000 nuclei of a 1.4M-cell folder ran out of DuckDB-WASM's
    // 3.1 GiB.
    const cells = join(folder, 'grid-cells.parquet')
    const outlines = join(folder, 'grid-outlines.parquet')
    // IDs aaaaaaaa-1 onwards: i in four base-16 letters, a to p.
    const letter = (shift: number) => `chr(CAST(97 + (i >> ${shift}) % 16 AS INTEGER))`
    const cellId = `'aaaa' || ${[12, 8, 4, 0].map(letter).join(' || ')} || '-1'`
    duck.query(`COPY (SELECT ${cellId} AS cell_id,
        (i % 100) * 10.0 AS x_centroid, (i // 100) * 10.0 AS y_centroid
      FROM range(5000) AS t(i)) TO '${cells}'`)
    // A zigzag of 25 vertices a cell, 0.25 µm apart in x, in file order.
    duck.query(`COPY (SELECT ${cellId} AS cell_id,
        CAST((i % 100) * 10 + k * 0.25 AS FLOAT) AS vertex_x,
        CAST((i // 100) * 10 + k % 2 AS FLOAT) AS vertex_y, 1 AS label_id
      FROM range(5000) AS t(i), range(25) AS v(k)
      ORDER BY i, k) TO '${outlines}'`)
    const grid = {
      minX: micrometers(0),
      maxX: micrometers(990),
      minY: micrometers(0),
      maxY: micrometers(490),
    }
    const limit = duck
      .query(`SELECT current_setting('memory_limit') AS limit`)
      .toArray()[0]?.limit as string

    // RESET does not bring back DuckDB-WASM's default, so the limit read is
    // set again.
    duck.query(`SET memory_limit = '64MB'`)
    try {
      const batch = await readXeniumBoundaryElements(
        connection(),
        { cells, cellBoundaries: outlines },
        grid,
      )
      const nuclei = await readXeniumNucleusBoundaryElements(
        connection(),
        { nucleusBoundaries: outlines },
        grid,
        { labelIds: true },
      )

      expect(batch.elements).toHaveLength(5000)
      expect(nuclei).toHaveLength(5000)
      expect(nuclei[4999]?.geometry).toEqual({
        kind: 'polygon',
        rings: [
          points(
            Array.from(
              { length: 25 },
              (_, k) => [990 + k * 0.25, 490 + (k % 2)] as const,
            ),
          ),
        ],
      })
    } finally {
      duck.query(`SET memory_limit = '${limit}'`)
    }
  })
})
