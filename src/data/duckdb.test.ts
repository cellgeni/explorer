import { describe, expect, it, vi } from 'vitest'
import { configureDuckDb, getDuckDbBundles } from './duckdb'
import type { DuckDbQueryConnection } from './duckdb'

class RecordingConnection implements DuckDbQueryConnection {
  readonly queries: string[] = []

  constructor(private readonly spatialError?: Error) {}

  async query(sql: string): Promise<unknown> {
    this.queries.push(sql)

    if (sql === 'LOAD spatial' && this.spatialError !== undefined) {
      throw this.spatialError
    }

    return null
  }
}

describe('DuckDB-WASM bootstrap', () => {
  it('configures metadata caching and spatial without loading httpfs', async () => {
    const conn = new RecordingConnection()

    await configureDuckDb(conn)

    expect(conn.queries).toEqual(['SET enable_http_metadata_cache=true', 'LOAD spatial'])
    expect(conn.queries.join('\n')).not.toMatch(/httpfs/i)
  })

  it('allows non-spatial range queries when the spatial extension cannot load', async () => {
    const spatialError = new Error('spatial unavailable')
    const onSpatialLoadError = vi.fn()
    const conn = new RecordingConnection(spatialError)

    await configureDuckDb(conn, { onSpatialLoadError })

    expect(conn.queries).toEqual(['SET enable_http_metadata_cache=true', 'LOAD spatial'])
    expect(onSpatialLoadError).toHaveBeenCalledWith(spatialError)
  })

  it('can require spatial extension loading for spatial query paths', async () => {
    await expect(
      configureDuckDb(new RecordingConnection(new Error('spatial unavailable')), {
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
