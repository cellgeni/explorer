import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { cell, fakeCellImage as fakeImage } from '../../test/cellImageFixtures'
import { measureTileBytes } from '../../workers/tileMeasureCore'
import {
  CELL_IMAGE_ASK_BYTES,
  CELL_IMAGE_REFUSE_BYTES,
  cellImageLevels,
  cellImageReadBytes,
  cellImageReadDecision,
  defaultCellImageLevel,
  planCellImageMeasurement,
  runCellImageMeasurement,
  type CellImageCell,
  type CellImageLoader,
} from './cellImageMeasurer'

async function measure(
  loader: CellImageLoader,
  cells: readonly CellImageCell[],
  options: { level?: number; radius?: number; threshold?: number } = {},
) {
  const plan = planCellImageMeasurement(
    loader,
    cells,
    options.level ?? 0,
    options.radius ?? 1,
  )
  return runCellImageMeasurement(loader, plan, {
    threshold: options.threshold ?? 50,
    measureTile: measureTileBytes,
  })
}

const values = (array: Float64Array) =>
  Array.from(array, (value) => (Number.isNaN(value) ? null : value))

describe('cell image measurements', () => {
  it('measures the mean and share above under each disc, across tile edges', async () => {
    // 8 x 8 in 4 x 4 tiles; the right half is 100, the left 10.
    const { loader } = fakeImage({
      width: 8,
      height: 8,
      pixel: (x) => (x >= 4 ? 100 : 10),
    })
    const result = await measure(loader, [
      // On the tile edge: a 2 x 2 block, half on each side.
      cell(4, 4),
      cell(1, 1),
      cell(7, 7),
    ])

    expect(values(result.mean)).toEqual([55, 10, 100])
    expect(values(result.above)).toEqual([50, 0, 100])
    expect(result).toMatchObject({ cellsOutside: 0, tiles: 4 })
  })

  it('uses each cell’s area for its disc, and the radius for cells without one', async () => {
    const { loader } = fakeImage({ width: 8, height: 8, pixel: (x, y) => x + y * 8 })
    // Area π: radius 1, the 2 x 2 pixels around (4, 4). Radius 0.5 at
    // (2, 6.5): the centres of pixels (1, 6) and (2, 6), on its edge.
    const result = await measure(loader, [cell(4, 4, Math.PI), cell(2, 6.5)], {
      radius: 0.5,
    })

    expect(values(result.mean)).toEqual([(27 + 28 + 35 + 36) / 4, 49.5])
  })

  it('gives cells outside the image no value', async () => {
    const { loader } = fakeImage({ width: 8, height: 8, pixel: () => 7 })
    const result = await measure(loader, [cell(-5, 2), cell(2, 2), cell(2, 50)])

    expect(values(result.mean)).toEqual([null, 7, null])
    expect(result.cellsOutside).toBe(2)
    expect(result.tiles).toBe(1)
  })

  it('reads a coarser level in its own pixels', async () => {
    // Level 1 takes each 2 x 2's top-left pixel: x even only.
    const { loader } = fakeImage({
      width: 16,
      height: 16,
      levels: 2,
      pixel: (x) => (x % 4 === 0 ? 40 : 20),
    })

    expect(cellImageLevels(loader)).toEqual([
      { level: 0, micrometersPerPixel: 1 },
      { level: 1, micrometersPerPixel: 2 },
    ])
    const result = await measure(loader, [cell(8, 8)], { level: 1, radius: 2 })

    // The 2 x 2 level-1 pixels around (4, 4): columns 3 and 4, from level-0
    // x 6 and 8.
    expect(values(result.mean)).toEqual([30])
  })

  it('places cells in an image that starts away from the origin (MERSCOPE)', async () => {
    const { loader } = fakeImage({
      width: 8,
      height: 8,
      micrometersPerPixel: 0.5,
      origin: { x: 1000, y: 2000 },
      pixel: (x, y) => (x === 5 && y === 2 ? 90 : 10),
    })
    // Pixel (5, 2) spans 1002.5-1003 and 2001-2001.5 µm.
    const result = await measure(loader, [cell(1002.75, 2001.25)], { radius: 0.3 })

    expect(values(result.mean)).toEqual([90])
  })

  it('maps cells into a flipped image’s frame', async () => {
    // Flipped vertically: frame y = 8 - dataset y.
    const { loader } = fakeImage({
      width: 8,
      height: 8,
      placement: { a: 1, b: 0, c: micrometers(0), d: 0, e: -1, f: micrometers(8) },
      pixel: (x, y) => (x === 1 && y === 6 ? 90 : 10),
    })
    const result = await measure(loader, [cell(1.5, 1.5)], { radius: 0.3 })

    expect(values(result.mean)).toEqual([90])
  })

  it('maps cells into an image whose axes are swapped', async () => {
    // Dataset x is frame y and dataset y is frame x.
    const { loader } = fakeImage({
      width: 8,
      height: 8,
      placement: { a: 0, b: 1, c: micrometers(0), d: 1, e: 0, f: micrometers(0) },
      pixel: (x, y) => (x === 6 && y === 1 ? 90 : 10),
    })
    const result = await measure(loader, [cell(1.5, 6.5)], { radius: 0.3 })

    expect(values(result.mean)).toEqual([90])
  })

  it('reads tiles row by row, naming those that come next, without persisting them', async () => {
    const { loader, fetches } = fakeImage({ width: 12, height: 8, pixel: () => 1 })
    await measure(loader, [cell(1, 1), cell(5, 5), cell(9, 1), cell(1, 5)])

    expect(fetches.map(({ tile }) => [tile.col, tile.row])).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ])
    expect(fetches[0]?.options).toMatchObject({
      persist: false,
      upcoming: [
        { col: 2, row: 0 },
        { col: 0, row: 1 },
        { col: 1, row: 1 },
      ],
    })
  })

  it('reports progress up to every tile', async () => {
    const { loader } = fakeImage({ width: 8, height: 8, pixel: () => 1 })
    const plan = planCellImageMeasurement(
      loader,
      [cell(1, 1), cell(5, 5), cell(4, 1)],
      0,
      1,
    )
    const onProgress = vi.fn()

    await runCellImageMeasurement(loader, plan, {
      threshold: 1,
      measureTile: measureTileBytes,
      onProgress,
    })

    expect(plan.tiles).toHaveLength(3)
    expect(onProgress.mock.calls.map(([done]) => done as number)).toEqual([1, 2, 3])
  })

  it('reads a failed tile once more', async () => {
    const { loader, fetches } = fakeImage({
      width: 8,
      height: 8,
      pixel: () => 3,
      fail: (tile, attempt) => tile.col === 1 && attempt === 1,
    })
    const result = await measure(loader, [cell(6, 2)])

    expect(values(result.mean)).toEqual([3])
    expect(fetches).toHaveLength(2)
  })

  it('fails when a tile cannot be read twice', async () => {
    const { loader } = fakeImage({
      width: 8,
      height: 8,
      pixel: () => 3,
      fail: (tile) => tile.col === 1,
    })

    await expect(measure(loader, [cell(1, 1), cell(6, 2)])).rejects.toThrow(
      "The image's tiles could not be read: Tile 0/1/0 failed",
    )
  })

  it('stops part-way when cancelled', async () => {
    const { loader, fetches } = fakeImage({ width: 64, height: 64, pixel: () => 1 })
    const cells = Array.from({ length: 256 }, (_, index) =>
      cell((index % 16) * 4 + 2, Math.floor(index / 16) * 4 + 2),
    )
    const plan = planCellImageMeasurement(loader, cells, 0, 1)
    const controller = new AbortController()
    const run = runCellImageMeasurement(loader, plan, {
      threshold: 1,
      measureTile: measureTileBytes,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 20) controller.abort()
      },
    })

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetches.length).toBeLessThan(plan.tiles.length)
  })

  it('sizes the read from the tile index, or at most the decoded tiles', async () => {
    const { loader } = fakeImage({ width: 8, height: 8, pixel: () => 1 })
    const plan = planCellImageMeasurement(loader, [cell(1, 1), cell(6, 6)], 0, 1)

    await expect(cellImageReadBytes(loader, plan)).resolves.toBe(2 * 4 * 4 * 2)
    await expect(
      cellImageReadBytes({ ...loader, tileReadBytes: async () => 1234 }, plan),
    ).resolves.toBe(1234)
  })

  it('measures, asks first, or refuses by the size of the read', () => {
    expect(cellImageReadDecision(180e6)).toBe('measure')
    expect(cellImageReadDecision(CELL_IMAGE_ASK_BYTES + 1)).toBe('ask')
    expect(cellImageReadDecision(CELL_IMAGE_REFUSE_BYTES + 1)).toBe('refuse')
  })

  it('defaults to level 2, or the coarsest of an image with fewer', () => {
    expect(defaultCellImageLevel({ numLevels: 9 })).toBe(2)
    expect(defaultCellImageLevel({ numLevels: 2 })).toBe(1)
    expect(defaultCellImageLevel({ numLevels: 1 })).toBe(0)
  })
})
