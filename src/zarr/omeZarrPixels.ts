import type { ImagePyramidPixelArray } from '../data/imagePyramid'

// Pixel helpers shared by the OME-Zarr loader and the Zarr decode worker.

export function newPixelArray(
  source: ImagePyramidPixelArray,
  length: number,
): ImagePyramidPixelArray {
  if (source instanceof Uint8Array) return new Uint8Array(length)
  if (source instanceof Uint16Array) return new Uint16Array(length)
  if (source instanceof Int8Array) return new Int8Array(length)
  if (source instanceof Int16Array) return new Int16Array(length)
  if (source instanceof Int32Array) return new Int32Array(length)
  if (source instanceof Uint32Array) return new Uint32Array(length)
  if (source instanceof Float32Array) return new Float32Array(length)
  return new Float64Array(length)
}

export function numericPixelsToRgba(
  pixels: ImagePyramidPixelArray,
  width: number,
  height: number,
  options: {
    readonly displayWindow?: { readonly lo: number; readonly hi: number }
    readonly color?: readonly [number, number, number]
    readonly alphaFromIntensity?: boolean
  },
): { readonly rgba: Uint8ClampedArray; readonly lo: number; readonly hi: number } {
  const window = options.displayWindow ?? percentileWindow(pixels)
  const range = Math.max(1e-12, window.hi - window.lo)
  const rgba = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < pixels.length; index += 1) {
    const pixel = pixels[index] ?? 0
    const value = clampByte(Math.round(((pixel - window.lo) / range) * 255))
    const offset = index * 4

    if (options.color === undefined) {
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
      rgba[offset + 3] = 255
      continue
    }

    rgba[offset] = Math.round((options.color[0] * value) / 255)
    rgba[offset + 1] = Math.round((options.color[1] * value) / 255)
    rgba[offset + 2] = Math.round((options.color[2] * value) / 255)
    rgba[offset + 3] = options.alphaFromIntensity === true ? value : 255
  }

  return {
    rgba,
    lo: window.lo,
    hi: window.hi,
  }
}

function percentileWindow(pixels: ImagePyramidPixelArray): {
  readonly lo: number
  readonly hi: number
} {
  if (pixels.length === 0) {
    return { lo: 0, hi: 1 }
  }

  const step = Math.max(1, Math.floor(pixels.length / 10_000))
  const sample: number[] = []

  for (let index = 0; index < pixels.length; index += step) {
    sample.push(pixels[index] ?? 0)
  }

  sample.sort((a, b) => a - b)

  const lo = sample[Math.floor(sample.length * 0.02)] ?? 0
  const hi = sample[Math.floor(sample.length * 0.98)] ?? lo + 1

  return { lo, hi: hi === lo ? lo + 1 : hi }
}

export function isSupportedPixelArray(value: unknown): value is ImagePyramidPixelArray {
  return (
    value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Int8Array ||
    value instanceof Int16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  )
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value))
}
