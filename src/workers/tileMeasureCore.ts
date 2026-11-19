import { decodeTiffTilePixels, type TiffTileDecodeMetadata } from '../codecs/tiffTile'
import { measureTileCells, type TileCellSums } from '../data/tileCellMeasure'
import type {
  TileDecodeResponse,
  TileMeasure,
  TileMeasureRequest,
} from './tileDecodeMessages'

export type TileMeasureResponder = (
  response: TileDecodeResponse,
  transfer: Transferable[],
) => void

// Decodes a TIFF tile and sums its pixels per cell (plan 26-D4). A tile the
// file leaves out (zero bytes) is zeros.
export async function measureTileBytes(
  bytes: Uint8Array,
  metadata: TiffTileDecodeMetadata,
  measure: TileMeasure,
): Promise<TileCellSums> {
  if (bytes.byteLength === 0) {
    return measureTileCells(null, 0, 0, measure.cells, measure)
  }

  const decoded = await decodeTiffTilePixels(bytes, metadata)

  if ((decoded.samplesPerPixel ?? 1) > 1) {
    throw new Error('Only single-channel image tiles can be measured, not RGB.')
  }

  return measureTileCells(
    decoded.pixels,
    decoded.width,
    decoded.height,
    measure.cells,
    measure,
  )
}

export async function handleTileMeasureRequest(
  request: TileMeasureRequest,
  respond: TileMeasureResponder,
): Promise<void> {
  try {
    const sums = await measureTileBytes(
      new Uint8Array(request.bytes),
      request,
      request.measure,
    )
    respond({ id: request.id, ok: true, ...sums }, [
      sums.sum.buffer,
      sums.count.buffer,
      sums.above.buffer,
    ])
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
