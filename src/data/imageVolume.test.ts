import { describe, expect, it } from 'vitest'
import type { ImagePyramidVolumeLevel } from './imagePyramid'
import {
  chooseVolumeLevel,
  float16Bits,
  volumeExtent,
  volumeTextureData,
} from './imageVolume'

function level(
  index: number,
  width: number,
  height: number,
  depth: number,
): ImagePyramidVolumeLevel {
  return {
    level: index,
    width,
    height,
    depth,
    voxelSize: { x: 2 ** index, y: 2 ** index },
  }
}

// A bioformats2raw z-stack: 41 planes, x and y halved at each level.
const STACK_LEVELS = [
  level(0, 8781, 2253, 41),
  level(1, 4391, 1127, 41),
  level(2, 2196, 564, 41),
  level(3, 1098, 282, 41),
]

describe('chooseVolumeLevel', () => {
  it('picks the finest level within the texture size and voxel budget', () => {
    expect(chooseVolumeLevel(STACK_LEVELS, { channelCount: 1 })?.level).toBe(3)
    expect(
      chooseVolumeLevel(STACK_LEVELS, { channelCount: 1, maxTextureSize: 4096 })?.level,
    ).toBe(2)
    // More channels share the budget.
    expect(
      chooseVolumeLevel(STACK_LEVELS, {
        channelCount: 2,
        maxTextureSize: 4096,
        voxelBudget: 64_000_000,
      })?.level,
    ).toBe(3)
  })

  it('reads a small volume at full resolution', () => {
    expect(
      chooseVolumeLevel([level(0, 256, 256, 128), level(1, 128, 128, 128)], {
        channelCount: 3,
      })?.level,
    ).toBe(0)
  })

  it('returns null when no level fits', () => {
    expect(chooseVolumeLevel([level(0, 4096, 4096, 10)], { channelCount: 1 })).toBeNull()
  })
})

describe('volumeExtent', () => {
  it('uses the plane spacing and stretches depth', () => {
    expect(
      volumeExtent({
        width: 10,
        height: 20,
        depth: 5,
        voxelSize: { x: 0.5, y: 0.5, z: 2 },
      }),
    ).toEqual([5, 10, 10])
    expect(
      volumeExtent(
        { width: 10, height: 20, depth: 5, voxelSize: { x: 0.5, y: 0.5, z: 2 } },
        3,
      ),
    ).toEqual([5, 10, 30])
  })

  it('makes planes as thick as a voxel is wide when the spacing is unknown', () => {
    expect(
      volumeExtent({ width: 10, height: 20, depth: 5, voxelSize: { x: 4, y: 4 } }),
    ).toEqual([40, 80, 20])
  })
})

describe('volumeTextureData', () => {
  it('uploads 8-bit volumes as they are', () => {
    const data = new Uint8Array([0, 128, 255, 7])
    const texture = volumeTextureData({ data, width: 2, height: 2, depth: 1 })

    expect(texture).toMatchObject({ format: 'r8unorm', scale: 255 })
    expect(texture.data).toBe(data)
  })

  it('scales 16-bit volumes into half floats by their largest value', () => {
    const texture = volumeTextureData({
      data: new Uint16Array([0, 1000, 4000, 2000]),
      width: 4,
      height: 1,
      depth: 1,
    })

    expect(texture).toMatchObject({ format: 'r16float', scale: 4000 })
    expect(Array.from(texture.data)).toEqual([0, 0.25, 1, 0.5].map(float16Bits))
  })

  it('keeps the sign of signed and float volumes', () => {
    expect(
      Array.from(
        volumeTextureData({
          data: new Int16Array([-200, 100]),
          width: 2,
          height: 1,
          depth: 1,
        }).data,
      ),
    ).toEqual([-1, 0.5].map(float16Bits))
    expect(
      volumeTextureData({
        data: new Float32Array([0.5, -0.25]),
        width: 2,
        height: 1,
        depth: 1,
      }),
    ).toMatchObject({ scale: 0.5 })
  })
})

describe('float16Bits', () => {
  it('encodes normal, subnormal and out-of-range values', () => {
    expect(float16Bits(0)).toBe(0x0000)
    expect(float16Bits(-0)).toBe(0x8000)
    expect(float16Bits(1)).toBe(0x3c00)
    expect(float16Bits(-2)).toBe(0xc000)
    expect(float16Bits(0.5)).toBe(0x3800)
    expect(float16Bits(65504)).toBe(0x7bff)
    expect(float16Bits(1e6)).toBe(0x7c00)
    expect(float16Bits(Number.NaN) & 0x7e00).toBe(0x7e00)
    // The smallest subnormal half float, and values that round to zero.
    expect(float16Bits(2 ** -24)).toBe(0x0001)
    expect(float16Bits(2 ** -26)).toBe(0x0000)
    // 1 + 2^-11 is halfway between 1 and the next half float; it rounds up.
    expect(float16Bits(1 + 2 ** -11)).toBe(0x3c01)
    expect(float16Bits(1 + 2 ** -12)).toBe(0x3c00)
  })
})
