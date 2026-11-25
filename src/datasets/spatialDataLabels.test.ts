import { describe, expect, it, vi } from 'vitest'
import * as zarr from 'zarrita'
import type { ZarrDecodePool } from '../workers/zarrDecodePool'
import { traceLabelEdges } from './spatialDataLabelTrace'
import {
  createWorkerLabelTracer,
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

  it('reads a tile again when the view whose read it joined is cancelled', async () => {
    // Each read waits until released, and fails if its own signal is aborted.
    const pending: (() => void)[] = []
    const tracer = vi.fn<SpatialDataLabelTracer>(
      (request) =>
        new Promise((resolve, reject) => {
          request.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
          pending.push(() =>
            resolve(
              traceLabelEdges(
                CHUNKS[request.coords[1] ?? 0] ?? new Int32Array(0),
                request.width,
                request.height,
                request.x0,
                request.y0,
                request.level.width,
              ),
            ),
          )
        }),
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
      { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
      { tracer },
    )
    const bounds = { minX: 0, maxX: 5, minY: 0, maxY: 2 }
    const earlier = new AbortController()
    const first = reader.outlines(bounds, { maxPixels: 1_000, signal: earlier.signal })
    const second = reader.outlines(bounds, {
      maxPixels: 1_000,
      signal: new AbortController().signal,
    })

    // The second view joined the first one's read; the first view is cancelled.
    earlier.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(tracer).toHaveBeenCalledTimes(2))
    pending.at(-1)?.()

    const outlines = await second
    expect(outlines.map((outline) => outline.label).sort()).toEqual([1, 2])
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

describe('labels at a plane (plan 28-D9)', () => {
  // A t, z, y, x mask of 3 time points and 2 z planes, 2 x 4 pixels each, in
  // chunks of 2 time points: each plane's left 2 x 2 pixels hold the label
  // 10t + z + 1.
  const root = '/planes-labels.zarr'
  const sizeT = 3
  const sizeZ = 2
  const plane = (t: number, z: number) =>
    [0, 1].flatMap(() => [0, 1, 2, 3].map((x) => (x < 2 ? 10 * t + z + 1 : 0)))
  const chunkBytes = (chunkT: number) => {
    const values: number[] = []
    for (let t = chunkT * 2; t < chunkT * 2 + 2; t += 1) {
      for (let z = 0; z < sizeZ; z += 1) {
        values.push(...(t < sizeT ? plane(t, z) : plane(0, 0).map(() => 0)))
      }
    }
    return new Uint8Array(Int32Array.from(values).buffer)
  }
  const files = new Map<string, Uint8Array>([
    [`${root}/.zgroup`, json({ zarr_format: 2 })],
    [
      `${root}/.zattrs`,
      json({
        multiscales: [
          {
            axes: [
              { name: 't', type: 'time' },
              { name: 'z', type: 'space' },
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [{ path: '0' }],
          },
        ],
      }),
    ],
    [
      `${root}/0/.zarray`,
      json({
        zarr_format: 2,
        shape: [sizeT, sizeZ, 2, 4],
        chunks: [2, sizeZ, 2, 4],
        dtype: '<i4',
        compressor: null,
        fill_value: 0,
        order: 'C',
        filters: null,
        dimension_separator: '/',
      }),
    ],
    [`${root}/0/0/0/0/0`, chunkBytes(0)],
    [`${root}/0/1/0/0/0`, chunkBytes(1)],
  ])
  const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 2 }

  async function openReader() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input)
        const bytes = files.get(new URL(url).pathname)
        return new Response(bytes === undefined ? null : bytes.slice().buffer, {
          status: bytes === undefined ? 404 : 200,
        })
      }),
    )
    return openOmeZarrLabels(`https://example.test${root}`, {
      tracer: traceLabelChunkOnMainThread,
    })
  }

  it("reads the image's time point and z plane", async () => {
    try {
      const reader = await openReader()
      const labelsAt = async (at?: { readonly t?: number; readonly z?: number }) =>
        (
          await reader.outlines(bounds, {
            maxPixels: 100,
            ...(at === undefined ? {} : { plane: at }),
          })
        ).map((outline) => outline.label)

      expect(reader.followsPlanes).toBe(true)
      expect(await labelsAt()).toEqual([1])
      expect(await labelsAt({ t: 1, z: 1 })).toEqual([12])
      // The second chunk along t.
      expect(await labelsAt({ t: 2, z: 0 })).toEqual([21])
      // Past the labels' time points: the last, and a notice.
      expect(await labelsAt({ t: 5 })).toEqual([21])
      expect(reader.planeNotice({ t: 5 })).toBe(
        'The labels have 3 time points; later ones show the last.',
      )
      expect(reader.planeNotice({ t: 2, z: 1 })).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps each plane its own traces and rings', async () => {
    try {
      const reader = await openReader()
      const ringAt = async (t: number) =>
        (await reader.outlines(bounds, { maxPixels: 100, plane: { t, z: 0 } }))[0]?.ring

      const first = await ringAt(0)
      const second = await ringAt(1)

      expect(second).not.toBe(first)
      expect(await ringAt(0)).toBe(first)
      expect(await ringAt(1)).toBe(second)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a chunk that holds several planes once for all of them', async () => {
    const zarray = {
      zarr_format: 2,
      shape: [4, 2, 4],
      chunks: [4, 2, 4],
      dtype: '<i4',
      compressor: null,
      fill_value: 0,
      order: 'C',
      filters: null,
      dimension_separator: '/',
    }
    const files = new Map<string, Uint8Array>([
      ['/mask/.zarray', json(zarray)],
      ['/mask/0/0/0', new Uint8Array(new Int32Array(32).fill(1).buffer)],
    ])
    const get = vi.fn((key: string) => Promise.resolve(files.get(key)))
    const array = await zarr.open.v2(zarr.root({ get }).resolve('/mask'), {
      kind: 'array',
    })
    const traceLabels = vi.fn(async () =>
      traceLabelEdges(new Int32Array(8).fill(1), 4, 2, 0, 0, 4),
    )
    const tracer = createWorkerLabelTracer({ traceLabels } as unknown as ZarrDecodePool)
    const level: SpatialDataLabelLevel = {
      array,
      width: 4,
      height: 2,
      chunkWidth: 4,
      chunkHeight: 2,
      xAxis: 2,
      yAxis: 1,
      tAxis: 0,
      scaleX: 1,
      scaleY: 1,
    }
    const request = (t: number) => ({
      level,
      col: 0,
      row: 0,
      x0: 0,
      y0: 0,
      width: 4,
      height: 2,
      coords: [0, 0, 0],
      fixedAxes: [{ axis: 0, index: t }],
    })

    await tracer(request(0))
    await tracer(request(3))

    expect(get.mock.calls.filter(([key]) => key === '/mask/0/0/0')).toHaveLength(1)
    expect(traceLabels).toHaveBeenCalledTimes(2)
    expect(
      (traceLabels.mock.calls[1] as unknown as [{ window: { fixedAxes: unknown } }])[0]
        .window.fixedAxes,
    ).toEqual([{ axis: 0, index: 3 }])
  })

  it('reads 2D labels the same at every plane', async () => {
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
    const reader = new SpatialDataLabelsReader(
      [
        {
          array: { shape: [2, 12], chunks: [2, 6] } as unknown as zarr.Array<
            zarr.DataType,
            zarr.Readable
          >,
          width: 12,
          height: 2,
          chunkWidth: 6,
          chunkHeight: 2,
          xAxis: 1,
          yAxis: 0,
          scaleX: 1,
          scaleY: 1,
        },
      ],
      { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
      { tracer },
    )
    const view = { minX: 0, maxX: 5, minY: 0, maxY: 2 }

    expect(reader.followsPlanes).toBe(false)
    await reader.outlines(view, { maxPixels: 100, plane: { t: 0 } })
    await reader.outlines(view, { maxPixels: 100, plane: { t: 3, z: 2 } })
    expect(tracer).toHaveBeenCalledTimes(1)
  })
})

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
