import type { OpenJpegModule } from '@cornerstonejs/codec-openjpeg'

export type Jpeg2000Pixels = Uint8Array | Uint16Array

export interface DecodedJpeg2000 {
  readonly pixels: Jpeg2000Pixels
  readonly width: number
  readonly height: number
}

export interface DisplayWindow {
  readonly lo: number
  readonly hi: number
}

export interface RgbaRenderOptions {
  readonly color?: readonly [number, number, number]
  readonly alphaFromIntensity?: boolean
}

export interface RgbaTile {
  readonly rgba: Uint8ClampedArray
  readonly lo: number
  readonly hi: number
}

let decoderModulePromise: Promise<OpenJpegModule> | null = null

export async function warmJpeg2000Decoder(): Promise<void> {
  await ensureDecoderModule()
}

export async function decodeJpeg2000(bytes: Uint8Array): Promise<DecodedJpeg2000> {
  const openJpeg = await ensureDecoderModule()
  const decoder = new openJpeg.J2KDecoder()

  decoder.getEncodedBuffer(bytes.length).set(bytes)
  decoder.decode()

  const frameInfo = decoder.getFrameInfo()
  const raw = decoder.getDecodedBuffer()
  if (
    !Number.isFinite(frameInfo.width) ||
    !Number.isFinite(frameInfo.height) ||
    frameInfo.width <= 0 ||
    frameInfo.height <= 0
  ) {
    decoder.delete?.()
    throw new Error(
      `JPEG-2000 decode returned invalid dimensions ${frameInfo.width}x${frameInfo.height}.`,
    )
  }

  const expectedPixels = frameInfo.width * frameInfo.height
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const pixels =
    raw.byteLength === expectedPixels * 2
      ? new Uint16Array(buffer)
      : new Uint8Array(buffer)

  decoder.delete?.()

  return {
    pixels,
    width: frameInfo.width,
    height: frameInfo.height,
  }
}

export function normaliseToRgba(
  pixels: Jpeg2000Pixels,
  width: number,
  height: number,
  displayWindow?: DisplayWindow,
  options: RgbaRenderOptions = {},
): RgbaTile {
  const window = displayWindow ?? percentileWindow(pixels)
  const range = Math.max(1, window.hi - window.lo)
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

export const decodeJ2K = decodeJpeg2000
export const normaliseToRGBA = normaliseToRgba

function ensureDecoderModule(): Promise<OpenJpegModule> {
  decoderModulePromise ??= import('@cornerstonejs/codec-openjpeg').then(
    ({ default: createOpenJpegModule }) => createOpenJpegModule(),
  )
  return decoderModulePromise
}

function percentileWindow(pixels: Jpeg2000Pixels): DisplayWindow {
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

  return {
    lo,
    hi: hi === lo ? lo + 1 : hi,
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value))
}
