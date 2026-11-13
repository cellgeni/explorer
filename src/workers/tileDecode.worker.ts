/// <reference lib="webworker" />

import { decodeJpegTileBitmap } from '../codecs/jpeg'
import { normaliseToRgba } from '../codecs/jpeg2000'
import { decodeTiffTilePixels, TIFF_COMPRESSION_JPEG } from '../codecs/tiffTile'
import type {
  TileDecodeRequest,
  TileDecodeResponse,
  WorkerDecodedTile,
} from './tileDecodeMessages'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<TileDecodeRequest>) => {
  void decodeTile(event.data)
}

async function decodeTile(request: TileDecodeRequest): Promise<void> {
  try {
    const bytes = new Uint8Array(request.bytes)
    const tile =
      bytes.byteLength === 0
        ? await emptyTile(request)
        : ((await browserDecodedJpegTile(bytes, request)) ??
          (await decodedTile(bytes, request)))
    const response: TileDecodeResponse = { id: request.id, ok: true, ...tile }

    workerScope.postMessage(response, [tile.bitmap])
  } catch (cause) {
    const response: TileDecodeResponse = {
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }

    workerScope.postMessage(response)
  }
}

async function decodedTile(
  bytes: Uint8Array,
  request: TileDecodeRequest,
): Promise<WorkerDecodedTile> {
  const decoded = await decodeTiffTilePixels(bytes, request)
  const rgba = normaliseToRgba(
    decoded.pixels,
    decoded.width,
    decoded.height,
    request.displayWindow,
    {
      ...(request.color === undefined ? {} : { color: request.color }),
      ...(request.alphaFromIntensity === undefined
        ? {}
        : { alphaFromIntensity: request.alphaFromIntensity }),
      ...(decoded.samplesPerPixel === undefined
        ? {}
        : { samplesPerPixel: decoded.samplesPerPixel }),
    },
  )
  const imageDataArray: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(rgba.rgba)
  const bitmap = await createImageBitmap(
    new ImageData(imageDataArray, decoded.width, decoded.height),
  )

  return {
    bitmap,
    width: decoded.width,
    height: decoded.height,
    lo: rgba.lo,
    hi: rgba.hi,
  }
}

// 8-bit RGB JPEG tiles (H&E slides) are drawn as stored, so the browser's
// decoder makes the bitmap directly. Undefined for other tiles, or when the
// browser cannot decode this one.
async function browserDecodedJpegTile(
  bytes: Uint8Array,
  request: TileDecodeRequest,
): Promise<WorkerDecodedTile | undefined> {
  const bitsPerSample = request.bitsPerSample ?? [8, 8, 8]

  if (
    request.compression !== TIFF_COMPRESSION_JPEG ||
    (request.samplesPerPixel ?? bitsPerSample.length) !== 3 ||
    (request.planarConfiguration ?? 1) !== 1 ||
    !bitsPerSample.every((bits) => bits === 8)
  ) {
    return undefined
  }

  const bitmap = await decodeJpegTileBitmap({
    bytes,
    ...(request.jpegTables === undefined ? {} : { tables: request.jpegTables }),
    ...(request.photometric === undefined ? {} : { photometric: request.photometric }),
  })

  return bitmap === undefined
    ? undefined
    : { bitmap, width: bitmap.width, height: bitmap.height, lo: 0, hi: 255 }
}

// A tile the file leaves out (zero bytes) is drawn transparent.
async function emptyTile(request: TileDecodeRequest): Promise<WorkerDecodedTile> {
  const width = Math.max(1, request.tileWidth ?? 1)
  const height = Math.max(1, request.tileHeight ?? 1)
  const maxSample = (request.bitsPerSample?.[0] ?? 8) <= 8 ? 255 : 65_535
  const bitmap = await createImageBitmap(new ImageData(width, height))

  return {
    bitmap,
    width,
    height,
    lo: request.displayWindow?.lo ?? 0,
    hi: request.displayWindow?.hi ?? maxSample,
  }
}
