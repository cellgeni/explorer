import { decodeTiffTilePixels, type TiffTileDecodeMetadata } from '../codecs/tiffTile'
import {
  sampleDecodedTile,
  type TileSamples,
  type TileSampling,
} from '../data/tileSamples'
import type { TileDecodeResponse, TileSamplesRequest } from './tileDecodeMessages'

export type TileSamplesResponder = (
  response: TileDecodeResponse,
  transfer: Transferable[],
) => void

// Decodes a TIFF tile and samples it for auto-contrast. A tile the file leaves
// out (zero bytes) has no pixels to sample.
export async function sampleTileBytes(
  bytes: Uint8Array,
  metadata: TiffTileDecodeMetadata,
  sampling: TileSampling,
): Promise<TileSamples> {
  if (bytes.byteLength === 0) {
    return sampleDecodedTile([], 0, 0, sampling)
  }

  const decoded = await decodeTiffTilePixels(bytes, metadata)
  return sampleDecodedTile(decoded.pixels, decoded.width, decoded.height, sampling)
}

export async function handleTileSamplesRequest(
  request: TileSamplesRequest,
  respond: TileSamplesResponder,
): Promise<void> {
  try {
    const tile = await sampleTileBytes(
      new Uint8Array(request.bytes),
      request,
      request.sampling,
    )
    respond(
      { id: request.id, ok: true, samples: tile.samples, pixelCount: tile.pixelCount },
      [tile.samples.buffer],
    )
  } catch (cause) {
    respond(
      {
        id: request.id,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      },
      [],
    )
  }
}
