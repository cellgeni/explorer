import * as duckdb from '@duckdb/duckdb-wasm'
import duckdbCoiWasm from '@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url'
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import coiPthreadWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url'
import coiWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'

export interface DuckDbQueryConnection {
  query(sql: string): Promise<unknown>
}

export interface DuckDbClient {
  readonly db: duckdb.AsyncDuckDB
  readonly conn: duckdb.AsyncDuckDBConnection
  readonly bundle: duckdb.DuckDBBundle
  readonly version: string
  close(): Promise<void>
}

export interface CreateDuckDbClientOptions {
  readonly logger?: duckdb.Logger
  readonly onInstantiationProgress?: duckdb.InstantiationProgressHandler
}

export function getDuckDbBundles(): duckdb.DuckDBBundles {
  return {
    mvp: {
      mainModule: duckdbMvpWasm,
      mainWorker: mvpWorker,
    },
    eh: {
      mainModule: duckdbEhWasm,
      mainWorker: ehWorker,
    },
    coi: {
      mainModule: duckdbCoiWasm,
      mainWorker: coiWorker,
      pthreadWorker: coiPthreadWorker,
    },
  }
}

export async function configureDuckDb(conn: DuckDbQueryConnection): Promise<void> {
  await conn.query('SET enable_http_metadata_cache=true')
  await conn.query('LOAD spatial')
}

export async function createDuckDbClient(
  options: CreateDuckDbClientOptions = {},
): Promise<DuckDbClient> {
  const bundle = await duckdb.selectBundle(getDuckDbBundles())

  if (bundle.mainWorker === null) {
    throw new Error('Selected DuckDB-WASM bundle does not include a browser worker.')
  }

  const worker = new Worker(bundle.mainWorker)
  const logger = options.logger ?? new duckdb.ConsoleLogger()
  const db = new duckdb.AsyncDuckDB(logger, worker)

  await db.instantiate(
    bundle.mainModule,
    bundle.pthreadWorker,
    options.onInstantiationProgress,
  )

  const conn = await db.connect()
  await configureDuckDb(conn)

  return {
    db,
    conn,
    bundle,
    version: await db.getVersion(),
    async close() {
      await conn.close()
      await db.terminate()
    },
  }
}
