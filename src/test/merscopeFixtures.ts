import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// src/test/fixtures/merscope (see make_fixtures.py there): a three-cell
// region laid out as the MERSCOPE instrument writes it.
export type MerscopeFixture =
  | 'cell_by_gene.csv'
  | 'cell_metadata.csv'
  | 'cell_boundaries.parquet'
  | 'cell_boundaries.parquet.gz'

export function merscopeFixtureBytes(name: MerscopeFixture): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/merscope', name)),
  )
}
