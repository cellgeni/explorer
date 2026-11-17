import { describe, expect, it, vi } from 'vitest'
import {
  DuckDbExtensionLoadError,
  configureDuckDb,
  createDuckDbClient,
  getDuckDbBundles,
  loadDuckDbSpatial,
} from './duckdb'
import type { DuckDbQueryConnection } from './duckdb'

const duckDbWasm = vi.hoisted(() => ({ connect: vi.fn<() => Promise<unknown>>() }))

vi.mock('@duckdb/duckdb-wasm', () => ({
  ConsoleLogger: class {},
  selectBundle: async () => ({
    mainModule: 'duckdb-eh.wasm',
    mainWorker: 'duckdb-browser-eh.worker.js',
    pthreadWorker: null,
  }),
  AsyncDuckDB: class {
    async instantiate() {}
    connect() {
      return duckDbWasm.connect()
    }
    async getVersion() {
      return 'v1.5.1'
    }
  },
}))

class RecordingConnection implements DuckDbQueryConnection {
  readonly queries: string[] = []

  constructor(
    private readonly errors: {
      readonly httpfs?: Error
      readonly parquet?: Error
      readonly spatial?: Error[]
    } = {},
  ) {}

  async query(sql: string): Promise<unknown> {
    this.queries.push(sql)

    if (sql === 'LOAD httpfs' && this.errors.httpfs !== undefined) {
      throw this.errors.httpfs
    }

    if (sql === 'LOAD parquet' && this.errors.parquet !== undefined) {
      throw this.errors.parquet
    }

    const spatialError = sql === 'LOAD spatial' ? this.errors.spatial?.shift() : undefined

    if (spatialError !== undefined) {
      throw spatialError
    }

    return null
  }
}

describe('DuckDB-WASM bootstrap', () => {
  it('loads httpfs, configures metadata caching, loads parquet, and leaves spatial for later', async () => {
    const conn = new RecordingConnection()

    await configureDuckDb(conn)

    expect(conn.queries).toEqual([
      'LOAD httpfs',
      'SET enable_http_metadata_cache=true',
      'LOAD parquet',
    ])
  })

  it('allows range queries when httpfs cannot load in older bundles', async () => {
    const httpfsError = new Error('httpfs unavailable')
    const onHttpfsLoadError = vi.fn()
    const conn = new RecordingConnection({ httpfs: httpfsError })

    await configureDuckDb(conn, { onHttpfsLoadError })

    expect(conn.queries).toEqual([
      'LOAD httpfs',
      'SET enable_http_metadata_cache=true',
      'LOAD parquet',
    ])
    expect(onHttpfsLoadError).toHaveBeenCalledWith(httpfsError)
  })

  it('names the parquet extension when it cannot load', async () => {
    const parquetError = new Error('IO Error: Failed to fetch parquet')

    const error: unknown = await configureDuckDb(
      new RecordingConnection({ parquet: parquetError }),
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DuckDbExtensionLoadError)
    expect(error).toMatchObject({
      extension: 'parquet',
      message:
        "Parquet queries need DuckDB's parquet extension, which did not load: IO Error: Failed to fetch parquet",
      cause: parquetError,
    })
  })

  it('can require httpfs extension loading for remote parquet query paths', async () => {
    await expect(
      configureDuckDb(
        new RecordingConnection({ httpfs: new Error('httpfs unavailable') }),
        {
          requireHttpfs: true,
        },
      ),
    ).rejects.toThrow('httpfs unavailable')
  })

  it('loads the spatial extension once per connection', async () => {
    const conn = new RecordingConnection()

    await Promise.all([loadDuckDbSpatial(conn), loadDuckDbSpatial(conn)])
    await loadDuckDbSpatial(conn)

    expect(conn.queries).toEqual(['LOAD spatial'])
  })

  it('names the spatial extension when it cannot load, and tries again next time', async () => {
    const spatialError = new Error('IO Error: Failed to fetch spatial')
    const conn = new RecordingConnection({ spatial: [spatialError] })

    const error: unknown = await loadDuckDbSpatial(conn).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(DuckDbExtensionLoadError)
    expect(error).toMatchObject({
      extension: 'spatial',
      message:
        "Lasso selections need DuckDB's spatial extension, which did not load: IO Error: Failed to fetch spatial",
      cause: spatialError,
    })

    await expect(loadDuckDbSpatial(conn)).resolves.toBeUndefined()
    expect(conn.queries).toEqual(['LOAD spatial', 'LOAD spatial'])
  })

  it('warns when a new client cannot load httpfs, and loads spatial only when asked', async () => {
    const httpfsError = new Error('httpfs unavailable')
    const conn = new RecordingConnection({ httpfs: httpfsError })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    duckDbWasm.connect.mockResolvedValue(conn)
    vi.stubGlobal('Worker', class {})

    try {
      const client = await createDuckDbClient()

      expect(warn).toHaveBeenCalledWith(
        'DuckDB could not load the httpfs extension, so remote Parquet reads will be slower.',
        httpfsError,
      )
      expect(conn.queries).toEqual([
        'LOAD httpfs',
        'SET enable_http_metadata_cache=true',
        'LOAD parquet',
      ])

      await client.loadSpatial()

      expect(conn.queries).toEqual([
        'LOAD httpfs',
        'SET enable_http_metadata_cache=true',
        'LOAD parquet',
        'LOAD spatial',
      ])
    } finally {
      warn.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('declares non-threaded browser bundles for extension compatibility', () => {
    const bundles = getDuckDbBundles()

    expect(bundles.mvp.mainModule).toMatch(/duckdb-mvp\.wasm/)
    expect(bundles.eh?.mainWorker).toMatch(/duckdb-browser-eh\.worker\.js/)
    expect(bundles.coi).toBeUndefined()
  })
})
