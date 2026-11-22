import { decodeTiffChunkSamples, type TiffTileDecodeMetadata } from '../codecs/tiffTile'
import { traceLabelEdges, type PackedLabelTrace } from '../datasets/spatialDataLabelTrace'

// Decodes one tile of a TIFF label image (a segmentation mask such as
// Cellpose writes) and traces its labels, in the tile decode workers or on the
// main thread. The tile is `tileWidth` by `tileHeight` samples; `width` and
// `height` are the part of it inside the level, at `levelX0`, `levelY0`.
export interface TiffLabelTraceOptions extends TiffTileDecodeMetadata {
  readonly width: number
  readonly height: number
  readonly levelX0: number
  readonly levelY0: number
  readonly levelWidth: number
}

const SAMPLE_FORMAT_SIGNED = 2
const SAMPLE_FORMAT_FLOAT = 3

export async function traceTiffLabelTile(
  bytes: Uint8Array,
  options: TiffLabelTraceOptions,
): Promise<PackedLabelTrace> {
  const labels =
    // A tile the file leaves out is background.
    bytes.byteLength === 0
      ? new Float64Array(options.width * options.height)
      : tiffLabelWindow(await decodeTiffChunkSamples(bytes, options), options)

  return traceLabelEdges(
    labels,
    options.width,
    options.height,
    options.levelX0,
    options.levelY0,
    options.levelWidth,
  )
}

// The tile's `width` by `height` window of label values. Unsigned 8-, 16- and
// 32-bit samples, signed ones and float labels are read, each as its value.
export function tiffLabelWindow(
  buffer: ArrayBufferLike,
  options: TiffLabelTraceOptions,
): Float64Array {
  const bits = options.bitsPerSample?.[0] ?? 8
  const samplesPerPixel = options.samplesPerPixel ?? options.bitsPerSample?.length ?? 1
  const sampleFormat = options.sampleFormat ?? 1
  const tileWidth = options.tileWidth ?? options.width
  const littleEndian = options.littleEndian ?? true

  if (samplesPerPixel !== 1) {
    throw new Error(
      `A label image has one sample per pixel; this TIFF has ${samplesPerPixel.toString()}.`,
    )
  }

  if (bits !== 8 && bits !== 16 && bits !== 32) {
    throw new Error(
      `Label TIFF samples are ${bits.toString()}-bit; 8-, 16- and 32-bit labels are read.`,
    )
  }

  if (sampleFormat === SAMPLE_FORMAT_FLOAT && bits !== 32) {
    throw new Error(`Label TIFF has ${bits.toString()}-bit float samples.`)
  }

  const bytesPerSample = bits / 8
  const view = new DataView(buffer)
  const output = new Float64Array(options.width * options.height)
  const rowBytes = tileWidth * bytesPerSample

  if (
    view.byteLength <
    (options.height - 1) * rowBytes + options.width * bytesPerSample
  ) {
    throw new Error('Label TIFF tile decoded shorter than its size.')
  }

  // Little-endian integers, as tifffile and Cellpose write them on x86, are
  // copied through a typed view of the samples.
  if (littleEndian && sampleFormat !== SAMPLE_FORMAT_FLOAT) {
    const samples =
      bits === 8
        ? sampleFormat === SAMPLE_FORMAT_SIGNED
          ? new Int8Array(buffer)
          : new Uint8Array(buffer)
        : bits === 16
          ? sampleFormat === SAMPLE_FORMAT_SIGNED
            ? new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2))
            : new Uint16Array(buffer, 0, Math.floor(buffer.byteLength / 2))
          : sampleFormat === SAMPLE_FORMAT_SIGNED
            ? new Int32Array(buffer, 0, Math.floor(buffer.byteLength / 4))
            : new Uint32Array(buffer, 0, Math.floor(buffer.byteLength / 4))

    for (let y = 0; y < options.height; y += 1) {
      output.set(
        samples.subarray(y * tileWidth, y * tileWidth + options.width),
        y * options.width,
      )
    }

    return output
  }

  const read =
    bits === 8
      ? sampleFormat === SAMPLE_FORMAT_SIGNED
        ? (offset: number) => view.getInt8(offset)
        : (offset: number) => view.getUint8(offset)
      : bits === 16
        ? sampleFormat === SAMPLE_FORMAT_SIGNED
          ? (offset: number) => view.getInt16(offset, littleEndian)
          : (offset: number) => view.getUint16(offset, littleEndian)
        : sampleFormat === SAMPLE_FORMAT_FLOAT
          ? (offset: number) => Math.round(view.getFloat32(offset, littleEndian))
          : sampleFormat === SAMPLE_FORMAT_SIGNED
            ? (offset: number) => view.getInt32(offset, littleEndian)
            : (offset: number) => view.getUint32(offset, littleEndian)

  for (let y = 0; y < options.height; y += 1) {
    const rowOffset = y * rowBytes
    const outputOffset = y * options.width

    for (let x = 0; x < options.width; x += 1) {
      output[outputOffset + x] = read(rowOffset + x * bytesPerSample)
    }
  }

  return output
}
