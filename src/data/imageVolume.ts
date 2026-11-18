import type {
  ImagePyramidPixelArray,
  ImagePyramidVolume,
  ImagePyramidVolumeLevel,
} from './imagePyramid'

// Voxels the 3D view uploads, summed over its channels: 64 MB of 8-bit or
// 128 MB of 16-bit textures.
export const VOLUME_VOXEL_BUDGET = 64 * 1024 * 1024
// The 3D texture size desktop GPUs take; WebGL2 only promises 256.
export const DEFAULT_MAX_3D_TEXTURE_SIZE = 2048
// Channels the 3D view draws at once, one texture each.
export const MAX_VOLUME_CHANNELS = 6

// The finest level whose channels fit the voxel budget and the GPU's 3D
// texture size, or null when even the coarsest does not.
export function chooseVolumeLevel(
  levels: readonly ImagePyramidVolumeLevel[],
  options: {
    readonly channelCount: number
    readonly voxelBudget?: number
    readonly maxTextureSize?: number
  },
): ImagePyramidVolumeLevel | null {
  const voxelBudget = options.voxelBudget ?? VOLUME_VOXEL_BUDGET
  const maxTextureSize = options.maxTextureSize ?? DEFAULT_MAX_3D_TEXTURE_SIZE
  const channelCount = Math.max(1, options.channelCount)
  const finestFirst = [...levels].sort(
    (left, right) => volumeVoxels(right) - volumeVoxels(left),
  )

  return (
    finestFirst.find(
      (level) =>
        level.width <= maxTextureSize &&
        level.height <= maxTextureSize &&
        level.depth <= maxTextureSize &&
        volumeVoxels(level) * channelCount <= voxelBudget,
    ) ?? null
  )
}

export function volumeVoxels(
  level: Pick<ImagePyramidVolumeLevel, 'width' | 'height' | 'depth'>,
): number {
  return level.width * level.height * level.depth
}

// The volume's extent in the image's units, x by y by z. A plane is as thick
// as a voxel is wide when the image does not give its spacing, and
// `depthScale` stretches z.
export function volumeExtent(
  level: Pick<ImagePyramidVolumeLevel, 'width' | 'height' | 'depth' | 'voxelSize'>,
  depthScale = 1,
): readonly [number, number, number] {
  const { x, y } = level.voxelSize
  const z = level.voxelSize.z ?? x

  return [level.width * x, level.height * y, level.depth * z * depthScale]
}

// A volume as 3D texture data. 8-bit images upload as they are; others as
// half floats of each value divided by `scale`, the largest magnitude in the
// volume, which keeps every dtype in half-float range.
export interface VolumeTextureData {
  readonly data: Uint8Array | Uint16Array
  readonly format: 'r8unorm' | 'r16float'
  readonly width: number
  readonly height: number
  readonly depth: number
  // A raw value v samples as v / scale.
  readonly scale: number
}

export function volumeTextureData(volume: ImagePyramidVolume): VolumeTextureData {
  const { data, width, height, depth } = volume

  if (data instanceof Uint8Array) {
    return { data, format: 'r8unorm', width, height, depth, scale: 255 }
  }

  const scale = largestMagnitude(data) || 1

  return {
    data: halfFloats(data, scale),
    format: 'r16float',
    width,
    height,
    depth,
    scale,
  }
}

function largestMagnitude(data: ImagePyramidPixelArray): number {
  let largest = 0

  for (let index = 0; index < data.length; index += 1) {
    const value = Math.abs(data[index] ?? 0)

    if (value > largest && Number.isFinite(value)) {
      largest = value
    }
  }

  return largest
}

function halfFloats(data: ImagePyramidPixelArray, scale: number): Uint16Array {
  const result = new Uint16Array(data.length)

  // 16-bit and smaller integers convert through a table of every value.
  if (
    data instanceof Uint16Array ||
    data instanceof Int16Array ||
    data instanceof Int8Array
  ) {
    const offset =
      data instanceof Uint16Array ? 0 : data instanceof Int16Array ? 32768 : 128
    const size = data instanceof Int8Array ? 256 : 65536
    const table = new Uint16Array(size)

    for (let index = 0; index < size; index += 1) {
      table[index] = float16Bits((index - offset) / scale)
    }

    for (let index = 0; index < data.length; index += 1) {
      result[index] = table[(data[index] ?? 0) + offset] ?? 0
    }

    return result
  }

  for (let index = 0; index < data.length; index += 1) {
    result[index] = float16Bits((data[index] ?? 0) / scale)
  }

  return result
}

const float32Scratch = new Float32Array(1)
const float32BitsScratch = new Uint32Array(float32Scratch.buffer)

// The IEEE half-float bits nearest to `value`.
export function float16Bits(value: number): number {
  float32Scratch[0] = value
  const bits = float32BitsScratch[0] ?? 0
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff

  if (exponent >= 31) {
    // Too large for a half float, infinity, or NaN.
    const isNaN = ((bits >>> 23) & 0xff) === 0xff && mantissa !== 0
    return sign | 0x7c00 | (isNaN ? 0x200 : 0)
  }

  if (exponent <= 0) {
    if (exponent < -10) {
      return sign
    }

    // A subnormal half float.
    const fullMantissa = mantissa | 0x800000
    const shift = 14 - exponent
    return sign | ((fullMantissa + (1 << (shift - 1))) >>> shift)
  }

  // Rounding may carry into the exponent, which is still the nearest value.
  return (sign | (exponent << 10) | (mantissa >>> 13)) + ((mantissa >>> 12) & 1)
}
