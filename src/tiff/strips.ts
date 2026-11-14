// Stripped TIFF images: each strip holds `RowsPerStrip` whole rows, so a
// strip cannot be read for part of a row. The loader shows a stripped level
// as square tiles cut from bands: runs of whole rows read (and, when
// compressed, decoded) once and shared by every tile across them.
import { TIFF_COMPRESSION_NONE } from '../codecs/tiffTile'
import { sharedLoad, type SharedLoad } from '../utils/sharedLoad'
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { TiffChunk } from './loader'

// The tile size of an image whose full-resolution level is stripped.
export const STRIP_TILE_SIZE = 256

// Bands aim for this size, within the persistent byte-range cache's entry
// limit, and at most STRIP_BAND_MAX_ROWS rows.
const STRIP_BAND_TARGET_BYTES = 8 * 1024 * 1024
const STRIP_BAND_MAX_ROWS = 1024
// A compressed strip decodes whole, so a band holds at least one. Strips
// that decode larger than this are refused.
const STRIP_BAND_MAX_BYTES = 256 * 1024 * 1024
// Band pieces stored this close together are read in one request.
const STRIP_READ_MAX_GAP = 4096
// Decoded bands kept in memory, least recently used first. The latest band
// stays even when it alone is over the limit.
const STRIP_BAND_CACHE_BYTES = 256 * 1024 * 1024

export interface TiffStripTags {
  readonly offsets: readonly number[]
  readonly byteCounts: readonly number[]
  // Missing means one strip for the whole image.
  readonly rowsPerStrip?: number
}

export interface TiffStripLevel {
  readonly width: number
  readonly height: number
  readonly rowsPerStrip: number
  readonly stripsPerPlane: number
  // Every strip of plane 0, then of plane 1, and so on.
  readonly strips: readonly TiffChunk[]
  // 1, or the samples per pixel when samples are stored in separate planes.
  readonly planes: number
  // Bytes per pixel, and per row, of one plane.
  readonly pixelBytes: number
  readonly rowBytes: number
  readonly bandRows: number
  readonly compressed: boolean
  // Decode tags for one strip of one plane.
  readonly stripDecode: TiffTileDecodeMetadata
  // Decode tags for the tiles cut from bands: uncompressed samples in the
  // file's byte order and plane layout.
  readonly tileDecode: TiffTileDecodeMetadata
}

export interface StripBandRead {
  // Byte ranges to request.
  readonly runs: readonly StripByteRun[]
  // The band's strips (compressed) or rows of strips (uncompressed), plane
  // by plane, top to bottom.
  readonly pieces: readonly PlannedStripPiece[]
}

export interface StripByteRun {
  readonly start: number
  readonly end: number
}

export interface StripPiece {
  readonly offset: number
  readonly length: number
  readonly rows: number
}

interface PlannedStripPiece extends StripPiece {
  // The run that reads it; -1 for a piece with no bytes.
  readonly run: number
}

export interface StripTileWindow {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface StripBand {
  readonly index: number
  readonly bytes: Uint8Array
}

export function tiffStripLevel(options: {
  readonly level: number
  readonly width: number
  readonly height: number
  readonly tags: TiffStripTags
  readonly decodeMetadata: TiffTileDecodeMetadata
  readonly tileHeight: number
}): TiffStripLevel {
  const { decodeMetadata, height, level, tags, width } = options
  const bitsPerSample =
    decodeMetadata.bitsPerSample === undefined ||
    decodeMetadata.bitsPerSample.length === 0
      ? [8]
      : decodeMetadata.bitsPerSample
  const bits = bitsPerSample[0] ?? 8
  const samplesPerPixel = decodeMetadata.samplesPerPixel ?? bitsPerSample.length
  const planarConfiguration = decodeMetadata.planarConfiguration ?? 1
  const compression = decodeMetadata.compression ?? TIFF_COMPRESSION_NONE

  if ((bits !== 8 && bits !== 16) || bitsPerSample.some((value) => value !== bits)) {
    throw new Error(
      `TIFF level ${level} is stored in strips of ${bitsPerSample.join('/')}-bit samples; only 8- and 16-bit samples can be read from strips.`,
    )
  }

  const separated = samplesPerPixel > 1 && planarConfiguration === 2
  const planes = separated ? samplesPerPixel : 1
  const pixelBytes = (bits / 8) * (separated ? 1 : samplesPerPixel)
  const rowBytes = width * pixelBytes
  const rowsPerStrip = Math.min(height, Math.max(1, tags.rowsPerStrip ?? height))
  const stripsPerPlane = Math.ceil(height / rowsPerStrip)
  const compressed = compression !== TIFF_COMPRESSION_NONE

  if (tags.offsets.length !== tags.byteCounts.length) {
    throw new Error(`TIFF level ${level} has mismatched strip offset/count arrays.`)
  }

  if (tags.offsets.length < stripsPerPlane * planes) {
    throw new Error(
      `TIFF level ${level} has ${tags.offsets.length} strips, expected ${stripsPerPlane * planes}.`,
    )
  }

  const bandRowBytes = rowBytes * planes
  const targetRows = Math.min(
    STRIP_BAND_MAX_ROWS,
    Math.max(1, Math.floor(STRIP_BAND_TARGET_BYTES / bandRowBytes)),
  )
  let bandRows: number

  if (compressed) {
    const stripBytes = rowsPerStrip * bandRowBytes

    if (stripBytes > STRIP_BAND_MAX_BYTES) {
      throw new Error(
        `TIFF level ${level} is stored in compressed strips of ${rowsPerStrip} rows (${Math.ceil(stripBytes / (1024 * 1024))} MB each once decoded), too large to read in parts. Save the image tiled, for example as a pyramidal OME-TIFF.`,
      )
    }

    bandRows = Math.max(1, Math.floor(targetRows / rowsPerStrip)) * rowsPerStrip
  } else {
    bandRows = uncompressedBandRows(targetRows, options.tileHeight)
  }

  const shared = {
    ...(decodeMetadata.predictor === undefined
      ? {}
      : { predictor: decodeMetadata.predictor }),
    ...(decodeMetadata.photometric === undefined
      ? {}
      : { photometric: decodeMetadata.photometric }),
    ...(decodeMetadata.littleEndian === undefined
      ? {}
      : { littleEndian: decodeMetadata.littleEndian }),
  }

  return {
    width,
    height,
    rowsPerStrip,
    stripsPerPlane,
    strips: tags.offsets.map((offset, index) => ({
      offset,
      length: tags.byteCounts[index] ?? 0,
    })),
    planes,
    pixelBytes,
    rowBytes,
    bandRows,
    compressed,
    stripDecode: {
      ...shared,
      compression,
      bitsPerSample: separated ? [bits] : bitsPerSample,
      samplesPerPixel: separated ? 1 : samplesPerPixel,
      planarConfiguration: 1,
      ...(decodeMetadata.jpegTables === undefined
        ? {}
        : { jpegTables: decodeMetadata.jpegTables }),
    },
    tileDecode: {
      ...(decodeMetadata.littleEndian === undefined
        ? {}
        : { littleEndian: decodeMetadata.littleEndian }),
      compression: TIFF_COMPRESSION_NONE,
      bitsPerSample,
      samplesPerPixel,
      planarConfiguration: separated ? 2 : 1,
    },
  }
}

// Uncompressed rows can be read in any runs, so bands are whole rows of
// tiles, or for very wide images an even split of one.
function uncompressedBandRows(targetRows: number, tileHeight: number): number {
  if (targetRows >= tileHeight) {
    return Math.floor(targetRows / tileHeight) * tileHeight
  }

  let rows = tileHeight

  while (rows > targetRows && rows > 1) {
    rows = Math.ceil(rows / 2)
  }

  return rows
}

// The bands holding rows `top` (inclusive) to `bottom` (exclusive).
export function stripBandsForRows(
  level: TiffStripLevel,
  top: number,
  bottom: number,
): readonly number[] {
  const first = Math.floor(top / level.bandRows)
  const last = Math.floor((Math.min(bottom, level.height) - 1) / level.bandRows)
  const bands: number[] = []

  for (let band = first; band <= last; band += 1) {
    bands.push(band)
  }

  return bands
}

function bandRowRange(
  level: TiffStripLevel,
  band: number,
): { readonly top: number; readonly bottom: number } {
  const top = band * level.bandRows

  return { top, bottom: Math.min(level.height, top + level.bandRows) }
}

// What to read for `band`: whole strips when compressed, otherwise just the
// band's rows of each strip.
export function stripBandRead(level: TiffStripLevel, band: number): StripBandRead {
  const { top, bottom } = bandRowRange(level, band)
  const firstStrip = Math.floor(top / level.rowsPerStrip)
  const lastStrip = Math.floor((bottom - 1) / level.rowsPerStrip)
  const pieces: StripPiece[] = []

  for (let plane = 0; plane < level.planes; plane += 1) {
    for (let strip = firstStrip; strip <= lastStrip; strip += 1) {
      const chunk = level.strips[plane * level.stripsPerPlane + strip]
      const stripTop = strip * level.rowsPerStrip
      const stripBottom = Math.min(level.height, stripTop + level.rowsPerStrip)

      if (chunk === undefined) {
        throw new Error(`TIFF strip ${strip} of plane ${plane} is missing.`)
      }

      if (level.compressed) {
        pieces.push({ ...chunk, rows: stripBottom - stripTop })
        continue
      }

      const first = Math.max(top, stripTop)
      const last = Math.min(bottom, stripBottom)
      const start = (first - stripTop) * level.rowBytes
      // A strip stored short reads what it holds; its other rows stay zero.
      const length = Math.max(
        0,
        Math.min((last - first) * level.rowBytes, chunk.length - start),
      )

      pieces.push({ offset: chunk.offset + start, length, rows: last - first })
    }
  }

  return planStripRuns(pieces)
}

// Pieces stored back to back, or nearly, share a run.
function planStripRuns(pieces: readonly StripPiece[]): StripBandRead {
  const runs: { start: number; end: number }[] = []
  const planned: PlannedStripPiece[] = []

  for (const piece of pieces) {
    const current = runs.at(-1)

    if (piece.length === 0) {
      planned.push({ ...piece, run: -1 })
      continue
    }

    const gap = current === undefined ? -1 : piece.offset - current.end

    if (current !== undefined && gap >= 0 && gap <= STRIP_READ_MAX_GAP) {
      current.end = piece.offset + piece.length
    } else {
      runs.push({ start: piece.offset, end: piece.offset + piece.length })
    }

    planned.push({ ...piece, run: runs.length - 1 })
  }

  return { runs, pieces: planned }
}

// Each piece's bytes, taken from the runs read for it. A run cut short (the
// file ends early) leaves its pieces short.
export function stripPieceBytes(
  read: StripBandRead,
  runBytes: readonly Uint8Array[],
): readonly Uint8Array[] {
  return read.pieces.map((piece) => {
    const run = read.runs[piece.run]
    const bytes = runBytes[piece.run]

    if (run === undefined || bytes === undefined) {
      return new Uint8Array(0)
    }

    const start = piece.offset - run.start

    return bytes.subarray(start, start + piece.length)
  })
}

// An uncompressed band: its pieces' rows in turn, zero where a piece is
// short.
export function uncompressedStripBand(
  level: TiffStripLevel,
  read: StripBandRead,
  pieces: readonly Uint8Array[],
): Uint8Array {
  const rows = read.pieces.reduce((sum, piece) => sum + piece.rows, 0)
  const band = new Uint8Array(rows * level.rowBytes)
  let offset = 0

  for (const [index, piece] of read.pieces.entries()) {
    const bytes = pieces[index]

    if (bytes !== undefined) {
      band.set(bytes.subarray(0, piece.rows * level.rowBytes), offset)
    }

    offset += piece.rows * level.rowBytes
  }

  return band
}

// The strips of a compressed band back to back, and how to decode them.
export function compressedStripBand(
  level: TiffStripLevel,
  pieces: readonly Uint8Array[],
  read: StripBandRead,
): { readonly bytes: Uint8Array; readonly options: TiffStripBandDecodeOptions } {
  const bytes = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0))
  let offset = 0

  for (const piece of pieces) {
    bytes.set(piece, offset)
    offset += piece.byteLength
  }

  return {
    bytes,
    options: {
      ...level.stripDecode,
      width: level.width,
      rowBytes: level.rowBytes,
      stripRows: read.pieces.map((piece) => piece.rows),
      stripByteLengths: pieces.map((piece) => piece.byteLength),
    },
  }
}

// One tile's samples, `tileWidth` by `tileHeight` per plane, cut from the
// bands across `window` and zero outside the image.
export function stripTileBytes(
  level: TiffStripLevel,
  bands: readonly StripBand[],
  window: StripTileWindow,
  tileWidth: number,
  tileHeight: number,
): Uint8Array {
  const tileRowBytes = tileWidth * level.pixelBytes
  const tilePlaneBytes = tileRowBytes * tileHeight
  const windowRowBytes = window.width * level.pixelBytes
  const columnOffset = window.left * level.pixelBytes
  const tile = new Uint8Array(tilePlaneBytes * level.planes)

  for (const band of bands) {
    const { top, bottom } = bandRowRange(level, band.index)
    const bandPlaneBytes = (bottom - top) * level.rowBytes
    const firstRow = Math.max(window.top, top)
    const lastRow = Math.min(window.top + window.height, bottom)

    for (let plane = 0; plane < level.planes; plane += 1) {
      for (let row = firstRow; row < lastRow; row += 1) {
        const source =
          plane * bandPlaneBytes + (row - top) * level.rowBytes + columnOffset

        tile.set(
          band.bytes.subarray(source, source + windowRowBytes),
          plane * tilePlaneBytes + (row - window.top) * tileRowBytes,
        )
      }
    }
  }

  return tile
}

// Bands being read or kept for their tiles, least recently used first. A
// band's read is shared by the tiles waiting on it and stops once all of them
// stop waiting.
export class StripBandCache {
  private readonly loads = new Map<string, SharedLoad<Uint8Array>>()
  private readonly sizes = new Map<string, number>()
  private totalBytes = 0

  constructor(private readonly maxBytes: number = STRIP_BAND_CACHE_BYTES) {}

  get(
    key: string,
    load: (signal: AbortSignal) => Promise<Uint8Array>,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    let entry = this.loads.get(key)

    if (entry === undefined || entry.aborted) {
      this.forget(key)
      const next = sharedLoad(load)

      next.promise.then(
        (bytes) => {
          if (this.loads.get(key) === next) {
            this.sizes.set(key, bytes.byteLength)
            this.totalBytes += bytes.byteLength
            this.evict(key)
          }
        },
        () => {
          if (this.loads.get(key) === next) {
            this.forget(key)
          }
        },
      )
      entry = next
    } else {
      this.loads.delete(key)
    }

    this.loads.set(key, entry)
    return entry.wait(signal)
  }

  clear(): void {
    this.loads.clear()
    this.sizes.clear()
    this.totalBytes = 0
  }

  private evict(latest: string): void {
    for (const key of this.loads.keys()) {
      if (this.totalBytes <= this.maxBytes) {
        return
      }

      // Bands still being read have no size yet.
      if (key !== latest && this.sizes.has(key)) {
        this.forget(key)
      }
    }
  }

  private forget(key: string): void {
    this.totalBytes -= this.sizes.get(key) ?? 0
    this.sizes.delete(key)
    this.loads.delete(key)
  }
}
