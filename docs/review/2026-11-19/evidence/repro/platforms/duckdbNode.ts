// Review harness (PLT): a real DuckDB-WASM instance in Node (the package's
// node-blocking build, same engine version as the app's browser build), wrapped
// in the `DuckDbClientLike` shape `XeniumDataset` takes. Lets a repro run the
// production SQL against tiny Parquet files written by DuckDB itself.
//
// Not a test file: imported by *.repro.ts only.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const DIST = join(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist/')
const duckdb = require(join(DIST, 'duckdb-node-blocking.cjs'))

interface BlockingStatement {
  query(...params: unknown[]): {
    toArray(): { toJSON(): Record<string, unknown> }[]
    getChild(name: string): { toArray(): ArrayLike<number> } | null
  }
}

interface BlockingConnection {
  query(sql: string): { toArray(): { toJSON(): Record<string, unknown> }[] }
  prepare(sql: string): BlockingStatement
}

export interface NodeDuckDb {
  readonly sql: (sql: string) => Record<string, unknown>[]
  // A temporary folder; datasets use `${dir}/<name>` as their base URL, which
  // DuckDB reads from the local file system (datasetFileUrl only joins paths).
  readonly dir: string
  // Writes `selectSql` to Parquet at `path` with DuckDB.
  readonly parquet: (path: string, selectSql: string) => Uint8Array
  readonly client: {
    readonly conn: {
      prepare(sql: string): Promise<{
        query(...params: unknown[]): Promise<{
          toArray(): Record<string, unknown>[]
          getChild(name: string): { toArray(): ArrayLike<number> } | null
        }>
      }>
    }
    loadSpatial(): Promise<void>
  }
}

export async function createNodeDuckDb(): Promise<NodeDuckDb> {
  const bundles = {
    mvp: {
      mainModule: join(DIST, 'duckdb-mvp.wasm'),
      mainWorker: join(DIST, 'duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: join(DIST, 'duckdb-eh.wasm'),
      mainWorker: join(DIST, 'duckdb-node-eh.worker.cjs'),
    },
  }
  const db = await duckdb.createDuckDB(
    bundles,
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  )
  await db.instantiate(() => {})
  const conn: BlockingConnection = db.connect()
  const dir = mkdtempSync(join(tmpdir(), 'plt-duckdb-'))

  return {
    dir,
    sql: (sql) =>
      conn
        .query(sql)
        .toArray()
        .map((row) => row.toJSON()),
    parquet: (path, selectSql) => {
      mkdirSync(dirname(path), { recursive: true })
      conn.query(`COPY (${selectSql}) TO '${path}' (FORMAT PARQUET)`)
      return new Uint8Array(readFileSync(path))
    },
    client: {
      conn: {
        prepare: async (sql) => {
          const statement = conn.prepare(sql)
          return {
            query: async (...params) => {
              const table = statement.query(...params)
              return {
                toArray: () => table.toArray().map((row) => row.toJSON()),
                getChild: (name) => table.getChild(name),
              }
            },
          }
        },
      },
      loadSpatial: async () => {},
    },
  }
}
