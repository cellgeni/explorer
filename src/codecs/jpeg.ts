// JPEG-compressed TIFF tiles (Compression 7). A tile is a JPEG stream that
// may leave its quantization and Huffman tables to the IFD's JPEGTables, and
// whose three components are RGB or YCbCr depending on the TIFF, not only on
// the stream: Aperio SVS stores RGB components with component IDs 0, 1, 2 and
// no JFIF or Adobe marker, which JPEG decoders take for YCbCr.

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const APP0 = 0xe0
const APP14 = 0xee
const TIFF_PHOTOMETRIC_RGB = 2
const TIFF_PHOTOMETRIC_YCBCR = 6

export type JpegColorSpace = 'rgb' | 'ycbcr'

export interface JpegTileStream {
  readonly bytes: Uint8Array
  readonly tables?: Uint8Array
  readonly photometric?: number
}

interface JpegMarkers {
  readonly jfif: boolean
  readonly adobeTransform?: number
  readonly componentIds?: readonly number[]
}

// The colour space of a three-component tile, or undefined for another
// component count. An Adobe marker or JFIF marker decides; otherwise the TIFF
// Photometric tag does, as tifffile reads Aperio SVS; otherwise the
// component IDs, as libjpeg guesses.
export function jpegTileColorSpace(tile: JpegTileStream): JpegColorSpace | undefined {
  const markers = mergeMarkers(
    tile.tables === undefined ? undefined : scanJpegMarkers(tile.tables),
    scanJpegMarkers(tile.bytes),
  )

  if (markers.componentIds?.length !== 3) {
    return undefined
  }

  if (markers.adobeTransform !== undefined) {
    return markers.adobeTransform === 0 ? 'rgb' : 'ycbcr'
  }

  if (markers.jfif || tile.photometric === TIFF_PHOTOMETRIC_YCBCR) {
    return 'ycbcr'
  }

  if (tile.photometric === TIFF_PHOTOMETRIC_RGB) {
    return 'rgb'
  }

  return libjpegColorSpace(markers)
}

// A self-contained JPEG for a browser decoder: the IFD's tables are merged
// into the tile, and an Adobe marker is added when the browser would read
// the components in the wrong colour space. Undefined for a stream whose
// components are not three.
export function standaloneJpegTile(tile: JpegTileStream): Uint8Array | undefined {
  const colorSpace = jpegTileColorSpace(tile)

  if (colorSpace === undefined) {
    return undefined
  }

  const tablesBody =
    tile.tables === undefined ? new Uint8Array(0) : jpegBody(tile.tables, true)
  const tileBody = jpegBody(tile.bytes, false)
  const markers = mergeMarkers(
    tile.tables === undefined ? undefined : scanJpegMarkers(tile.tables),
    scanJpegMarkers(tile.bytes),
  )
  const adobe =
    libjpegColorSpace(markers) === colorSpace
      ? new Uint8Array(0)
      : adobeMarker(colorSpace === 'rgb' ? 0 : 1)
  const stream = new Uint8Array(2 + adobe.length + tablesBody.length + tileBody.length)

  stream.set([0xff, SOI], 0)
  stream.set(adobe, 2)
  stream.set(tablesBody, 2 + adobe.length)
  stream.set(tileBody, 2 + adobe.length + tablesBody.length)

  return stream
}

// Decodes a three-component tile with the browser's JPEG decoder, which is
// several times faster than decoding in JavaScript and yields the bitmap the
// renderer draws. Undefined when the browser cannot decode it here.
export async function decodeJpegTileBitmap(
  tile: JpegTileStream,
): Promise<ImageBitmap | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof Blob !== 'function') {
    return undefined
  }

  const stream = standaloneJpegTile(tile)

  if (stream === undefined) {
    return undefined
  }

  try {
    return await createImageBitmap(
      new Blob([stream as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
      { colorSpaceConversion: 'none', premultiplyAlpha: 'none' },
    )
  } catch {
    return undefined
  }
}

// JFIF YCbCr to RGB, in place, for interleaved 8-bit samples.
export function convertYCbCrToRgb(samples: Uint8Array): void {
  for (let offset = 0; offset + 2 < samples.length; offset += 3) {
    const y = samples[offset] ?? 0
    const cb = (samples[offset + 1] ?? 128) - 128
    const cr = (samples[offset + 2] ?? 128) - 128

    samples[offset] = clampByte(y + 1.402 * cr)
    samples[offset + 1] = clampByte(y - 0.344_136 * cb - 0.714_136 * cr)
    samples[offset + 2] = clampByte(y + 1.772 * cb)
  }
}

// libjpeg's guess without markers: IDs 'R', 'G', 'B' are RGB, anything else
// is YCbCr. Browsers decode with libjpeg's rules.
function libjpegColorSpace(markers: JpegMarkers): JpegColorSpace {
  if (markers.adobeTransform !== undefined) {
    return markers.adobeTransform === 0 ? 'rgb' : 'ycbcr'
  }

  const [first, second, third] = markers.componentIds ?? []

  return !markers.jfif && first === 0x52 && second === 0x47 && third === 0x42
    ? 'rgb'
    : 'ycbcr'
}

function mergeMarkers(tables: JpegMarkers | undefined, tile: JpegMarkers): JpegMarkers {
  const adobeTransform = tile.adobeTransform ?? tables?.adobeTransform
  const componentIds = tile.componentIds ?? tables?.componentIds

  return {
    jfif: tile.jfif || tables?.jfif === true,
    ...(adobeTransform === undefined ? {} : { adobeTransform }),
    ...(componentIds === undefined ? {} : { componentIds }),
  }
}

// Reads the marker segments before the scan data.
function scanJpegMarkers(bytes: Uint8Array): JpegMarkers {
  let jfif = false
  let adobeTransform: number | undefined
  let componentIds: number[] | undefined
  let offset = 0

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break
    }

    const marker = bytes[offset + 1] ?? 0

    if (marker === 0xff) {
      offset += 1
      continue
    }

    if (marker === SOI || marker === EOI || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    if (marker === SOS || offset + 3 >= bytes.length) {
      break
    }

    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    const segment = bytes.subarray(offset + 4, offset + 2 + length)

    if (marker === APP0 && asciiAt(segment, 0, 5) === 'JFIF\0') {
      jfif = true
    } else if (marker === APP14 && asciiAt(segment, 0, 5) === 'Adobe') {
      adobeTransform = segment[11]
    } else if (isStartOfFrame(marker)) {
      const count = segment[5] ?? 0
      componentIds = Array.from(
        { length: count },
        (_unused, index) => segment[6 + index * 3] ?? 0,
      )
    }

    offset += 2 + length
  }

  return {
    jfif,
    ...(adobeTransform === undefined ? {} : { adobeTransform }),
    ...(componentIds === undefined ? {} : { componentIds }),
  }
}

// SOF0–SOF15 except DHT (C4), JPG (C8), and DAC (CC).
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  )
}

// The stream without its leading SOI and, for tables, the trailing EOI.
function jpegBody(bytes: Uint8Array, dropEoi: boolean): Uint8Array {
  const start = bytes[0] === 0xff && bytes[1] === SOI ? 2 : 0
  const end =
    dropEoi && bytes.length >= 2 && bytes.at(-2) === 0xff && bytes.at(-1) === EOI
      ? bytes.length - 2
      : bytes.length

  return bytes.subarray(start, Math.max(start, end))
}

// APP14 "Adobe", version 100, no flags, and the colour transform: 0 for
// RGB (or CMYK), 1 for YCbCr.
function adobeMarker(transform: 0 | 1): Uint8Array {
  return Uint8Array.from([
    0xff,
    APP14,
    0x00,
    0x0e,
    0x41,
    0x64,
    0x6f,
    0x62,
    0x65,
    0x00,
    0x64,
    0x00,
    0x00,
    0x00,
    0x00,
    transform,
  ])
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value)
}
