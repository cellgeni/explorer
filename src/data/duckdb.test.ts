import { describe, expect, it, vi } from 'vitest'
import { configureDuckDb, getDuckDbBundles } from './duckdb'
import type { DuckDbQueryConnection } from './duckdb'

class RecordingConnection implements DuckDbQueryConnection {
  readonly queries: string[] = []

  constructor(
    private readonly errors: {
      readonly httpfs?: Error
      readonly spatial?: Error
    } = {},
  ) {}

  async query(sql: string): Promise<unknown> {
    this.queries.push(sql)

    if (sql === 'LOAD httpfs' && this.errors.httpfs !== undefined) {
      throw this.errors.httpfs
    }

    if (sql === 'LOAD spatial' && this.errors.spatial !== undefined) {
      throw this.errors.spatial
    }

    return null
  }
}

describe('DuckDB-WASM bootstrap', () => {
  it('loads httpfs before configuring metadata caching and spatial', async () => {
    const conn = new RecordingConnection()

    await configureDuckDb(conn)

    expect(conn.queries).toEqual([
      'LOAD httpfs',
      'SET enable_http_metadata_cache=true',
      'LOAD spatial',
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
      'LOAD spatial',
    ])
    expect(onHttpfsLoadError).toHaveBeenCalledWith(httpfsError)
  })

  it('allows non-spatial range queries when the spatial extension cannot load', async () => {
    const spatialError = new Error('spatial unavailable')
    const onSpatialLoadError = vi.fn()
    const conn = new RecordingConnection({ spatial: spatialError })

    await configureDuckDb(conn, { onSpatialLoadError })

    expect(conn.queries).toEqual([
      'LOAD httpfs',
      'SET enable_http_metadata_cache=true',
      'LOAD spatial',
    ])
    expect(onSpatialLoadError).toHaveBeenCalledWith(spatialError)
  })

  it('can require httpfs extension loading for remote parquet query paths', async () => {
    await expect(
      configureDuckDb(new RecordingConnection({ httpfs: new Error('httpfs unavailable') }), {
        requireHttpfs: true,
      }),
    ).rejects.toThrow('httpfs unavailable')
  })

  it('can require spatial extension loading for spatial query paths', async () => {
    await expect(
      configureDuckDb(new RecordingConnection({ spatial: new Error('spatial unavailable') }), {
        requireSpatial: true,
      }),
    ).rejects.toThrow('spatial unavailable')
  })

  it('declares non-threaded browser bundles for extension compatibility', () => {
    const bundles = getDuckDbBundles()

    expect(bundles.mvp.mainModule).toMatch(/duckdb-mvp\.wasm/)
    expect(bundles.eh?.mainWorker).toMatch(/duckdb-browser-eh\.worker\.js/)
    expect(bundles.coi).toBeUndefined()
  })
})
