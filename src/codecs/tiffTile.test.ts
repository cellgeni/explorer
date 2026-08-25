import { getDecoder } from 'geotiff'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodeTiffTilePixels,
  TIFF_COMPRESSION_ADOBE_DEFLATE,
  TIFF_COMPRESSION_DEFLATE,
  TIFF_COMPRESSION_JPEG,
  TIFF_COMPRESSION_LZW,
  TIFF_COMPRESSION_NONE,
} from './tiffTile'

vi.mock('geotiff', () => ({
  getDecoder: vi.fn(),
}))

const mockedGetDecoder = vi.mocked(getDecoder)

describe('decodeTiffTilePixels', () => {
  beforeEach(() => {
    mockedGetDecoder.mockReset()
  })

  it('decodes LZW-compressed 8-bit grayscale tiles with GeoTIFF metadata', async () => {
    await expect(
      decodeTiffTilePixels(packTiffLzwCodes([256, 0, 10, 20, 30, 257]), {
        bitsPerSample: [8],
        compression: TIFF_COMPRESSION_LZW,
        littleEndian: true,
        planarConfiguration: 1,
        predictor: 1,
        samplesPerPixel: 1,
        tileHeight: 2,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      height: 2,
      pixels: new Uint8Array([0, 10, 20, 30]),
      width: 2,
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('decodes uncompressed 8-bit RGB tiles without changing interleaved sample order', async () => {
    await expect(
      decodeTiffTilePixels(
        new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
        {
          bitsPerSample: [8, 8, 8],
          compression: TIFF_COMPRESSION_NONE,
          littleEndian: true,
          planarConfiguration: 1,
          samplesPerPixel: 3,
          tileHeight: 2,
          tileWidth: 2,
        },
      ),
    ).resolves.toMatchObject({
      height: 2,
      pixels: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
      samplesPerPixel: 3,
      width: 2,
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('decodes LZW-compressed 8-bit RGB tiles with the fast path', async () => {
    await expect(
      decodeTiffTilePixels(
        packTiffLzwCodes([
          256, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 257,
        ]),
        {
          bitsPerSample: [8, 8, 8],
          compression: TIFF_COMPRESSION_LZW,
          littleEndian: true,
          planarConfiguration: 1,
          predictor: 1,
          samplesPerPixel: 3,
          tileHeight: 2,
          tileWidth: 2,
        },
      ),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
      samplesPerPixel: 3,
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('rejects planar multi-sample tiles before decoding', async () => {
    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_NONE,
        littleEndian: true,
        planarConfiguration: 2,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 1,
      }),
    ).rejects.toThrow(/Only interleaved tiles are supported/)

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('respects TIFF byte order for 16-bit grayscale tiles', async () => {
    await expect(
      decodeTiffTilePixels(packTiffLzwCodes([256, 1, 2, 3, 4, 257]), {
        bitsPerSample: [16],
        compression: TIFF_COMPRESSION_LZW,
        littleEndian: false,
        samplesPerPixel: 1,
        tileHeight: 1,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint16Array([0x0102, 0x0304]),
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('delegates LZW predictor decoding to GeoTIFF', async () => {
    const decode = vi.fn(async () => new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer)

    mockedGetDecoder.mockResolvedValue({ decode } as unknown as Awaited<
      ReturnType<typeof getDecoder>
    >)

    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [16],
        compression: TIFF_COMPRESSION_LZW,
        littleEndian: false,
        predictor: 2,
        samplesPerPixel: 1,
        tileHeight: 1,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint16Array([0x0102, 0x0304]),
    })

    expect(mockedGetDecoder).toHaveBeenCalledWith(TIFF_COMPRESSION_LZW, {
      bitsPerSample: [16],
      planarConfiguration: 1,
      predictor: 2,
      samplesPerPixel: 1,
      tileHeight: 1,
      tileWidth: 2,
    })
  })

  it('delegates DEFLATE-compressed RGB tiles to GeoTIFF', async () => {
    const decode = vi.fn(
      async () =>
        new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]).buffer,
    )

    mockedGetDecoder.mockResolvedValue({ decode } as unknown as Awaited<
      ReturnType<typeof getDecoder>
    >)

    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_DEFLATE,
        littleEndian: true,
        planarConfiguration: 1,
        predictor: 1,
        samplesPerPixel: 3,
        tileHeight: 2,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
      samplesPerPixel: 3,
    })

    expect(mockedGetDecoder).toHaveBeenCalledWith(TIFF_COMPRESSION_DEFLATE, {
      bitsPerSample: [8, 8, 8],
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 3,
      tileHeight: 2,
      tileWidth: 2,
    })
  })

  it('passes JPEG tables when delegating JPEG-compressed tiles', async () => {
    const decode = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const jpegTables = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

    mockedGetDecoder.mockResolvedValue({ decode } as unknown as Awaited<
      ReturnType<typeof getDecoder>
    >)

    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_JPEG,
        jpegTables,
        littleEndian: true,
        planarConfiguration: 1,
        predictor: 1,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 1,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([1, 2, 3]),
      samplesPerPixel: 3,
    })

    expect(mockedGetDecoder).toHaveBeenCalledWith(TIFF_COMPRESSION_JPEG, {
      JPEGTables: jpegTables,
      bitsPerSample: [8, 8, 8],
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 3,
      tileHeight: 1,
      tileWidth: 1,
    })
  })

  it('delegates Adobe DEFLATE-compressed tiles to GeoTIFF', async () => {
    const decode = vi.fn(async () => new Uint8Array([7, 8, 9]).buffer)

    mockedGetDecoder.mockResolvedValue({ decode } as unknown as Awaited<
      ReturnType<typeof getDecoder>
    >)

    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_ADOBE_DEFLATE,
        littleEndian: true,
        planarConfiguration: 1,
        predictor: 1,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 1,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([7, 8, 9]),
      samplesPerPixel: 3,
    })
  })
})

function packTiffLzwCodes(codes: readonly number[]): Uint8Array {
  const codeSize = 9
  const packed = new Uint8Array(Math.ceil((codes.length * codeSize) / 8))
  let bitOffset = 0

  for (const code of codes) {
    for (let bit = codeSize - 1; bit >= 0; bit -= 1) {
      if (((code >> bit) & 1) !== 0) {
        const byteIndex = bitOffset >> 3
        packed[byteIndex] = (packed[byteIndex] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }

      bitOffset += 1
    }
  }

  return packed
}
