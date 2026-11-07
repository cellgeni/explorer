import * as zarr from 'zarrita'
import { isSupportedPixelArray, newPixelArray } from '../zarr/omeZarrPixels'
import type { ZarrChunkSource, ZarrChunkWindow } from './zarrDecodeMessages'

// Chunk decoding used by the Zarr decode worker: rebuilds the array from its
// stored metadata around a single chunk and copies 2D windows out of it.

const encoder = new TextEncoder()

export async function decodeChunk(
  source: ZarrChunkSource,
  bytes: ArrayBuffer | null,
): Promise<zarr.Chunk<zarr.DataType>> {
  const store = new Map<string, Uint8Array>([
    [`/${source.metadataKey}`, encoder.encode(JSON.stringify(source.metadata))],
  ])

  if (bytes !== null) {
    store.set(`/${source.chunkKey}`, new Uint8Array(bytes))
  }

  const location = zarr.root(store)
  const array =
    source.metadataKey === 'zarr.json'
      ? await zarr.open.v3(location, { kind: 'array' })
      : await zarr.open.v2(location, { kind: 'array' })

  return array.getChunk([...source.coords])
}

export function chunkWindow(chunk: zarr.Chunk<zarr.DataType>, window: ZarrChunkWindow) {
  const data = chunk.data

  if (!isSupportedPixelArray(data)) {
    throw new Error('Unsupported OME-Zarr image dtype for tile rendering.')
  }

  let offset = 0

  for (const fixed of window.fixedAxes) {
    offset += fixed.index * (chunk.stride[fixed.axis] ?? 0)
  }

  const xStride = chunk.stride[window.xAxis] ?? 1
  const yStride = chunk.stride[window.yAxis] ?? 1
  const pixels = newPixelArray(data, window.width * window.height)

  for (let y = 0; y < window.height; y += 1) {
    const sourceRow = offset + (window.y0 + y) * yStride + window.x0 * xStride
    const targetRow = y * window.width

    for (let x = 0; x < window.width; x += 1) {
      pixels[targetRow + x] = data[sourceRow + x * xStride] ?? 0
    }
  }

  return pixels
}
