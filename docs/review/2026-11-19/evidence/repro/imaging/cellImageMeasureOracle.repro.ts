// IMG review: Phase 26 per-cell image measurement against an independent
// numpy oracle (fixtures/imaging/make_measure_fixtures.py), through the real
// TIFF and OME-Zarr loaders.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/imaging/cellImageMeasureOracle.repro.ts
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  planCellImageMeasurement,
  runCellImageMeasurement,
  type CellImageCell,
  type CellImageChunkMeasure,
  type CellImageLoader,
} from '../../../../../../src/features/query/cellImageMeasurer'
import { clearOpenTiffFiles, openTiff } from '../../../../../../src/tiff/loader'
import { measureTileBytes } from '../../../../../../src/workers/tileMeasureCore'
import { measureChunkCells } from '../../../../../../src/workers/zarrDecodeCore'
import { openOmeZarrImageWithOptions } from '../../../../../../src/zarr/omeZarrLoader'

const FIXTURES = join(__dirname, '../../fixtures/imaging')
const LOG = join(__dirname, '../../imaging/cellImageMeasureOracle.out.txt')
const log = (line: string) => appendFileSync(LOG, `${line}\n`)

interface OracleCell {
  readonly x: number
  readonly y: number
  readonly radius?: number
  readonly area?: number
}
interface OracleResult {
  readonly count: number
  readonly mean: number | null
  readonly above: number | null
}
interface Expected {
  readonly threshold: number
  readonly defaultRadius: number
  readonly cells: readonly OracleCell[]
  readonly levels: Record<string, { readonly results: readonly OracleResult[] }>
  readonly aniso: { readonly results: readonly OracleResult[] }
}

const expected = JSON.parse(
  readFileSync(join(FIXTURES, 'measure_expected.json'), 'utf8'),
) as Expected

// Every cell gets its radius through an area, as Xenium cells do.
const cells: CellImageCell[] = expected.cells.map((cell) => ({
  position: [cell.x, -cell.y],
  cellArea: cell.area ?? Math.PI * (cell.radius ?? expected.defaultRadius) ** 2,
}))

const measureChunk: CellImageChunkMeasure = (chunk, measure) =>
  measureChunkCells(
    chunk.source,
    chunk.bytes === undefined ? null : chunk.bytes.slice().buffer,
    chunk.window,
    measure,
  )

async function measureLevel(loader: CellImageLoader, level: number) {
  const plan = planCellImageMeasurement(loader, cells, level, expected.defaultRadius)
  const result = await runCellImageMeasurement(loader, plan, {
    threshold: expected.threshold,
    measureTile: measureTileBytes,
    measureChunk,
  })
  return { plan, result }
}

function compare(
  label: string,
  result: { mean: Float64Array; above: Float64Array },
  oracle: readonly OracleResult[],
) {
  const mismatches: string[] = []
  oracle.forEach((want, index) => {
    const mean = result.mean[index] ?? Number.NaN
    const above = result.above[index] ?? Number.NaN
    const gotMean = Number.isNaN(mean) ? null : mean
    const gotAbove = Number.isNaN(above) ? null : above
    const same = (a: number | null, b: number | null) =>
      a === null || b === null ? a === b : Math.abs(a - b) < 1e-9
    if (!same(gotMean, want.mean) || !same(gotAbove, want.above)) {
      mismatches.push(
        `${label} cell ${index}: mean ${String(gotMean)} vs ${String(want.mean)}, above ${String(gotAbove)} vs ${String(want.above)} (oracle pixels ${want.count})`,
      )
    }
  })
  return mismatches
}

function zarrFetcher(root: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    const relative = path.replace(/^\/[^/]+\.ome\.zarr\/?/, '')
    try {
      return new Response(readFileSync(join(FIXTURES, root, relative)))
    } catch {
      return new Response(null, { status: 404 })
    }
  }) as typeof fetch
}

describe('IMG Phase 26 measurement oracle', () => {
  it('OME-TIFF (32 x 16 deflate tiles, edge tiles, SubIFD levels) matches the oracle', async () => {
    clearOpenTiffFiles()
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'measure.ome.tif')))
    const loader = await openTiff(
      'https://example.test/measure.ome.tif',
      undefined,
      undefined,
      {
        bytes,
      },
    )
    expect(loader.numLevels).toBe(3)
    expect(loader.tileWidth).toBe(32)
    expect(loader.tileHeight).toBe(16)
    const mismatches: string[] = []
    for (const level of [0, 1, 2]) {
      const { result } = await measureLevel(loader, level)
      mismatches.push(
        ...compare(
          `tiff L${level}`,
          result,
          expected.levels[String(level)]?.results ?? [],
        ),
      )
    }
    log(`TIFF mismatches: ${mismatches.length}\n${mismatches.join('\n')}`)
    expect(mismatches).toEqual([])
  })

  it('OME-Zarr (24 x 24 chunks) matches the oracle', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/measure.ome.zarr',
      {
        fetcher: zarrFetcher('measure.ome.zarr'),
        decodePool: null,
      },
    )
    expect(loader.numLevels).toBe(3)
    const mismatches: string[] = []
    for (const level of [0, 1, 2]) {
      const { result } = await measureLevel(loader, level)
      mismatches.push(
        ...compare(
          `zarr L${level}`,
          result,
          expected.levels[String(level)]?.results ?? [],
        ),
      )
    }
    log(`OME-Zarr mismatches: ${mismatches.length}\n${mismatches.join('\n')}`)
    expect(mismatches).toEqual([])
  })

  it('cellsOutside counts a small in-image cell with no pixel centre as outside', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/measure.ome.zarr',
      {
        fetcher: zarrFetcher('measure.ome.zarr'),
        decodePool: null,
      },
    )
    const { plan, result } = await measureLevel(loader, 2)
    // Cell 3 is outside; cell 4 (r = 0.2 um at (5.25, 20.25)) lies inside the
    // image but covers no level-2 pixel centre.
    log(`L2 cellsOutside=${plan.cellsOutside} cell4 mean=${String(result.mean[4])}`)
    expect(Number.isNaN(result.mean[4])).toBe(true)
  })

  it('anisotropic OME-Zarr pixels (x 0.5 um, y 1.0 um): disc in micrometres', async () => {
    const loader = await openOmeZarrImageWithOptions(
      'https://example.test/aniso.ome.zarr',
      {
        fetcher: zarrFetcher('aniso.ome.zarr'),
        decodePool: null,
      },
    )
    const first = loader.tileBounds(0, 0, 0)
    const size = loader.tileSourceSize(0, 0, 0)
    log(
      `aniso tile(0,0) um/px x=${(first.maxX - first.minX) / size.width} y=${(first.maxY - first.minY) / size.height}`,
    )
    const { result } = await measureLevel(loader, 0)
    const mismatches = compare('aniso', result, expected.aniso.results)
    // How far the pixel counts are from the oracle's disc in micrometres.
    const oracleCounts = expected.aniso.results.map((r) => r.count)
    log(
      `aniso mismatches: ${mismatches.length} of ${expected.cells.length}\n${mismatches.slice(0, 12).join('\n')}\noracle pixel counts (first 8): ${oracleCounts.slice(0, 8).join(', ')}`,
    )
    expect(mismatches.length).toBeGreaterThan(0)
  })
})
