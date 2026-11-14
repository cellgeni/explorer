import { getDecoder } from 'geotiff'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJpeg2000 } from './jpeg2000'
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

vi.mock('./jpeg2000', () => ({
  decodeJpeg2000: vi.fn(),
}))

const mockedGetDecoder = vi.mocked(getDecoder)
const mockedDecodeJpeg2000 = vi.mocked(decodeJpeg2000)

describe('decodeTiffTilePixels', () => {
  beforeEach(() => {
    mockedGetDecoder.mockReset()
    mockedDecodeJpeg2000.mockReset()
    mockedDecodeJpeg2000.mockResolvedValue({
      height: 1,
      pixels: new Uint8Array([42]),
      samplesPerPixel: 1,
      width: 1,
    })
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
        packTiffLzwCodes([256, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 257]),
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

  it('decodes uncompressed planar 8-bit RGB tiles by interleaving sample planes', async () => {
    await expect(
      decodeTiffTilePixels(new Uint8Array([10, 20, 30, 40, 50, 60]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_NONE,
        littleEndian: true,
        planarConfiguration: 2,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      height: 1,
      pixels: new Uint8Array([10, 30, 50, 20, 40, 60]),
      samplesPerPixel: 3,
      width: 2,
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('decodes compressed planar RGB sample chunks and interleaves planes', async () => {
    const decode = vi.fn(async (buffer: ArrayBufferLike) => {
      const source = new Uint8Array(buffer)
      const first = source[0] ?? 0

      return new Uint8Array([first, first + 1]).buffer
    })

    mockedGetDecoder.mockResolvedValue({ decode } as unknown as Awaited<
      ReturnType<typeof getDecoder>
    >)

    await expect(
      decodeTiffTilePixels(new Uint8Array([10, 20, 30]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_DEFLATE,
        littleEndian: true,
        planarConfiguration: 2,
        planarSampleByteLengths: [1, 1, 1],
        predictor: 1,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 2,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 11, 21, 31]),
      samplesPerPixel: 3,
    })

    expect(mockedGetDecoder).toHaveBeenCalledTimes(3)
    expect(mockedGetDecoder).toHaveBeenCalledWith(TIFF_COMPRESSION_DEFLATE, {
      bitsPerSample: [8],
      planarConfiguration: 1,
      predictor: 1,
      samplesPerPixel: 1,
      tileHeight: 1,
      tileWidth: 2,
    })
  })

  it('requires sample byte lengths for compressed planar multi-sample tiles', async () => {
    await expect(
      decodeTiffTilePixels(new Uint8Array([1, 2, 3]), {
        bitsPerSample: [8, 8, 8],
        compression: TIFF_COMPRESSION_DEFLATE,
        littleEndian: true,
        planarConfiguration: 2,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 1,
      }),
    ).rejects.toThrow(/planar sample byte lengths/)

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('keeps missing compression metadata on the JPEG-2000 path', async () => {
    const bytes = new Uint8Array([1, 2, 3])

    await expect(
      decodeTiffTilePixels(bytes, {
        bitsPerSample: [8, 8, 8],
        planarConfiguration: 2,
        samplesPerPixel: 3,
        tileHeight: 1,
        tileWidth: 1,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([42]),
      samplesPerPixel: 1,
    })

    expect(mockedDecodeJpeg2000).toHaveBeenCalledWith(bytes)
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

  it('undoes horizontal differencing of LZW tiles in their byte order', async () => {
    await expect(
      decodeTiffTilePixels(packTiffLzwCodes([256, 0x01, 0x02, 0x02, 0x02, 257]), {
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

    // Each row starts again; RGB samples add the same sample of the pixel
    // to their left.
    await expect(
      decodeTiffTilePixels(
        packTiffLzwCodes([256, 10, 20, 30, 5, 5, 5, 1, 2, 3, 1, 1, 1, 257]),
        {
          bitsPerSample: [8, 8, 8],
          compression: TIFF_COMPRESSION_LZW,
          predictor: 2,
          samplesPerPixel: 3,
          tileHeight: 2,
          tileWidth: 2,
        },
      ),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([10, 20, 30, 15, 25, 35, 1, 2, 3, 2, 3, 4]),
    })

    expect(mockedGetDecoder).not.toHaveBeenCalled()
  })

  it('decodes LZW streams that use every 12-bit code before a clear code', async () => {
    const width = 256
    const height = 512
    // Within a long run of one byte each code is the newest, so the table
    // fills mid-run and its last code is used.
    const differenced = Uint8Array.from(
      { length: width * height * 2 },
      (_unused, index) => Math.floor(index / 2000) % 251,
    )
    const deltas = new DataView(differenced.buffer)
    const samples = new Uint16Array(width * height)

    for (let index = 0; index < samples.length; index += 1) {
      const delta = deltas.getUint16(index * 2, true)
      samples[index] = index % width === 0 ? delta : (samples[index - 1] ?? 0) + delta
    }

    const encoded = encodeTiffLzw(differenced)

    expect(encoded.maxCode).toBe(4094)
    await expect(
      decodeTiffTilePixels(encoded.bytes, {
        bitsPerSample: [16],
        compression: TIFF_COMPRESSION_LZW,
        littleEndian: true,
        predictor: 2,
        samplesPerPixel: 1,
        tileHeight: height,
        tileWidth: width,
      }),
    ).resolves.toMatchObject({ pixels: samples })
  })

  it('delegates DEFLATE-compressed RGB tiles to GeoTIFF', async () => {
    const decode = vi.fn(
      async () => new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]).buffer,
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

// TIFF LZW as tifffile (imagecodecs) writes it: the code table fills to the
// last 12-bit code before a clear code.
function encodeTiffLzw(input: Uint8Array): { bytes: Uint8Array; maxCode: number } {
  const codes: (readonly [code: number, width: number])[] = []
  let table = new Map<number, number>()
  let nextCode = 258
  let width = 9
  let current = -1
  let maxCode = 0
  const emit = (code: number) => {
    codes.push([code, width])
    maxCode = code < 256 ? maxCode : Math.max(maxCode, code === 257 ? 0 : code)
  }
  const grow = () => {
    nextCode += 1

    if (nextCode === 4096) {
      emit(256)
      table = new Map()
      nextCode = 258
      width = 9
    } else if (nextCode > 2 ** width - 1) {
      width += 1
    }
  }

  emit(256)

  for (const byte of input) {
    const known = current < 0 ? byte : table.get(current * 256 + byte)

    if (known !== undefined) {
      current = known
      continue
    }

    emit(current)
    table.set(current * 256 + byte, nextCode)
    grow()
    current = byte
  }

  emit(current)
  grow()
  emit(257)

  const packed = new Uint8Array(
    Math.ceil(codes.reduce((sum, [, bits]) => sum + bits, 0) / 8),
  )
  let bitOffset = 0

  for (const [code, bits] of codes) {
    for (let bit = bits - 1; bit >= 0; bit -= 1) {
      if (((code >> bit) & 1) !== 0) {
        const byteIndex = bitOffset >> 3
        packed[byteIndex] = (packed[byteIndex] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }

      bitOffset += 1
    }
  }

  return { bytes: packed, maxCode }
}
