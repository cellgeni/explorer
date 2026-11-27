import * as duckdb from '@duckdb/duckdb-wasm'
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import {
  LiveInstances,
  registerMemoryReporter,
  sumReportedBytes,
} from './memoryTelemetry'

export interface DuckDbQueryConnection {
  query(sql: string): Promise<unknown>
}

export interface DuckDbClient {
  readonly db: duckdb.AsyncDuckDB
  readonly conn: duckdb.AsyncDuckDBConnection
  readonly bundle: duckdb.DuckDBBundle
  readonly version: string
  // Loads the spatial extension, which polygon selections need.
  loadSpatial(): Promise<void>
  close(): Promise<void>
}

// DuckDB-WASM downloads its extensions from extensions.duckdb.org the first
// time they are loaded; they are not in package-lock.json.
export class DuckDbExtensionLoadError extends Error {
  readonly extension: string

  constructor(extension: string, purpose: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const message = `${purpose} need DuckDB's ${extension} extension, which did not load: ${reason}`
    super(message, { cause })
    this.name = 'DuckDbExtensionLoadError'
    this.extension = extension
  }
}

export interface ConfigureDuckDbOptions {
  readonly requireHttpfs?: boolean
  readonly onHttpfsLoadError?: (error: Error) => void
}

export interface CreateDuckDbClientOptions {
  readonly logger?: duckdb.Logger
  readonly onInstantiationProgress?: duckdb.InstantiationProgressHandler
}

// Every open client, for the memory table (O20): each is a worker, and
// reports the memory DuckDB's buffer manager holds (`duckdb_memory()`), not
// its whole WebAssembly heap.
const liveClients = new LiveInstances<DuckDbMemoryReader>()
registerMemoryReporter('DuckDB', () => {
  const clients = [...liveClients]

  return {
    entries: clients.length,
    workers: clients.length,
    bytes:
      clients.length === 0 ? 0 : sumReportedBytes(clients.map((client) => client.read())),
  }
})

// Asks on a connection of its own, one question at a time, so the dataset's
// queries are not disturbed; it waits for a query already running.
class DuckDbMemoryReader {
  private pending: Promise<number | null> | null = null

  constructor(private readonly db: duckdb.AsyncDuckDB) {}

  read(): Promise<number | null> {
    this.pending ??= this.query().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async query(): Promise<number | null> {
    try {
      const conn = await this.db.connect()

      try {
        // A sum of BIGINTs is a HUGEINT, which Arrow returns as neither a
        // number nor a bigint.
        const table = await conn.query(
          'SELECT CAST(coalesce(sum(memory_usage_bytes), 0) AS DOUBLE) AS bytes FROM duckdb_memory()',
        )
        const value: unknown = table.getChildAt(0)?.get(0)

        return typeof value === 'number' || typeof value === 'bigint'
          ? Number(value)
          : null
      } finally {
        await conn.close()
      }
    } catch {
      return null
    }
  }
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

  // DuckDB would load parquet on the first read_parquet, but when that load
  // fails it reports only "function signature mismatch", for that query and
  // every later one.
  try {
    await conn.query('LOAD parquet')
  } catch (cause) {
    throw new DuckDbExtensionLoadError('parquet', 'Parquet queries', cause)
  }
}

const spatialLoads = new WeakMap<DuckDbQueryConnection, Promise<void>>()

// ST_Within, for polygon selections, comes from the spatial extension: 4.4 MB
// from DuckDB's extension repository, compiled into 23.5 MB of WASM. Loading
// it when DuckDB started added about 1.4 s to every client, though only the
// lasso uses it, so it loads on the first polygon query. A failed load is not
// kept, so the next polygon query tries again.
export function loadDuckDbSpatial(conn: DuckDbQueryConnection): Promise<void> {
  let load = spatialLoads.get(conn)

  if (load === undefined) {
    load = conn.query('LOAD spatial').then(
      () => undefined,
      (cause: unknown) => {
        spatialLoads.delete(conn)
        throw new DuckDbExtensionLoadError('spatial', 'Lasso selections', cause)
      },
    )
    spatialLoads.set(conn, load)
  }

  return load
}

export async function createDuckDbClient(
  options: CreateDuckDbClientOptions = {},
): Promise<DuckDbClient> {
  const bundle = await duckdb.selectBundle(getDuckDbBundles())

  if (bundle.mainWorker === null) {
    throw new Error('Selected DuckDB-WASM bundle does not include a browser worker.')
  }

  const worker = new Worker(bundle.mainWorker)
  let db: duckdb.AsyncDuckDB | null = null
  let conn: duckdb.AsyncDuckDBConnection | null = null

  // A step that fails leaves the caller no client to close, so what was
  // started is shut down here, and the step's error is the one thrown.
  try {
    const logger = options.logger ?? new duckdb.ConsoleLogger()
    db = new duckdb.AsyncDuckDB(logger, worker)

    await db.instantiate(
      bundle.mainModule,
      bundle.pthreadWorker,
      options.onInstantiationProgress,
    )

    conn = await db.connect()
    await configureDuckDb(conn, {
      // Remote reads still work through DuckDB-WASM's own HTTP file system, but
      // counting cells.parquet that way took 3.7 s instead of 0.5 s.
      onHttpfsLoadError(error) {
        console.warn(
          'DuckDB could not load the httpfs extension, so remote Parquet reads will be slower.',
          error,
        )
      },
    })

    const version = await db.getVersion()
    const client = { db, conn, worker }
    const memory = new DuckDbMemoryReader(db)
    liveClients.add(memory)

    return {
      db,
      conn,
      bundle,
      version,
      loadSpatial: () => loadDuckDbSpatial(client.conn),
      close: () => {
        liveClients.delete(memory)
        return shutDownDuckDb(client)
      },
    }
  } catch (error) {
    await shutDownDuckDb({ db, conn, worker }).catch(() => undefined)
    throw error
  }
}

// Closes the connection, then terminates the database, and with it the
// worker, even when the connection does not close.
async function shutDownDuckDb(client: {
  readonly db: duckdb.AsyncDuckDB | null
  readonly conn: duckdb.AsyncDuckDBConnection | null
  readonly worker: Worker
}): Promise<void> {
  try {
    await client.conn?.close()
  } finally {
    try {
      await client.db?.terminate()
    } finally {
      client.worker.terminate()
    }
  }
}
