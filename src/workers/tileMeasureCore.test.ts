import { describe, expect, it, vi } from 'vitest'
import type { TileDecodeResponse } from './tileDecodeMessages'
import { handleTileMeasureRequest, measureTileBytes } from './tileMeasureCore'

// An uncompressed 8-bit 4 x 2 tile whose visible area is 3 x 2.
const TILE = {
  compression: 1,
  bitsPerSample: [8],
  samplesPerPixel: 1,
  tileWidth: 4,
  tileHeight: 2,
} as const
const TILE_BYTES = Uint8Array.from([10, 20, 30, 250, 40, 50, 60, 250])

function cells(x: number, y: number, radius: number) {
  return {
    x: Float32Array.from([x]),
    y: Float32Array.from([y]),
    radius: Float32Array.from([radius]),
  }
}

describe('tile measure worker core', () => {
  it('decodes a tile, sums it per cell, and transfers the sums', async () => {
    const respond =
      vi.fn<(response: TileDecodeResponse, transfer: Transferable[]) => void>()

    await handleTileMeasureRequest(
      {
        id: 7,
        bytes: TILE_BYTES.slice().buffer,
        ...TILE,
        measure: { cells: cells(1.5, 1, 5), width: 3, height: 2, threshold: 40 },
      },
      respond,
    )

    const [response, transfer] = respond.mock.calls[0] ?? []
    expect(response).toEqual({
      id: 7,
      ok: true,
      sum: Float64Array.from([210]),
      count: Uint32Array.from([6]),
      above: Uint32Array.from([3]),
    })
    expect(transfer).toHaveLength(3)
  })

  it('measures a tile the file leaves out as zeros', async () => {
    const sums = await measureTileBytes(new Uint8Array(0), TILE, {
      cells: cells(1, 1, 1),
      width: 3,
      height: 2,
      threshold: 1,
    })

    expect(Array.from(sums.count)).toEqual([4])
    expect(Array.from(sums.sum)).toEqual([0])
    expect(Array.from(sums.above)).toEqual([0])
  })

  it('refuses RGB tiles', async () => {
    const respond =
      vi.fn<(response: TileDecodeResponse, transfer: Transferable[]) => void>()

    await handleTileMeasureRequest(
      {
        id: 8,
        bytes: new Uint8Array(4 * 2 * 3).buffer,
        ...TILE,
        bitsPerSample: [8, 8, 8],
        samplesPerPixel: 3,
        measure: { cells: cells(1, 1, 1), width: 3, height: 2, threshold: 1 },
      },
      respond,
    )

    expect(respond.mock.calls[0]?.[0]).toMatchObject({
      id: 8,
      ok: false,
      error: 'Only single-channel image tiles can be measured, not RGB.',
    })
  })
})
