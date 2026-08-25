import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJpeg2000, normaliseToRgba } from './jpeg2000'

const openJpegMock = vi.hoisted(() => ({
  decodedBuffer: new Uint8Array(),
  deleted: 0,
  encodedBytes: [] as number[],
  frameInfo: {
    width: 1,
    height: 1,
    componentCount: 1,
  },
}))

vi.mock('@cornerstonejs/codec-openjpeg', () => ({
  default: vi.fn(async () => ({
    J2KDecoder: class {
      private encoded = new Uint8Array()

      getEncodedBuffer(length: number): Uint8Array {
        this.encoded = new Uint8Array(length)
        return this.encoded
      }

      decode(): void {}

      getFrameInfo(): typeof openJpegMock.frameInfo {
        return openJpegMock.frameInfo
      }

      getDecodedBuffer(): Uint8Array {
        return openJpegMock.decodedBuffer
      }

      delete(): void {
        openJpegMock.deleted += 1
        openJpegMock.encodedBytes = [...this.encoded]
      }
    },
  })),
}))

describe('JPEG-2000 decoding', () => {
  beforeEach(() => {
    openJpegMock.decodedBuffer = new Uint8Array()
    openJpegMock.deleted = 0
    openJpegMock.encodedBytes = []
    openJpegMock.frameInfo = { width: 1, height: 1, componentCount: 1 }
  })

  it('reports single-sample decoded buffers', async () => {
    openJpegMock.frameInfo = { width: 2, height: 1, componentCount: 1 }
    openJpegMock.decodedBuffer = new Uint8Array([10, 20])

    await expect(decodeJpeg2000(new Uint8Array([1, 2, 3]))).resolves.toMatchObject({
      height: 1,
      pixels: new Uint8Array([10, 20]),
      samplesPerPixel: 1,
      width: 2,
    })
    expect(openJpegMock.encodedBytes).toEqual([1, 2, 3])
    expect(openJpegMock.deleted).toBe(1)
  })

  it('reports multi-sample decoded buffers using the codec component count', async () => {
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 0x0102, true)
    view.setUint16(2, 0x0304, true)
    view.setUint16(4, 0x0506, true)
    view.setUint16(6, 0x0708, true)
    view.setUint16(8, 0x090a, true)
    view.setUint16(10, 0x0b0c, true)

    openJpegMock.frameInfo = { width: 2, height: 1, componentCount: 3 }
    openJpegMock.decodedBuffer = bytes

    const decoded = await decodeJpeg2000(new Uint8Array([4, 5, 6]))

    expect(decoded).toMatchObject({
      height: 1,
      samplesPerPixel: 3,
      width: 2,
    })
    expect(decoded.pixels).toBeInstanceOf(Uint16Array)
    expect([...decoded.pixels]).toEqual([
      0x0102, 0x0304, 0x0506, 0x0708, 0x090a, 0x0b0c,
    ])
  })
})

describe('JPEG-2000 windowing', () => {
  it('normalises grayscale pixels to opaque RGBA with a supplied window', () => {
    const result = normaliseToRgba(new Uint16Array([0, 50, 100]), 3, 1, {
      lo: 0,
      hi: 100,
    })

    expect([...result.rgba]).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ])
    expect(result.lo).toBe(0)
    expect(result.hi).toBe(100)
  })

  it('auto-calibrates a non-degenerate percentile window', () => {
    const result = normaliseToRgba(new Uint16Array([7, 7, 7]), 3, 1)

    expect(result.lo).toBe(7)
    expect(result.hi).toBe(8)
  })

  it('tints grayscale pixels by intensity instead of filling the whole tile', () => {
    const result = normaliseToRgba(
      new Uint16Array([0, 50, 100]),
      3,
      1,
      {
        lo: 0,
        hi: 100,
      },
      {
        color: [80, 160, 240],
        alphaFromIntensity: true,
      },
    )

    expect([...result.rgba]).toEqual([0, 0, 0, 0, 40, 80, 120, 128, 80, 160, 240, 255])
  })

  it('copies RGB samples directly and ignores grayscale tint options', () => {
    const result = normaliseToRgba(
      new Uint8Array([255, 0, 0, 0, 128, 255]),
      2,
      1,
      {
        lo: 0,
        hi: 1,
      },
      {
        alphaFromIntensity: true,
        color: [80, 160, 240],
        samplesPerPixel: 3,
      },
    )

    expect([...result.rgba]).toEqual([255, 0, 0, 255, 0, 128, 255, 255])
    expect(result.lo).toBe(0)
    expect(result.hi).toBe(255)
  })

  it('scales 16-bit RGBA samples to byte RGBA', () => {
    const result = normaliseToRgba(
      new Uint16Array([65_535, 0, 32_768, 16_384]),
      1,
      1,
      undefined,
      { samplesPerPixel: 4 },
    )

    expect([...result.rgba]).toEqual([255, 0, 128, 64])
    expect(result.lo).toBe(0)
    expect(result.hi).toBe(65_535)
  })
})
