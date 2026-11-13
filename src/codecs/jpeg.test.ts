import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  convertYCbCrToRgb,
  decodeJpegTileBitmap,
  jpegTileColorSpace,
  standaloneJpegTile,
} from './jpeg'
import { decodeTiffTilePixels } from './tiffTile'
import {
  APERIO_RGB_JPEG_TABLES,
  APERIO_RGB_JPEG_TILE,
  JFIF_YCBCR_TILE,
  JPEG_FIXTURE_COLOR,
} from '../test/jpegFixtures'

const aperioTile = {
  bytes: APERIO_RGB_JPEG_TILE,
  tables: APERIO_RGB_JPEG_TABLES,
  photometric: 2,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('jpegTileColorSpace', () => {
  it('reads Aperio tiles as RGB from the Photometric tag', () => {
    expect(jpegTileColorSpace(aperioTile)).toBe('rgb')
    // Without the tag, component IDs 0, 1, 2 read as YCbCr, as libjpeg does.
    expect(
      jpegTileColorSpace({ bytes: APERIO_RGB_JPEG_TILE, tables: APERIO_RGB_JPEG_TABLES }),
    ).toBe('ycbcr')
  })

  it('reads YCbCr from the Photometric tag or a JFIF marker', () => {
    expect(jpegTileColorSpace({ ...aperioTile, photometric: 6 })).toBe('ycbcr')
    expect(jpegTileColorSpace({ bytes: JFIF_YCBCR_TILE, photometric: 2 })).toBe('ycbcr')
  })

  it('follows an Adobe marker over the Photometric tag', () => {
    const marked = standaloneJpegTile(aperioTile)

    expect(marked).toBeDefined()
    expect(jpegTileColorSpace({ bytes: marked as Uint8Array, photometric: 6 })).toBe(
      'rgb',
    )
  })

  it('has no colour space for a greyscale stream', () => {
    const greyscale = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 16, 0, 16, 1, 1, 0x11, 0, 0xff, 0xda,
    ])

    expect(jpegTileColorSpace({ bytes: greyscale, photometric: 1 })).toBeUndefined()
    expect(standaloneJpegTile({ bytes: greyscale })).toBeUndefined()
  })
})

describe('standaloneJpegTile', () => {
  it('merges JPEGTables into the tile and marks Aperio RGB with an Adobe marker', () => {
    const stream = standaloneJpegTile(aperioTile) as Uint8Array
    const adobeRgb = [
      0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0, 0, 0, 0, 0,
    ]

    expect([...stream.subarray(0, 2)]).toEqual([0xff, 0xd8])
    expect([...stream.subarray(2, 18)]).toEqual(adobeRgb)
    // The tables lose SOI and EOI and the tile its SOI.
    expect(stream.length).toBe(
      2 +
        adobeRgb.length +
        APERIO_RGB_JPEG_TABLES.length -
        4 +
        APERIO_RGB_JPEG_TILE.length -
        2,
    )
    expect(markerCount(stream, 0xd8)).toBe(1)
    expect(markerCount(stream, 0xd9)).toBe(1)
  })

  it('leaves a JFIF tile unchanged', () => {
    expect(standaloneJpegTile({ bytes: JFIF_YCBCR_TILE, photometric: 6 })).toEqual(
      JFIF_YCBCR_TILE,
    )
  })
})

describe('convertYCbCrToRgb', () => {
  it('converts JFIF YCbCr samples in place', () => {
    const samples = Uint8Array.from([128, 128, 128, 76, 85, 255, 255, 128, 128])

    convertYCbCrToRgb(samples)

    expect([...samples.subarray(0, 3)]).toEqual([128, 128, 128])
    expect(samples[0 + 3]).toBeGreaterThan(250)
    expect(samples[1 + 3]).toBeLessThan(3)
    expect(samples[2 + 3]).toBeLessThan(3)
    expect([...samples.subarray(6, 9)]).toEqual([255, 255, 255])
  })
})

describe('decodeTiffTilePixels with JPEG tiles', () => {
  const metadata = {
    compression: 7,
    tileWidth: 16,
    tileHeight: 16,
    bitsPerSample: [8, 8, 8],
    samplesPerPixel: 3,
  }

  it('decodes Aperio RGB tiles with their JPEGTables as stored', async () => {
    const decoded = await decodeTiffTilePixels(APERIO_RGB_JPEG_TILE, {
      ...metadata,
      jpegTables: APERIO_RGB_JPEG_TABLES,
      photometric: 2,
    })

    expectPixelNear(decoded.pixels, JPEG_FIXTURE_COLOR)
  })

  it('converts YCbCr tiles to RGB', async () => {
    const decoded = await decodeTiffTilePixels(JFIF_YCBCR_TILE, {
      ...metadata,
      photometric: 6,
    })

    expectPixelNear(decoded.pixels, JPEG_FIXTURE_COLOR)
  })
})

describe('decodeJpegTileBitmap', () => {
  it('hands the standalone stream to the browser decoder', async () => {
    const bitmap = { width: 16, height: 16 } as ImageBitmap
    const decode = vi.fn<
      (blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>
    >(async () => bitmap)
    vi.stubGlobal('createImageBitmap', decode)

    await expect(decodeJpegTileBitmap(aperioTile)).resolves.toBe(bitmap)

    const [blob, options] = decode.mock.calls[0] ?? []
    expect(blob?.type).toBe('image/jpeg')
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(
      standaloneJpegTile(aperioTile),
    )
    expect(options).toEqual({ colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  })

  it('returns nothing when the browser cannot decode the tile', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('The source image could not be decoded.')
      }),
    )

    await expect(decodeJpegTileBitmap(aperioTile)).resolves.toBeUndefined()
  })
})

function markerCount(bytes: Uint8Array, marker: number): number {
  let count = 0

  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === marker) {
      count += 1
    }
  }

  return count
}

function expectPixelNear(
  pixels: ArrayLike<number>,
  expected: readonly [number, number, number],
): void {
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs((pixels[channel] ?? 0) - expected[channel]!)).toBeLessThanOrEqual(3)
  }
}
