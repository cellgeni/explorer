// Pyramid levels stored in tiles of another size than the full-resolution
// level's (EXP-015). The loader shows every level in tiles of one size, so
// such a level's tiles are cut from the stored tiles they overlap, decoded
// once each and kept while neighbouring tiles need them, as a stripped
// level's tiles are cut from bands (see strips.ts).
import { TIFF_COMPRESSION_NONE, type TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { StripTileWindow } from './strips'

const JPEG_2000_COMPRESSION_CODES = new Set([33003, 33004, 33005, 34712])

export interface TiffRetiledLevel {
  readonly level: number
  // The stored tiles' size, and how many there are across.
  readonly tileWidth: number
  readonly tileHeight: number
  readonly cols: number
  // 1, or the samples per pixel when samples are stored in separate planes.
  readonly planes: number
  // Bytes per pixel of one plane.
  readonly pixelBytes: number
  // Decode tags for one stored tile of one plane.
  readonly storedDecode: TiffTileDecodeMetadata
  // Decode tags for the tiles cut from them: uncompressed samples in the
  // file's byte order and plane layout.
  readonly tileDecode: TiffTileDecodeMetadata
}

export interface RetiledStoredTile {
  readonly col: number
  readonly row: number
}

export function tiffRetiledLevel(options: {
  readonly level: number
  readonly width: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly decodeMetadata: TiffTileDecodeMetadata
  // A label image, whose 32-bit samples are read too (as raw values).
  readonly labels?: boolean
}): TiffRetiledLevel {
  const { decodeMetadata, level, tileHeight, tileWidth } = options
  const bitsPerSample =
    decodeMetadata.bitsPerSample === undefined ||
    decodeMetadata.bitsPerSample.length === 0
      ? [8]
      : decodeMetadata.bitsPerSample
  const bits = bitsPerSample[0] ?? 8
  const samplesPerPixel = decodeMetadata.samplesPerPixel ?? bitsPerSample.length
  const compression = decodeMetadata.compression ?? TIFF_COMPRESSION_NONE
  const separated = samplesPerPixel > 1 && (decodeMetadata.planarConfiguration ?? 1) === 2
  const stored = `TIFF level ${level} is stored in ${tileWidth} × ${tileHeight} tiles, unlike level 0`

  if (
    (bits !== 8 && bits !== 16 && (options.labels !== true || bits !== 32)) ||
    bitsPerSample.some((value) => value !== bits)
  ) {
    throw new Error(
      `${stored}, in ${bitsPerSample.join('/')}-bit samples; only ${options.labels === true ? '8-, 16- and 32-bit' : '8- and 16-bit'} samples can be re-tiled.`,
    )
  }

  if (JPEG_2000_COMPRESSION_CODES.has(compression)) {
    throw new Error(
      `${stored}, in JPEG 2000, which can only be read in level 0's tile size. Save every level with the same tile size.`,
    )
  }

  const shared = {
    ...(decodeMetadata.littleEndian === undefined
      ? {}
      : { littleEndian: decodeMetadata.littleEndian }),
    ...(decodeMetadata.sampleFormat === undefined
      ? {}
      : { sampleFormat: decodeMetadata.sampleFormat }),
  }

  return {
    level,
    tileWidth,
    tileHeight,
    cols: Math.ceil(options.width / tileWidth),
    planes: separated ? samplesPerPixel : 1,
    pixelBytes: (bits / 8) * (separated ? 1 : samplesPerPixel),
    storedDecode: {
      ...shared,
      ...(decodeMetadata.predictor === undefined
        ? {}
        : { predictor: decodeMetadata.predictor }),
      ...(decodeMetadata.photometric === undefined
        ? {}
        : { photometric: decodeMetadata.photometric }),
      ...(decodeMetadata.jpegTables === undefined
        ? {}
        : { jpegTables: decodeMetadata.jpegTables }),
      compression,
      bitsPerSample: separated ? [bits] : bitsPerSample,
      samplesPerPixel: separated ? 1 : samplesPerPixel,
      planarConfiguration: 1,
    },
    tileDecode: {
      ...shared,
      compression: TIFF_COMPRESSION_NONE,
      bitsPerSample,
      samplesPerPixel,
      planarConfiguration: separated ? 2 : 1,
    },
  }
}

// The stored tiles under a tile of the loader's grid.
export function retiledTilesUnder(
  level: TiffRetiledLevel,
  window: StripTileWindow,
): readonly RetiledStoredTile[] {
  const tiles: RetiledStoredTile[] = []
  const firstRow = Math.floor(window.top / level.tileHeight)
  const lastRow = Math.floor((window.top + window.height - 1) / level.tileHeight)
  const firstCol = Math.floor(window.left / level.tileWidth)
  const lastCol = Math.floor((window.left + window.width - 1) / level.tileWidth)

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      tiles.push({ col, row })
    }
  }

  return tiles
}

// How the strip band decoder decodes one stored tile: its planes one after
// another, each a single strip of the tile's rows.
export function retiledTileDecodeOptions(
  level: TiffRetiledLevel,
  planeByteLengths: readonly number[],
): TiffStripBandDecodeOptions {
  return {
    ...level.storedDecode,
    width: level.tileWidth,
    rowBytes: level.tileWidth * level.pixelBytes,
    stripRows: planeByteLengths.map(() => level.tileHeight),
    stripByteLengths: planeByteLengths,
  }
}

// The window's pixels from the decoded stored tiles, in a tile of the
// loader's size laid out as tileDecode says.
export function retiledTileBytes(
  level: TiffRetiledLevel,
  stored: readonly (RetiledStoredTile & { readonly bytes: Uint8Array })[],
  window: StripTileWindow,
  tileWidth: number,
  tileHeight: number,
): Uint8Array {
  const tileRowBytes = tileWidth * level.pixelBytes
  const tilePlaneBytes = tileRowBytes * tileHeight
  const storedRowBytes = level.tileWidth * level.pixelBytes
  const storedPlaneBytes = storedRowBytes * level.tileHeight
  const tile = new Uint8Array(tilePlaneBytes * level.planes)

  for (const { bytes, col, row } of stored) {
    const storedLeft = col * level.tileWidth
    const storedTop = row * level.tileHeight
    const left = Math.max(window.left, storedLeft)
    const right = Math.min(window.left + window.width, storedLeft + level.tileWidth)
    const top = Math.max(window.top, storedTop)
    const bottom = Math.min(window.top + window.height, storedTop + level.tileHeight)
    const length = (right - left) * level.pixelBytes

    if (length <= 0) continue

    for (let plane = 0; plane < level.planes; plane += 1) {
      for (let y = top; y < bottom; y += 1) {
        const source =
          plane * storedPlaneBytes +
          (y - storedTop) * storedRowBytes +
          (left - storedLeft) * level.pixelBytes

        tile.set(
          bytes.subarray(source, source + length),
          plane * tilePlaneBytes +
            (y - window.top) * tileRowBytes +
            (left - window.left) * level.pixelBytes,
        )
      }
    }
  }

  return tile
}
