import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  measureTileCells,
  type TileCellDiscs,
  type TileCellSums,
} from './tileCellMeasure'

interface Disc {
  readonly x: number
  readonly y: number
  readonly radius: number
}

function discs(cells: readonly Disc[], offsetX = 0, offsetY = 0): TileCellDiscs {
  return {
    x: Float32Array.from(cells, (cell) => cell.x - offsetX),
    y: Float32Array.from(cells, (cell) => cell.y - offsetY),
    radius: Float32Array.from(cells, (cell) => cell.radius),
  }
}

// Each pixel's owner found the slow way: the disc whose centre is nearest
// relative to its radius, the first listed on ties.
function bruteForce(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  cells: readonly Disc[],
  threshold: number,
): TileCellSums {
  const sum = new Float64Array(cells.length)
  const count = new Uint32Array(cells.length)
  const above = new Uint32Array(cells.length)
  const placed = discs(cells)

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let best = -1
      let bestRelative = Infinity
      cells.forEach((_, cell) => {
        const dx = px + 0.5 - (placed.x[cell] ?? 0)
        const dy = py + 0.5 - (placed.y[cell] ?? 0)
        const radius = placed.radius[cell] ?? 0
        const distanceSquared = dx * dx + dy * dy
        if (radius <= 0 || distanceSquared > radius * radius) return
        const relative = distanceSquared / (radius * radius)
        if (relative < bestRelative) {
          best = cell
          bestRelative = relative
        }
      })
      if (best < 0) continue
      const value = pixels[py * width + px] ?? 0
      sum[best] = (sum[best] ?? 0) + value
      count[best] = (count[best] ?? 0) + 1
      if (value >= threshold) above[best] = (above[best] ?? 0) + 1
    }
  }

  return { sum, count, above }
}

function plain(sums: TileCellSums) {
  return {
    sum: Array.from(sums.sum),
    count: Array.from(sums.count),
    above: Array.from(sums.above),
  }
}

// Centres and radii in eighths of a pixel, exact as Float32 after any whole
// pixel shift, so tiles and the whole image compare exactly.
function eighths(min: number, max: number): fc.Arbitrary<number> {
  return fc.integer({ min: min * 8, max: max * 8 }).map((value) => value / 8)
}

const image = fc
  .record({
    width: fc.integer({ min: 1, max: 24 }),
    height: fc.integer({ min: 1, max: 24 }),
  })
  .chain(({ width, height }) =>
    fc.record({
      width: fc.constant(width),
      height: fc.constant(height),
      pixels: fc
        .array(fc.integer({ min: 0, max: 65_535 }), {
          minLength: width * height,
          maxLength: width * height,
        })
        .map((values) => Uint16Array.from(values)),
      cells: fc.array(
        fc.record({
          x: eighths(-4, width + 4),
          y: eighths(-4, height + 4),
          radius: eighths(0, 8),
        }),
        { maxLength: 12 },
      ),
      threshold: fc.integer({ min: 0, max: 65_535 }),
    }),
  )

describe('measureTileCells', () => {
  it('sums the pixels whose centres are inside a disc', () => {
    // 4 x 3, values 0 to 11 row by row; a disc of radius 1.5 at (2, 1.5)
    // takes the pixels whose centres are within 1.5 of it.
    const pixels = Uint16Array.from({ length: 12 }, (_, index) => index)
    const sums = measureTileCells(pixels, 4, 3, discs([{ x: 2, y: 1.5, radius: 1.5 }]), {
      width: 4,
      height: 3,
      threshold: 6,
    })

    // The middle row's centres are 0.5 to 1.5 away, the edge counting. Rows
    // 0 and 2 are 1 away, so only their pixels 1 and 2 are inside.
    expect(plain(sums)).toEqual({
      sum: [1 + 2 + 4 + 5 + 6 + 7 + 9 + 10],
      count: [8],
      above: [4],
    })
  })

  it('gives a pixel inside two discs to the nearer centre, relative to the radius', () => {
    const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const sums = measureTileCells(
      pixels,
      8,
      1,
      discs([
        { x: 2, y: 0.5, radius: 3 },
        { x: 4, y: 0.5, radius: 1 },
      ]),
      { width: 8, height: 1, threshold: 4 },
    )

    // Pixel 3 (centre 3.5) is 1.5 / 3 = 0.5 radii from the first centre and
    // 0.5 / 1 from the second: a tie, which the first takes. Pixel 4 (4.5)
    // is 2.5 / 3 from the first and 0.5 / 1 from the second.
    expect(plain(sums)).toEqual({ sum: [1 + 2 + 3 + 4, 5], count: [4, 1], above: [1, 1] })
  })

  it('reads only the visible part of a padded tile', () => {
    // Decoded 4 wide, 3 visible; the padding holds 99.
    const pixels = Uint16Array.from([1, 1, 1, 99, 1, 1, 1, 99])
    const sums = measureTileCells(pixels, 4, 2, discs([{ x: 2, y: 1, radius: 10 }]), {
      width: 3,
      height: 2,
      threshold: 50,
    })

    expect(plain(sums)).toEqual({ sum: [6], count: [6], above: [0] })
  })

  it('counts a tile the file leaves out as zeros', () => {
    const sums = measureTileCells(null, 0, 0, discs([{ x: 2, y: 2, radius: 1 }]), {
      width: 4,
      height: 4,
      threshold: 0,
    })

    expect(plain(sums)).toEqual({ sum: [0], count: [4], above: [4] })
  })

  it('leaves out discs with no radius', () => {
    const sums = measureTileCells(
      new Uint8Array(4).fill(3),
      2,
      2,
      discs([
        { x: 1, y: 1, radius: 0 },
        { x: 1, y: 1, radius: Number.NaN },
      ]),
      { width: 2, height: 2, threshold: 0 },
    )

    expect(plain(sums)).toEqual({ sum: [0, 0], count: [0, 0], above: [0, 0] })
  })

  it('matches a brute-force reference', () => {
    fc.assert(
      fc.property(image, ({ width, height, pixels, cells, threshold }) => {
        const sums = measureTileCells(pixels, width, height, discs(cells), {
          width,
          height,
          threshold,
        })

        expect(plain(sums)).toEqual(
          plain(bruteForce(pixels, width, height, cells, threshold)),
        )
      }),
    )
  })

  it('counts a pixel for one cell at most, and no more above than in all', () => {
    fc.assert(
      fc.property(image, ({ width, height, pixels, cells, threshold }) => {
        const sums = measureTileCells(pixels, width, height, discs(cells), {
          width,
          height,
          threshold,
        })
        const counted = sums.count.reduce((total, count) => total + count, 0)

        expect(counted).toBeLessThanOrEqual(width * height)
        sums.count.forEach((count, cell) => {
          expect(sums.above[cell] ?? 0).toBeLessThanOrEqual(count)
        })
      }),
    )
  })

  it('sums discs cut into tiles as it sums them in one piece', () => {
    fc.assert(
      fc.property(
        image,
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 1, max: 9 }),
        ({ width, height, pixels, cells, threshold }, tileWidth, tileHeight) => {
          const whole = measureTileCells(pixels, width, height, discs(cells), {
            width,
            height,
            threshold,
          })
          const sum = new Float64Array(cells.length)
          const count = new Uint32Array(cells.length)
          const above = new Uint32Array(cells.length)

          for (let top = 0; top < height; top += tileHeight) {
            for (let left = 0; left < width; left += tileWidth) {
              // Each tile decoded at the full tile size, padded with 7s.
              const tile = new Uint16Array(tileWidth * tileHeight).fill(7)
              for (let y = 0; y < tileHeight && top + y < height; y += 1) {
                for (let x = 0; x < tileWidth && left + x < width; x += 1) {
                  tile[y * tileWidth + x] = pixels[(top + y) * width + left + x] ?? 0
                }
              }
              const part = measureTileCells(
                tile,
                tileWidth,
                tileHeight,
                discs(cells, left, top),
                {
                  width: Math.min(tileWidth, width - left),
                  height: Math.min(tileHeight, height - top),
                  threshold,
                },
              )
              part.sum.forEach((value, cell) => {
                sum[cell] = (sum[cell] ?? 0) + value
                count[cell] = (count[cell] ?? 0) + (part.count[cell] ?? 0)
                above[cell] = (above[cell] ?? 0) + (part.above[cell] ?? 0)
              })
            }
          }

          expect(plain({ sum, count, above })).toEqual(plain(whole))
        },
      ),
    )
  })
})
