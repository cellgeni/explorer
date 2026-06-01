/// <reference lib="webworker" />

import { decodeJpeg2000, normaliseToRgba } from '../codecs/jpeg2000'
import type { TileDecodeRequest, TileDecodeResponse } from './tileDecodeMessages'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<TileDecodeRequest>) => {
  void decodeTile(event.data)
}

async function decodeTile(request: TileDecodeRequest): Promise<void> {
  try {
    const decoded = await decodeJpeg2000(new Uint8Array(request.bytes))
    const rgba = normaliseToRgba(
      decoded.pixels,
      decoded.width,
      decoded.height,
      request.displayWindow,
    )
    const imageDataArray: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(
      rgba.rgba,
    )
    const bitmap = await createImageBitmap(
      new ImageData(imageDataArray, decoded.width, decoded.height),
    )
    const response: TileDecodeResponse = {
      id: request.id,
      ok: true,
      bitmap,
      width: decoded.width,
      height: decoded.height,
      lo: rgba.lo,
      hi: rgba.hi,
    }

    workerScope.postMessage(response, [bitmap])
  } catch (cause) {
    const response: TileDecodeResponse = {
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    }

    workerScope.postMessage(response)
  }
}
