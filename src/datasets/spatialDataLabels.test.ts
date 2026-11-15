import { describe, expect, it, vi } from 'vitest'
import type * as zarr from 'zarrita'
import { traceLabelEdges } from './spatialDataLabelTrace'
import {
  openOmeZarrLabels,
  SpatialDataLabelsReader,
  traceLabelChunkOnMainThread,
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

  it('opens the first series of a bioformats2raw label store', async () => {
    // A 5D (t, c, z, y, x) big-endian uint16 mask, 4 x 2 pixels:
    //   1 1 0 2
    //   1 1 0 2
    const root = '/SPCOX-A-label.zarr'
    const mask = new DataView(new ArrayBuffer(16))
    ;[1, 1, 0, 2, 1, 1, 0, 2].forEach((label, index) => {
      mask.setUint16(index * 2, label, false)
    })
    const files = new Map<string, Uint8Array>([
      [`${root}/.zgroup`, json({ zarr_format: 2 })],
      [`${root}/.zattrs`, json({ 'bioformats2raw.layout': 3 })],
      [`${root}/0/.zgroup`, json({ zarr_format: 2 })],
      [
        `${root}/0/.zattrs`,
        json({
          multiscales: [
            {
              axes: ['t', 'c', 'z', 'y', 'x'].map((name) => ({ name })),
              datasets: [
                {
                  path: '0',
                  coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1, 1, 1] }],
                },
              ],
            },
          ],
        }),
      ],
      [
        `${root}/0/0/.zarray`,
        json({
          zarr_format: 2,
          shape: [1, 1, 1, 2, 4],
          chunks: [1, 1, 1, 2, 4],
          dtype: '>u2',
          compressor: null,
          fill_value: 0,
          order: 'C',
          filters: null,
          dimension_separator: '/',
        }),
      ],
      [`${root}/0/0/0/0/0/0/0`, new Uint8Array(mask.buffer)],
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input)
        const bytes = files.get(new URL(url).pathname)
        return new Response(bytes === undefined ? null : bytes.slice().buffer, {
          status: bytes === undefined ? 403 : 200,
        })
      }),
    )

    try {
      const reader = await openOmeZarrLabels(`https://example.test${root}`, {
        tracer: traceLabelChunkOnMainThread,
      })

      expect(reader.levels.map(({ width, height }) => [width, height])).toEqual([[4, 2]])
      const outlines = await reader.outlines(
        { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        { maxPixels: 100 },
      )

      // Rings are in label pixels.
      expect(
        outlines
          .map(({ label, ring }) => {
            const xs = ring.filter((_value, index) => index % 2 === 0)
            const ys = ring.filter((_value, index) => index % 2 === 1)
            return [
              label,
              Math.min(...xs),
              Math.max(...xs),
              Math.min(...ys),
              Math.max(...ys),
            ]
          })
          .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)),
      ).toEqual([
        [1, 0, 2, 0, 2],
        [2, 3, 4, 0, 2],
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
