import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeTiffStripBand } from './tiffStrips'
import { TIFF_COMPRESSION_DEFLATE } from './tiffTile'

describe('decodeTiffStripBand', () => {
  it('joins the rows of strips stored back to back, leaving missing strips zero', async () => {
    const first = deflateSync(Uint8Array.from([1, 2, 3, 4, 5, 6]))
    const last = deflateSync(Uint8Array.from([7, 8, 9]))
    const band = await decodeTiffStripBand(Uint8Array.from([...first, ...last]), {
      compression: TIFF_COMPRESSION_DEFLATE,
      bitsPerSample: [8],
      samplesPerPixel: 1,
      width: 3,
      rowBytes: 3,
      // Two rows, a strip the file leaves out, and a short last strip.
      stripRows: [2, 2, 1],
      stripByteLengths: [first.byteLength, 0, last.byteLength],
    })

    expect(Array.from(band)).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 7, 8, 9])
  })

  it('rejects mismatched strip lists', async () => {
    await expect(
      decodeTiffStripBand(new Uint8Array(0), {
        compression: TIFF_COMPRESSION_DEFLATE,
        width: 1,
        rowBytes: 1,
        stripRows: [1],
        stripByteLengths: [],
      }),
    ).rejects.toThrow(/1 strip heights for 0 strips/)
  })
})
