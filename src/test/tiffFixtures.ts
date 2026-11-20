import { vi } from 'vitest'

export interface TestTiffImage {
  readonly width: number
  readonly height: number
  // Tiled when set; otherwise strips of `rowsPerStrip` rows (one strip when
  // that is unset too).
  readonly tile?: number
  readonly rowsPerStrip?: number
  readonly subfileType: number
  readonly description: string
  readonly samplesPerPixel?: number
  // Every 16-bit sample of tile (or strip) N holds value(N).
  readonly value: (tileIndex: number) => number
  // Stores these bytes as tile N instead of samples from `value`; an empty
  // array writes a zero-length tile. Separated sample planes store every
  // tile of plane 0, then of plane 1, and so on.
  readonly tileBytes?: (tileIndex: number) => readonly number[]
  readonly planarConfiguration?: number
  readonly predictor?: number
  // Null leaves the Compression tag out, which TIFF reads as 1 (none).
  readonly compression?: number | null
  readonly photometric?: number
  readonly bitsPerSample?: number
  readonly jpegTables?: readonly number[]
  // More tags, such as a format's private ones, replacing any written
  // above: SHORT, LONG, SLONG, or FLOAT values.
  readonly extraTags?: readonly TestTiffTag[]
}

export type TestTiffTag = readonly [tag: number, type: number, values: readonly number[]]

export interface TestTiffFile {
  readonly bytes: Uint8Array
  readonly ifdOffsets: readonly number[]
}

const SHORT = 3
const LONG = 4
const RATIONAL = 5
const ASCII = 2
const UNDEFINED = 7
export const TIFF_SHORT = SHORT
export const TIFF_LONG = LONG
export const TIFF_SLONG = 9
export const TIFF_FLOAT = 11

// A little-endian classic TIFF with uncompressed 16-bit samples unless an
// image says otherwise, written as pixel data, then tag data, then the IFD,
// for each image in turn.
export function buildTiff(images: readonly TestTiffImage[]): Uint8Array {
  return buildTiffFile(images).bytes
}

export function buildTiffFile(images: readonly TestTiffImage[]): TestTiffFile {
  const bytes: number[] = [0x49, 0x49, 42, 0, 0, 0, 0, 0]
  const ifdOffsets: number[] = []
  let nextIfdPointer = 4

  const append = (data: readonly number[]): number => {
    if (bytes.length % 2 === 1) {
      bytes.push(0)
    }

    const offset = bytes.length

    for (const byte of data) {
      bytes.push(byte)
    }

    return offset
  }

  for (const image of images) {
    const samplesPerPixel = image.samplesPerPixel ?? 1
    const bitsPerSample = image.bitsPerSample ?? 16
    const tileWidth = image.tile ?? image.width
    const tileHeight = image.tile ?? image.rowsPerStrip ?? image.height
    const tileCount =
      Math.ceil(image.width / tileWidth) *
      Math.ceil(image.height / tileHeight) *
      (image.planarConfiguration === 2 ? samplesPerPixel : 1)
    const offsets: number[] = []
    const byteCounts: number[] = []

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const sample = u16(image.value(tileIndex))
      const data =
        image.tileBytes?.(tileIndex) ??
        Array.from(
          { length: tileWidth * tileHeight * samplesPerPixel },
          () => sample,
        ).flat()

      offsets.push(data.length === 0 ? 0 : append(data))
      byteCounts.push(data.length)
    }

    type Entry = readonly [number, number, readonly number[] | string]
    const layoutEntries: readonly Entry[] =
      image.tile === undefined
        ? [
            [273, LONG, offsets],
            [278, LONG, [tileHeight]],
            [279, LONG, byteCounts],
          ]
        : [
            [322, LONG, [tileWidth]],
            [323, LONG, [tileHeight]],
            [324, LONG, offsets],
            [325, LONG, byteCounts],
          ]
    const extraTags = image.extraTags ?? []
    const baseEntries: readonly Entry[] = [
      [254, LONG, [image.subfileType]],
      [256, LONG, [image.width]],
      [257, LONG, [image.height]],
      [258, SHORT, Array.from({ length: samplesPerPixel }, () => bitsPerSample)],
      ...(image.compression === null
        ? []
        : [[259, SHORT, [image.compression ?? 1]] as const]),
      [262, SHORT, [image.photometric ?? (samplesPerPixel >= 3 ? 2 : 1)]],
      [270, ASCII, image.description],
      [277, SHORT, [samplesPerPixel]],
      [282, RATIONAL, [20_000, 1]],
      [284, SHORT, [image.planarConfiguration ?? 1]],
      [296, SHORT, [3]],
      ...(image.predictor === undefined
        ? []
        : [[317, SHORT, [image.predictor]] as const]),
      ...(image.jpegTables === undefined
        ? []
        : [[347, UNDEFINED, image.jpegTables] as const]),
      ...layoutEntries,
    ]
    const entries: Entry[] = [
      ...baseEntries.filter(([tag]) => !extraTags.some(([extraTag]) => extraTag === tag)),
      ...extraTags,
    ]
    entries.sort((left, right) => left[0] - right[0])

    const encoded = entries.map(([tag, type, values]) => {
      const data =
        typeof values === 'string'
          ? [...new TextEncoder().encode(values), 0]
          : type === UNDEFINED
            ? [...values]
            : values.flatMap((value) =>
                type === SHORT
                  ? u16(value)
                  : type === TIFF_FLOAT
                    ? f32(value)
                    : u32(value),
              )
      const count =
        typeof values === 'string'
          ? data.length
          : type === RATIONAL
            ? values.length / 2
            : values.length

      return {
        tag,
        type,
        count,
        value: data.length <= 4 ? [...data, 0, 0, 0, 0].slice(0, 4) : u32(append(data)),
      }
    })
    const ifdOffset = append([
      ...u16(encoded.length),
      ...encoded.flatMap(({ tag, type, count, value }) => [
        ...u16(tag),
        ...u16(type),
        ...u32(count),
        ...value,
      ]),
      ...u32(0),
    ])

    u32(ifdOffset).forEach((byte, index) => {
      bytes[nextIfdPointer + index] = byte
    })
    ifdOffsets.push(ifdOffset)
    nextIfdPointer = ifdOffset + 2 + encoded.length * 12
  }

  return { bytes: Uint8Array.from(bytes), ifdOffsets }
}

export function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

export function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

function f32(value: number): number[] {
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, value, true)
  return [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)]
}

// Serves `file` at `url` with 206 Range responses, as object storage does.
export function stubRangeFetch(url: string, file: Uint8Array) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = input instanceof Request ? input.url : String(input)

    if (requestUrl !== url) {
      return new Response(null, { status: 404 })
    }

    const range = new Headers(init?.headers).get('Range')
    const match = range?.match(/^bytes=(\d+)-(\d+)$/)

    if (match === null || match === undefined) {
      return new Response(file.slice(), { status: 200 })
    }

    const start = Number(match[1])
    const end = Math.min(Number(match[2]), file.byteLength - 1)

    if (start >= file.byteLength) {
      return new Response(null, { status: 416 })
    }

    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${file.byteLength}`,
      },
    })
  })

  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
