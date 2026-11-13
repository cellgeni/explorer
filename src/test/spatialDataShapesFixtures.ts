import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AsyncBuffer } from 'hyparquet'
import { asyncBufferFromBytes } from './xeniumCellsFixtures'

// src/test/fixtures/spatialdata (see make_fixtures.py there): GeoParquet
// shapes laid out like spatialdata-io's. cell_boundaries.parquet holds four
// polygons (ids aaaa-1 to aaad-1), cell_circles.parquet three circles (ids 7
// to 9).
export type SpatialDataShapesFixture = 'cell_boundaries.parquet' | 'cell_circles.parquet'

export function spatialDataShapesFixtureBytes(
  name: SpatialDataShapesFixture,
): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/spatialdata', name)),
  )
}

export function spatialDataShapesFixture(name: SpatialDataShapesFixture): AsyncBuffer {
  return asyncBufferFromBytes(spatialDataShapesFixtureBytes(name))
}
