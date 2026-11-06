import { describe, expect, it, vi } from 'vitest'
import type * as zarr from 'zarrita'
import { traceLabelEdges } from './spatialDataLabelTrace'
import {
  SpatialDataLabelsReader,
  type SpatialDataLabelLevel,
  type SpatialDataLabelTracer,
} from './spatialDataLabels'

// 12 x 2 label pixels in two 6-pixel chunks:
//   1 1 0 0 0 0 | 3 3 0 0 4 4
//   1 1 0 2 2 0 | 3 3 0 0 4 4
const CHUNKS = [
  Int32Array.from([1, 1, 0, 0, 0, 0, 1, 1, 0, 2, 2, 0]),
  Int32Array.from([3, 3, 0, 0, 4, 4, 3, 3, 0, 0, 4, 4]),
]

describe('SpatialDataLabelsReader', () => {
  it('joins only labels in view and reuses their rings', async () => {
    const tracer = vi.fn<SpatialDataLabelTracer>(async (request) =>
      traceLabelEdges(
        CHUNKS[request.coords[1] ?? 0] ?? new Int32Array(0),
        request.width,
        request.height,
        request.x0,
        request.y0,
        request.level.width,
      ),
    )
    const level: SpatialDataLabelLevel = {
      array: { shape: [2, 12] } as unknown as zarr.Array<zarr.DataType, zarr.Readable>,
      width: 12,
      height: 2,
      chunkWidth: 6,
      chunkHeight: 2,
      xAxis: 1,
      yAxis: 0,
      scaleX: 1,
      scaleY: 1,
    }
    const reader = new SpatialDataLabelsReader(
      [level],
      { a: 2, b: 0, c: 0, d: 0, e: 2, f: 0 },
      { tracer },
    )

    // Target x 0-7 covers label pixels 0-3.5 of the first chunk.
    const first = await reader.outlines(
      { minX: 0, maxX: 7, minY: 0, maxY: 4 },
      { maxPixels: 1_000 },
    )
    expect(first.map((outline) => outline.label).sort()).toEqual([1, 2])

    const again = await reader.outlines(
      { minX: 0, maxX: 7, minY: 0, maxY: 4 },
      { maxPixels: 1_000 },
    )
    expect(again.find((outline) => outline.label === 1)?.ring).toBe(
      first.find((outline) => outline.label === 1)?.ring,
    )

    const all = await reader.outlines(
      { minX: 0, maxX: 24, minY: 0, maxY: 4 },
      { maxPixels: 1_000, include: (label) => label !== 4 },
    )
    expect(all.map((outline) => outline.label).sort()).toEqual([1, 2, 3])
    // Each chunk is traced once.
    expect(tracer).toHaveBeenCalledTimes(2)
  })
})
