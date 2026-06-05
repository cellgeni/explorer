import * as duckdb from '@duckdb/duckdb-wasm'
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
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

export interface ConfigureDuckDbOptions {
  readonly requireHttpfs?: boolean
  readonly requireSpatial?: boolean
  readonly onHttpfsLoadError?: (error: Error) => void
  readonly onSpatialLoadError?: (error: Error) => void
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
  }
}

export async function configureDuckDb(
  conn: DuckDbQueryConnection,
  options: ConfigureDuckDbOptions = {},
): Promise<void> {
  try {
    await conn.query('LOAD httpfs')
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))

    if (options.requireHttpfs === true) {
      throw error
    }

    options.onHttpfsLoadError?.(error)
  }

  await conn.query('SET enable_http_metadata_cache=true')

  try {
    await conn.query('LOAD spatial')
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))

    if (options.requireSpatial === true) {
      throw error
    }

    options.onSpatialLoadError?.(error)
  }
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
