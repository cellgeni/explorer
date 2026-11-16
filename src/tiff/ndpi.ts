// Hamamatsu NDPI slides, written by NanoZoomer scanners. An NDPI is a TIFF
// whose pyramid levels are top-level IFDs, each holding the whole level as
// one baseline JPEG in a single strip: a 68,096 × 37,632 level is 7.7 GB once
// decoded, and wider than the 65,535 pixels a JPEG header can state, so the
// scanner writes a width of 0. The scanner also ends every few MCUs with a
// restart marker and lists where each restart interval starts in a private
// tag (McuStarts), which is how OpenSlide reads regions of a level.
//
// Restart intervals run along MCU rows, so the viewer reads bands of whole
// MCU rows, which lie back to back in the file, and decodes a block of
// intervals as a small JPEG of its own: the level's header with the block's
// size, the intervals' entropy-coded data, and restart markers numbered
// afresh. Tiles are cut from the decoded blocks.
import type { TiffStripBandDecodeOptions } from '../codecs/tiffStrips'
import type { TiffTileDecodeMetadata } from '../codecs/tiffTile'
import type { StripTileWindow } from './strips'

// Private NDPI tags.
export const NDPI_FORMAT_FLAG_TAG = 65420
// The level's objective magnification; -1 marks the macro image and -2 the
// map of scanned areas.
export const NDPI_MAGNIFICATION_TAG = 65421
// The focal plane, in nanometres from the slide's focus.
export const NDPI_Z_OFFSET_TAG = 65424
export const NDPI_MCU_STARTS_TAG = 65426
// Written by files over 4 GB, whose offsets need more than 32 bits.
export const NDPI_MCU_STARTS_HIGH_BYTES_TAG = 65432

export const NDPI_OVER_4GB_MESSAGE =
  'The NDPI is larger than 4 GB, which stores offsets in a form this viewer does not read. Convert it to pyramidal OME-TIFF.'

// NDPI levels are shown as tiles of this size, cut from decoded blocks.
export const NDPI_TILE_SIZE = 512

// When the smallest level is larger than this, a level an eighth of its size
// is added, decoded from each JPEG block's DC term, so a whole-slide view
// needs a few tiles rather than every tile of that level.
export const NDPI_DC_LEVEL_MIN_SIZE = 2048
export const NDPI_DC_SCALE = 8

// A band is read in one request and aims for this many bytes, within the
// persistent byte-range cache's entry limit. A block spans about
// NDPI_BLOCK_TARGET_WIDTH pixels of whole restart intervals, and the band
// shrinks until a block decodes to at most NDPI_BLOCK_MAX_BYTES.
const NDPI_BAND_TARGET_BYTES = 2 * 1024 * 1024
const NDPI_BLOCK_TARGET_WIDTH = 2048
const NDPI_BLOCK_MAX_BYTES = 16 * 1024 * 1024

const TIFF_COMPRESSION_NONE = 1
const TIFF_COMPRESSION_JPEG = 7

const SOI = 0xd8
const EOI = 0xd9
const RST0 = 0xd0
const RST7 = 0xd7
const SOF0 = 0xc0
const SOF1 = 0xc1
const DHT = 0xc4
const JPG = 0xc8
const DAC = 0xcc
const DRI = 0xdd
const SOS = 0xda

// The IFD fields that place an image in the NDPI layout.
export interface NdpiIfdSummary {
  readonly index: number
  readonly width: number
  readonly height: number
  // Undefined when the tag is missing.
  readonly magnification?: number
  readonly zOffset?: number
}

// Where a level's JPEG stream is and how to find its restart intervals.
export interface NdpiLevelSource {
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  readonly photometric?: number
  // The level's one strip: the JPEG stream.
  readonly streamOffset: number
  readonly streamLength: number
  // The McuStarts tag: where each restart interval's entropy-coded data
  // starts, from the start of the stream.
  readonly intervalStarts: () => Promise<ArrayLike<number>>
}

// How a pyramid level reads an NDPI stream: as stored, or at an eighth of
// the size from the DC terms (see NDPI_DC_LEVEL_MIN_SIZE).
export interface NdpiLevelRead {
  readonly source: NdpiLevelSource
  // The pyramid level that reads the stream as stored; levels of one stream
  // share its layout.
  readonly sourceLevel: number
  readonly dcOnly: boolean
}

export interface NdpiJpegHeader {
  // From SOI to the end of the SOS segment.
  readonly length: number
  // Where the SOF segment's height field starts; the width follows it.
  readonly frameSizeOffset: number
  readonly mcuWidth: number
  readonly mcuHeight: number
  readonly components: number
  // MCUs per restart interval; 0 without a DRI segment.
  readonly restartInterval: number
}

export interface NdpiPlanOptions {
  readonly tileHeight: number
  readonly bandTargetBytes: number
  readonly blockTargetWidth: number
  readonly blockMaxBytes: number
}

export interface NdpiLevelGeometry {
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  readonly header: Uint8Array
  readonly frameSizeOffset: number
  readonly mcuWidth: number
  readonly mcuHeight: number
  readonly mcuRows: number
  readonly intervalMcus: number
  readonly intervalsPerRow: number
  readonly intervalStarts: ArrayLike<number>
  readonly streamLength: number
  // MCU rows per band, and restart intervals per block.
  readonly bandMcuRows: number
  readonly blockIntervals: number
}

// A band of MCU rows, and a run of restart intervals across it.
export interface NdpiBlock {
  readonly band: number
  readonly group: number
}

export interface NdpiDecodedBlock {
  readonly window: StripTileWindow
  readonly bytes: Uint8Array
}

export interface NdpiBlockJpeg {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

export function isNdpiUrl(url: string): boolean {
  return /\.ndpi(?:$|[?#])/i.test(url)
}

// The IFDs of the pyramid, full resolution first: the levels of the focal
// plane nearest the focus, each smaller than the one before. The macro image
// and the map are left out.
export function ndpiLayout(summaries: readonly NdpiIfdSummary[]): readonly number[] {
  const images = summaries.filter(
    (summary) => summary.magnification === undefined || summary.magnification > 0,
  )
  const nearest = images.reduce<NdpiIfdSummary | undefined>(
    (best, summary) =>
      best === undefined || Math.abs(summary.zOffset ?? 0) < Math.abs(best.zOffset ?? 0)
        ? summary
        : best,
    undefined,
  )

  if (nearest === undefined) {
    return []
  }

  const plane = images
    .filter((summary) => (summary.zOffset ?? 0) === (nearest.zOffset ?? 0))
    .sort((left, right) => right.width - left.width || left.index - right.index)
  const levels: NdpiIfdSummary[] = []

  for (const summary of plane) {
    const previous = levels.at(-1)

    if (
      previous === undefined ||
      (summary.width < previous.width && summary.height < previous.height)
    ) {
      levels.push(summary)
    }
  }

  return levels.map((summary) => summary.index)
}

// Reads a level's JPEG header up to the end of its SOS segment. Only
// sequential Huffman streams (SOF0 and SOF1) at 8 bits are read.
export function parseNdpiJpegHeader(bytes: Uint8Array): NdpiJpegHeader {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new Error('The NDPI level does not start with a JPEG image.')
  }

  let position = 2
  let frame:
    | Pick<NdpiJpegHeader, 'frameSizeOffset' | 'mcuWidth' | 'mcuHeight' | 'components'>
    | undefined
  let restartInterval = 0

  while (position + 4 <= bytes.length) {
    if (bytes[position] !== 0xff) {
      throw new Error(`The NDPI level's JPEG header is damaged at byte ${position}.`)
    }

    const marker = bytes[position + 1] ?? 0

    // Fill bytes before a marker.
    if (marker === 0xff) {
      position += 1
      continue
    }

    const segmentEnd = position + 2 + readUint16(bytes, position + 2)

    if (segmentEnd > bytes.length) {
      break
    }

    if (marker === SOF0 || marker === SOF1) {
      frame = readFrame(bytes, position)
    } else if (isOtherFrameMarker(marker)) {
      throw new Error(
        `The NDPI level is a JPEG of a kind this viewer does not read (SOF marker 0x${marker.toString(16)}).`,
      )
    } else if (marker === DRI) {
      restartInterval = readUint16(bytes, position + 4)
    } else if (marker === SOS) {
      if (frame === undefined) {
        throw new Error("The NDPI level's JPEG scan starts before its frame header.")
      }

      return { ...frame, length: segmentEnd, restartInterval }
    }

    position = segmentEnd
  }

  throw new Error("The NDPI level's JPEG header ends before its scan starts.")
}

// The restart-interval layout of a level and how it is read, checked
// against the McuStarts tag.
export function ndpiLevelGeometry(options: {
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  // At least the level's JPEG header.
  readonly header: Uint8Array
  readonly intervalStarts: ArrayLike<number>
  readonly streamLength: number
  readonly plan?: Partial<NdpiPlanOptions>
}): NdpiLevelGeometry {
  const { height, intervalStarts, samplesPerPixel, streamLength, width } = options
  const parsed = parseNdpiJpegHeader(options.header)

  if (parsed.components !== samplesPerPixel) {
    throw new Error(
      `The NDPI level's JPEG has ${parsed.components} components; the TIFF says ${samplesPerPixel} samples per pixel.`,
    )
  }

  if (parsed.restartInterval === 0) {
    throw new Error('The NDPI level lists restart intervals but its JPEG has none.')
  }

  if (intervalStarts[0] !== parsed.length) {
    throw new Error(
      `The NDPI level's first restart interval starts at byte ${String(intervalStarts[0])}, not where its JPEG scan starts (${parsed.length}).`,
    )
  }

  const mcusPerRow = Math.ceil(width / parsed.mcuWidth)
  const mcuRows = Math.ceil(height / parsed.mcuHeight)

  if (mcusPerRow % parsed.restartInterval !== 0) {
    throw new Error(
      `The NDPI level's restart intervals of ${parsed.restartInterval} MCUs do not divide its rows of ${mcusPerRow} MCUs.`,
    )
  }

  const intervalsPerRow = mcusPerRow / parsed.restartInterval

  if (intervalStarts.length !== intervalsPerRow * mcuRows) {
    throw new Error(
      `The NDPI level lists ${intervalStarts.length} restart intervals; its size needs ${intervalsPerRow * mcuRows}.`,
    )
  }

  for (let index = 1; index < intervalStarts.length; index += 1) {
    if (!((intervalStarts[index] ?? 0) > (intervalStarts[index - 1] ?? 0))) {
      throw new Error(`The NDPI level's restart interval ${index} is out of order.`)
    }
  }

  if (!((intervalStarts[intervalStarts.length - 1] ?? 0) < streamLength)) {
    throw new Error("The NDPI level's last restart interval starts past its JPEG stream.")
  }

  const plan = {
    tileHeight: NDPI_TILE_SIZE,
    bandTargetBytes: NDPI_BAND_TARGET_BYTES,
    blockTargetWidth: NDPI_BLOCK_TARGET_WIDTH,
    blockMaxBytes: NDPI_BLOCK_MAX_BYTES,
    ...options.plan,
  }
  const intervalWidth = parsed.restartInterval * parsed.mcuWidth
  const blockIntervals = Math.min(
    intervalsPerRow,
    Math.max(1, Math.round(plan.blockTargetWidth / intervalWidth)),
  )
  const blockWidth = Math.min(width, blockIntervals * intervalWidth)
  const rowBytes = streamLength / mcuRows
  let bandMcuRows = Math.min(
    mcuRows,
    Math.max(1, Math.ceil(plan.tileHeight / parsed.mcuHeight)),
  )

  // Halving keeps bands that fit a tile's height aligned with the tiles.
  while (
    bandMcuRows > 1 &&
    (bandMcuRows * rowBytes > plan.bandTargetBytes ||
      bandMcuRows * parsed.mcuHeight * blockWidth * samplesPerPixel > plan.blockMaxBytes)
  ) {
    bandMcuRows = Math.ceil(bandMcuRows / 2)
  }

  return {
    width,
    height,
    samplesPerPixel,
    header: options.header.slice(0, parsed.length),
    frameSizeOffset: parsed.frameSizeOffset,
    mcuWidth: parsed.mcuWidth,
    mcuHeight: parsed.mcuHeight,
    mcuRows,
    intervalMcus: parsed.restartInterval,
    intervalsPerRow,
    intervalStarts,
    streamLength,
    bandMcuRows,
    blockIntervals,
  }
}

// The pixels a block covers, clipped to the level.
export function ndpiBlockWindow(
  geometry: NdpiLevelGeometry,
  block: NdpiBlock,
): StripTileWindow {
  const blockWidth = geometry.blockIntervals * geometry.intervalMcus * geometry.mcuWidth
  const bandHeight = geometry.bandMcuRows * geometry.mcuHeight
  const left = block.group * blockWidth
  const top = block.band * bandHeight

  return {
    left,
    top,
    width: Math.min(blockWidth, geometry.width - left),
    height: Math.min(bandHeight, geometry.height - top),
  }
}

// The blocks across `window`, band by band.
export function ndpiBlocksForWindow(
  geometry: NdpiLevelGeometry,
  window: StripTileWindow,
): readonly NdpiBlock[] {
  const blockWidth = geometry.blockIntervals * geometry.intervalMcus * geometry.mcuWidth
  const bandHeight = geometry.bandMcuRows * geometry.mcuHeight
  const right = Math.min(geometry.width, window.left + window.width)
  const bottom = Math.min(geometry.height, window.top + window.height)
  const blocks: NdpiBlock[] = []

  if (right <= window.left || bottom <= window.top) {
    return blocks
  }

  for (
    let band = Math.floor(window.top / bandHeight);
    band <= Math.floor((bottom - 1) / bandHeight);
    band += 1
  ) {
    for (
      let group = Math.floor(window.left / blockWidth);
      group <= Math.floor((right - 1) / blockWidth);
      group += 1
    ) {
      blocks.push({ band, group })
    }
  }

  return blocks
}

// A band's bytes, from the start of the level's JPEG stream: every restart
// interval of its MCU rows.
export function ndpiBandByteRange(
  geometry: NdpiLevelGeometry,
  band: number,
): { readonly start: number; readonly end: number } {
  const { firstRow, lastRow } = bandRows(geometry, band)

  return {
    start: intervalStart(geometry, firstRow * geometry.intervalsPerRow),
    end: intervalStart(geometry, lastRow * geometry.intervalsPerRow),
  }
}

// A self-contained JPEG of one block, from the bytes of its band (see
// ndpiBandByteRange).
export function ndpiBlockJpeg(
  geometry: NdpiLevelGeometry,
  bandBytes: Uint8Array,
  block: NdpiBlock,
): NdpiBlockJpeg {
  const window = ndpiBlockWindow(geometry, block)
  const bandStart = ndpiBandByteRange(geometry, block.band).start
  const { firstRow, lastRow } = bandRows(geometry, block.band)
  const firstInterval = block.group * geometry.blockIntervals
  const lastInterval = Math.min(
    geometry.intervalsPerRow,
    firstInterval + geometry.blockIntervals,
  )
  const segments: Uint8Array[] = []

  for (let row = firstRow; row < lastRow; row += 1) {
    for (let interval = firstInterval; interval < lastInterval; interval += 1) {
      const index = row * geometry.intervalsPerRow + interval
      const start = intervalStart(geometry, index) - bandStart
      const end = intervalStart(geometry, index + 1) - bandStart

      if (start < 0 || end > bandBytes.byteLength) {
        throw new Error(
          `The NDPI band ${block.band} is missing restart interval ${index}.`,
        )
      }

      segments.push(entropyCodedData(bandBytes.subarray(start, end)))
    }
  }

  const { header } = geometry
  const length =
    header.byteLength +
    segments.reduce((sum, segment) => sum + segment.byteLength, 0) +
    2 * segments.length
  const bytes = new Uint8Array(length)
  let position = header.byteLength

  bytes.set(header)
  writeUint16(bytes, geometry.frameSizeOffset, window.height)
  writeUint16(bytes, geometry.frameSizeOffset + 2, window.width)

  for (const [index, segment] of segments.entries()) {
    bytes.set(segment, position)
    position += segment.byteLength
    bytes[position] = 0xff
    bytes[position + 1] = index === segments.length - 1 ? EOI : RST0 + (index % 8)
    position += 2
  }

  return { bytes, width: window.width, height: window.height }
}

// How the strip band decoder decodes a block's JPEG: as one strip.
export function ndpiBlockDecodeOptions(
  geometry: NdpiLevelGeometry,
  jpeg: NdpiBlockJpeg,
  photometric: number | undefined,
  dcOnly = false,
): TiffStripBandDecodeOptions {
  const { width, height } = dcOnly
    ? ndpiDcWindow({ left: 0, top: 0, width: jpeg.width, height: jpeg.height })
    : jpeg

  return {
    compression: TIFF_COMPRESSION_JPEG,
    bitsPerSample: Array.from({ length: geometry.samplesPerPixel }, () => 8),
    samplesPerPixel: geometry.samplesPerPixel,
    planarConfiguration: 1,
    ...(photometric === undefined ? {} : { photometric }),
    ...(dcOnly ? { jpegDcOnly: true } : {}),
    width,
    rowBytes: width * geometry.samplesPerPixel,
    stripRows: [height],
    stripByteLengths: [jpeg.bytes.byteLength],
  }
}

// A window of a level in the pixels of the level an eighth its size, read
// from DC terms: one pixel per 8 x 8 block, a partial block included. Block
// windows start on MCU boundaries, so they divide exactly.
export function ndpiDcWindow(window: StripTileWindow): StripTileWindow {
  return {
    left: Math.floor(window.left / NDPI_DC_SCALE),
    top: Math.floor(window.top / NDPI_DC_SCALE),
    width:
      Math.ceil((window.left + window.width) / NDPI_DC_SCALE) -
      Math.floor(window.left / NDPI_DC_SCALE),
    height:
      Math.ceil((window.top + window.height) / NDPI_DC_SCALE) -
      Math.floor(window.top / NDPI_DC_SCALE),
  }
}

// Tiles cut from decoded blocks hold 8-bit samples, uncompressed.
export function ndpiTileDecodeMetadata(samplesPerPixel: number): TiffTileDecodeMetadata {
  return {
    compression: TIFF_COMPRESSION_NONE,
    bitsPerSample: Array.from({ length: samplesPerPixel }, () => 8),
    samplesPerPixel,
    planarConfiguration: 1,
  }
}

// One tile's samples, `tileWidth` by `tileHeight`, cut from the decoded
// blocks across `window` and zero outside them.
export function ndpiTileBytes(
  blocks: readonly NdpiDecodedBlock[],
  window: StripTileWindow,
  tileWidth: number,
  tileHeight: number,
  samplesPerPixel: number,
): Uint8Array {
  const tile = new Uint8Array(tileWidth * tileHeight * samplesPerPixel)

  for (const block of blocks) {
    const left = Math.max(window.left, block.window.left)
    const right = Math.min(
      window.left + window.width,
      block.window.left + block.window.width,
    )
    const top = Math.max(window.top, block.window.top)
    const bottom = Math.min(
      window.top + window.height,
      block.window.top + block.window.height,
    )
    const runBytes = (right - left) * samplesPerPixel

    for (let row = top; row < bottom; row += 1) {
      const source =
        ((row - block.window.top) * block.window.width + (left - block.window.left)) *
        samplesPerPixel
      const target =
        ((row - window.top) * tileWidth + (left - window.left)) * samplesPerPixel

      tile.set(block.bytes.subarray(source, source + runBytes), target)
    }
  }

  return tile
}

function bandRows(
  geometry: NdpiLevelGeometry,
  band: number,
): { readonly firstRow: number; readonly lastRow: number } {
  const firstRow = band * geometry.bandMcuRows

  return {
    firstRow,
    lastRow: Math.min(geometry.mcuRows, firstRow + geometry.bandMcuRows),
  }
}

// Where restart interval `index` starts; the stream's end past the last.
function intervalStart(geometry: NdpiLevelGeometry, index: number): number {
  return index < geometry.intervalStarts.length
    ? (geometry.intervalStarts[index] ?? geometry.streamLength)
    : geometry.streamLength
}

// An interval's entropy-coded data, without the restart or end-of-image
// marker that closes it, or fill bytes before that marker. Entropy-coded
// data stores 0xFF as 0xFF 0x00, so a trailing 0xFF is fill.
function entropyCodedData(segment: Uint8Array): Uint8Array {
  let end = segment.byteLength
  const last = segment[end - 1] ?? 0

  if (
    end >= 2 &&
    segment[end - 2] === 0xff &&
    ((last >= RST0 && last <= RST7) || last === EOI)
  ) {
    end -= 2
  }

  while (end > 0 && segment[end - 1] === 0xff) {
    end -= 1
  }

  return segment.subarray(0, end)
}

// An interleaved scan's MCU covers the largest sampling factors' blocks; a
// single-component scan's MCU is one block.
function readFrame(
  bytes: Uint8Array,
  position: number,
): Pick<NdpiJpegHeader, 'frameSizeOffset' | 'mcuWidth' | 'mcuHeight' | 'components'> {
  const precision = bytes[position + 4] ?? 0
  const components = bytes[position + 9] ?? 0

  if (precision !== 8) {
    throw new Error(
      `The NDPI level is a ${precision}-bit JPEG; only 8-bit levels are read.`,
    )
  }

  let maxHorizontal = 1
  let maxVertical = 1

  for (let component = 0; component < components; component += 1) {
    const sampling = bytes[position + 11 + component * 3] ?? 0x11
    maxHorizontal = Math.max(maxHorizontal, sampling >> 4)
    maxVertical = Math.max(maxVertical, sampling & 0x0f)
  }

  return {
    frameSizeOffset: position + 5,
    mcuWidth: components === 1 ? 8 : maxHorizontal * 8,
    mcuHeight: components === 1 ? 8 : maxVertical * 8,
    components,
  }
}

function isOtherFrameMarker(marker: number): boolean {
  return (
    marker >= SOF0 && marker <= 0xcf && marker !== DHT && marker !== JPG && marker !== DAC
  )
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}
