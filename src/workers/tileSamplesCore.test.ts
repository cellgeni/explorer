import { describe, expect, it, vi } from 'vitest'
import type { TileDecodeResponse } from './tileDecodeMessages'
import { handleTileSamplesRequest, sampleTileBytes } from './tileSamplesCore'

// An uncompressed 8-bit 4 x 2 tile whose visible area is 3 x 2.
const TILE = {
  compression: 1,
  bitsPerSample: [8],
  samplesPerPixel: 1,
  tileWidth: 4,
  tileHeight: 2,
} as const
const TILE_BYTES = Uint8Array.from([10, 20, 30, 250, 40, 50, 60, 250])

describe('tile samples worker core', () => {
  it('decodes a tile, samples it, and transfers the samples', async () => {
    const respond =
      vi.fn<(response: TileDecodeResponse, transfer: Transferable[]) => void>()

    await handleTileSamplesRequest(
      {
        id: 4,
        bytes: TILE_BYTES.slice().buffer,
        ...TILE,
        sampling: { startIndex: 1, stride: 2, width: 3, height: 2 },
      },
      respond,
    )

    const [response, transfer] = respond.mock.calls[0] ?? []
    expect(response).toMatchObject({ id: 4, ok: true, pixelCount: 6 })
    expect(
      response !== undefined && 'samples' in response ? Array.from(response.samples) : [],
    ).toEqual([20, 40, 60])
    expect(transfer).toHaveLength(1)
  })

  it('samples nothing from a tile the file leaves out', async () => {
    const tile = await sampleTileBytes(new Uint8Array(0), TILE, {
      startIndex: 0,
      stride: 1,
      width: 3,
      height: 2,
    })

    expect(tile.samples).toHaveLength(0)
    expect(tile.pixelCount).toBe(0)
  })

  it('reports a tile that does not decode', async () => {
    const respond =
      vi.fn<(response: TileDecodeResponse, transfer: Transferable[]) => void>()

    await handleTileSamplesRequest(
      {
        id: 9,
        bytes: TILE_BYTES.slice().buffer,
        ...TILE,
        samplesPerPixel: 2,
        sampling: { startIndex: 0, stride: 1, width: 3, height: 2 },
      },
      respond,
    )

    expect(respond).toHaveBeenCalledWith(
      {
        id: 9,
        ok: false,
        error: expect.stringContaining('Unsupported TIFF tile sample count 2') as string,
      },
      [],
    )
  })
})
