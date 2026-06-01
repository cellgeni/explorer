import { describe, expect, it } from 'vitest'
import { configureDuckDb, getDuckDbBundles } from './duckdb'
import type { DuckDbQueryConnection } from './duckdb'

class RecordingConnection implements DuckDbQueryConnection {
  readonly queries: string[] = []

  async query(sql: string): Promise<unknown> {
    this.queries.push(sql)
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

  it('declares browser bundles including the cross-origin isolated worker', () => {
    const bundles = getDuckDbBundles()

    expect(bundles.mvp.mainModule).toMatch(/duckdb-mvp\.wasm/)
    expect(bundles.eh?.mainWorker).toMatch(/duckdb-browser-eh\.worker\.js/)
    expect(bundles.coi?.pthreadWorker).toMatch(/duckdb-browser-coi\.pthread\.worker\.js/)
  })
})
