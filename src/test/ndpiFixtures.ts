import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildTiffFile,
  TIFF_FLOAT,
  TIFF_LONG,
  TIFF_SHORT,
  TIFF_SLONG,
  u16,
} from './tiffFixtures'
import type { TestTiffImage, TestTiffTag } from './tiffFixtures'
import { decodeTiffChunkSamples } from '../codecs/tiffTile'

// src/test/fixtures/ndpi (see make_fixtures.py there): the JPEG streams of
// a three-level synthetic slide and its macro image.
export type NdpiFixtureJpeg = 'level0' | 'level1' | 'level2' | 'macro'

export const NDPI_FIXTURE_SIZES: Record<NdpiFixtureJpeg, readonly [number, number]> = {
  level0: [118, 44],
  level1: [59, 22],
  level2: [30, 11],
  macro: [40, 20],
}

export function ndpiFixtureJpeg(name: NdpiFixtureJpeg): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/ndpi', `${name}.jpg`)),
  )
}

// The McuStarts tag a NanoZoomer writes: where the scan's data starts, and
// the byte after each restart marker.
export function mcuStarts(jpeg: Uint8Array): number[] {
  let position = 2

  while (jpeg[position + 1] !== 0xda) {
    position += 2 + (((jpeg[position + 2] ?? 0) << 8) | (jpeg[position + 3] ?? 0))
  }

  const starts = [
    position + 2 + (((jpeg[position + 2] ?? 0) << 8) | (jpeg[position + 3] ?? 0)),
  ]

  for (let index = starts[0] ?? 0; index + 1 < jpeg.length; index += 1) {
    const marker = jpeg[index + 1] ?? 0

    if (jpeg[index] === 0xff && marker >= 0xd0 && marker <= 0xd7) {
      starts.push(index + 2)
    }
  }

  return starts
}

// The stream with the frame's width set to 0, as NanoZoomer writes levels
// wider than a JPEG header can state.
export function withZeroFrameWidth(jpeg: Uint8Array): Uint8Array {
  const copy = jpeg.slice()
  let position = 2

  while (copy[position + 1] !== 0xc0 && copy[position + 1] !== 0xc1) {
    position += 2 + (((copy[position + 2] ?? 0) << 8) | (copy[position + 3] ?? 0))
  }

  copy.set([0, 0], position + 7)
  return copy
}

// The pixels the whole stream decodes to, as 8-bit RGB.
export async function decodeWholeJpeg(name: NdpiFixtureJpeg): Promise<Uint8Array> {
  const [width, height] = NDPI_FIXTURE_SIZES[name]

  return new Uint8Array(
    await decodeTiffChunkSamples(ndpiFixtureJpeg(name), {
      compression: 7,
      photometric: 6,
      bitsPerSample: [8, 8, 8],
      samplesPerPixel: 3,
      tileWidth: width,
      tileHeight: height,
    }),
  )
}

export interface NdpiFixtureOptions {
  // Tags added to, or replacing, a level's tags.
  readonly levelTags?: (name: NdpiFixtureJpeg) => readonly TestTiffTag[]
  readonly withoutMcuStarts?: readonly NdpiFixtureJpeg[]
  // Leaves out the smallest level, so the smallest has restart markers.
  readonly withoutLevel2?: boolean
}

// A NanoZoomer-style NDPI: three levels, each one JPEG strip, then the
// macro image and the map. The map's IFD claims 65,535 entries, past the end
// of the file, so the open fails if the IFD walk goes past the macro.
export function ndpiFixtureFile(options: NdpiFixtureOptions = {}): Uint8Array {
  const image = (
    name: NdpiFixtureJpeg,
    magnification: number,
    stream: Uint8Array,
  ): TestTiffImage => {
    const [width, height] = NDPI_FIXTURE_SIZES[name]
    const extra = options.levelTags?.(name) ?? []
    const tags: TestTiffTag[] = [
      [65420, TIFF_SHORT, [1]],
      [65421, TIFF_FLOAT, [magnification]],
      [65424, TIFF_SLONG, [0]],
      // NanoZoomer leaves the tag out of small levels without restart
      // markers.
      ...(magnification > 0 &&
      name !== 'level2' &&
      !(options.withoutMcuStarts ?? []).includes(name)
        ? [[65426, TIFF_LONG, mcuStarts(stream)] as const]
        : []),
    ]

    return {
      width,
      height,
      subfileType: 0,
      description: '',
      samplesPerPixel: 3,
      bitsPerSample: 8,
      compression: 7,
      photometric: 6,
      value: () => 0,
      tileBytes: () => [...stream],
      extraTags: [
        ...tags.filter(([tag]) => !extra.some(([extraTag]) => extraTag === tag)),
        ...extra,
      ],
    }
  }
  const level0 = withZeroFrameWidth(ndpiFixtureJpeg('level0'))
  const { bytes, ifdOffsets } = buildTiffFile([
    image('level0', 40, level0),
    image('level1', 20, ndpiFixtureJpeg('level1')),
    ...(options.withoutLevel2 === true
      ? []
      : [image('level2', 10, ndpiFixtureJpeg('level2'))]),
    image('macro', -1, ndpiFixtureJpeg('macro')),
    image('macro', -2, ndpiFixtureJpeg('macro')),
  ])

  bytes.set(u16(0xffff), ifdOffsets.at(-1) ?? 0)
  return bytes
}
