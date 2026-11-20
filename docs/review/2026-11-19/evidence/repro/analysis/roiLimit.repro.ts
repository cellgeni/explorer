// ANA review: ROI cell limits on the AnnData platforms (H5AD, Visium,
// SpatialData, Atera, MERSCOPE all route ROI cells through
// AnnDataH5adDataset.cells).
//
// Expected values are written out by hand from the fixture's coordinates, not
// computed with production helpers.
//
// Run:
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/analysis/roiLimit.repro.ts
import { describe, expect, it } from 'vitest'
import { micrometers, type DataPoint } from '../../../../../../src/data/coords'
import { ROI_CELL_EXPORT_LIMIT } from '../../../../../../src/data/roiCells'
import type { RoiSelection } from '../../../../../../src/data/roiSelection'
import { AnnDataH5adDataset } from '../../../../../../src/datasets/h5adDataset'

async function h5adWithCells(
  name: string,
  ids: readonly string[],
  xy: Float32Array,
): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/ana-review-${name}.h5ad`
  try {
    FS.unlink(fileName)
  } catch {
    // first run
  }
  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  obs.create_attribute('_index', 'cell_id')
  obs.create_attribute('column-order', [])
  obs.create_dataset({ name: 'cell_id', data: [...ids] })
  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', 'gene_ids')
  varGroup.create_dataset({ name: 'gene_ids', data: ['G1'] })
  file
    .create_group('obsm')
    .create_dataset({ name: 'spatial', data: xy, shape: [ids.length, 2] })
  file.create_dataset({
    name: 'X',
    data: new Float32Array(ids.length).fill(1),
    shape: [ids.length, 1],
  })
  file.close()
  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

function fetcherFor(bytes: Uint8Array): typeof fetch {
  return (async () => new Response(bytes.slice(), { status: 200 })) as typeof fetch
}

function point(x: number, y: number): DataPoint {
  return { x: micrometers(x), y: micrometers(y) }
}

describe('ANA: ROI cell limits on AnnData platforms', () => {
  it('returns every cell of a box when no limit is passed (the app passes none), yet the app rule flags the ROI as cut short', async () => {
    const count = ROI_CELL_EXPORT_LIMIT + 1
    const ids = Array.from({ length: count }, (_, index) => `c${index}`)
    const xy = new Float32Array(count * 2)
    for (let index = 0; index < count; index += 1) {
      xy[index * 2] = index % 300
      xy[index * 2 + 1] = Math.floor(index / 300)
    }
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/ana-roi-big.h5ad',
      fetcher: fetcherFor(await h5adWithCells('big', ids, xy)),
    })
    const box: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(-1),
        minY: micrometers(-1),
        maxX: micrometers(1000),
        maxY: micrometers(1000),
      },
    }

    // loadActiveRoiCells (App.tsx) passes `limit` only when the caller gives
    // one; useRoiWorkflow and useSelectionCells give none.
    const cells = await dataset.cells(box)

    // Hand-computed: every one of the 50,001 cells lies inside the box.
    expect(cells).toHaveLength(50_001)
    // The rule in useRoiWorkflow.ts (roiReady) and useSelectionCells.ts:
    // `cells.length >= ROI_CELL_EXPORT_LIMIT` marks the ROI as cut short,
    // which shows "50,001+" and "holds its first cells only" notes although
    // nothing was left out.
    expect(cells.length >= ROI_CELL_EXPORT_LIMIT).toBe(true)
  }, 60_000)

  it('applies a limit before the lasso test, so a lasso can come back short without reaching the limit (latent)', async () => {
    // c0..c2 lie in the lasso's bounding box but outside the lasso;
    // c3 and c4 lie inside the lasso.
    const ids = ['c0', 'c1', 'c2', 'c3', 'c4']
    const xy = Float32Array.of(0, 10, 10, 30, 20, 50, 100, 99, 105, 101)
    const dataset = new AnnDataH5adDataset({
      url: 'https://example.test/ana-roi-lasso.h5ad',
      fetcher: fetcherFor(await h5adWithCells('lasso', ids, xy)),
    })
    const lassoPoints = [point(-5, -5), point(110, 110), point(110, 95)]
    const lasso: RoiSelection = {
      kind: 'lasso',
      bbox: {
        minX: micrometers(-5),
        minY: micrometers(-5),
        maxX: micrometers(110),
        maxY: micrometers(110),
      },
      points: lassoPoints,
    }

    const unlimited = await dataset.cells(lasso)
    expect(unlimited.map((cell) => cell.id)).toEqual(['c3', 'c4'])

    // With a limit of 3, the first 3 cells of the bounding box (c0..c2) use
    // the whole limit and are then dropped by the lasso test.
    const limited = await dataset.cells(lasso, { limit: 3 })
    expect(limited.map((cell) => cell.id)).toEqual([])
    // ...and a caller that judges truncation by `length >= limit` sees none.
    expect(limited.length >= 3).toBe(false)
  })
})
