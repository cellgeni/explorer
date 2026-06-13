import { getDecoder } from 'geotiff'
import { decodeJpeg2000 } from './jpeg2000'
import type { DecodedJpeg2000, Jpeg2000Pixels } from './jpeg2000'

export const TIFF_COMPRESSION_NONE = 1
export const TIFF_COMPRESSION_LZW = 5

const TIFF_COMPRESSION_JPEG_2000 = 34712
const TIFF_COMPRESSION_JPEG_2000_LOSSLESS = 33003
const TIFF_COMPRESSION_JPEG_2000_LOSSY = 33004
const TIFF_COMPRESSION_JPEG_2000_LEGACY = 33005

const JPEG_2000_COMPRESSION_CODES = new Set([
  TIFF_COMPRESSION_JPEG_2000,
  TIFF_COMPRESSION_JPEG_2000_LOSSLESS,
  TIFF_COMPRESSION_JPEG_2000_LOSSY,
  TIFF_COMPRESSION_JPEG_2000_LEGACY,
])

export interface TiffTileDecodeMetadata {
  readonly compression?: number
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly bitsPerSample?: readonly number[]
  readonly samplesPerPixel?: number
  readonly predictor?: number
  readonly planarConfiguration?: number
  readonly littleEndian?: boolean
}

export async function decodeTiffTilePixels(
  bytes: Uint8Array,
  metadata: TiffTileDecodeMetadata = {},
): Promise<DecodedJpeg2000> {
  if (
    metadata.compression === undefined ||
    JPEG_2000_COMPRESSION_CODES.has(metadata.compression)
  ) {
    return decodeJpeg2000(bytes)
  }

  if (
    metadata.compression === TIFF_COMPRESSION_NONE ||
    metadata.compression === TIFF_COMPRESSION_LZW
  ) {
    return decodeGeotiffCompressedTile(bytes, metadata)
  }

  throw new Error(
    `Unsupported TIFF tile compression ${metadata.compression}. Supported tile compressions are uncompressed, JPEG-2000, and LZW.`,
  )
}

async function decodeGeotiffCompressedTile(
  bytes: Uint8Array,
  metadata: TiffTileDecodeMetadata,
): Promise<DecodedJpeg2000> {
  const compression = metadata.compression ?? TIFF_COMPRESSION_NONE
  const tileWidth = positiveInteger(metadata.tileWidth, 'tile width')
  const tileHeight = positiveInteger(metadata.tileHeight, 'tile height')
  const bitsPerSample =
    metadata.bitsPerSample === undefined || metadata.bitsPerSample.length === 0
      ? [8]
      : [...metadata.bitsPerSample]
  const samplesPerPixel = metadata.samplesPerPixel ?? bitsPerSample.length
  const predictor = metadata.predictor ?? 1
  const planarConfiguration = metadata.planarConfiguration ?? 1

  if (samplesPerPixel !== 1) {
    throw new Error(
      `Unsupported TIFF tile sample count ${samplesPerPixel}. Only single-sample grayscale tiles are supported.`,
    )
  }

  const decodedBuffer =
    compression === TIFF_COMPRESSION_NONE
      ? copyToArrayBuffer(bytes)
      : compression === TIFF_COMPRESSION_LZW && predictor === 1
        ? decompressTiffLzw(
            bytes,
            decodedByteLength(tileWidth, tileHeight, bitsPerSample),
          )
        : await decodeWithGeotiff(bytes, {
            bitsPerSample,
            compression,
            planarConfiguration,
            predictor,
            samplesPerPixel,
            tileHeight,
            tileWidth,
          })

  return {
    pixels: pixelsFromDecodedBuffer(decodedBuffer, {
      bitsPerSample,
      littleEndian: metadata.littleEndian ?? true,
      samplesPerPixel,
      tileHeight,
      tileWidth,
    }),
    width: tileWidth,
    height: tileHeight,
  }
}

function pixelsFromDecodedBuffer(
  buffer: ArrayBufferLike,
  options: {
    readonly bitsPerSample: readonly number[]
    readonly littleEndian: boolean
    readonly samplesPerPixel: number
    readonly tileHeight: number
    readonly tileWidth: number
  },
): Jpeg2000Pixels {
  const bitsPerSample = options.bitsPerSample[0] ?? 8
  const pixelCount = options.tileWidth * options.tileHeight

  if (bitsPerSample <= 8) {
    return copyUint8Pixels(buffer, pixelCount)
  }

  if (bitsPerSample <= 16) {
    return copyUint16Pixels(buffer, pixelCount, options.littleEndian)
  }

  throw new Error(
    `Unsupported TIFF tile bit depth ${bitsPerSample}. Only 8-bit and 16-bit grayscale tiles are supported.`,
  )
}

async function decodeWithGeotiff(
  bytes: Uint8Array,
  options: {
    readonly bitsPerSample: readonly number[]
    readonly compression: number
    readonly planarConfiguration: number
    readonly predictor: number
    readonly samplesPerPixel: number
    readonly tileHeight: number
    readonly tileWidth: number
  },
): Promise<ArrayBufferLike> {
  const decoder = await getDecoder(options.compression, {
    bitsPerSample: [...options.bitsPerSample],
    planarConfiguration: options.planarConfiguration,
    predictor: options.predictor,
    samplesPerPixel: options.samplesPerPixel,
    tileHeight: options.tileHeight,
    tileWidth: options.tileWidth,
  })

  return decoder.decode(copyToArrayBuffer(bytes))
}

function decodedByteLength(
  tileWidth: number,
  tileHeight: number,
  bitsPerSample: readonly number[],
): number {
  const bits = bitsPerSample[0] ?? 8
  const bytesPerSample = Math.ceil(bits / 8)

  return tileWidth * tileHeight * bytesPerSample
}

function decompressTiffLzw(bytes: Uint8Array, expectedByteLength: number): ArrayBuffer {
  const output = new Uint8Array(expectedByteLength)
  const prefixes = new Uint16Array(4096)
  const suffixes = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  let codeSize = 9
  let nextCode = 258
  let bitOffset = 0
  let outputOffset = 0
  let previousCode = -1

  const resetDictionary = () => {
    codeSize = 9
    nextCode = 258
    previousCode = -1
  }

  const readCode = (): number => {
    if (bitOffset + codeSize > bytes.length * 8) {
      return 257
    }

    let code = 0

    for (let bit = 0; bit < codeSize; bit += 1) {
      const absoluteBit = bitOffset + bit
      const byte = bytes[absoluteBit >> 3] ?? 0
      const shift = 7 - (absoluteBit & 7)
      code = (code << 1) | ((byte >> shift) & 1)
    }

    bitOffset += codeSize
    return code
  }

  const writeByte = (value: number) => {
    if (outputOffset < output.length) {
      output[outputOffset] = value
    }

    outputOffset += 1
  }

  const firstByteForCode = (code: number): number => {
    let current = code

    while (current >= 256) {
      current = prefixes[current] ?? 0
    }

    return current
  }

  const writeCode = (code: number): number => {
    if (code < 256) {
      writeByte(code)
      return code
    }

    let stackLength = 0
    let current = code

    while (current >= 256) {
      stack[stackLength] = suffixes[current] ?? 0
      stackLength += 1
      current = prefixes[current] ?? 0
    }

    const firstByte = current
    writeByte(firstByte)

    for (let index = stackLength - 1; index >= 0; index -= 1) {
      writeByte(stack[index] ?? 0)
    }

    return firstByte
  }

  const addDictionaryEntry = (prefix: number, suffix: number) => {
    if (nextCode >= 4096) {
      return
    }

    prefixes[nextCode] = prefix
    suffixes[nextCode] = suffix
    nextCode += 1

    if (nextCode + 1 >= 2 ** codeSize && codeSize < 12) {
      codeSize += 1
    }
  }

  resetDictionary()

  while (outputOffset < output.length) {
    const code = readCode()

    if (code === 257) {
      break
    }

    if (code === 256) {
      resetDictionary()
      continue
    }

    if (previousCode < 0) {
      writeCode(code)
      previousCode = code
      continue
    }

    if (code < nextCode) {
      const firstByte = writeCode(code)
      addDictionaryEntry(previousCode, firstByte)
      previousCode = code
      continue
    }

    if (code === nextCode) {
      const firstByte = firstByteForCode(previousCode)
      writeCode(previousCode)
      writeByte(firstByte)
      addDictionaryEntry(previousCode, firstByte)
      previousCode = code
      continue
    }

    throw new Error(`Invalid TIFF LZW code ${code}.`)
  }

  return output.buffer
}

function copyUint8Pixels(buffer: ArrayBufferLike, pixelCount: number): Uint8Array {
  const source = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, pixelCount))
  const pixels = new Uint8Array(pixelCount)

  pixels.set(source)
  return pixels
}

function copyUint16Pixels(
  buffer: ArrayBufferLike,
  pixelCount: number,
  littleEndian: boolean,
): Uint16Array {
  const view = new DataView(buffer)
  const availablePixels = Math.min(pixelCount, Math.floor(buffer.byteLength / 2))
  const pixels = new Uint16Array(pixelCount)

  for (let index = 0; index < availablePixels; index += 1) {
    pixels[index] = view.getUint16(index * 2, littleEndian)
  }

  return pixels
}

function positiveInteger(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Missing TIFF ${label} for tile decode.`)
  }

  return Math.floor(value)
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)

  copy.set(bytes)
  return copy.buffer
}
