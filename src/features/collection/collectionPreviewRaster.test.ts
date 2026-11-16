import { describe, expect, it } from 'vitest'
import { geneExpressionColor } from '../../rendering/deckLayerColors'
import { previewBounds, type PreviewCells } from './collectionPreviewData'
import { rasterizePreview, type PreviewRasterOptions } from './collectionPreviewRaster'

const OPTIONS: PreviewRasterOptions = {
  width: 10,
  height: 10,
  pointSize: 1,
  padding: 0,
  colorScale: 'plasma',
  scaleMin: 0,
  scaleMax: 4,
}

function cells(points: readonly (readonly [number, number])[]): PreviewCells {
  const positions = new Float32Array(points.flat())
  const bounds = previewBounds(positions)
  if (bounds === null) throw new Error('Expected cells.')
  return { positions, cellIds: points.map((_point, index) => `cell-${index}`), bounds }
}

function pixel(pixels: Uint8ClampedArray, x: number, y: number): number[] {
  const offset = (y * OPTIONS.width + x) * 4
  return [...pixels.slice(offset, offset + 4)]
}

describe('rasterizePreview', () => {
  // Corners of a 9 by 9 square, which fills the 10 px preview.
  const square = cells([
    [0, 0],
    [9, 0],
    [0, 9],
    [9, 9],
  ])

  it('draws every cell in grey, with y growing downwards', () => {
    const { pixels, scaleMax } = rasterizePreview(square, null, OPTIONS)

    expect(scaleMax).toBe(0)
    expect(pixel(pixels, 0, 0)).toEqual([92, 88, 76, 200])
    expect(pixel(pixels, 9, 9)).toEqual([92, 88, 76, 200])
    expect(pixel(pixels, 5, 5)).toEqual([0, 0, 0, 0])
  })

  it('colours scored cells on the shared scale, keeping the highest per pixel', () => {
    const { pixels, scaleMax } = rasterizePreview(
      square,
      {
        kind: 'scores',
        scores: {
          // Two cells on the top left pixel, and a zero score at the bottom right.
          positions: new Float32Array([0, 0, 0, 0, 9, 9]),
          scores: new Float32Array([1, 4, 0]),
          maxScore: 4,
        },
      },
      OPTIONS,
    )
    const full = geneExpressionColor('plasma', 1)

    expect(scaleMax).toBe(4)
    expect(pixel(pixels, 0, 0)).toEqual([full[0], full[1], full[2], 245])
    expect(pixel(pixels, 9, 9)).toEqual([92, 88, 76, 200])

    const { pixels: quarter } = rasterizePreview(
      square,
      {
        kind: 'scores',
        scores: {
          positions: new Float32Array([0, 0]),
          scores: new Float32Array([1]),
          maxScore: 1,
        },
      },
      OPTIONS,
    )
    const half = geneExpressionColor('plasma', 0.5)
    // sqrt(1 / 4): the same response as the main view.
    expect(pixel(quarter, 0, 0).slice(0, 3)).toEqual([half[0], half[1], half[2]])

    // A set range: 2 to 6, so 3 is a quarter of the way up and 7 is the top.
    const { pixels: ranged } = rasterizePreview(
      square,
      {
        kind: 'scores',
        scores: {
          positions: new Float32Array([0, 0, 9, 9]),
          scores: new Float32Array([3, 7]),
          maxScore: 7,
        },
      },
      { ...OPTIONS, scaleMin: 2, scaleMax: 6 },
    )
    expect(pixel(ranged, 0, 0).slice(0, 3)).toEqual([half[0], half[1], half[2]])
    expect(pixel(ranged, 9, 9).slice(0, 3)).toEqual([full[0], full[1], full[2]])
  })

  it('tops its own scale at a percentile of the drawn pixels, not of the cells', () => {
    // Each of the 100 pixels holds a cell scoring 1 to 100 and four scoring 1.
    const positions: number[] = []
    const scores: number[] = []
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        for (const score of [y * 10 + x + 1, 1, 1, 1, 1]) {
          positions.push(x, y)
          scores.push(score)
        }
      }
    }
    const raster = rasterizePreview(
      square,
      {
        kind: 'scores',
        scores: {
          positions: new Float32Array(positions),
          scores: new Float32Array(scores),
          maxScore: 100,
        },
      },
      { ...OPTIONS, scalePercentile: 95 },
    )
    const full = geneExpressionColor('plasma', 1)

    // The 95th of the pixels' 1 to 100; over the 500 cells it would be 75.
    expect(raster.scaleMax).toBe(95)
    expect(pixel(raster.pixels, 4, 9).slice(0, 3)).toEqual([full[0], full[1], full[2]])
    expect(pixel(raster.pixels, 3, 9).slice(0, 3)).not.toEqual([
      full[0],
      full[1],
      full[2],
    ])
  })

  it('colours the cells of shown classes, fading hidden ones and the rest', () => {
    const { pixels } = rasterizePreview(
      square,
      {
        kind: 'classes',
        // Top left and bottom right in a shown class, top right in a hidden
        // one, bottom left in none.
        classOf: new Int32Array([0, 1, -1, 0]),
        colors: ['#ff8000', null],
      },
      OPTIONS,
    )

    expect(pixel(pixels, 0, 0)).toEqual([255, 128, 0, 255])
    expect(pixel(pixels, 9, 9)).toEqual([255, 128, 0, 255])
    expect(pixel(pixels, 9, 0)).toEqual([92, 88, 76, 72])
    expect(pixel(pixels, 0, 9)).toEqual([92, 88, 76, 72])
  })

  it('keeps the aspect ratio and centres the cells', () => {
    const wide = cells([
      [0, 0],
      [9, 3],
    ])
    const { pixels } = rasterizePreview(wide, null, OPTIONS)
    const drawn = [...Array(10).keys()].flatMap((y) =>
      [...Array(10).keys()]
        .filter((x) => (pixel(pixels, x, y)[3] ?? 0) > 0)
        .map((x) => [x, y]),
    )

    expect(drawn).toEqual([
      [0, 3],
      [9, 6],
    ])
  })

  it('leaves a preview without room empty', () => {
    expect(rasterizePreview(square, null, { ...OPTIONS, width: 0 }).pixels).toHaveLength(
      0,
    )
  })
})
