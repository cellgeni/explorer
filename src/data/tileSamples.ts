// Auto-contrast samples every `stride`-th pixel of a pyramid level, counting
// each tile's visible pixels row by row, tile after tile. Workers and the main
// thread share this so both pick the same pixels.

export interface TileSampling {
  // Level pixel count before this tile's first visible pixel.
  readonly startIndex: number
  readonly stride: number
  // The tile's visible size; decoded edge tiles may be padded beyond it.
  readonly width: number
  readonly height: number
}

export interface TileSamples {
  readonly samples: Float64Array
  // Visible pixels counted: the visible size cropped to the decoded tile.
  readonly pixelCount: number
}

export function sampleDecodedTile(
  pixels: ArrayLike<number>,
  decodedWidth: number,
  decodedHeight: number,
  sampling: TileSampling,
): TileSamples {
  const width = Math.max(0, Math.min(sampling.width, decodedWidth))
  const height = Math.max(0, Math.min(sampling.height, decodedHeight))
  const pixelCount = width * height
  const stride = Math.max(1, Math.floor(sampling.stride))
  const first = (stride - (sampling.startIndex % stride)) % stride
  const count = first < pixelCount ? Math.ceil((pixelCount - first) / stride) : 0
  const samples = new Float64Array(count)

  for (let sample = 0, index = first; sample < count; sample += 1, index += stride) {
    const y = Math.floor(index / width)
    samples[sample] = pixels[y * decodedWidth + (index - y * width)] ?? 0
  }

  return { samples, pixelCount }
}
