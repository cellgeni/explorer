import { decodeTiffChunkSamples, type TiffTileDecodeMetadata } from './tiffTile'

// Compressed strips stored back to back, and how to decode them. For
// separated sample planes the strips are of one sample each, plane after
// plane, and the decode tags describe one sample.
export interface TiffStripBandDecodeOptions extends TiffTileDecodeMetadata {
  readonly width: number
  readonly rowBytes: number
  // Each strip's rows and stored byte length, in the order the bytes hold
  // them.
  readonly stripRows: readonly number[]
  readonly stripByteLengths: readonly number[]
}

// The strips' rows one after another, as sample bytes in the file's byte
// order. A strip the file leaves out (zero bytes), or one that decodes short,
// leaves its rows zero.
export async function decodeTiffStripBand(
  bytes: Uint8Array,
  options: TiffStripBandDecodeOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  if (options.stripRows.length !== options.stripByteLengths.length) {
    throw new Error(
      `TIFF strip band lists ${options.stripRows.length} strip heights for ${options.stripByteLengths.length} strips.`,
    )
  }

  const totalRows = options.stripRows.reduce((sum, rows) => sum + rows, 0)
  const band = new Uint8Array(totalRows * options.rowBytes)
  let byteOffset = 0
  let rowOffset = 0

  for (const [index, rows] of options.stripRows.entries()) {
    const length = options.stripByteLengths[index] ?? 0

    if (length > 0 && byteOffset + length <= bytes.byteLength) {
      const decoded = await decodeTiffChunkSamples(
        bytes.subarray(byteOffset, byteOffset + length),
        { ...options, tileWidth: options.width, tileHeight: rows },
      )
      const stripByteLength = Math.min(decoded.byteLength, rows * options.rowBytes)

      band.set(new Uint8Array(decoded, 0, stripByteLength), rowOffset * options.rowBytes)
    }

    byteOffset += length
    rowOffset += rows
  }

  return band
}
