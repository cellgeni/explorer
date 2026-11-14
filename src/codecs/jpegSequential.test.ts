import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeSequentialJpeg, JpegDecodeError, jpegPrecision } from './jpegSequential'

// src/test/fixtures/jpeg12 (see make_fixtures.py there): streams encoded by
// libjpeg-turbo and Pillow, with libjpeg-turbo's decoded samples. The
// decoder's floating-point IDCT differs from libjpeg's integer one by at most
// one or two levels.
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/jpeg12', name)),
  )
}

function maxDifference(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
): { readonly max: number; readonly mean: number } {
  let max = 0
  let total = 0

  for (let index = 0; index < expected.length; index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0))
    max = Math.max(max, difference)
    total += difference
  }

  return { max, mean: total / expected.length }
}

describe('decodeSequentialJpeg', () => {
  it('decodes 12-bit extended sequential JPEG to 16-bit samples', () => {
    const image = decodeSequentialJpeg(fixture('gradient_12bit.jpg'))
    const reference = new Uint16Array(fixture('gradient_12bit.u16').slice().buffer)

    expect(image).toMatchObject({ width: 45, height: 37, components: 1, precision: 12 })
    expect(image.data).toBeInstanceOf(Uint16Array)
    const difference = maxDifference(image.data, reference)
    expect(difference.max).toBeLessThanOrEqual(2)
    expect(difference.mean).toBeLessThan(0.5)
  })

  it('reads tables from a TIFF JPEGTables stream', () => {
    const whole = decodeSequentialJpeg(fixture('gradient_12bit.jpg'))
    const split = decodeSequentialJpeg(
      fixture('gradient_12bit_image.jpg'),
      fixture('gradient_12bit_tables.jpg'),
    )

    expect(split.data).toEqual(whole.data)
    expect(() => decodeSequentialJpeg(fixture('gradient_12bit_image.jpg'))).toThrow(
      'a scan uses a table the stream does not define.',
    )
  })

  it('decodes 8-bit JPEG with restart markers', () => {
    const image = decodeSequentialJpeg(fixture('restart_8bit.jpg'))
    const reference = fixture('restart_8bit.u8')

    expect(image).toMatchObject({ width: 45, height: 37, precision: 8 })
    expect(image.data).toBeInstanceOf(Uint8Array)
    expect(maxDifference(image.data, reference).max).toBeLessThanOrEqual(2)
  })

  it('decodes a MERSCOPE .vzg pyramid tile as libjpeg does', () => {
    const reference = JSON.parse(
      new TextDecoder().decode(fixture('merscope_tile.json')),
    ) as {
      readonly width: number
      readonly height: number
      readonly sum: number
      readonly min: number
      readonly max: number
      readonly centre: readonly number[]
    }
    const image = decodeSequentialJpeg(fixture('merscope_tile.jpg'))
    const centre: number[] = []
    let sum = 0
    let min = Number.POSITIVE_INFINITY
    let max = 0

    for (const value of image.data) {
      sum += value
      min = Math.min(min, value)
      max = Math.max(max, value)
    }

    for (let y = image.height / 2 - 32; y < image.height / 2 + 32; y += 1) {
      for (let x = image.width / 2 - 32; x < image.width / 2 + 32; x += 1) {
        centre.push(image.data[y * image.width + x] ?? 0)
      }
    }

    expect([image.width, image.height, image.precision]).toEqual([384, 384, 12])
    expect(maxDifference(centre, reference.centre).max).toBeLessThanOrEqual(2)
    expect(Math.abs(sum - reference.sum) / reference.sum).toBeLessThan(0.0005)
    expect(Math.abs(min - reference.min)).toBeLessThanOrEqual(2)
    expect(Math.abs(max - reference.max)).toBeLessThanOrEqual(2)
  })

  it('reads the precision from the frame header', () => {
    expect(jpegPrecision(fixture('merscope_tile.jpg'))).toBe(12)
    expect(jpegPrecision(fixture('restart_8bit.jpg'))).toBe(8)
    expect(jpegPrecision(fixture('gradient_12bit_tables.jpg'))).toBeUndefined()
  })

  it('refuses streams it cannot decode', () => {
    const progressive = fixture('restart_8bit.jpg').slice()
    const sof = progressive.findIndex(
      (value, index) => value === 0xff && progressive[index + 1] === 0xc0,
    )
    progressive[sof + 1] = 0xc2

    expect(() => decodeSequentialJpeg(progressive)).toThrow(JpegDecodeError)
    expect(() => decodeSequentialJpeg(progressive)).toThrow('frame type 0xc2')
    expect(() => decodeSequentialJpeg(new Uint8Array([0, 1, 2]))).toThrow(
      'missing start of image',
    )
  })
})
