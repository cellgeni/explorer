import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeJpeg2000 } from './jpeg2000'

// Decodes with the real OpenJPEG WASM build (jpeg2000.test.ts mocks it).
// src/test/fixtures/jpeg2000 (see make_fixtures.py there): lossless J2K
// codestreams written by imagecodecs, with their source pixels.
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/jpeg2000', name)),
  )
}

describe('decodeJpeg2000 with the OpenJPEG WASM build', () => {
  it('decodes a 16-bit grayscale codestream losslessly', async () => {
    const decoded = await decodeJpeg2000(fixture('gradient_16bit.j2k'))

    expect(decoded).toMatchObject({ width: 45, height: 37, samplesPerPixel: 1 })
    expect(decoded.pixels).toBeInstanceOf(Uint16Array)
    expect(decoded.pixels).toEqual(
      new Uint16Array(fixture('gradient_16bit.u16').slice().buffer),
    )
  })

  it('decodes an 8-bit RGB codestream with interleaved samples', async () => {
    const decoded = await decodeJpeg2000(fixture('gradient_rgb.j2k'))

    expect(decoded).toMatchObject({ width: 45, height: 37, samplesPerPixel: 3 })
    expect(decoded.pixels).toBeInstanceOf(Uint8Array)
    expect(decoded.pixels).toEqual(fixture('gradient_rgb.u8'))
  })
})
