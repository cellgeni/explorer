import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DuckDbExtensionLoadError,
  configureDuckDb,
  createDuckDbClient,
  getDuckDbBundles,
  loadDuckDbSpatial,
} from './duckdb'
import type { DuckDbQueryConnection } from './duckdb'

const duckDbWasm = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<unknown>>(),
  terminate: vi.fn<() => Promise<void>>(),
  // The AsyncDuckDB step that throws, if any.
  failing: null as 'construct' | 'instantiate' | 'getVersion' | null,
}))

vi.mock('@duckdb/duckdb-wasm', () => ({
  ConsoleLogger: class {},
  selectBundle: async () => ({
    mainModule: 'duckdb-eh.wasm',
    mainWorker: 'duckdb-browser-eh.worker.js',
    pthreadWorker: null,
  }),
  AsyncDuckDB: class {
    constructor() {
      if (duckDbWasm.failing === 'construct') throw new Error('construct failed')
    }
    async instantiate() {
      if (duckDbWasm.failing === 'instantiate') throw new Error('instantiate failed')
    }
    connect() {
      return duckDbWasm.connect()
    }
    async getVersion() {
      if (duckDbWasm.failing === 'getVersion') throw new Error('getVersion failed')
      return 'v1.5.1'
    }
    terminate() {
      return duckDbWasm.terminate()
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

class ClosableConnection extends RecordingConnection {
  closes = 0

  constructor(
    errors: ConstructorParameters<typeof RecordingConnection>[0] = {},
    private readonly closeFails = false,
  ) {
    super(errors)
  }

  async close(): Promise<void> {
    this.closes += 1
    if (this.closeFails) throw new Error('close failed')
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

  describe('when a client fails to start', () => {
    const workers: { terminated: number }[] = []

    beforeEach(() => {
      workers.length = 0
      duckDbWasm.failing = null
      duckDbWasm.connect.mockReset()
      duckDbWasm.terminate.mockReset().mockResolvedValue(undefined)
      vi.stubGlobal(
        'Worker',
        class {
          readonly record = { terminated: 0 }

          constructor() {
            workers.push(this.record)
          }

          terminate() {
            this.record.terminated += 1
          }
        },
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it.each(['construct', 'instantiate'] as const)(
      'ends the worker when the database cannot %s',
      async (step) => {
        duckDbWasm.failing = step

        await expect(createDuckDbClient()).rejects.toThrow(`${step} failed`)
        expect(workers).toHaveLength(1)
        expect(workers[0]?.terminated).toBeGreaterThan(0)
        expect(duckDbWasm.connect).not.toHaveBeenCalled()
      },
    )

    it('terminates the database when it cannot connect', async () => {
      duckDbWasm.connect.mockRejectedValue(new Error('connect failed'))

      await expect(createDuckDbClient()).rejects.toThrow('connect failed')
      expect(duckDbWasm.terminate).toHaveBeenCalledTimes(1)
      expect(workers[0]?.terminated).toBeGreaterThan(0)
    })

    it.each([
      {
        step: 'an extension does not load',
        conn: () => new ClosableConnection({ parquet: new Error('no parquet') }),
        failing: null,
        message: 'parquet extension',
      },
      {
        step: 'the version cannot be read',
        conn: () => new ClosableConnection(),
        failing: 'getVersion',
        message: 'getVersion failed',
      },
    ] as const)(
      'closes the connection and terminates the database when $step',
      async ({ conn: createConn, failing, message }) => {
        const conn = createConn()
        duckDbWasm.connect.mockResolvedValue(conn)
        duckDbWasm.failing = failing

        await expect(createDuckDbClient()).rejects.toThrow(message)
        expect(conn.closes).toBe(1)
        expect(duckDbWasm.terminate).toHaveBeenCalledTimes(1)
        expect(workers[0]?.terminated).toBeGreaterThan(0)
      },
    )

    it('keeps the step error when shutting down fails too', async () => {
      duckDbWasm.connect.mockResolvedValue(new ClosableConnection({}, true))
      duckDbWasm.failing = 'getVersion'
      duckDbWasm.terminate.mockRejectedValue(new Error('terminate failed'))

      await expect(createDuckDbClient()).rejects.toThrow('getVersion failed')
      expect(workers[0]?.terminated).toBeGreaterThan(0)
    })

    it('terminates the database on close even when the connection does not close', async () => {
      const conn = new ClosableConnection({}, true)
      duckDbWasm.connect.mockResolvedValue(conn)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        const client = await createDuckDbClient()

        await expect(client.close()).rejects.toThrow('close failed')
        expect(conn.closes).toBe(1)
        expect(duckDbWasm.terminate).toHaveBeenCalledTimes(1)
        expect(workers[0]?.terminated).toBeGreaterThan(0)
      } finally {
        warn.mockRestore()
      }
    })
  })

  it('declares non-threaded browser bundles for extension compatibility', () => {
    const bundles = getDuckDbBundles()

    expect(bundles.mvp.mainModule).toMatch(/duckdb-mvp\.wasm/)
    expect(bundles.eh?.mainWorker).toMatch(/duckdb-browser-eh\.worker\.js/)
    expect(bundles.coi).toBeUndefined()
  })
})
