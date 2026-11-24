import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeTiffTilePixels } from './tiffTile'

// geotiff, unmocked: Deflate tiles of 16-bit samples, with and without
// horizontal differencing, in either byte order. geotiff undid the predictor
// on little-endian samples only, so a big-endian row came back garbled
// (EXP-332).
const ROW = [255, 256, 511, 512, 1000, 40000, 65535, 3]

function stored(littleEndian: boolean, predictor: 1 | 2): Uint8Array {
  const view = new DataView(new ArrayBuffer(ROW.length * 2))
  ROW.forEach((value, index) => {
    const sample =
      predictor === 2 && index > 0 ? (value - (ROW[index - 1] ?? 0)) & 0xffff : value
    view.setUint16(index * 2, sample, littleEndian)
  })
  return new Uint8Array(deflateSync(new Uint8Array(view.buffer)))
}

describe.each([
  ['little-endian', true],
  ['big-endian', false],
] as const)('16-bit Deflate tiles, %s', (_name, littleEndian) => {
  it.each([1, 2] as const)('read back with predictor %i', async (predictor) => {
    const decoded = await decodeTiffTilePixels(stored(littleEndian, predictor), {
      compression: 8,
      predictor,
      littleEndian,
      bitsPerSample: [16],
      samplesPerPixel: 1,
      planarConfiguration: 1,
      tileWidth: ROW.length,
      tileHeight: 1,
    })

    expect(Array.from(decoded.pixels)).toEqual(ROW)
  })
})
